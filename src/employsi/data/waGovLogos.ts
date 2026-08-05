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
 *  * roster agencies whose only asset is a WHITE/REVERSE variant — the workbook
 *    flags each as "invisible on light backgrounds, source a dark version". The
 *    badge renders on a light surface, so using them would show an empty
 *    circle, which is worse than the favicon fallback: Aqwest, Art Gallery of
 *    WA, Central/North Regional TAFE, North Metropolitan TAFE, UWA, Western
 *    Power. (South Regional TAFE, South Metropolitan TAFE and Rottnest Island
 *    Authority have since had dark marks found or supplied and are wired above.)
 *  * 2 that did not resolve when checked: Department of Water and Environmental
 *    Regulation (404) and Insurance Commission of WA (403).
 *  * 11 roster agencies the workbook has no row for at all — mostly the health
 *    service providers (Child and Adolescent, East/North/South Metropolitan,
 *    Health Support Services, PathWest) plus GESB, MyLeave, Parliamentary
 *    Services, Tourism WA.
 *
 * SEARCHED AGAIN 2026-08-05, AND STILL EXCLUDED. Four were looked for directly
 * and the reason each is still on the fallback is worth recording, because all
 * four LOOK like they should be easy:
 *
 *  * PathWest and North Metropolitan Health Service — both sites serve the same
 *    file, /images/hsps/logo.svg, byte for byte (257 KB, element ids
 *    "badge-white-a"/"badge-white-b"). It is the shared health-services badge in
 *    its WHITE variant, so it is both wrong-per-agency and invisible here.
 *  * MyLeave — myleave.wa.gov.au answers 403 to this network on every path
 *    tried, with and without www.
 *  * WA Police — the only mark its wa.gov.au page publishes is
 *    wa_police_force_logo_rgb_1200x600_white.png, a reverse variant. Swapping
 *    "_white" out of that filename returns HTTP 200 with a PLACEHOLDER
 *    "missing image" graphic rather than a 404, which a status check would have
 *    accepted and shipped. Every URL in this file was opened and looked at, not
 *    just status-checked, for exactly that reason.
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
  // Four agencies that were falling back — two to the whole-of-government
  // crest, two to the favicon — because the only assets their own domains
  // published were white/reverse variants that vanish on the light badge. Dark
  // lockups were supplied for each and checked (200, image content) before
  // being wired here; they move out of WA_GOV_CREST_IDS and the exclusion list
  // above accordingly.
  "perth-gov-south-metropolitan-health-service":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTAfm9b5gvSMSfHAW-osl8-9OULUy6DCHKmV-MwDSWUdiYvOdfBIydUM_w&s=10", // South Metropolitan Health Service
  "perth-gov-department-of-communities":
    "https://media.cdn.gradconnection.com/uploads/735c667b-e7f1-4438-aec5-10bfe89d8c68-new-logo.jpg", // Department of Communities
  "perth-gov-rottnest-island-authority":
    "https://www.dbca.wa.gov.au/sites/default/files/logos/2023-04/Logo-RIA_0.svg", // Rottnest Island Authority (served from DBCA, its parent department)
  "perth-gov-south-metropolitan-tafe":
    "https://images.prismic.io/erdi/178db128-c71c-4689-9cc1-cda5b6f2a4ed_South+Metropolitan+TAFE+.png?auto=compress,format", // South Metropolitan TAFE
  "perth-gov-construction-training-fund": "https://ctf.wa.gov.au/images/ctf-logo.svg", // Construction Training Fund
  "perth-gov-corruption-and-crime-commission":
    "https://www.ccc.wa.gov.au/themes/custom/ccc_theme/images/logo.png", // Corruption and Crime Commission
  "perth-gov-department-of-biodiversity-conservation-and-attractions":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSSoSVj42AXDSt4AKaup48k-iswgYo7D6KHD0D56gHqPa3jRiGFE9WvIVWv&s=10", // Department of Biodiversity, Conservation and Attractions
  "perth-gov-department-of-education":
    "https://burningfruit.com/wp-content/uploads/2024/05/DOE_NO-PE-STATEMENT_RGB_BLACK-1.png", // Department of Education
  // DFES had the generic whole-of-government PNG, which is the badge every WA
  // agency page carries — so it looked like the crest agencies rather than
  // itself. This is its own wordmark, the BLACK variant: the site also serves
  // dfes-logo_2.png, which is the reverse version for the navy header and would
  // be invisible on the light badge surface.
  "perth-gov-department-of-fire-emergency-services":
    "https://www.dfes.wa.gov.au/images/dfes-logo-black_2.png", // Department of Fire & Emergency Services
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
  // Main Roads had the generic wagov mark. This is its own device — the dark
  // roundel with the road-and-lightning symbol. It is the SYMBOL, not the
  // "mainroads WESTERN AUSTRALIA" lockup, because the only lockup the site
  // publishes is mrwa-100-year-logo-white.svg, a reverse variant that would be
  // invisible here. A square dark mark is the better badge anyway.
  "perth-gov-main-roads-wa":
    "https://www.mainroads.wa.gov.au/static/favicons/apple-touch-icon-152x152.png", // Main Roads WA
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
  // Three agencies moved out of WA_GOV_CREST_IDS below on 2026-08-05: each has a
  // named brand lockup on its wa.gov.au organisation page, so the crest was
  // hiding a real identity rather than reflecting one. All three were fetched
  // and LOOKED AT, not just status-checked — see the note on WA Police for why
  // that matters here.
  "perth-gov-forest-products-commission":
    "https://www.wa.gov.au/system/files/2023-12/fpc_logo_cmyk.png", // Forest Products Commission
  "perth-gov-department-of-housing-and-works":
    "https://www.wa.gov.au/system/files/2025-12/dhw_brandmark_0.png", // Department of Housing and Works
  // The only URL here carrying an ?itok= token. The untokenised original at
  // /system/files/2025-06/dmpe_wa_gov_au_logo_0.jpg is the same image at 593 KB,
  // which is unreasonable for a 128 px badge; this derivative is 11 KB. The
  // trade is a signed URL that can expire, against a half-megabyte download on
  // every marker render.
  "perth-gov-department-of-mines-petroleum-and-exploration":
    "https://www.wa.gov.au/system/files/styles/organisation_branding_logo/private/2025-06/dmpe_wa_gov_au_logo_0.jpg?itok=G-aEhUzS", // Department of Mines, Petroleum and Exploration
  // Gold Corporation trades as The Perth Mint and its swan is a square mark,
  // which is what the badge wants. The site's logo.svg is the 602x64 wordmark
  // and would render as a sliver.
  "perth-gov-gold-corporation":
    "https://www.perthmint.com/static/assets/images/favicons/apple-touch-icon.png", // Gold Corporation
};

