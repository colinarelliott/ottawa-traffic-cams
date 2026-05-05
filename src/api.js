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

// Video URL — no secret in the URL; the session cookie is sent automatically.
export function videoSrc(cameraId, date) {
  return `${API_BASE}/api/videos/${cameraId}/${date}`;
}
