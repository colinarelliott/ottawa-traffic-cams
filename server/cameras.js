// Mirrors the camera list in src/App.jsx — keep in sync if cameras change.
// retainDays overrides the global RETAIN_DAYS env var for that camera.
export const CAMERAS = [
  { id: 258, name: "[258] Scott/Smirle",          retainDays: 5 },
  { id: 114, name: "[114] Holland/Scott",          retainDays: 5 },
  { id: 242, name: "[242] Bayview/Scott",          retainDays: 5 },
  { id: 243, name: "[243] Parkdale/Scott",         retainDays: 5 },
  { id: 310, name: "[310] Tunneys/Kichi Zibi",     retainDays: 5 },
  { id: 260, name: "[260] Albert/City C.",         retainDays: 5 },
  { id: 232, name: "[232] Kichi Zibi/Vimy",        retainDays: 5 },
  { id: 109, name: "[109] Parkdale/Wellington",    retainDays: 5 },
  { id: 182, name: "[182] Holland/Wellington",     retainDays: 5 },
  { id: 128, name: "[128] 417 West @ Parkdale",    retainDays: 5 },
  { id: 287, name: "[287] 417 East @ Parkdale",    retainDays: 5 },
  { id: 359, name: "[359] Gladstone/Corso Italia", retainDays: 5 },
  { id: 93,  name: "[93] Carling/Preston",         retainDays: 90 },
  { id: 366, name: "[366] Preston/P.O.W.",         retainDays: 90 },
  { id: 171, name: "[171] Bronson/Sunnyside",      retainDays: 5 },
  { id: 283, name: "[283] Bronson/Raven",          retainDays: 5 },
];

export const getCameraUrl = (id) =>
  `https://traffic.ottawa.ca/camera?id=${id}&timems=${Date.now()}`;
