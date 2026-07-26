// Real head-office coordinates for the San Jose / Silicon Valley roster,
// geocoded from each company's published corporate address via OpenStreetMap
// (Nominatim) and bounds-checked against Santa Clara County.
//
// These companies were previously pinned to San Francisco. They are in the
// San Jose-Sunnyvale-Santa Clara metro — a different labour market with its
// own BLS statistics — so both their map position and the metro their demand
// counts towards were wrong. Anything not listed falls back to the generated
// fan around the city centre.
//
// Regenerate with: python3 scripts/geocode-sanjose.py

export const SAN_JOSE_REAL_COORDS: Record<string, [number, number]> = {
  "sanjose-aapl": [-122.010806, 37.337119],
  "sanjose-adbe": [-121.894772, 37.329471],
  "sanjose-amat": [-121.97789, 37.376829],
  "sanjose-amd": [-121.970377, 37.382961],
  "sanjose-avgo": [-122.144416, 37.399027],
  "sanjose-cdns": [-121.918936, 37.39663],
  "sanjose-csco": [-121.954091, 37.408358],
  "sanjose-googl": [-122.085585, 37.422486],
  "sanjose-hpq": [-122.149223, 37.414222],
  "sanjose-intc": [-121.963779, 37.388266],
  "sanjose-intu": [-122.096858, 37.430421],
  "sanjose-isrg": [-122.013355, 37.375142],
  "sanjose-klac": [-121.923998, 37.421276],
  "sanjose-nflx": [-121.963939, 37.256924],
  "sanjose-now": [-121.962709, 37.375824],
  "sanjose-nvda": [-121.967081, 37.370544],
  "sanjose-panw": [-121.982744, 37.38343],
  "sanjose-pypl": [-121.922806, 37.376871],
  "sanjose-snps": [-122.032338, 37.398045],
};
