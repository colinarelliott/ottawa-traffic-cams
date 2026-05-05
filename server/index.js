import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { startCaptureService } from "./capture.js";
import { scheduleEncoding } from "./encode.js";
import { createRouter } from "./api.js";

if (!process.env.API_SECRET) {
  console.error("[startup] ERROR: API_SECRET is not set. Refusing to start.");
  console.error("[startup] Copy .env.example to .env and fill in the values.");
  process.exit(1);
}

const PORT = process.env.PORT ?? 3001;
// ALLOWED_ORIGIN supports a comma-separated list, e.g.:
//   http://localhost:5173,https://your-app.vercel.app
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();

app.use(
  cors({
    origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : false,
    methods: ["GET", "POST"],
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

// Unauthenticated health check — useful for uptime monitors / Cloudflare Tunnel health.
app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", createRouter());

app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
  if (ALLOWED_ORIGINS.length) {
    console.log(`[server] CORS allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
  } else {
    console.warn("[server] ALLOWED_ORIGIN not set — CORS disabled (same-origin only)");
  }
  startCaptureService();
  scheduleEncoding();
});
