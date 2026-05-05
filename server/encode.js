import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import cron from "node-cron";
import { CAMERAS } from "./cameras.js";

const FRAMES_DIR = process.env.FRAMES_DIR ?? "./data/frames";
const VIDEOS_DIR = process.env.VIDEOS_DIR ?? "./data/videos";
const TIMELAPSE_FPS = parseInt(process.env.TIMELAPSE_FPS ?? "30", 10);
const RETAIN_DAYS = parseInt(process.env.RETAIN_DAYS ?? "5", 10);
const RETAIN_WEEKS = parseInt(process.env.RETAIN_WEEKS ?? "12", 10);
const RETAIN_MONTHS = parseInt(process.env.RETAIN_MONTHS ?? "12", 10);
const TIMEZONE = process.env.TZ_LOCAL ?? "America/Toronto";

// --- WebVTT timecode helpers ---

// Converts a number of milliseconds into a VTT timestamp "HH:MM:SS.mmm".
function msToVttTime(totalMs) {
  const ms = Math.round(totalMs) % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

// Parses a VTT timestamp "HH:MM:SS.mmm" back into milliseconds.
function vttTimeToMs(vttTime) {
  const [hms, milliStr] = vttTime.split(".");
  const [h, m, s] = hms.split(":").map(Number);
  return (h * 3600 + m * 60 + s) * 1000 + parseInt(milliStr || "0", 10);
}

// Builds a WebVTT string for a daily timelapse.
// Each cue spans one frame in video-time and shows the wall-clock time
// derived from the frame's Unix-ms filename.
function generateDailyVtt(files) {
  const frameDurationMs = 1000 / TIMELAPSE_FPS;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const lines = ["WEBVTT", ""];
  for (let i = 0; i < files.length; i++) {
    const tsMs = parseInt(files[i].replace(".jpg", ""), 10);
    const startMs = i * frameDurationMs;
    const endMs = (i + 1) * frameDurationMs;
    lines.push(`${msToVttTime(startMs)} --> ${msToVttTime(endMs)}`);
    lines.push(formatter.format(new Date(tsMs)));
    lines.push("");
  }
  return lines.join("\n");
}

// Concatenates multiple VTT files into one, shifting each segment's cue
// timings by the cumulative video duration of all preceding segments.
async function concatenateVtts(vttPaths) {
  const segments = [];
  let cumulativeMs = 0;

  for (const vttPath of vttPaths) {
    const content = await fs.readFile(vttPath, "utf8");
    let segmentEndMs = 0;
    const shifted = [];

    for (const line of content.split("\n")) {
      const m = line.trim().match(/^(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})$/);
      if (m) {
        const origStart = vttTimeToMs(m[1]);
        const origEnd = vttTimeToMs(m[2]);
        segmentEndMs = Math.max(segmentEndMs, origEnd);
        shifted.push(`${msToVttTime(origStart + cumulativeMs)} --> ${msToVttTime(origEnd + cumulativeMs)}`);
      } else if (line.trim() !== "WEBVTT") {
        shifted.push(line);
      }
    }

    cumulativeMs += segmentEndMs;
    const trimmed = shifted.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
    if (trimmed) segments.push(trimmed);
  }

  return "WEBVTT\n\n" + segments.join("\n\n") + "\n";
}

function dateStr(d = new Date()) {
  // Format in local timezone so directory names match wall-clock days.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(d);
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateStr(d);
}

// Returns true if yesterday was a Sunday (last day of an ISO Mon–Sun week).
function isEndOfWeek() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.getDay() === 0;
}

// Returns the 7 date strings [Mon, Tue, …, Sun] for the week ending on sundayDateStr.
function weekDatesFor(sundayDateStr) {
  const [y, m, d] = sundayDateStr.split("-").map(Number);
  const sun = new Date(y, m - 1, d);
  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(sun);
    day.setDate(sun.getDate() - i);
    dates.push(dateStr(day));
  }
  return dates;
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

  // Write a WebVTT timecode file alongside the MP4.
  const vttFile = path.join(videosDir, `${date}.vtt`);
  await fs.writeFile(vttFile, generateDailyVtt(files));

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

