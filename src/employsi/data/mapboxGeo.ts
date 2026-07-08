// Real-world Perth head-office coordinates for each company, geocoded from
// their actual HQ street addresses via the Mapbox Geocoding API. The default
// camera is framed to fit the whole spread — most sit along St Georges
// Terrace, but Fortescue (East Perth) and Sandfire (West Perth) are ~1.5km
// either side of the CBD cluster.
export const PERTH_CENTER: [number, number] = [115.8552, -31.9542];
export const PERTH_DEFAULT_ZOOM = 15.3;
export const PERTH_DEFAULT_PITCH = 60;
export const PERTH_DEFAULT_BEARING = -17.6;

export const COMPANY_COORDS: Record<string, [number, number]> = {
  rio: [115.85582, -31.95409], // Rio Tinto — Central Park, 152 St Georges Tce
  bhp: [115.85455, -31.95471], // BHP — Brookfield Place, 125 St Georges Tce
  s32: [115.85715, -31.95453], // South32 — 108 St Georges Tce
  fmg: [115.87415, -31.96062], // Fortescue — 87 Adelaide Tce, East Perth
  wds: [115.84986, -31.95382], // Woodside — Mia Yellagonga, 11 Mount St
  sto: [115.85076, -31.95193], // Santos — 250 St Georges Tce
  sfr: [115.84138, -31.95249], // Sandfire — 10 Kings Park Rd, West Perth
  igo: [115.85633, -31.9542], // IGO — 140 St Georges Tce
};
