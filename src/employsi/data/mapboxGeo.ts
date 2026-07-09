// Real-world Perth head-office coordinates for each company, geocoded from
// their actual HQ street addresses via the Mapbox Geocoding API. The default
// camera is framed to fit the whole spread — most sit along St Georges
// Terrace, but Fortescue (East Perth) and Sandfire (West Perth) are ~1.5km
// either side of the CBD cluster.
export const PERTH_CENTER: [number, number] = [115.8552, -31.9542];
export const PERTH_DEFAULT_ZOOM = 15.3;
export const PERTH_DEFAULT_PITCH = 60;
export const PERTH_DEFAULT_BEARING = -17.6;

// Local city views. Only Perth has companies mapped for now; the others open
// the same 3D city look with no company pins yet.
export interface CityView {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}
export const CITY_VIEWS: Record<string, CityView> = {
  perth: { center: PERTH_CENTER, zoom: PERTH_DEFAULT_ZOOM, pitch: PERTH_DEFAULT_PITCH, bearing: PERTH_DEFAULT_BEARING },
  brisbane: { center: [153.026, -27.4705], zoom: 15.2, pitch: 60, bearing: -18 },
  adelaide: { center: [138.6007, -34.9285], zoom: 15.2, pitch: 60, bearing: -16 },
  singapore: { center: [103.8519, 1.29], zoom: 15.1, pitch: 60, bearing: -12 },
  ganzhou: { center: [114.9333, 25.83], zoom: 14.8, pitch: 60, bearing: -14 },
};

export const COMPANY_COORDS: Record<string, [number, number]> = {
  rio: [115.85582, -31.95409], // Rio Tinto — Central Park, 152 St Georges Tce
  bhp: [115.85455, -31.95471], // BHP — Brookfield Place, 125 St Georges Tce
  s32: [115.85715, -31.95453], // South32 — 108 St Georges Tce
  fmg: [115.87415, -31.96062], // Fortescue — 87 Adelaide Tce, East Perth
  wds: [115.84986, -31.95382], // Woodside — Mia Yellagonga, 11 Mount St
  sto: [115.85076, -31.95193], // Santos — 250 St Georges Tce
  sfr: [115.84138, -31.95249], // Sandfire — 10 Kings Park Rd, West Perth
  igo: [115.85633, -31.9542], // IGO — 140 St Georges Tce
  min: [115.82786, -31.9019], // Mineral Resources — 20 Walters Dr, Osborne Park
  pls: [115.84361, -31.9464], // Pilbara Minerals — 130 Stirling Hwy area / West Perth
  ltr: [115.8398, -31.9512], // Liontown Resources — West Perth
  ilu: [115.8599, -31.957], // Iluka Resources — 140 St Georges Tce precinct
  nst: [115.8256, -31.9481], // Northern Star — Subiaco
};
