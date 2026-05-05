import express from "express";
import fs from "fs/promises";
import { createReadStream, statSync } from "fs";
import path from "path";
import rateLimit from "express-rate-limit";
import { CAMERAS } from "./cameras.js";
import { captureStatus } from "./capture.js";

const VIDEOS_DIR = process.env.VIDEOS_DIR ?? "./data/videos";

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
      secure: process.env.NODE_ENV !== "development",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    return res.json({ ok: true });
  });

  // All subsequent routes require either the header key or the session cookie.
  router.use((req, res, next) => {
    const headerKey = req.headers["x-api-key"];
    const cookieKey = req.cookies?.session;
    if (headerKey !== process.env.API_SECRET && cookieKey !== process.env.API_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
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

  // GET /api/status
  // Returns per-camera capture health: last capture time, frame count today, error count.
  router.get("/status", (_req, res) => {
    const out = {};
    for (const cam of CAMERAS) {
      out[cam.id] = { name: cam.name, ...captureStatus.get(cam.id) };
    }
    res.json(out);
  });

  return router;
}
