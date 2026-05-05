import express from "express";
import fs from "fs/promises";
import { createReadStream, statSync } from "fs";
import path from "path";
import { createHmac, timingSafeEqual } from "crypto";
import rateLimit from "express-rate-limit";
import { CAMERAS } from "./cameras.js";
import { captureStatus } from "./capture.js";

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5-minute short-lived tokens for video streaming

function makeVideoToken(resource) {
  const expiry = Date.now() + TOKEN_TTL_MS;
  const sig = createHmac("sha256", process.env.API_SECRET)
    .update(`${resource}:${expiry}`)
    .digest("hex");
  return `${expiry}:${sig}`;
}

function checkVideoToken(resource, token) {
  if (!token || typeof token !== "string") return false;
  const colonIdx = token.indexOf(":");
  if (colonIdx === -1) return false;
  const expiryStr = token.slice(0, colonIdx);
  const sig = token.slice(colonIdx + 1);
  const expiry = parseInt(expiryStr, 10);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return false;
  const expected = createHmac("sha256", process.env.API_SECRET)
    .update(`${resource}:${expiry}`)
    .digest("hex");
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false; // buffers of different lengths
  }
}

const VIDEOS_DIR = process.env.VIDEOS_DIR ?? "./data/videos";
const FRAMES_DIR = process.env.FRAMES_DIR ?? "./data/frames";

// Whitelist of valid camera IDs for fast O(1) lookup.
const VALID_CAMERA_IDS = new Set(CAMERAS.map((c) => c.id));

