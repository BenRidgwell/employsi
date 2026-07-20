// Real head-office coordinates for Perth-plotted entities, geocoded from each
// body's authoritative head-office street address via OpenStreetMap
// (Nominatim). Only entities whose exact address is verifiable are listed;
// every other Perth pin falls back to the generated fan around the CBD.
// Currently covers WA government agencies with well-documented head offices.

export const PERTH_REAL_COORDS: Record<string, [number, number]> = {
  "perth-gov-chemcentre": [115.891604, -32.01065],
  "perth-gov-child-and-adolescent-health-service": [115.81648, -31.970402],
  "perth-gov-corruption-and-crime-commission": [115.859236, -31.947979],
  "perth-gov-department-of-biodiversity-conservation-and-attractions": [115.883793, -31.995457],
  "perth-gov-department-of-education": [115.877824, -31.953211],
  "perth-gov-department-of-fire-emergency-services": [115.856085, -32.127206],
  "perth-gov-department-of-health": [115.869986, -31.952529],
  "perth-gov-department-of-justice": [115.853925, -31.955126],
  "perth-gov-department-of-planning-lands-and-heritage": [115.858204, -31.952091],
  "perth-gov-department-of-the-premier-and-cabinet": [115.843745, -31.953201],
  "perth-gov-department-of-training-and-workforce-development": [115.815994, -31.916701],
  "perth-gov-east-metropolitan-health-service": [115.865901, -31.953307],
  "perth-gov-forest-products-commission": [115.910884, -31.954052],
  "perth-gov-insurance-commission-of-western-australia": [115.852113, -31.953709],
  "perth-gov-lotterywest": [115.813156, -31.912209],
  "perth-gov-main-roads-wa": [115.876645, -31.957365],
  "perth-gov-metropolitan-cemeteries-board": [115.798574, -31.967205],
  "perth-gov-north-metropolitan-health-service": [115.816733, -31.967641],
  "perth-gov-north-metropolitan-tafe": [115.861458, -31.947418],
  "perth-gov-office-of-the-auditor-general": [115.859021, -31.951828],
  "perth-gov-public-sector-commission": [115.843745, -31.953201],
  "perth-gov-public-transport-authority": [115.876696, -31.944618],
  "perth-gov-south-metropolitan-health-service": [115.847665, -32.069556],
  "perth-gov-south-metropolitan-tafe": [115.739831, -32.055637],
  "perth-gov-venueswest": [115.777589, -31.955075],
  "perth-gov-western-australia-police-force": [115.879174, -31.961234],
  "perth-gov-workcover-wa": [115.800265, -31.956397],
};