async function encodeWeeklyForCamera(cam, weekDates, weekEndDate) {
  const camDailyDir = path.join(VIDEOS_DIR, String(cam.id));
  const camWeeklyDir = path.join(VIDEOS_DIR, String(cam.id), "weekly");
  const outFile = path.join(camWeeklyDir, `${weekEndDate}.mp4`);

  // Verify all 7 daily videos exist before attempting to concatenate.
  for (const d of weekDates) {
    try {
      await fs.access(path.join(camDailyDir, `${d}.mp4`));
    } catch {
      console.log(`[weekly] Camera ${cam.id}: missing ${d}.mp4, skipping`);
      return;
    }
  }

  // Skip if this weekly video was already produced.
  try {
    await fs.access(outFile);
    console.log(`[weekly] Camera ${cam.id}: ${weekEndDate} already exists, skipping`);
    return;
  } catch {}

  await fs.mkdir(camWeeklyDir, { recursive: true });

  // Stream-copy concat — no re-encoding, very fast.
  const listFile = path.join(camWeeklyDir, `${weekEndDate}.txt`);
  const lines = weekDates.map((d) => `file '${path.resolve(camDailyDir, `${d}.mp4`)}'`);
  await fs.writeFile(listFile, lines.join("\n"));

  console.log(`[weekly] Encoding camera ${cam.id} week ending ${weekEndDate}...`);

  await new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-c", "copy",
      outFile,
    ]);
    ff.stderr.on("data", (d) => process.stdout.write(d));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code === 0) {
        console.log(`[weekly] Done: ${outFile}`);
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });

  // Concatenate the daily VTT timecode files into a weekly one.
  const weeklyVttFile = path.join(camWeeklyDir, `${weekEndDate}.vtt`);
  const dailyVttPaths = weekDates.map((d) => path.join(camDailyDir, `${d}.vtt`));
  try {
    await fs.writeFile(weeklyVttFile, await concatenateVtts(dailyVttPaths));
  } catch (err) {
    console.warn(`[weekly] Could not generate timecode VTT for camera ${cam.id}: ${err.message}`);
  }

  await fs.unlink(listFile).catch(() => {});
}

async function checkAndEncodeWeeklies() {
  if (!isEndOfWeek()) return;

  const yest = yesterday();
  const weekDates = weekDatesFor(yest);
  console.log(`[weekly] Sunday — encoding weeklies for week ending ${yest}`);

  const results = await Promise.allSettled(
    CAMERAS.map((cam) => encodeWeeklyForCamera(cam, weekDates, yest))
  );
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`[weekly] Camera ${CAMERAS[i].id} failed: ${r.reason?.message}`);
    }
  });
}

async function encodeMonthlyForCamera(cam, weekFiles, weekEndDate) {
  const camWeeklyDir = path.join(VIDEOS_DIR, String(cam.id), "weekly");
  const camMonthlyDir = path.join(VIDEOS_DIR, String(cam.id), "monthly");
  const outFile = path.join(camMonthlyDir, `${weekEndDate}.mp4`);

  // Verify all 4 weekly videos exist.
  for (const f of weekFiles) {
    try {
      await fs.access(path.join(camWeeklyDir, f));
    } catch {
      console.log(`[monthly] Camera ${cam.id}: missing weekly ${f}, skipping`);
      return;
    }
  }

  // Skip if already produced.
  try {
    await fs.access(outFile);
    console.log(`[monthly] Camera ${cam.id}: ${weekEndDate} already exists, skipping`);
    return;
  } catch {}

  await fs.mkdir(camMonthlyDir, { recursive: true });

  const listFile = path.join(camMonthlyDir, `${weekEndDate}.txt`);
  const lines = weekFiles.map((f) => `file '${path.resolve(camWeeklyDir, f)}'`);
  await fs.writeFile(listFile, lines.join("\n"));

  console.log(`[monthly] Encoding camera ${cam.id} month ending ${weekEndDate}...`);

  await new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-c", "copy",
      outFile,
    ]);
    ff.stderr.on("data", (d) => process.stdout.write(d));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code === 0) {
        console.log(`[monthly] Done: ${outFile}`);
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });

  // Concatenate the weekly VTT timecode files into a monthly one.
  const monthlyVttFile = path.join(camMonthlyDir, `${weekEndDate}.vtt`);
  const weeklyVttPaths = weekFiles.map((f) => path.join(camWeeklyDir, f.replace(".mp4", ".vtt")));
  try {
    await fs.writeFile(monthlyVttFile, await concatenateVtts(weeklyVttPaths));
  } catch (err) {
    console.warn(`[monthly] Could not generate timecode VTT for camera ${cam.id}: ${err.message}`);
  }

  await fs.unlink(listFile).catch(() => {});
}

