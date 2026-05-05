import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import cron from "node-cron";
import { CAMERAS, getCameraUrl } from "./cameras.js";

const CAPTURE_INTERVAL_MS = 5000;
const FRAMES_DIR = process.env.FRAMES_DIR ?? "./data/frames";
const TIMEZONE = process.env.TZ_LOCAL ?? "America/Toronto";

// Expected resolution of a valid Ottawa traffic camera frame.
const VALID_WIDTH = 800;
const VALID_HEIGHT = 450;

// Path to the black replacement frame, generated once at startup.
const BLACK_FRAME_PATH = path.join(FRAMES_DIR, "black.jpg");

// Per-camera status exposed to the /api/status endpoint.
export const captureStatus = new Map(
  CAMERAS.map((c) => [c.id, { lastCapture: null, todayCount: 0, errors: 0, noSignal: 0, retainedCount: 0 }])
);

// Parses width/height from a JPEG buffer by scanning for SOF markers.
// No external library needed — the dimensions are in the raw header bytes.
function getJpegDimensions(buffer) {
  let i = 2; // skip SOI marker (FF D8)
  while (i + 8 < buffer.length) {
    if (buffer[i] !== 0xFF) break;
    const marker = buffer[i + 1];
    const segLen = buffer.readUInt16BE(i + 2);
    // SOF0–SOF3, SOF5–SOF7, SOF9–SOF11, SOF13–SOF15
    if (
      (marker >= 0xC0 && marker <= 0xC3) ||
      (marker >= 0xC5 && marker <= 0xC7) ||
      (marker >= 0xC9 && marker <= 0xCB) ||
      (marker >= 0xCD && marker <= 0xCF)
    ) {
      return {
        height: buffer.readUInt16BE(i + 5),
        width: buffer.readUInt16BE(i + 7),
      };
    }
    i += 2 + segLen;
  }
  return null;
}

// Generates a black JPEG at BLACK_FRAME_PATH using ffmpeg (runs once at startup).
async function ensureBlackFrame() {
  try {
    await fs.access(BLACK_FRAME_PATH);
    return; // already exists
  } catch {}

  await fs.mkdir(FRAMES_DIR, { recursive: true });
  await new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-y",
      "-f", "lavfi",
      "-i", `color=c=black:s=${VALID_WIDTH}x${VALID_HEIGHT}`,
      "-frames:v", "1",
      BLACK_FRAME_PATH,
    ]);
    ff.on("error", reject);
    ff.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))
    );
  });
  console.log(`[capture] Generated black frame at ${BLACK_FRAME_PATH}`);
}

function todayStr() {
  // Use local timezone so the directory date matches the wall-clock day,
  // not UTC (which rolls over at 8 pm EDT and would split an evening capture).
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
}

async function captureCamera(cam) {
  const dir = path.join(FRAMES_DIR, String(cam.id), todayStr());
  await fs.mkdir(dir, { recursive: true });

  const res = await fetch(getCameraUrl(cam.id), {
    headers: { "User-Agent": "ottawa-cams-archiver/1.0" },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const dims = getJpegDimensions(buffer);
  const isValid = dims?.width === VALID_WIDTH && dims?.height === VALID_HEIGHT;

  const destPath = path.join(dir, `${Date.now()}.jpg`);
  if (isValid) {
    await fs.writeFile(destPath, buffer);
  } else {
    // No-signal frame — substitute a black frame to preserve timing.
    await fs.copyFile(BLACK_FRAME_PATH, destPath);
    const ns = captureStatus.get(cam.id);
    ns.noSignal++;
    // Persist so the count survives server restarts.
    await fs.writeFile(path.join(dir, "_nosignal"), String(ns.noSignal)).catch(() => {});
    console.warn(`[capture] Camera ${cam.id}: no-signal frame replaced with black (got ${dims ? `${dims.width}x${dims.height}` : "unparseable"})`);
  }

  const s = captureStatus.get(cam.id);
  s.lastCapture = new Date().toISOString();
  s.todayCount++;
  if (isValid) s.retainedCount++;
}

async function captureAll() {
  // Fire all cameras in parallel; a single camera failure must not block others.
  await Promise.allSettled(
    CAMERAS.map(async (cam) => {
      try {
        await captureCamera(cam);
      } catch (err) {
        captureStatus.get(cam.id).errors++;
        console.error(`[capture] Camera ${cam.id} failed: ${err.message}`);
      }
    })
  );
}

export async function startCaptureService() {
  console.log(
    `[capture] Starting — ${CAMERAS.length} cameras every ${CAPTURE_INTERVAL_MS}ms`
  );

  await ensureBlackFrame();

  // Get the black frame's file size — used as a fingerprint to detect black frames
  // on disk without hashing every file (avoids reading file contents at scale).
  const blackFrameSize = (await fs.stat(BLACK_FRAME_PATH)).size;

  // Re-initialize today's counters from disk so a restart doesn't lose the tally.
  const todayDate = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
  await Promise.allSettled(
    CAMERAS.map(async (cam) => {
      const dir = path.join(FRAMES_DIR, String(cam.id), todayDate);
      const s = captureStatus.get(cam.id);
      try {
        const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jpg"));
        s.todayCount = files.length;

        // Prefer the sidecar if it exists (written incrementally, no per-file stat needed).
        // Fall back to a size-based scan for frames captured before the sidecar was introduced.
        const sidecarStr = await fs.readFile(path.join(dir, "_nosignal"), "utf8").catch(() => null);
        if (sidecarStr !== null) {
          s.noSignal = parseInt(sidecarStr, 10) || 0;
        } else {
          // Scan each frame's size against the known black frame size.
          const stats = await Promise.all(
            files.map((f) => fs.stat(path.join(dir, f)).then((st) => st.size))
          );
          s.noSignal = stats.filter((sz) => sz === blackFrameSize).length;
          // Write the sidecar so future restarts skip this scan.
          await fs.writeFile(path.join(dir, "_nosignal"), String(s.noSignal)).catch(() => {});
        }
        s.retainedCount = s.todayCount - s.noSignal;
        console.log(`[capture] Init camera ${cam.id}: ${s.todayCount} frames, ${s.noSignal} no-signal, ${s.errors} errors`);
      } catch { /* no frames yet today — leave counters at 0 */ }
    })
  );

  captureAll(); // capture immediately on startup, then on each interval
  setInterval(captureAll, CAPTURE_INTERVAL_MS);

  // Reset per-day counters at local midnight (the encode job fires at 00:05).
  cron.schedule("0 0 * * *", () => {
    for (const s of captureStatus.values()) {
      s.todayCount = 0;
      s.errors = 0;
      s.noSignal = 0;
      s.retainedCount = 0;
    }
  }, { timezone: TIMEZONE });
}
