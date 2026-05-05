const API_BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:3001").replace(/\/$/, "");
const API_SECRET = import.meta.env.VITE_API_SECRET ?? "";

let _sessionReady = false;

// Exchange the API secret for an httpOnly session cookie once per page load.
// Subsequent requests (including <video> elements) use the cookie automatically.
export async function initSession() {
  if (_sessionReady) return;
  const res = await fetch(`${API_BASE}/api/auth`, {
    method: "POST",
    credentials: "include",
    headers: { "x-api-key": API_SECRET },
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  _sessionReady = true;
}

// Authenticated JSON fetch for data endpoints.
export async function apiFetch(path) {
  await initSession();
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

// Video URL helpers — these fetch a short-lived HMAC token from the server so
// the URL works on mobile Safari where ITP blocks cross-origin cookie sending
// from <video> elements (even with crossOrigin="use-credentials").
export async function getVideoSrc(cameraId, date) {
  const resource = `videos/${cameraId}/${date}`;
  const { token } = await apiFetch(`/api/token?resource=${encodeURIComponent(resource)}`);
  return `${API_BASE}/api/${resource}?token=${encodeURIComponent(token)}`;
}

export async function getWeeklySrc(cameraId, weekEnd) {
  const resource = `weekly/${cameraId}/${weekEnd}`;
  const { token } = await apiFetch(`/api/token?resource=${encodeURIComponent(resource)}`);
  return `${API_BASE}/api/${resource}?token=${encodeURIComponent(token)}`;
}

export async function getMonthlySrc(cameraId, monthEnd) {
  const resource = `monthly/${cameraId}/${monthEnd}`;
  const { token } = await apiFetch(`/api/token?resource=${encodeURIComponent(resource)}`);
  return `${API_BASE}/api/${resource}?token=${encodeURIComponent(token)}`;
}

// Legacy plain-URL exports kept for reference but no longer used for playback.
export function videoSrc(cameraId, date) {
  return `${API_BASE}/api/videos/${cameraId}/${date}`;
}

// Weekly timelapse URL.
export function weeklySrc(cameraId, weekEnd) {
  return `${API_BASE}/api/weekly/${cameraId}/${weekEnd}`;
}

// Monthly timelapse URL.
export function monthlySrc(cameraId, monthEnd) {
  return `${API_BASE}/api/monthly/${cameraId}/${monthEnd}`;
}