export function createRouter() {
  const router = express.Router();

  // --- Auth ---
  // POST /api/auth: exchange the API secret for an httpOnly session cookie.
  // This keeps the secret out of URLs and browser history.
  router.post("/auth", (req, res) => {
    const key = req.headers["x-api-key"] ?? req.body?.apiKey;
    if (key !== process.env.API_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    res.cookie("session", process.env.API_SECRET, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    return res.json({ ok: true });
  });

  // All subsequent routes require a session cookie, the x-api-key header, or a
  // short-lived HMAC token (used by <video> elements on mobile where Safari's ITP
  // blocks third-party cookies on cross-origin media requests).
  router.use((req, res, next) => {
    const headerKey = req.headers["x-api-key"];
    const cookieKey = req.cookies?.session;
    if (headerKey === process.env.API_SECRET || cookieKey === process.env.API_SECRET) {
      return next();
    }
    // Accept a short-lived token on GET requests (video/weekly/monthly streaming).
    if (req.method === "GET" && req.query.token) {
      const resource = req.path.replace(/^\//, ""); // e.g. "videos/109/2026-05-04"
      if (checkVideoToken(resource, req.query.token)) {
        return next();
      }
    }
    return res.status(401).json({ error: "Unauthorized" });
  });

  // GET /api/token?resource=videos/cameraId/date
  // Issues a short-lived (5-min) HMAC token for a single streaming resource.
  // Requires normal session auth so only authenticated clients can mint tokens.
  router.get("/token", (req, res) => {
    const { resource } = req.query;
    if (!resource || typeof resource !== "string" || resource.length > 200) {
      return res.status(400).json({ error: "resource query param required" });
    }
    res.json({ token: makeVideoToken(resource) });
  });

  // --- Rate limiting: 120 requests/min per IP ---
  router.use(
    rateLimit({
      windowMs: 60_000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // GET /api/videos
  // Returns a list of all encoded recordings, newest date first.
  router.get("/videos", async (_req, res) => {
    try {
      const result = [];
      for (const cam of CAMERAS) {
        const camDir = path.join(VIDEOS_DIR, String(cam.id));
        let files;
        try {
          files = (await fs.readdir(camDir)).filter((f) => f.endsWith(".mp4"));
        } catch {
          continue; // camera has no recordings yet
        }
        for (const file of files) {
          result.push({
            cameraId: cam.id,
            cameraName: cam.name,
            date: file.replace(".mp4", ""),
          });
        }
      }
      result.sort((a, b) => b.date.localeCompare(a.date));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/videos/:cameraId/:date.vtt
  // Serves the WebVTT timecode file for a daily timelapse.
  router.get("/videos/:cameraId/:date.vtt", async (req, res) => {
    const cameraId = parseInt(req.params.cameraId, 10);
    const { date } = req.params;
    if (!Number.isFinite(cameraId) || !VALID_CAMERA_IDS.has(cameraId)) {
      return res.status(404).json({ error: "Unknown camera" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Invalid date format — use YYYY-MM-DD" });
    }
    const filePath = path.join(VIDEOS_DIR, String(cameraId), `${date}.vtt`);
    try {
      const content = await fs.readFile(filePath, "utf8");
      res.set("Content-Type", "text/vtt; charset=utf-8");
      return res.send(content);
    } catch {
      return res.status(404).json({ error: "Timecode file not found" });
    }
  });

  // GET /api/videos/:cameraId/:date
  // Streams an MP4 with full Range header support so the <video> element can seek.
  router.get("/videos/:cameraId/:date", (req, res) => {
    const cameraId = parseInt(req.params.cameraId, 10);
    const { date } = req.params;

    // Input validation — prevents path traversal attacks.
    if (!Number.isFinite(cameraId) || !VALID_CAMERA_IDS.has(cameraId)) {
      return res.status(404).json({ error: "Unknown camera" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Invalid date format — use YYYY-MM-DD" });
    }

    // path.join + the whitelist above makes traversal impossible.
    const filePath = path.join(VIDEOS_DIR, String(cameraId), `${date}.mp4`);

    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      return res.status(404).json({ error: "Video not found" });
    }

    const { size } = stat;
    const range = req.headers.range;

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : size - 1;

      if (start >= size || end >= size) {
        return res
          .status(416)
          .set("Content-Range", `bytes */${size}`)
          .end();
      }

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": "video/mp4",
      });
      createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": size,
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
      });
      createReadStream(filePath).pipe(res);
    }
  });

  // GET /api/weekly
  // Returns a list of all weekly timelapses, newest first.
  router.get("/weekly", async (_req, res) => {
    try {
      const result = [];
      for (const cam of CAMERAS) {
        const weeklyDir = path.join(VIDEOS_DIR, String(cam.id), "weekly");
        let files;
        try {
          files = (await fs.readdir(weeklyDir)).filter((f) => f.endsWith(".mp4"));
        } catch {
          continue;
        }
        for (const file of files) {
          result.push({
            cameraId: cam.id,
            cameraName: cam.name,
            weekEnd: file.replace(".mp4", ""),
          });
        }
      }
      result.sort((a, b) => b.weekEnd.localeCompare(a.weekEnd));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/weekly/:cameraId/:date.vtt
  // Serves the WebVTT timecode file for a weekly timelapse.
  router.get("/weekly/:cameraId/:date.vtt", async (req, res) => {
    const cameraId = parseInt(req.params.cameraId, 10);
    const { date } = req.params;
    if (!Number.isFinite(cameraId) || !VALID_CAMERA_IDS.has(cameraId)) {
      return res.status(404).json({ error: "Unknown camera" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Invalid date format — use YYYY-MM-DD" });
    }
    const filePath = path.join(VIDEOS_DIR, String(cameraId), "weekly", `${date}.vtt`);
    try {
      const content = await fs.readFile(filePath, "utf8");
      res.set("Content-Type", "text/vtt; charset=utf-8");
      return res.send(content);
    } catch {
      return res.status(404).json({ error: "Timecode file not found" });
    }
  });

  // GET /api/weekly/:cameraId/:date
  // Streams a weekly MP4 with full Range header support.
  router.get("/weekly/:cameraId/:date", (req, res) => {
    const cameraId = parseInt(req.params.cameraId, 10);
    const { date } = req.params;

    if (!Number.isFinite(cameraId) || !VALID_CAMERA_IDS.has(cameraId)) {
      return res.status(404).json({ error: "Unknown camera" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Invalid date format — use YYYY-MM-DD" });
    }

    const filePath = path.join(VIDEOS_DIR, String(cameraId), "weekly", `${date}.mp4`);

    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      return res.status(404).json({ error: "Weekly video not found" });
    }

    const { size } = stat;
    const range = req.headers.range;

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : size - 1;

      if (start >= size || end >= size) {
        return res.status(416).set("Content-Range", `bytes */${size}`).end();
      }

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": "video/mp4",
      });
      createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": size,
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
      });
      createReadStream(filePath).pipe(res);
    }
  });

  // GET /api/monthly
  // Returns a list of all monthly timelapses, newest first.
  router.get("/monthly", async (_req, res) => {
    try {
      const result = [];
      for (const cam of CAMERAS) {
        const monthlyDir = path.join(VIDEOS_DIR, String(cam.id), "monthly");
        let files;
        try {
          files = (await fs.readdir(monthlyDir)).filter((f) => f.endsWith(".mp4"));
        } catch {
          continue;
        }
        for (const file of files) {
          result.push({
            cameraId: cam.id,
            cameraName: cam.name,
            monthEnd: file.replace(".mp4", ""),
          });
        }
      }
      result.sort((a, b) => b.monthEnd.localeCompare(a.monthEnd));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/monthly/:cameraId/:date.vtt
  // Serves the WebVTT timecode file for a monthly timelapse.
  router.get("/monthly/:cameraId/:date.vtt", async (req, res) => {
    const cameraId = parseInt(req.params.cameraId, 10);
    const { date } = req.params;
    if (!Number.isFinite(cameraId) || !VALID_CAMERA_IDS.has(cameraId)) {
      return res.status(404).json({ error: "Unknown camera" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Invalid date format — use YYYY-MM-DD" });
    }
    const filePath = path.join(VIDEOS_DIR, String(cameraId), "monthly", `${date}.vtt`);
    try {
      const content = await fs.readFile(filePath, "utf8");
      res.set("Content-Type", "text/vtt; charset=utf-8");
      return res.send(content);
    } catch {
      return res.status(404).json({ error: "Timecode file not found" });
    }
  });

  // GET /api/monthly/:cameraId/:date
  // Streams a monthly MP4 with full Range header support.
  router.get("/monthly/:cameraId/:date", (req, res) => {
    const cameraId = parseInt(req.params.cameraId, 10);
    const { date } = req.params;

    if (!Number.isFinite(cameraId) || !VALID_CAMERA_IDS.has(cameraId)) {
      return res.status(404).json({ error: "Unknown camera" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Invalid date format — use YYYY-MM-DD" });
    }

    const filePath = path.join(VIDEOS_DIR, String(cameraId), "monthly", `${date}.mp4`);

    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      return res.status(404).json({ error: "Monthly video not found" });
    }

    const { size } = stat;
    const range = req.headers.range;

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : size - 1;

      if (start >= size || end >= size) {
        return res.status(416).set("Content-Range", `bytes */${size}`).end();
      }

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": "video/mp4",
      });
      createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": size,
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
      });
      createReadStream(filePath).pipe(res);
    }
  });

  // GET /api/status
  // Returns per-camera capture health: last capture time, frame count today, error count.
  router.get("/status", (_req, res) => {
    const out = {};
    for (const cam of CAMERAS) {
      const s = captureStatus.get(cam.id);
      const retainPct = s.todayCount > 0
        ? Math.round((s.retainedCount / s.todayCount) * 100)
        : null;
      out[cam.id] = { name: cam.name, ...s, retainPct };
    }
    res.json(out);
  });

  // GET /api/stats
  // Returns per-camera capture statistics including file counts and retention info.
  router.get("/stats", async (_req, res) => {
    const CAPTURE_INTERVAL_SEC = 5;
    const timezone = process.env.TZ_LOCAL ?? "America/Toronto";

    // Compute seconds elapsed since local midnight.
    const nowDate = new Date();
    const timeParts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    }).formatToParts(nowDate);
    const hour   = parseInt(timeParts.find((p) => p.type === "hour")?.value   ?? "0", 10) % 24;
    const minute = parseInt(timeParts.find((p) => p.type === "minute")?.value ?? "0", 10);
    const second = parseInt(timeParts.find((p) => p.type === "second")?.value ?? "0", 10);
    const secondsSinceMidnight = hour * 3600 + minute * 60 + second;
    const expectedCount = Math.floor(secondsSinceMidnight / CAPTURE_INTERVAL_SEC);

    // Compute today's local date string (e.g. "2026-05-05") to find today's frames dir.
    const todayDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(nowDate);

    try {
      const out = {};
      for (const cam of CAMERAS) {
        const status = captureStatus.get(cam.id);

        // Count actual .jpg files on disk so a server restart doesn't lose the tally.
        let todayCount = 0;
        try {
          const framesDir = path.join(FRAMES_DIR, String(cam.id), todayDate);
          const files = await fs.readdir(framesDir);
          todayCount = files.filter((f) => f.endsWith(".jpg")).length;
        } catch { /* directory doesn't exist yet */ }

        const retainPct = todayCount > 0
          ? Math.round((status.retainedCount / todayCount) * 100)
          : null;
        const capturePct = expectedCount > 0
          ? Math.round((todayCount / expectedCount) * 100)
          : null;

        const camVideoDir = path.join(VIDEOS_DIR, String(cam.id));
        let dailyVideos = 0, weeklyVideos = 0, monthlyVideos = 0;
        try {
          const files = await fs.readdir(camVideoDir);
          dailyVideos = files.filter((f) => f.endsWith(".mp4")).length;
        } catch { /* no recordings yet */ }
        try {
          const files = await fs.readdir(path.join(camVideoDir, "weekly"));
          weeklyVideos = files.filter((f) => f.endsWith(".mp4")).length;
        } catch { /* no weekly recordings yet */ }
        try {
          const files = await fs.readdir(path.join(camVideoDir, "monthly"));
          monthlyVideos = files.filter((f) => f.endsWith(".mp4")).length;
        } catch { /* no monthly recordings yet */ }

        out[cam.id] = {
          name: cam.name,
          retainDays: cam.retainDays,
          lastCapture: status.lastCapture,
          todayCount,
          expectedCount,
          capturePct,
          retainedCount: status.retainedCount,
          retainPct,
          errors: status.errors,
          noSignal: status.noSignal,
          dailyVideos,
          weeklyVideos,
          monthlyVideos,
        };
      }
      res.json(out);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
