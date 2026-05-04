const API_BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:3001").replace(/\/$/, "");
const API_SECRET = import.meta.env.VITE_API_SECRET ?? "";

// Authenticated JSON fetch for data endpoints.
export async function apiFetch(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "x-api-key": API_SECRET },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

// Video URLs embed the secret as a query param because the <video> element
// cannot send custom headers. Only use this for video src attributes.
export function videoSrc(cameraId, date) {
  return `${API_BASE}/api/videos/${cameraId}/${date}?apiKey=${encodeURIComponent(API_SECRET)}`;
}
