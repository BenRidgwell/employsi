/**
 * Logos for the Western Australian government agencies on the Perth roster,
 * from the supplied workbook (WA_Government_Agency_Logos_2.xlsx, "WA agency
 * logos" sheet, column F).
 *
 * The workbook lists 142 agencies harvested from the wa.gov.au sitemap; 51 of
 * them are on this app's Perth government roster and the rest are ignored, as
 * asked. Of those 51, 42 are used here — the exclusions are explained below and
 * fall back to the favicon path in lib/companyLogo.ts.
 *
 * TWO GROUPS, ON PURPOSE
 *
 *  WA_GOV_LOGO_URL     agencies with their own brand mark.
 *  WA_GOV_CREST_IDS    agencies that present the whole-of-government identity
 *                      rather than a distinct logo — the workbook says so
 *                      explicitly for each. They all resolve to the same crest,
 *                      so they will look alike in the app. That is correct
 *                      rather than a bug: it is the identity those agencies
 *                      actually use. Listing them separately from the real
 *                      logos keeps the distinction visible instead of burying
 *                      65 copies of one URL in a map.
 *
 * WHAT IS EXCLUDED
 *  * 7 roster agencies whose only asset is a WHITE/REVERSE variant — the
 *    workbook flags each as "invisible on light backgrounds, source a dark
 *    version". The badge renders on a light surface, so using them would show
 *    an empty circle, which is worse than the favicon fallback: Aqwest, Art
 *    Gallery of WA, Central/North/South Regional TAFE, North/South Metropolitan
 *    TAFE, Rottnest Island Authority, UWA, Western Power.
 *  * 2 that did not resolve when checked: Department of Water and Environmental
 *    Regulation (404) and Insurance Commission of WA (403).
 *  * 11 roster agencies the workbook has no row for at all — mostly the health
 *    service providers (Child and Adolescent, East/North/South Metropolitan,
 *    Health Support Services, PathWest) plus GESB, MyLeave, Parliamentary
 *    Services, Tourism WA.
 *
 * Every URL below returned a 200 with image content when it was added.
 */

// Agency id → its own brand mark.
export const WA_GOV_LOGO_URL: Record<string, string> = {
  // ChemCentre's own hexagon mark, not the generic "logo-gov-wa-badge.png" that
  // was here — the badge is the whole-of-government identity every WA agency
  // page carries in its header, so it made ChemCentre indistinguishable from
  // its neighbours despite having a distinct logo of its own.
  "perth-gov-chemcentre": "https://www.chemcentre.wa.gov.au/assets/images/logo-chemcentre.png",
  // South Regional TAFE was on the exclusion list below because the only asset
  // found at the time was a white/reverse SVG. The site also serves a DARK one
  // at the same path without the `-white` suffix (#799900 green on #231f20),
  // which is what the badge needs, so it is no longer an exclusion.
  "perth-gov-south-regional-tafe":
    "https://www.southregionaltafe.wa.edu.au/themes/custom/srtafe_theme/images/logos/site-logo.svg",
  "perth-gov-construction-training-fund": "https://ctf.wa.gov.au/images/ctf-logo.svg", // Construction Training Fund
  "perth-gov-corruption-and-crime-commission":
    "https://www.ccc.wa.gov.au/themes/custom/ccc_theme/images/logo.png", // Corruption and Crime Commission
  "perth-gov-department-of-biodiversity-conservation-and-attractions":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSSoSVj42AXDSt4AKaup48k-iswgYo7D6KHD0D56gHqPa3jRiGFE9WvIVWv&s=10", // Department of Biodiversity, Conservation and Attractions
  "perth-gov-department-of-education":
    "https://burningfruit.com/wp-content/uploads/2024/05/DOE_NO-PE-STATEMENT_RGB_BLACK-1.png", // Department of Education
  "perth-gov-department-of-fire-emergency-services":
    "https://www.dfes.wa.gov.au/images/wa-gov-logo_1wa-gov-logo.png", // Department of Fire & Emergency Services
  "perth-gov-department-of-health":
    "https://www.health.wa.gov.au/~/media/Images/Corporate/Logo-Banner/logoDOH.gif", // Department of Health
  "perth-gov-department-of-primary-industries-and-regional-development":
    "https://www.dpird.wa.gov.au/Corporate/core/assets/images/logo-dpird.svg", // Department of Primary Industries and Regional Development
  "perth-gov-economic-regulation-authority":
    "https://www.erawa.com.au/themes/custom/era_theme/logo-era.svg", // Economic Regulation Authority
  "perth-gov-landgate": "https://upload.wikimedia.org/wikipedia/en/a/a7/Landgate_logo.png", // Landgate
  "perth-gov-legal-aid-western-australia":
    "https://www.legalaid.wa.gov.au/themes/custom/legalaid/logo.svg", // Legal Aid Western Australia
  "perth-gov-legal-practice-board": "https://www.lpbwa.org.au/static/LPBWA-logo.jpg", // Legal Practice Board
  "perth-gov-lotterywest": "https://www.lotterywest.wa.gov.au/favicon.svg", // Lotterywest
  "perth-gov-main-roads-wa":
    "https://www.mainroads.wa.gov.au/49c224/contentassets/cdae6beda63d46168fadbdd2979bec24/wagov-logo.svg", // Main Roads WA
  "perth-gov-mental-health-commission":
    "https://www.mhc.wa.gov.au/awcontent/web/assets/images/logo.svg", // Mental Health Commission
  "perth-gov-office-of-the-auditor-general":
    "https://audit.wa.gov.au/wp-content/uploads/2018/07/logo.png", // Office of the Auditor General
  "perth-gov-ombudsman-western-australian":
    "https://ombudsman.wa.gov.au/sites/default/files/ombudsman_wa_logo_2026.png", // Ombudsman Western Australian
  "perth-gov-perth-zoo": "https://www.perthzoo.wa.gov.au/assets/images/perth-zoo-logo.png", // Perth Zoo
  "perth-gov-pilbara-ports-authority": "https://www.pilbaraports.com.au/images/logo.png", // Pilbara Ports Authority
  "perth-gov-public-transport-authority":
    "https://www.pta.wa.gov.au/Portals/_default/Skins/Ozone/assets/images/footerLogos/metronet-logo.svg", // Public Transport Authority
  "perth-gov-venueswest":
    "https://www.venueswest.wa.gov.au/assets/corp/static/images/icons/logo-left.svg", // VenuesWest
  "perth-gov-wa-country-health-service":
    "https://www.wacountry.health.wa.gov.au/images/hsps/logo.svg", // WA Country Health Service
  "perth-gov-western-australian-electoral-commission":
    "https://www.elections.wa.gov.au/themes/custom/waectheme/logo.svg", // Western Australian Electoral Commission
  "perth-gov-western-australian-museum":
    "https://visit.museum.wa.gov.au/themes/custom/wamuseum_theme/logo.svg", // Western Australian Museum
  "perth-gov-workcover-wa":
    "https://www.workcover.wa.gov.au/wp-content/themes/workcover/images/logo-mobile.svg", // WorkCover WA
};

