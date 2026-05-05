import { useEffect, useState } from "react";
import { apiFetch } from "./api.js";

const REFRESH_MS = 30_000;

function pctColor(pct) {
  if (pct == null) return "#666";
  if (pct >= 90) return "#2ecc71";
  if (pct >= 70) return "#f1c40f";
  return "#e74c3c";
}

export default function Stats() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await apiFetch("/api/stats");
        if (!cancelled) { setStats(data); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (error) return <div className="stats-error">Failed to load stats: {error}</div>;
  if (!stats) return <div className="stats-loading">Loading…</div>;

  const { todayDate, dayProgressPct, cameras: cameraMap } = stats;
  const cameras = Object.entries(cameraMap).map(([id, s]) => ({ id: Number(id), ...s }));

  return (
    <div className="stats-page">
      <div className="stats-summary">
        <span className="stats-summary-date">{todayDate}</span>
        <div className="stats-progress-bar-wrap" title={`${dayProgressPct}% through today`}>
          <div className="stats-progress-bar-fill" style={{ width: `${dayProgressPct}%` }} />
        </div>
        <span className="stats-summary-pct">{dayProgressPct}% through today</span>
      </div>
      <table className="stats-table">
        <thead>
          <tr>
            <th className="stats-th stats-th--name">Camera</th>
            <th className="stats-th">Captured</th>
            <th className="stats-th">Expected&nbsp;Today</th>
            <th className="stats-th">Unavailable</th>
            <th className="stats-th">Capture&nbsp;%</th>
            <th className="stats-th">Valid&nbsp;%</th>
            <th className="stats-th">Retention</th>
            <th className="stats-th">Daily</th>
            <th className="stats-th">Weekly</th>
            <th className="stats-th">Monthly</th>
          </tr>
        </thead>
        <tbody>
          {cameras.map((cam) => (
            <tr key={cam.id} className="stats-row">
              <td className="stats-td stats-td--name">{cam.name}</td>
              <td className="stats-td stats-td--num">{cam.todayCount.toLocaleString()}</td>
              <td className="stats-td stats-td--num">{cam.expectedCount.toLocaleString()}</td>
              <td className="stats-td stats-td--num">{cam.noSignal.toLocaleString()}</td>
              <td className="stats-td stats-td--pct" style={{ color: pctColor(cam.capturePct) }}>
                {cam.capturePct != null ? `${cam.capturePct}%` : "—"}
              </td>
              <td className="stats-td stats-td--pct" style={{ color: pctColor(cam.retainPct) }}>
                {cam.retainPct != null ? `${cam.retainPct}%` : "—"}
              </td>
              <td className="stats-td stats-td--num">{cam.retainDays}d</td>
              <td className="stats-td stats-td--num">{cam.dailyVideos}</td>
              <td className="stats-td stats-td--num">{cam.weeklyVideos}</td>
              <td className="stats-td stats-td--num">{cam.monthlyVideos}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
