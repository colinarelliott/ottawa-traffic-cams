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

  function switchMode(m) {
    setMode(m);
    setFullscreen(null);
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
        </div>
      </header>

      {mode === "live" && (
        <>
          <div className={`grid ${fullscreen !== null ? "hidden" : ""}`}>
            {CAMERAS.map((cam, i) => (
              <div
                className="cam-wrapper"
                key={cam.id}
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
              </div>
            ))}
          </div>

          {fullscreen !== null && (
            <div className="fullscreen" onClick={() => setFullscreen(null)}>
              <img
                src={getCameraUrl(CAMERAS[fullscreen].id, tick)}
                alt="fullscreen"
              />
            </div>
          )}
        </>
      )}

      {mode === "playback" && <Playback />}
    </div>
  );
}

export default App;