# Ottawa Traffic Cams
- A very simple React/Vite app that takes data from ottawa-traffic.com and compiles it into a page of viewable cams to be put on a screen.
- Configured for 16 cams, dynamically scales to any amount.
- Refresh every 5s.
- Click a camera to view max size.

## To Configure:
- Simply open `src/App.jsx`
- Find this array of camera definitions:

```javascript
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
]
```

- Replace with your own ID and name for the camera.
- Use Ottawa-traffic.com, select cameras to find ID. Note: Highway cameras will not work as they fall under a different base web URL than Ottawa's traffic cams.


### Notes
- 100% vibe coded in 5 minutes with ChatGPT. Expect bugs.
- My version deployed at: https://ottawa-traffic-cams.vercel.app/
