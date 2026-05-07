import { useEffect, useRef, useState } from "react";
import { apiFetch, getVideoSrc, getWeeklySrc, getMonthlySrc, getVideoVttSrc, getWeeklyVttSrc, getMonthlyVttSrc } from "./api.js";

// Load a video URL into the active Cast session (no-op if no session is open).
function loadMediaToCast(src, title) {
  const session = window.cast?.framework?.CastContext?.getInstance()?.getCurrentSession();
  if (!session || !src) return;
  const mediaInfo = new window.chrome.cast.media.MediaInfo(src, "video/mp4");
  mediaInfo.metadata = new window.chrome.cast.media.GenericMediaMetadata();
  mediaInfo.metadata.title = title ?? "";
  session.loadMedia(new window.chrome.cast.media.LoadRequest(mediaInfo)).catch(console.error);
}

export default function Playback() {
  const [view, setView] = useState("daily"); // "daily" | "weekly" | "monthly"
  const [recordings, setRecordings] = useState(null);
  const [weeklyRecordings, setWeeklyRecordings] = useState(null);
  const [monthlyRecordings, setMonthlyRecordings] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // { cameraId, cameraName, date, type }
  const [resolvedSrc, setResolvedSrc] = useState(null);
  const [resolvedVttSrc, setResolvedVttSrc] = useState(null);

  // Refs so Cast event-listener callbacks (created once) always see the latest values.
  const resolvedSrcRef = useRef(null);
  const selectedRef = useRef(null);
  useEffect(() => { resolvedSrcRef.current = resolvedSrc; }, [resolvedSrc]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // Initialise the Cast SDK once. The __onGCastApiAvailable callback fires when the
  // SDK finishes loading; if it already loaded, we call initCast() directly.
  useEffect(() => {
    function initCast() {
      window.cast.framework.CastContext.getInstance().setOptions({
        receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });
      const player = new window.cast.framework.RemotePlayer();
      const controller = new window.cast.framework.RemotePlayerController(player);
      controller.addEventListener(
        window.cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
        () => {
          if (player.isConnected) {
            const s = selectedRef.current;
            loadMediaToCast(
              resolvedSrcRef.current,
              s ? `${s.cameraName} \u2014 ${s.date}` : ""
            );
          }
        }
      );
    }
    if (window.cast?.framework) {
      initCast();
    } else {
      window.__onGCastApiAvailable = (isAvailable) => { if (isAvailable) initCast(); };
    }
  }, []);

  // When the selected video changes while already casting, push the new video.
  // loadMediaToCast is a no-op when no Cast session is active.
  useEffect(() => {
    if (!resolvedSrc || !selected) return;
    loadMediaToCast(resolvedSrc, `${selected.cameraName} \u2014 ${selected.date}`);
  }, [resolvedSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    apiFetch("/api/videos")
      .then(setRecordings)
      .catch((e) => setError(e.message));
    apiFetch("/api/weekly")
      .then(setWeeklyRecordings)
      .catch(() => setWeeklyRecordings([]));
    apiFetch("/api/monthly")
      .then(setMonthlyRecordings)
      .catch(() => setMonthlyRecordings([]));
  }, []);

  function switchView(v) {
    setView(v);
    setSelected(null);
  }

  // Fetch a short-lived token and build the authenticated video URL whenever
  // the selection changes.  This avoids relying on cookies for the <video>
  // request, which mobile Safari blocks on cross-origin media elements (ITP).
  useEffect(() => {
    if (!selected) {
      setResolvedSrc(null);
      setResolvedVttSrc(null);
      return;
    }
    setResolvedSrc(null); // clear previous while loading
    setResolvedVttSrc(null);
    let cancelled = false;
    const getSrc =
      selected.type === "monthly"
        ? getMonthlySrc(selected.cameraId, selected.date)
        : selected.type === "weekly"
        ? getWeeklySrc(selected.cameraId, selected.date)
        : getVideoSrc(selected.cameraId, selected.date);
    const getVttSrc =
      selected.type === "monthly"
        ? getMonthlyVttSrc(selected.cameraId, selected.date)
        : selected.type === "weekly"
        ? getWeeklyVttSrc(selected.cameraId, selected.date)
        : getVideoVttSrc(selected.cameraId, selected.date);
    getSrc.then((url) => { if (!cancelled) setResolvedSrc(url); }).catch(console.error);
    getVttSrc.then((url) => { if (!cancelled) setResolvedVttSrc(url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [selected]);

  // Group daily recordings by camera.
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

  // Group weekly recordings by camera.
  const weeklyGrouped = [];
  if (weeklyRecordings) {
    const map = new Map();
    for (const r of weeklyRecordings) {
      if (!map.has(r.cameraId)) {
        const entry = { id: r.cameraId, name: r.cameraName, weekEnds: [] };
        map.set(r.cameraId, entry);
        weeklyGrouped.push(entry);
      }
      map.get(r.cameraId).weekEnds.push(r.weekEnd);
    }
  }

  // Group monthly recordings by camera.
  const monthlyGrouped = [];
  if (monthlyRecordings) {
    const map = new Map();
    for (const r of monthlyRecordings) {
      if (!map.has(r.cameraId)) {
        const entry = { id: r.cameraId, name: r.cameraName, monthEnds: [] };
        map.set(r.cameraId, entry);
        monthlyGrouped.push(entry);
      }
      map.get(r.cameraId).monthEnds.push(r.monthEnd);
    }
  }

  const src = resolvedSrc;

  return (
    <div className="pb-layout">
      <aside className="pb-sidebar">
        <div className="pb-view-toggle">
          <button
            className={`pb-view-btn${view === "daily" ? " active" : ""}`}
            onClick={() => switchView("daily")}
          >Daily</button>
          <button
            className={`pb-view-btn${view === "weekly" ? " active" : ""}`}
            onClick={() => switchView("weekly")}
          >Weekly</button>
          <button
            className={`pb-view-btn${view === "monthly" ? " active" : ""}`}
            onClick={() => switchView("monthly")}
          >Monthly</button>
        </div>

        {view === "daily" && (
          <>
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
                    className={`pb-date-btn${selected?.cameraId === cam.id && selected?.date === date && selected?.type === "daily" ? " active" : ""}`}
                    onClick={() => setSelected({ cameraId: cam.id, cameraName: cam.name, date, type: "daily" })}
                  >
                    {date}
                  </button>
                ))}
              </div>
            ))}
          </>
        )}

        {view === "weekly" && (
          <>
            {!weeklyRecordings && <p className="pb-message">Loading…</p>}
            {weeklyRecordings?.length === 0 && (
              <p className="pb-message">
                No weekly timelapses yet. They are generated every Sunday night when a full week of daily videos exists.
              </p>
            )}
            {weeklyGrouped.map((cam) => (
              <div key={cam.id} className="pb-cam-group">
                <div className="pb-cam-name">{cam.name}</div>
                {cam.weekEnds.map((weekEnd) => (
                  <button
                    key={weekEnd}
                    className={`pb-date-btn${selected?.cameraId === cam.id && selected?.date === weekEnd && selected?.type === "weekly" ? " active" : ""}`}
                    onClick={() => setSelected({ cameraId: cam.id, cameraName: cam.name, date: weekEnd, type: "weekly" })}
                  >
                    Week of {weekEnd}
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
        {view === "monthly" && (
          <>
            {!monthlyRecordings && <p className="pb-message">Loading…</p>}
            {monthlyRecordings?.length === 0 && (
              <p className="pb-message">
                No monthly timelapses yet. They are generated after every 4 consecutive weekly videos exist for a camera.
              </p>
            )}
            {monthlyGrouped.map((cam) => (
              <div key={cam.id} className="pb-cam-group">
                <div className="pb-cam-name">{cam.name}</div>
                {cam.monthEnds.map((monthEnd) => (
                  <button
                    key={monthEnd}
                    className={`pb-date-btn${selected?.cameraId === cam.id && selected?.date === monthEnd && selected?.type === "monthly" ? " active" : ""}`}
                    onClick={() => setSelected({ cameraId: cam.id, cameraName: cam.name, date: monthEnd, type: "monthly" })}
                  >
                    Month ending {monthEnd}
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
      </aside>

      <main className="pb-player">
        {selected ? (
          <>
            <div className="pb-player-title">
              <span>
                {selected.cameraName} &mdash; {
                  selected.type === "monthly" ? `Month ending ${selected.date}` :
                  selected.type === "weekly"  ? `Week ending ${selected.date}` :
                  selected.date
                }
              </span>
              <google-cast-launcher className="cast-launcher" title="Cast to TV" />
            </div>
            <video
              key={`${selected.cameraId}-${selected.date}-${selected.type}`}
              className="pb-video"
              src={src}
              crossOrigin="anonymous"
              controls
              autoPlay
            >
              {resolvedVttSrc && (
                <track kind="subtitles" src={resolvedVttSrc} default />
              )}
            </video>
          </>
        ) : (
          <div className="pb-player-empty">← Select a recording from the list</div>
        )}
      </main>
    </div>
  );
}
