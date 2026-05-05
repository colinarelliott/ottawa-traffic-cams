import fs from "fs/promises";
import path from "path";
import cron from "node-cron";
import { CAMERAS, getCameraUrl } from "./cameras.js";

const CAPTURE_INTERVAL_MS = 5000;
const FRAMES_DIR = process.env.FRAMES_DIR ?? "./data/frames";
const TIMEZONE = process.env.TZ_LOCAL ?? "America/Toronto";

// Per-camera status exposed to the /api/status endpoint.
export const captureStatus = new Map(
  CAMERAS.map((c) => [c.id, { lastCapture: null, todayCount: 0, errors: 0 }])
);

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
  // Filename is the Unix timestamp in ms — sorts correctly for ffmpeg ordering.
  await fs.writeFile(path.join(dir, `${Date.now()}.jpg`), buffer);

  const s = captureStatus.get(cam.id);
  s.lastCapture = new Date().toISOString();
  s.todayCount++;
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

export function startCaptureService() {
  console.log(
    `[capture] Starting — ${CAMERAS.length} cameras every ${CAPTURE_INTERVAL_MS}ms`
  );
  captureAll(); // capture immediately on startup, then on each interval
  setInterval(captureAll, CAPTURE_INTERVAL_MS);

  // Reset per-day counters at local midnight (the encode job fires at 00:05).
  cron.schedule("0 0 * * *", () => {
    for (const s of captureStatus.values()) {
      s.todayCount = 0;
      s.errors = 0;
    }
  }, { timezone: TIMEZONE });
}
