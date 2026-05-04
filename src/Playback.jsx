import { useEffect, useState } from "react";
import { apiFetch, videoSrc } from "./api.js";

export default function Playback() {
  const [recordings, setRecordings] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // { cameraId, cameraName, date }

  useEffect(() => {
    apiFetch("/api/videos")
      .then(setRecordings)
      .catch((e) => setError(e.message));
  }, []);

  // Build ordered list of cameras, preserving server's date ordering (newest first).
  const grouped = [];
  if (recordings) {
    const map = new Map();
    for (const r of recordings) {
      if (!map.has(r.cameraId)) {
        const entry = { id: r.cameraId, name: r.cameraName, dates: [] };
        map.set(r.cameraId, entry);
        grouped.push(entry);
      }
      map.get(r.cameraId).dates.push(r.date);
    }
  }

  return (
    <div className="pb-layout">
      <aside className="pb-sidebar">
        {!recordings && !error && <p className="pb-message">Loading…</p>}
        {error && <p className="pb-message pb-error">Could not load recordings:<br />{error}</p>}
        {recordings?.length === 0 && (
          <p className="pb-message">
            No recordings yet. The first encode runs at 00:05 after a full day of capture.
          </p>
        )}
        {grouped.map((cam) => (
          <div key={cam.id} className="pb-cam-group">
            <div className="pb-cam-name">{cam.name}</div>
            {cam.dates.map((date) => (
              <button
                key={date}
                className={`pb-date-btn${
                  selected?.cameraId === cam.id && selected?.date === date ? " active" : ""
                }`}
                onClick={() => setSelected({ cameraId: cam.id, cameraName: cam.name, date })}
              >
                {date}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <main className="pb-player">
        {selected ? (
          <>
            <div className="pb-player-title">
              {selected.cameraName} &mdash; {selected.date}
            </div>
            <video
              key={`${selected.cameraId}-${selected.date}`}
              className="pb-video"
              src={videoSrc(selected.cameraId, selected.date)}
              controls
              autoPlay
            />
          </>
        ) : (
          <div className="pb-player-empty">← Select a recording from the list</div>
        )}
      </main>
    </div>
  );
}
