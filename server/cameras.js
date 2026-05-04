// Mirrors the camera list in src/App.jsx — keep in sync if cameras change.
export const CAMERAS = [
  { id: 258, name: "[258] Scott/Smirle" },
  { id: 114, name: "[114] Holland/Scott" },
  { id: 242, name: "[242] Bayview/Scott" },
  { id: 243, name: "[243] Parkdale/Scott" },
  { id: 310, name: "[310] Tunneys/Kichi Zibi" },
  { id: 260, name: "[260] Albert/City C." },
  { id: 232, name: "[232] Kichi Zibi/Vimy" },
  { id: 109, name: "[109] Parkdale/Wellington" },
  { id: 182, name: "[182] Holland/Wellington" },
  { id: 128, name: "[128] 417 West @ Parkdale" },
  { id: 287, name: "[287] 417 East @ Parkdale" },
  { id: 359, name: "[359] Gladstone/Corso Italia" },
  { id: 93,  name: "[93] Carling/Preston" },
  { id: 366, name: "[366] Preston/P.O.W." },
  { id: 171, name: "[171] Bronson/Sunnyside" },
  { id: 283, name: "[283] Bronson/Raven" },
];

export const getCameraUrl = (id) =>
  `https://traffic.ottawa.ca/camera?id=${id}&timems=${Date.now()}`;