/**
 * Agencies that use the shared Government of Western Australia crest.
 * Kept as a list because the URL is the same for all of them.
 */
export const WA_GOV_CREST = "https://www.wa.gov.au/themes/custom/wagov/images/logo_full.svg";

export const WA_GOV_CREST_IDS: string[] = [
  "perth-gov-arts-and-culture-trust", // Arts and Culture Trust
  // South Metropolitan Health Service and Department of Communities used to sit
  // here: their own sites publish only white/reverse lockups, so the crest was
  // the closest legible identity. Dark marks have since been supplied for both
  // and they now carry their own logo in WA_GOV_LOGO_URL above.
  "perth-gov-department-of-creative-industries-tourism-and-sport", // Department of Creative Industries, Tourism and Sport
  "perth-gov-department-of-energy-and-economic-diversification", // Department of Energy and Economic Diversification
  "perth-gov-department-of-justice", // Department of Justice
  "perth-gov-department-of-local-government-industry-regulation-and-safety", // Department of Local Government, Industry Regulation and Safety
  "perth-gov-department-of-planning-lands-and-heritage", // Department of Planning, Lands and Heritage
  "perth-gov-department-of-the-premier-and-cabinet", // Department of the Premier and Cabinet
  "perth-gov-department-of-training-and-workforce-development", // Department of Training and Workforce Development
  "perth-gov-department-of-treasury-and-finance", // Department of Treasury and Finance
  "perth-gov-metropolitan-cemeteries-board", // Metropolitan Cemeteries Board
  "perth-gov-public-sector-commission", // Public Sector Commission
  "perth-gov-state-solicitors-office", // State Solicitors Office
  "perth-gov-western-australia-police-force", // Western Australia Police Force
];

export const WA_GOV_CREST_ID_SET = new Set(WA_GOV_CREST_IDS);