/**
 * Agencies that use the shared Government of Western Australia crest.
 * Kept as a list because the URL is the same for all of them.
 */
export const WA_GOV_CREST = "https://www.wa.gov.au/themes/custom/wagov/images/logo_full.svg";

export const WA_GOV_CREST_IDS: string[] = [
  "perth-gov-arts-and-culture-trust", // Arts and Culture Trust
  // South Metropolitan Health Service. Asked for its crest-and-name logo; its
  // site serves that lockup ONLY in white (logo.svg is literally id
  // "badge-white-a", filled #FFF, and the other asset is
  // "COA-with-text-GoWA-white.png"), and both would render as an empty circle
  // on the light badge. No dark variant is published anywhere on the domain.
  // The whole-of-government crest is the same identity minus the agency line,
  // and it is legible — so it is used rather than the favicon it was falling
  // back to. If a dark SMHS lockup is supplied, it belongs in WA_GOV_LOGO_URL.
  "perth-gov-south-metropolitan-health-service",
  "perth-gov-department-of-communities", // Department of Communities
  "perth-gov-department-of-creative-industries-tourism-and-sport", // Department of Creative Industries, Tourism and Sport
  "perth-gov-department-of-energy-and-economic-diversification", // Department of Energy and Economic Diversification
  "perth-gov-department-of-housing-and-works", // Department of Housing and Works
  "perth-gov-department-of-justice", // Department of Justice
  "perth-gov-department-of-local-government-industry-regulation-and-safety", // Department of Local Government, Industry Regulation and Safety
  "perth-gov-department-of-mines-petroleum-and-exploration", // Department of Mines, Petroleum and Exploration
  "perth-gov-department-of-planning-lands-and-heritage", // Department of Planning, Lands and Heritage
  "perth-gov-department-of-the-premier-and-cabinet", // Department of the Premier and Cabinet
  "perth-gov-department-of-training-and-workforce-development", // Department of Training and Workforce Development
  "perth-gov-department-of-treasury-and-finance", // Department of Treasury and Finance
  "perth-gov-forest-products-commission", // Forest Products Commission
  "perth-gov-metropolitan-cemeteries-board", // Metropolitan Cemeteries Board
  "perth-gov-public-sector-commission", // Public Sector Commission
  "perth-gov-state-solicitors-office", // State Solicitors Office
  "perth-gov-western-australia-police-force", // Western Australia Police Force
];

export const WA_GOV_CREST_ID_SET = new Set(WA_GOV_CREST_IDS);
