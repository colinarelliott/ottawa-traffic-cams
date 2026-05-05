import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import cron from "node-cron";
import { CAMERAS } from "./cameras.js";

const FRAMES_DIR = process.env.FRAMES_DIR ?? "./data/frames";
const VIDEOS_DIR = process.env.VIDEOS_DIR ?? "./data/videos";
const TIMELAPSE_FPS = parseInt(process.env.TIMELAPSE_FPS ?? "30", 10);
const RETAIN_DAYS = parseInt(process.env.RETAIN_DAYS ?? "5", 10);
const TIMEZONE = process.env.TZ_LOCAL ?? "America/Toronto";

function dateStr(d = new Date()) {
  // Format in local timezone so directory names match wall-clock days.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(d);
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateStr(d);
}

async function encodeCamera(cameraId, date) {
  const framesDir = path.join(FRAMES_DIR, String(cameraId), date);
  const videosDir = path.join(VIDEOS_DIR, String(cameraId));
  const outFile = path.join(videosDir, `${date}.mp4`);
  const listFile = path.join(framesDir, "filelist.txt");

  let files;
  try {
    files = (await fs.readdir(framesDir))
      .filter((f) => f.endsWith(".jpg"))
      .sort(); // numeric timestamps sort correctly as strings
  } catch {
    console.warn(`[encode] No frames dir for camera ${cameraId} on ${date}, skipping.`);
    return;
  }

  if (files.length === 0) {
    console.warn(`[encode] No frames found for camera ${cameraId} on ${date}, skipping.`);
    return;
  }

  // Build the concat list with explicit durations.
  // Each frame is displayed for 1/FPS seconds so every captured frame gets
  // equal screen time regardless of gaps caused by capture errors.
  // The last file must be listed twice — FFmpeg ignores the duration of the
  // final entry in a concat list, so duplicating it ensures it appears.
  const frameDuration = (1 / TIMELAPSE_FPS).toFixed(6);
  const lines = [];
  for (const f of files) {
    lines.push(`file '${path.resolve(framesDir, f)}'`);
    lines.push(`duration ${frameDuration}`);
  }
  // Duplicate last frame so its duration is honoured.
  lines.push(`file '${path.resolve(framesDir, files[files.length - 1])}'`);
  const listContent = lines.join("\n");
  await fs.writeFile(listFile, listContent);
  await fs.mkdir(videosDir, { recursive: true });

  console.log(
    `[encode] Encoding camera ${cameraId} for ${date} (${files.length} frames @ ${TIMELAPSE_FPS}fps)...`
  );

  await new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-y",                      // overwrite output if it exists
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-vf", `fps=${TIMELAPSE_FPS}`,
      "-c:v", "libx264",
      "-preset", "fast",
      "-pix_fmt", "yuv420p",     // maximum browser/player compatibility
      outFile,
    ]);

    // ffmpeg writes progress to stderr — surface it so the operator can see it.
    ff.stderr.on("data", (d) => process.stdout.write(d));

    ff.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(new Error("ffmpeg not found — install it with: brew install ffmpeg"));
      } else {
        reject(err);
      }
    });

    ff.on("close", (code) => {
      if (code === 0) {
        console.log(`[encode] Done: ${outFile}`);
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });

  // Delete raw frames to reclaim disk space now that the video exists.
  await Promise.all(files.map((f) => fs.unlink(path.join(framesDir, f))));
  await fs.unlink(listFile).catch(() => {}); // best-effort cleanup
  console.log(`[encode] Cleaned up ${files.length} frames for camera ${cameraId} on ${date}`);
}

export async function encodeDate(date) {
  console.log(`[encode] Starting batch encode for ${date}`);
  // Encode all cameras in parallel so a slow or failing camera doesn't
  // block the rest, and the total wall-clock time is much shorter.
  const results = await Promise.allSettled(
    CAMERAS.map((cam) => encodeCamera(cam.id, date))
  );
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`[encode] Camera ${CAMERAS[i].id} failed: ${r.reason?.message}`);
    }
  });
  console.log(`[encode] Batch encode complete for ${date}`);
}

async function pruneOldVideos() {
  let totalDeleted = 0;

  for (const cam of CAMERAS) {
    const retain = cam.retainDays ?? RETAIN_DAYS;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retain);
    const cutoffStr = dateStr(cutoff); // "YYYY-MM-DD" — string comparison works correctly

    const camDir = path.join(VIDEOS_DIR, String(cam.id));
    let files;
    try {
      files = (await fs.readdir(camDir)).filter((f) => f.endsWith(".mp4"));
    } catch {
      continue; // camera has no videos yet
    }
    for (const file of files) {
      const fileDate = file.replace(".mp4", "");
      if (fileDate < cutoffStr) {
        await fs.unlink(path.join(camDir, file));
        console.log(`[prune] Deleted ${camDir}/${file} (retain=${retain} days)`);
        totalDeleted++;
      }
    }
  }

  if (totalDeleted > 0) {
    console.log(`[prune] Removed ${totalDeleted} video(s)`);
  } else {
    console.log(`[prune] Nothing to prune`);
  }
}

export function scheduleEncoding() {
  // Run at 00:05 daily — 5 min after midnight so the last captures of the
  // previous day are safely flushed to disk before encoding starts.
  cron.schedule("5 0 * * *", async () => {
    await encodeDate(yesterday());
    await pruneOldVideos();
  }, { timezone: TIMEZONE });
  console.log(`[encode] Nightly encoding scheduled at 00:05 ${TIMEZONE} (retaining ${RETAIN_DAYS} days)`);
}