async function checkAndEncodeMonthlies() {
  if (!isEndOfWeek()) return;

  for (const cam of CAMERAS) {
    const camWeeklyDir = path.join(VIDEOS_DIR, String(cam.id), "weekly");
    const camMonthlyDir = path.join(VIDEOS_DIR, String(cam.id), "monthly");

    let allWeekly;
    try {
      allWeekly = (await fs.readdir(camWeeklyDir))
        .filter((f) => f.endsWith(".mp4"))
        .sort();
    } catch {
      continue;
    }

    // Find groups of 4 consecutive weekly files not yet rolled into a monthly.
    let existingMonthly;
    try {
      existingMonthly = new Set(
        (await fs.readdir(camMonthlyDir)).filter((f) => f.endsWith(".mp4"))
      );
    } catch {
      existingMonthly = new Set();
    }

    for (let i = 0; i + 3 < allWeekly.length; i += 4) {
      const group = allWeekly.slice(i, i + 4);
      const monthLabel = group[3]; // named after the last (4th) Sunday
      if (existingMonthly.has(monthLabel)) continue;
      try {
        await encodeMonthlyForCamera(cam, group, monthLabel.replace(".mp4", ""));
      } catch (err) {
        console.error(`[monthly] Camera ${cam.id} failed: ${err.message}`);
      }
    }
  }
}

async function pruneOldMonthlyVideos() {
  let totalDeleted = 0;
  for (const cam of CAMERAS) {
    const retain = cam.retainMonths ?? RETAIN_MONTHS;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retain * 28); // ~4 weeks per month
    const cutoffStr = dateStr(cutoff);

    const camMonthlyDir = path.join(VIDEOS_DIR, String(cam.id), "monthly");
    let files;
    try {
      files = (await fs.readdir(camMonthlyDir)).filter((f) => f.endsWith(".mp4"));
    } catch {
      continue;
    }
    for (const file of files) {
      if (file.replace(".mp4", "") < cutoffStr) {
        await fs.unlink(path.join(camMonthlyDir, file));
        await fs.unlink(path.join(camMonthlyDir, file.replace(".mp4", ".vtt"))).catch(() => {});
        console.log(`[prune-monthly] Deleted ${camMonthlyDir}/${file}`);
        totalDeleted++;
      }
    }
  }
  if (totalDeleted > 0) {
    console.log(`[prune-monthly] Removed ${totalDeleted} monthly video(s)`);
  }
}

async function pruneOldWeeklyVideos() {
  let totalDeleted = 0;
  for (const cam of CAMERAS) {
    const retain = cam.retainWeeks ?? RETAIN_WEEKS;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retain * 7);
    const cutoffStr = dateStr(cutoff);

    const camWeeklyDir = path.join(VIDEOS_DIR, String(cam.id), "weekly");
    let files;
    try {
      files = (await fs.readdir(camWeeklyDir)).filter((f) => f.endsWith(".mp4"));
    } catch {
      continue;
    }
    for (const file of files) {
      if (file.replace(".mp4", "") < cutoffStr) {
        await fs.unlink(path.join(camWeeklyDir, file));
        await fs.unlink(path.join(camWeeklyDir, file.replace(".mp4", ".vtt"))).catch(() => {});
        console.log(`[prune-weekly] Deleted ${camWeeklyDir}/${file}`);
        totalDeleted++;
      }
    }
  }
  if (totalDeleted > 0) {
    console.log(`[prune-weekly] Removed ${totalDeleted} weekly video(s)`);
  }
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
        await fs.unlink(path.join(camDir, file.replace(".mp4", ".vtt"))).catch(() => {});
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
    await checkAndEncodeWeeklies();
    await checkAndEncodeMonthlies();
    await pruneOldVideos();
    await pruneOldWeeklyVideos();
    await pruneOldMonthlyVideos();
  }, { timezone: TIMEZONE });
  console.log(`[encode] Nightly encoding scheduled at 00:05 ${TIMEZONE} (retaining ${RETAIN_DAYS} days / ${RETAIN_WEEKS} weeks / ${RETAIN_MONTHS} months)`);
}
