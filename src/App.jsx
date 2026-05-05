import { useEffect, useState } from "react";
import "./App.css";
import Playback from "./Playback.jsx";

const REFRESH_MS = 5000;

// Replace with your chosen camera IDs
const CAMERAS = [
  { id: 258, name: "[258] Scott/Smirle" },
  { id: 114, name: "[114] Holland/Scott" },
  { id: 242, name: "[242] Bayview/Scott" },
  { id: 243, name: "[243] Parkdale/Scott" },
  { id: 310, name: "[310] Tunneys/Kichi Zibi" },
  { id: 260, name: "[260] Albert/City C." },
  { id: 232, name: "[232] Kichi Zibi/Vimy" },
  { id: 109, name: "[109] Parkdale/Wellington]" },
  { id: 182, name: "[182] Holland/Wellington" },
  { id: 128, name: "[128] 417 West @ Parkdale" },
  { id: 287, name: "[287] 417 East @ Parkdale" },
  { id: 359, name: "[359] Gladstone/Corso Italia" },
  { id: 93, name: "[93] Carling/Preston" },
  { id: 366, name: "[366] Preston/P.O.W." },
  { id: 171, name: "[171] Bronson/Sunnyside" },
  { id: 283, name: "[283] Bronson/Raven" },
];

const getCameraUrl = (id, tick) =>
  `https://traffic.ottawa.ca/camera?id=${id}&timems=${tick}`;

function App() {
  const [mode, setMode] = useState("live"); // "live" | "playback"
  const [tick, setTick] = useState(Date.now());
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(null);
  const [cameras, setCameras] = useState(() => {
    try {
      const saved = localStorage.getItem("cameras");
      return saved ? JSON.parse(saved) : CAMERAS;
    } catch {
      return CAMERAS;
    }
  });
  const [swapping, setSwapping] = useState(null); // { index, id, name }

  function switchMode(m) {
    setMode(m);
    setFullscreen(null);
  }

  function openSwap(e, i) {
    e.stopPropagation();
    setSwapping({ index: i, id: String(cameras[i].id), name: cameras[i].name });
  }

  function saveSwap(e) {
    e.preventDefault();
    const id = parseInt(swapping.id, 10);
    if (!Number.isFinite(id)) return;
    setCameras((prev) => {
      const next = prev.map((cam, i) => (i === swapping.index ? { id, name: swapping.name } : cam));
      localStorage.setItem("cameras", JSON.stringify(next));
      return next;
    });
    setSwapping(null);
  }

  function resetCameras() {
    localStorage.removeItem("cameras");
    setCameras(CAMERAS);
  }

  useEffect(() => {
    const interval = setInterval(() => {
      if (!paused) {
        setTick(Date.now());
      }
    }, REFRESH_MS);

    return () => clearInterval(interval);
  }, [paused]);

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">Ottawa Traffic Cams</span>
        <div className="mode-tabs">
          <button
            className={`mode-tab${mode === "live" ? " active" : ""}`}
            onClick={() => switchMode("live")}
          >
            Live
          </button>
          <button
            className={`mode-tab${mode === "playback" ? " active" : ""}`}
            onClick={() => switchMode("playback")}
          >
            Playback
          </button>
          {cameras !== CAMERAS && cameras.some((c, i) => c.id !== CAMERAS[i]?.id || c.name !== CAMERAS[i]?.name) && (
            <button className="mode-tab reset-tab" onClick={resetCameras} title="Restore default cameras">
              Reset
            </button>
          )}
        </div>
      </header>

      {mode === "live" && (
        <>
          <div className={`grid ${fullscreen !== null ? "hidden" : ""}`}>
            {cameras.map((cam, i) => (
              <div
                className="cam-wrapper"
                key={i}
                onMouseEnter={() => setPaused(true)}
                onMouseLeave={() => setPaused(false)}
                onClick={() => setFullscreen(i)}
              >
                <img
                  className="cam"
                  src={getCameraUrl(cam.id, tick)}
                  alt={cam.name}
                  referrerPolicy="no-referrer"
                />
                <div className="label">{cam.name}</div>
                <button
                  className="cam-edit-btn"
                  title="Swap camera"
                  onClick={(e) => openSwap(e, i)}
                >✎</button>
              </div>
            ))}
          </div>

          {fullscreen !== null && (
            <div className="fullscreen" onClick={() => setFullscreen(null)}>
              <img
                src={getCameraUrl(cameras[fullscreen].id, tick)}
                alt="fullscreen"
              />
            </div>
          )}

          {swapping !== null && (
            <div className="swap-overlay" onClick={() => setSwapping(null)}>
              <form
                className="swap-modal"
                onClick={(e) => e.stopPropagation()}
                onSubmit={saveSwap}
              >
                <div className="swap-title">Swap camera</div>
                <label className="swap-label">
                  Camera ID
                  <input
                    className="swap-input"
                    type="number"
                    min="1"
                    value={swapping.id}
                    onChange={(e) => setSwapping((s) => ({ ...s, id: e.target.value }))}
                    autoFocus
                  />
                </label>
                <label className="swap-label">
                  Name
                  <input
                    className="swap-input"
                    type="text"
                    value={swapping.name}
                    onChange={(e) => setSwapping((s) => ({ ...s, name: e.target.value }))}
                  />
                </label>
                <div className="swap-actions">
                  <button type="button" className="swap-btn swap-btn--cancel" onClick={() => setSwapping(null)}>Cancel</button>
                  <button type="submit" className="swap-btn swap-btn--save">Save</button>
                </div>
              </form>
            </div>
          )}
        </>
      )}

      {mode === "playback" && <Playback />}
    </div>
  );
}

export default App;