/**
 * Three-letter codes for the map's hub cities, from `Employsi Map Markers.html`
 * — its city pins carry SYD rather than a name, so the marker stays small
 * enough to sit on the map without covering it.
 *
 * These are the real IATA city codes (the metropolitan-area code where one
 * exists, e.g. NYC rather than JFK, LON rather than LHR), not initials. A city
 * with no entry falls back to the first three letters of its label, which is
 * only ever a stopgap for a hub added without its code.
 */
export const CITY_CODE: Record<string, string> = {
  // Australia / New Zealand
  perth: "PER",
  adelaide: "ADL",
  brisbane: "BNE",
  melbourne: "MEL",
  sydney: "SYD",
  canberra: "CBR",
  darwin: "DRW",
  hobart: "HBA",
  auckland: "AKL",
  wellington: "WLG",
  // Asia / Middle East
  singapore: "SIN",
  kualalumpur: "KUL",
  manila: "MNL",
  tokyo: "TYO",
  hongkong: "HKG",
  dubai: "DXB",
  seoul: "SEL",
  beijing: "BJS",
  shanghai: "SHA",
  shenzhen: "SZX",
  ganzhou: "KOW",
  // North America
  toronto: "YTO",
  calgary: "YYC",
  montreal: "YMQ",
  vancouver: "YVR",
  ottawa: "YOW",
  houston: "HOU",
  denver: "DEN",
  newyork: "NYC",
  sanfrancisco: "SFO",
  sanjose: "SJC",
  chicago: "CHI",
  seattle: "SEA",
  austin: "AUS",
  atlanta: "ATL",
  bentonville: "XNA",
  omaha: "OMA",
  indianapolis: "IND",
  sandiego: "SAN",
  losangeles: "LAX",
  charlotte: "CLT",
  minneapolis: "MSP",
  cincinnati: "CVG",
  boston: "BOS",
  dallas: "DFW",
  washington: "WAS",
  philadelphia: "PHL",
  portland: "PDX",
  // Europe / Africa
  london: "LON",
  paris: "PAR",
  zurich: "ZRH",
  johannesburg: "JNB",
};

export function codeFor(id: string, label: string): string {
  return (
    CITY_CODE[id] ??
    label
      .replace(/[^A-Za-z]/g, "")
      .slice(0, 3)
      .toUpperCase()
  );
}
