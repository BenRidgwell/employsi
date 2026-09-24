/**
 * Real brand logos and head-office domains for the Australian Top-150 private
 * companies, supplied as a spreadsheet (AU_Top150_MultiYear_v2_1.xlsx, "Top
 * 150" sheet, columns U "Website" and V "Logo URL").
 *
 * WHY BOTH MAPS
 * Every other company in the app gets its badge from Google's favicon service
 * keyed on a domain, and for the private roster that domain is GUESSED from the
 * company name by deriveDomain(). The guess is wrong for 71 of the 150 —
 * Pallion is pallion.com.au not pallion.com, VGW is vgw.co not vgw.com — so
 * those badges have been resolving to the wrong site or to nothing at all.
 *
 *   PRIVATE_LOGO_URL  the company's own logo file, used directly. Best quality:
 *                     a real brand mark rather than a 16px favicon upscaled.
 *   PRIVATE_DOMAIN    the real website domain, used to key the favicon fallback
 *                     for companies with no logo file of their own. This fixes
 *                     the badge even where no logo was supplied.
 *
 * WHAT WAS LEFT OUT, AND WHY
 *  * 30 of the supplied URLs were themselves google.com/s2/favicons links —
 *    the same service the app already falls back to. Storing them would hard-
 *    code today's fallback provider into the data, so their DOMAIN is recorded
 *    instead and the fallback does its job. Same image, one less thing to
 *    rewrite when the provider changes.
 *  * 2 of the spreadsheet's own logo files did not resolve (CMV Group 403,
 *    Life Without Barriers 404). Replacements were supplied separately and are
 *    used instead — both 447x447 and live when added. They are Google image
 *    thumbnail-cache links (encrypted-tbn0.gstatic.com) keyed on an opaque
 *    token, so unlike a logo served off a company's own site they can stop
 *    resolving when Google re-crawls; the badge falls back to initials if so.
 *  * 21 companies had no logo URL supplied; they keep the favicon path, now on
 *    a corrected domain where one was available.
 *
 * Every URL below returned a 200 with image content when it was added.
 * Verified 99 of 99 logo files in this map, the two replacements included.
 *
 * AND A 200 WITH IMAGE CONTENT IS NOT A VERIFICATION. That check is what this
 * map was audited with, it passed 94 of 94, and on 2026-09-23 all 94 were
 * fetched and LOOKED AT on a white badge instead. 36 were wrong, so the entries
 * were deleted and each company now resolves through the ladder below them —
 * LinkedIn for 19, the favicon service for 17. All 36 were re-fetched after:
 * every one draws its own company's real mark, and none lands on the favicon
 * service's generic globe.
 *
 * What a status code cannot see, in the four shapes they came in:
 *
 *  * ANOTHER COMPANY'S LOGO, served perfectly. Harris Farm was on Uber's logo
 *    (a .svg sitting in a Shopify theme), BIG4 on Crusader Caravans, VGW on
 *    Monopoly Match game art, People First Bank on an App Store download
 *    badge, Teachers Health on a grid of its rewards partners' logos —
 *    Woolworths, Apple, Bunnings. GMHBA, Meriton and Newcastle Greater Mutual
 *    were all on an AWARD MEDAL the company had won, which is what a harvester
 *    grabs when the prize badge is the first image on the page.
 *  * INVISIBLE, because the file is white-on-transparent and the badge is
 *    white: ARA's `ARA-Group-White-Logo.svg`, Clayton Utz's `logo_white.svg`.
 *    The logos README warns about exactly this; it is the same trap that kept
 *    several WA agencies out of waGovLogos.ts.
 *  * NOT A LOGO AT ALL: a photograph. Canberra Airport was an apron with
 *    Qantas jets on it, Kane a group of workers in hi-vis, Loan Market a stock
 *    family, Mort & Co cattle, RAA a van, Winning Appliances a shopfront.
 *  * A FRAGMENT OR A SUB-BRAND. AFL pointed into an SVG SPRITE with a
 *    `#icn-afl-logo` fragment, which an <img> cannot address, so it drew
 *    nothing. Deloitte was the green full stop with no wordmark, EY was
 *    EY-Parthenon, Fitness and Lifestyle was Goodlife's "G.", RAC of WA was
 *    its Horizons brand, Tennis Australia was the AO mark, NHP was partner
 *    brand Terasaki.
 *
 * The lesson for the next pass: this map sits ABOVE LinkedIn and the favicon
 * service, so a bad entry here is not a gap being filled — it is a better
 * source being overridden. Prefer deleting one to repairing it, and never add
 * one without opening the image.
 */

// Roster id → the company's own logo file.
export const PRIVATE_LOGO_URL: Record<string, string> = {
  "priv-abn-group":
    "https://www.abngroup.com.au/wp-content/themes/simplistik-child/assets/images/abn-group-logo-2024.png",
  "priv-akd": "https://www.akd.com.au/wp-content/themes/akd/images/logo.svg",
  "priv-alto": "https://www.altogroup.com.au/images/logo.png",
  "priv-ateco": "https://ateco.com.au/wp-content/uploads/2021/05/ateco-logo.png",
  "priv-aurecon":
    "https://www.aurecongroup.com/-/media/images/aurecon/logo/aurecon-desktop-logo.svg",
  "priv-ausgrid":
    "https://edge.sitecorecloud.io/c40b38b726fe-ausgridxmcfa6a-prod826a-b8f3/media/project/corporate/structural/header/logo-placeholder-image.svg?h=512&iar=0&w=512&rev=5f7a67c90d8243b3806cbba5659ff563",
  "priv-australian-consolidated-milk":
    "https://www.australianconsolidatedmilk.com.au/wp-content/themes/acm/assets/images/logo_acm.svg",
  "priv-australian-panels":
    "https://borg.bynder.com/asset/7117a3b2-b28b-43f5-890f-effb71d50013/Logo.svg",
  "priv-australian-unity":
    "https://www.australianunity.com.au/-/media/rebrandcorporate/logos/au-180years-logo.svg",
  "priv-avant-mutual": "https://avant.org.au/images/avant-logo.svg",
  "priv-bac-holdings": "https://www.bne.com.au/themes/custom/bne/images/bne-logo-new.svg",
  "priv-bmd-group":
    "https://www.bmdgroup.global/api/asset/generated/w720-16_9/bmd-newlogos-bmd-constructions-16-9",
  "priv-bolton-clarke": "https://www.boltonclarke.com.au/globalassets/bolton-clarke-s2024.png",
  "priv-brisbane-catholic-education":
    "https://www.bne.catholic.edu.au/images/UserUploadedImages/11/BCE_logo_negativeA.svg",
  "priv-cbh-group":
    "https://cbhprd.azureedge.net/-/media/Project/CBH-Group/CBH-Group/CBH-Website/core-elements/logo-cbhg.svg?rev=b7733ec273174ea1b16acbbd61d0c105&hash=2DABFAB2F8AA4634AFEF91F3A333B090",
  "priv-cci": "https://www.ccinsurance.org.au/wp-content/uploads/2024/05/CCI-main-logo.png",
  "priv-choices-flooring":
    "https://www.choicesflooring.com.au/media/vzpg35ep/choices-flooring-logo-svg.svg",
  "priv-cmv-group":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQh-2YFxE_NohK2wTLOiQLM0ZmQmKdV773qkXOf2AhfrT5to38FoVuzw1A&s=10",
  "priv-cnw-electrical":
    "https://shop.cnw.com.au/_ui/responsive/common/images/logos/svg/cnw-desktop.svg",
  // HUNGRY JACK'S, on the card of its parent Competitive Foods Australia.
  // Chosen over a blank badge on 2026-09-24; see the note in PRIVATE_DOMAIN
  // below for why the two names differ and what that costs. This is the
  // group's own logo file, hot-linked, so it carries the usual risk that a
  // site rebuild moves it — the same way goodstart, kennards and hcf broke.
  "priv-competitive-foods": "https://www.hungryjacks.com.au/App_Themes/HJ/assets/images/HJLogo.svg",
  "priv-colcap":
    "https://www.colcap.com.au/wp-content/uploads/2025/10/ColCap-Financial_logo_new_blue-Financial.png",
  // Was pointing at revslider's `dummy.png` — a slider PLACEHOLDER that the
  // harvester picked up because it is the first image in the page source. It
  // resolved 200, so nothing looked broken; the badge was just a blank. This is
  // the real brand mark (the coloured one, not the `_white` variant beside it,
  // which would be invisible on the light badge).
  "priv-craig-mostyn": "https://www.craigmostyn.com.au/wp-content/uploads/2023/04/CMG_Brand-1.svg",
  "priv-creation-homes": "https://creationhomes.com.au/wp-content/uploads/2025/05/ch-logo-t.svg",
  "priv-defence-health":
    "https://www.defencehealth.com.au/getmedia/3b42c8ee-043f-4351-8aad-1579fd1de2e8/defence-health-logo.svg?ext=.svg&v=2057",
  "priv-detmold-group":
    "https://www.detmoldgroup.com/globalassets/detpak/logos/detmold-group-colour.svg",
  "priv-employers-mutual":
    "https://www.eml.com.au/wp-content/uploads/2025/02/EML-Logo-Colour-RGB.svg",
  "priv-epworth-healthcare":
    "https://www.epworth.org.au/-/media/project/epworth/epworthweb/logos/logo-epworth.svg",
  "priv-firstmac": "https://www.firstmac.com.au/application/themes/fmc/assets/firstmac.svg",
  "priv-ghd":
    "https://ghd-p-001.sitecorecontenthub.cloud/api/public/content/e25bc49fae164283b4e8b1f3f84ae635?v=c5d56e8b",
  "priv-hammondcare":
    "https://www.hammond.com.au/hubfs/HammondCare%20Master%20Folder/Logos/ham-c-logo.svg",
  "priv-hutchies-builders":
    "https://www.hutchinsonbuilders.com.au/uploads/HU-Brand-Logos-Sub-HutchiesDivisions-RGB-Civil-Colour.svg?1736211743",
  "priv-j-j-richards-sons": "https://jjrichards.com.au/wp-content/uploads/2016/12/logo.png",
  "priv-kennards-hire": "https://www.kennards.com.au/img/Kennards-Hire-logo.svg",
  "priv-kpmg":
    "https://kpmg.com/content/experience-fragments/kpmgpublic/au/en/site/header/master/_jcr_content/root/header_v2/logo.coreimg.svg/1749689970934/logo.svg",
  "priv-life-without-barriers":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS97IgZhNI9Q2bt1WW55_n3eQk7xIRiUs2srdxSLBG_zNPno_MqXyRdzfI&s=10",
  "priv-linfox": "https://www.linfox.com/wp-content/themes/linfox/dist/images/logo.svg",
  "priv-mater":
    "https://www.mater.org.au/getmedia/1817319e-1033-4ec7-9de7-db5b74ce1f1c/mater-group-logo.svg?ext=.svg",
  "priv-mecca-brands":
    "https://contenthub-delivery.mecca.com/api/public/content/mecca-logo-black-Qm5ntZFC40Ws3K6wEz6rMg.svg?v=dcd8bc57",
  "priv-midfield": "https://midfield.com.au/wp-content/uploads/Midfield-logo-3-300x162.png",
  "priv-norco-co-op": "https://www.norco.com.au/images/Norco-Logo-on-White_RGB.png",
  "priv-nrma-motoring-services":
    "https://www.mynrma.com.au/-/media/nrmaheadless/navigation/header/nrma-navy-logo.svg?iar=0&hash=7E875A7EA0418D031ACA4FB581978D61",
  "priv-opal-aged-care":
    "https://cdn.opalhealthcare.com.au/public/opal-new-logo.svg?VersionId=Jlb6rZp95EshhTF5Bk.AbtEnBPkgylYO",
  "priv-pallion": "https://pallion.com/wp-content/uploads/2024/07/pallion-logo.svg",
  "priv-patterson-cheney":
    "https://nextgen-images.cdn.dealersolutions.com.au/modular.multisite.dealer.solutions/wp-content/uploads/sites/3044/2024/03/19140735/PC-Primary-logo2.png?format=webp&width=351",
  "priv-perfection-fresh":
    "https://www.perfection.com.au/hubfs/raw_assets/public/perfection-fresh/images/Perfection-Fresh-Logo-Vertical-Read.png",
  "priv-peter-kittle-motor-company":
    "https://www.peterkittle.com.au/includes/_manufacturer/peter-kittle-shared/images/logo-print.png",
  "priv-racq":
    "https://www.racq.com.au/-/media/project/racqgroup/racq/icons/racq-logo.svg?iar=0&rev=34159441153f4bccb20ac4ccb235af1f&hash=41341B521B48720D7C9F4E1CAB90FD83",
  "priv-refuelling-solutions":
    "https://irp.cdn-website.com/596aba7c/dms3rep/multi/RFS-logo-min-primary.svg",
  "priv-san-remo":
    "https://sanremo.com.au/content/themes/frame-custom/built/images/san-remo-logo.png?auto=format&w=500",
  "priv-st-vincent-de-paul":
    "https://www.vinnies.org.au/_next/image?url=https%3A%2F%2Fcms.vinnies.org.au%2Fmedia%2Fhzhfelhx%2Fvinnies-logo-1.png&w=1080&q=75",
  "priv-st-vincent-s-health-australia": "https://www.svha.org.au/imgs/svg/logos/logo-svha-new.svg",
  "priv-sunny-queen-farms": "https://www.sunnyqueen.com.au/app/themes/default/dist/images/logo.svg",
  "priv-teys-australia":
    "https://us.teysgroup.com/wp-content/themes/trulysimpletheme/img/Teyslogo.svg",
  "priv-thomas-foods-international":
    "https://thomasfoods.com/wp-content/uploads/2019/07/TFI-Logo-Positive.svg",
  "priv-turosi": "https://turosi.com.au/wp-content/uploads/2018/10/logo1big.png",
  "priv-united-petroleum":
    "https://www.unitedpetroleum.com.au/app/uploads/2016/06/united-logo-300.png",
  "priv-visy": "https://www.visy.com/sites/default/files/2023-03/logo.svg",
  "priv-walker-corporation": "https://www.walkercorp.com.au/images/walker-logo-white.svg",
  "priv-winslow-constructors":
    "https://www.winslow.com.au/images/logos/Winslow-wordmark-yellow.svg",
};

// Roster id → real website domain, where it differs from the name-derived
// guess. Keying the favicon fallback on this is what fixes the badge for the
// companies with no logo file of their own.
//
// NOT ONLY PRIVATE COMPANIES, despite the name and the rest of this file:
// logoFor() reads it for every id, and the same failure turns up on the listed
// roster and on government agencies. The roster derives a domain from the
// COMPANY NAME, so anything that does not trade under its legal name gets a
// domain that has never existed — commonwealthbankaustralia.com,
// westpacbanking.com, northmetropolitantafe.com. The favicon service 404s, the
// badge falls back to initials, and nothing reports it.
//
// Found by fetching all 145 Perth badges and decoding them (2026-08-08): 19
// returned nothing at all, and 14 of those were this, not a missing logo.
export const PRIVATE_DOMAIN: Record<string, string> = {
  // ── corrections found by auditing the rendered badges, 2026-08-08 ──────────
  // Every one verified twice: the site answers 200 and its <title> is the
  // organisation (so the domain is not a squatter's), and the favicon service
  // returns an image for it (so the badge will actually draw).
  "sydney-apa": "apa.com.au",
  "sydney-cba": "commbank.com.au",
  "sydney-wbc": "westpac.com.au",
  "perth-bgl": "bellevuegold.com.au",
  "perth-bwp": "bwptrust.com.au",
  cmm: "capmet.com.au", // Capricorn Metals trades on capmet, not capricornmetals
  "perth-cyl": "catalystmetals.com.au",
  "perth-ggp": "greatland.com.au", // Greatland Resources; greatland*resources* does not resolve
  "perth-obm": "orabandamining.com.au",
  // Swift Holdings Investments has no site of its own — it trades as
  // Autoleague, which is also why the job feeds search that name
  // (EXTRA_QUERIES) and attribute it back (ADVERTISER_ALIAS).
  "priv-swift-holdings-investments": "autoleague.com.au",
  "perth-gov-east-metropolitan-health-service": "emhs.health.wa.gov.au",
  "perth-gov-north-metropolitan-tafe": "northmetrotafe.wa.edu.au",
  "perth-gov-office-of-the-director-of-public-prosecutions": "dpp.wa.gov.au",
  "perth-gov-pathwest": "pathwest.health.wa.gov.au",
  // ── the three agencies whose white logo was removed, 2026-08-08 ───────────
  // Taking away an invisible logo only helps if what replaces it is visible,
  // and the favicon fallback is keyed on a name-derived domain that does not
  // exist for any of these three (wacountryhealthservice.com,
  // westernaustralianelectoralcommission.com, westernaustralianmuseum.com). The
  // real domains were sitting in the logo URLs being removed. Each verified the
  // usual two ways: the site is the agency's, and the favicon has ink in it.
  //
  // Public Transport Authority and Hancock Prospecting needed nothing — their
  // roster domains (pta.wa.gov.au, hancockprospecting.com.au) already resolve.
  "perth-gov-wa-country-health-service": "wacountry.health.wa.gov.au",
  "perth-gov-western-australian-electoral-commission": "elections.wa.gov.au",
  "perth-gov-western-australian-museum": "museum.wa.gov.au",
  // perron.com.au is PERRON INTEGRATED LOGISTICS, a different company — so the
  // badge was serving another firm's mark on Perron Group's pin, which is the
  // De Grey failure in miniature: confidently wrong rather than blank. Perron
  // Group (the Stan Perron property/Toyota WA group) is perrongroup.com.au,
  // confirmed from its own description. Its favicon is all white, so the badge
  // goes from wrong to empty — which is the right direction, and the fix from
  // here is a file in public/logos/.
  "priv-perron-group": "perrongroup.com.au",
  // These two are the CORRECT domains and both sites answer 200, but the
  // favicon service has nothing for either today, so the badge does not change
  // yet. Recorded anyway: the domain is the fact, and the badge fixes itself
  // the day the service indexes one.
  "perth-gov-parliamentary-services-department": "parliament.wa.gov.au",
  "sydney-wor": "worley.com",
  // ── every Wellington company, 2026-09-22 ─────────────────────────────────
  // 29 OF THE 31 roster domains were wrong. The NZ rosters have no domain field
  // of their own, so nzCompanies.ts and nzGov.ts both build one with
  // deriveDomain() — the company name, lowercased, punctuation dropped, plus
  // ".com". That produces treasury.com for The Treasury, nzpolice.com for NZ
  // Police, tepapa.com for Te Papa. New Zealand's public service lives on
  // .govt.nz and its listed companies mostly on .co.nz, so a .com guess was
  // never going to land; it is a rule that cannot be right for this country.
  // Only Xero and Infratil came out right, and by luck — see the note at the
  // end of the block.
  //
  // What that looked like on the map, measured the same day:
  //   * 25 drew the favicon service's generic 16px globe.
  //   * 4 drew ANOTHER COMPANY'S LOGO. meridianenergy.com, contactenergy.com
  //     and nzpolice.com are all registered, all parked, and all serve the SAME
  //     favicon (sha1 c20af3aed3de, a turquoise heart-swirl); chorus.com is a
  //     different live company again. So NZ Police and Chorus were each showing
  //     a stranger's brand mark. That is the Perron Group failure repeated, and
  //     it is why this is worth doing even where no logo file exists:
  //     confidently wrong is worse than blank.
  //
  // Verification, and it is not uniform, so it is recorded per tier rather than
  // claimed as the usual two checks for all of them:
  //   * 17 verified the usual way — the site answers and its <title> is the
  //     organisation (ACC's is unreadable from here but its favicon IS the ACC
  //     logo, which is the same fact by another route).
  //   * 12 sit behind a WAF that refuses this sandbox, so no <title> could be
  //     read. For those the check was the favicon service: it returns a real
  //     icon for each, not the generic globe, and the ones inspected are the
  //     agency's own mark (Oranga Tamariki's koru spiral) or the standard
  //     whole-of-government tile. A parked domain does not get either.
  // Every one returns an image from the favicon service except wgtn.ac.nz,
  // which has a logo file instead so does not need one.
  "nz-accident-compensation-corporation": "acc.co.nz",
  "nz-civil-aviation-authority-of-nz": "aviation.govt.nz",
  "nz-contact-energy": "contact.co.nz",
  "nz-department-of-internal-affairs": "dia.govt.nz",
  "nz-department-of-the-prime-minister-cabinet": "dpmc.govt.nz",
  "nz-environmental-protection-authority": "epa.govt.nz",
  "nz-government-communications-security-bureau": "gcsb.govt.nz",
  // Te Whatu Ora's districts share one national site; the roster's per-district
  // card is a hub, not a separate employer with a domain of its own.
  "nz-health-new-zealand-te-whatu-ora-capital-coast-hutt-valley": "tewhatuora.govt.nz",
  "nz-maritime-new-zealand": "maritimenz.govt.nz",
  "nz-meridian-energy": "meridianenergy.co.nz",
  "nz-ministry-of-business-innovation-and-employment": "mbie.govt.nz",
  "nz-ministry-of-education": "education.govt.nz",
  "nz-ministry-of-foreign-affairs-trade": "mfat.govt.nz",
  "nz-natural-hazards-commission-toka-t-ake": "naturalhazards.govt.nz",
  "nz-new-zealand-customs-service": "customs.govt.nz",
  // Waka Kotahi. nzta.govt.nz is the live site; the newer nzta brand did not
  // move the domain.
  "nz-new-zealand-transport-agency": "nzta.govt.nz",
  "nz-nz-police": "police.govt.nz",
  "nz-nz-security-intelligence-service-nzsis": "nzsis.govt.nz",
  "nz-oranga-tamariki-ministry-for-children": "orangatamariki.govt.nz",
  "nz-public-service-commission-te-kawa-mataaho": "publicservice.govt.nz",
  "nz-reserve-bank-of-new-zealand": "rbnz.govt.nz",
  "nz-statistics-nz": "stats.govt.nz",
  "nz-te-papa": "tepapa.govt.nz",
  "nz-te-puni-k-kiri-ministry-of-m-ori-development": "tpk.govt.nz",
  "nz-the-treasury": "treasury.govt.nz",
  // The corporate entity is toddcorporation.com; it redirects to todd.co.nz,
  // which is where the favicon lives. Either resolves — the registered name is
  // recorded here because that is what the roster card is.
  "nz-todd-corporation": "toddcorporation.com",
  "nz-transpower-new-zealand-limited": "transpower.co.nz",
  // Te Herenga Waka. wgtn.ac.nz, not victoria.ac.nz, since the 2019 rebrand.
  "nz-victoria-university-of-wellington": "wgtn.ac.nz",
  // ── the last blank AU badges, 2026-09-23 ─────────────────────────────────
  // A sweep of all 908 Australian and New Zealand companies found 44 still
  // drawing the favicon service's generic globe — and 35 of those were not a
  // missing logo at all, just a name-derived .com that belongs to nobody:
  // reservebankaustralia.com, australiansecuritiesinvestmentscommission.com,
  // charterhallretailreit.com. These fourteen are the ones whose real domain
  // was found and confirmed, each by the site's own <title> or by opening the
  // favicon and recognising the mark — IAG's purple wordmark, Ventia's green V,
  // Centuria's white C, Light & Wonder's "L&W", the RBA's crest.
  //
  // APRA, ASIC AND THE RESERVE BANK ARE COMMONWEALTH AGENCIES AND WERE MISSED
  // BY THE CANBERRA PASS, because that pass was scoped by CITY and these three
  // are plotted in Sydney. Anything scoped to a city will keep missing the
  // aps-* entries that sit elsewhere; the prefix is the honest scope.
  "aps-australian-prudential-regulation-authority": "apra.gov.au",
  "aps-australian-securities-and-investments-commission": "asic.gov.au",
  "aps-reserve-bank-of-australia": "rba.gov.au",
  "sydney-iag": "iag.com.au",
  "sydney-all": "aristocrat.com",
  "sydney-sdf": "steadfast.com.au",
  "sydney-vnt": "ventia.com",
  "sydney-lnw": "lnw.com",
  "sydney-cip": "centuria.com.au",
  // The two Charter Hall REITs and the two WAM funds are separately listed
  // vehicles managed by one house, and each pair shares its manager's site and
  // so its badge. Correct rather than a collision, the same case as China
  // Unicom appearing on both the Hong Kong and Shanghai rosters.
  "sydney-clw": "charterhall.com.au",
  "sydney-cqr": "charterhall.com.au",
  "sydney-wam": "wilsonassetmanagement.com.au",
  "sydney-wle": "wilsonassetmanagement.com.au",
  // CHANGES NO PIXEL TODAY, and is recorded anyway. soulpatts.com does not
  // resolve at all; soulpatts.com.au does and titles itself "Soul Patts". The
  // favicon service has no icon for it yet, so the badge stays blank — but it
  // is now blank on the right domain, and fixes itself the day the service
  // indexes one. Same call as sydney-wor and fma.govt.nz above.
  "sydney-sol": "soulpatts.com.au",
  // ── and the rest of them, 2026-09-23 ─────────────────────────────────────
  // The remaining name-derived .coms from the same sweep. Nineteen of these
  // twenty draw a real mark on the corrected domain; each was confirmed by the
  // site's <title> where it answers, and by opening the favicon where it
  // bot-walls this sandbox.
  //
  // WOOLWORTHS GROUP IS HERE FOR THE SECOND TIME AND IT IS WORTH SAYING WHY.
  // Earlier in this audit its badge was Woolworths SOUTH AFRICA's black-and-
  // white W, taken from a LinkedIn slug that belonged to the South African
  // retailer. That was removed. woolworthsgroup.com.au is the Australian
  // group's own site and its favicon is the blue corporate swirl — a third
  // mark again, distinct from both the South African W and the green
  // supermarket logo. Opened and checked rather than assumed, precisely
  // because this is the one that has already been wrong once.
  "adelaide-abc": "adbri.com.au",
  // All four SA landscape boards are regions of one statutory body and share
  // its site, the way the TAFE WA colleges share theirs. Same badge, correctly.
  "sa-gov-alinytjara-wilurara-landscape-board": "landscape.sa.gov.au",
  "sa-gov-limestone-coast-landscape-board": "landscape.sa.gov.au",
  "sa-gov-murraylands-and-riverland-landscape-board": "landscape.sa.gov.au",
  "sa-gov-northern-and-yorke-landscape-board": "landscape.sa.gov.au",
  // fctgl.com, not flightcentre.com.au: the roster entry is the listed GROUP
  // (FLT), and its favicon is the "Flight Centre Travel Group" lockup rather
  // than the consumer travel brand.
  "brisbane-flt": "fctgl.com",
  "brisbane-nsr": "nationalstorage.com.au",
  // The NT force shares a site with Fire and Emergency Services, so the badge
  // is the combined NTPFES crest set.
  "nt-gov-nt-police-force": "pfes.nt.gov.au",
  "melbourne-afi": "afi.com.au",
  "aps-australian-institute-of-family-studies": "aifs.gov.au",
  "aps-australian-radiation-protection-and-nuclear-safety-agency": "arpansa.gov.au",
  "melbourne-ben": "bendigobank.com.au",
  "melbourne-jbh": "jbhifi.com.au",
  "melbourne-lsf": "l1.com.au",
  "melbourne-vcx": "vicinity.com.au",
  "sydney-wow": "woolworthsgroup.com.au",
  // Abacus Storage King trades as Storage King; abacusstorageking.com.au does
  // not resolve, storageking.com.au does and draws the blue crown.
  "sydney-ask": "storageking.com.au",
  "sydney-hdn": "home-co.com.au",
  "sydney-mxt": "metrics.com.au",
  // The twentieth. bom.gov.au is unambiguously right — it titles itself
  // "Discover your weather | The Bureau of Meteorology" — but the favicon
  // service has no icon for it, so this badge stays blank on a correct domain.
  "aps-bureau-of-meteorology": "bom.gov.au",
  // Sayona Mining became Elevra Lithium in the 2026 Piedmont merger, so this
  // is a renamed company rather than a corrected guess — see cityRosters.ts.
  // elevra.com is the site the company's own LinkedIn page lists, and its
  // favicon is Elevra's orange "e". elevralithium.com resolves but serves a
  // 114-byte shell with no icon.
  "brisbane-elv": "elevra.com",
  // STILL UNRESOLVED after this pass, and left rather than guessed:
  //   priv-competitive-foods  already on competitivefoods.com.au; no icon indexed
  //   priv-ati-global         atiglobal.com.au does not answer
  //   priv-cogi               RESOLVED 2026-09-23. It is the Cotton On Group;
  //                           see priv-cotton-on-group below.
  //   priv-northwestern-roads no candidate found
  // Plus five already on the right domain with no favicon indexed: fma.govt.nz,
  // fwc.gov.au, generationdevelopmentgroup.com.au, ororagroup.com, aub.com.au.
  // The FOURTH card that was showing a stranger's logo, added 2026-09-22 once
  // the exclusion above no longer applied. chorus.com is not Chorus NZ — it
  // serves a different company's mark, a white figure on a blue gradient.
  // chorus.co.nz is, confirmed both ways: its <title> is "Chorus", and the
  // favicon service returns a real 64px icon for it. That icon is a plain
  // magenta-to-purple gradient disc with no mark in it, which is Chorus's own
  // brand colour but will read as a coloured dot until a logo file exists —
  // right company, no detail, rather than wrong company.
  "nz-chorus": "chorus.co.nz",
  // Left alone, and for once that is correct rather than pending:
  //   * xero.com IS Xero's, confirmed by title. deriveDomain got it right.
  //   * infratil.com answers with no readable title, and the favicon service
  //     returns a real 128px icon for it rather than the globe, so it is a live
  //     site and not parked. Consistent with being Infratil's, not proof.
  // These two are the only Wellington entries deriveDomain did not get wrong.
  // ── Auckland, 2026-09-22, the same audit ─────────────────────────────────
  // 14 of 18 wrong, so a better hit rate than Wellington's 29-of-31 — and the
  // reason is worth knowing rather than putting down to luck. Auckland's roster
  // is mostly NZX-listed exporters, and a listed exporter really does own the
  // .com of its own name, so deriveDomain's rule happens to land. It landed on
  // aucklandairport.com, mainfreight.com, fletcherbuilding.com and a2milk.com,
  // each confirmed by opening the favicon: Auckland Airport's black A,
  // Mainfreight's red-and-blue M, Fletcher's green chevron, a2's a-squared.
  // None of those four is listed below, because nothing needs correcting.
  //
  // The rule fails on exactly the two shapes it failed on in Wellington: public
  // agencies, which are .govt.nz, and any name the company does not trade
  // under. fonterraoperative.com is the second kind at its most obvious — the
  // "Co-operative" in the roster name was mangled rather than dropped.
  //
  // AND ONE DOMAIN I PROPOSED WAS ITSELF PARKED. nra.co.nz looked like the
  // obvious home for Northern Regional Alliance and serves the SAME parked
  // favicon as nzpolice.com — sha1 c20af3aed3de again. Caught by checking the
  // hash rather than trusting a 200. The real one is nra.health.nz, which
  // resolves to Health NZ: the alliance has been absorbed into Te Whatu Ora, so
  // its badge will be Te Whatu Ora's mark. That is correct, not a mix-up.
  "nz-fisher-and-paykel-healthcare": "fphcare.com",
  "nz-spark-new-zealand": "spark.co.nz",
  "nz-mercury-nz": "mercury.co.nz",
  "nz-skycity-entertainment-group": "skycityentertainmentgroup.com",
  "nz-fonterra-co-operative-group": "fonterra.com",
  // The three Auckland districts and Wellington's all sit on the one national
  // site; a district is a hub on the roster, not an employer with a domain.
  "nz-health-new-zealand-te-whatu-ora-te-toka-tumai-auckland": "tewhatuora.govt.nz",
  "nz-health-new-zealand-te-whatu-ora-counties-manukau": "tewhatuora.govt.nz",
  "nz-health-new-zealand-te-whatu-ora-waitemat": "tewhatuora.govt.nz",
  "nz-northern-regional-alliance-nra": "nra.health.nz",
  "nz-electoral-commission": "elections.nz",
  "nz-department-of-conservation": "doc.govt.nz",
  // Correct, and the favicon service has nothing for it today, so this changes
  // no pixel yet — recorded because the domain is the fact and the badge fixes
  // itself the day the service indexes one. Same as sydney-wor above.
  "nz-financial-markets-authority": "fma.govt.nz",
  "nz-k-inga-ora-homes-and-communities": "kaingaora.govt.nz",
  // The Crown entity is the New Zealand Lotteries Commission; it trades as
  // Lotto NZ and mylotto.co.nz is where it lives ("The Official Lotto NZ
  // website"). Nothing resolves for the registered name.
  "nz-new-zealand-lotteries-commission": "mylotto.co.nz",
  // ── Brisbane / Melbourne / Sydney, the non-government half, 2026-09-22 ────
  // The government half of those three cities is not here: 117 agencies were on
  // a deriveDomain .com and they are now on their state's crest instead, which
  // is the identity they actually present. See data/stateGovCrests.ts for why
  // that is a better fix than 117 domain corrections.
  //
  // What is left is the listed and private companies, and the failure is the
  // familiar one — an Australian company owns the .com.au, and deriveDomain
  // guesses the .com, which usually belongs to an American company of a similar
  // name. Every badge below was OPENED before being called wrong; a contact
  // sheet of all 113 that were drawing something is how these were found:
  //
  //   car.com       -> Car.com, a US car-research site, on CAR Group's card
  //   zip.com       -> Zip AI Procurement, on Zip Co's card
  //   ngp.com       -> National Guard Products, on NGP Group's card
  //   arb.com       -> an arboriculture site, on ARB Corporation's card
  //   l1.com        -> "Legend", a gaming brand, on L1 Group's card
  //   aub.com       -> a domain broker's own parking page, on AUB Group's
  //   lottery.com   -> a US lottery site, on The Lottery Corporation's card
  //   orora.com     -> Orora Design Technologies, unrelated to Orora Limited
  //   smrmagazine   -> a magazine, on SMRM Holdings' card
  //   regishealthcare.com -> the same parked favicon as NZ Police, sha1
  //                          c20af3aed3de
  //
  // A NOTE ON HOW THAT LIST WAS BUILT, because the first pass got it wrong.
  // The audit read each company's ROSTER domain, which is not what the badge
  // uses — this map overrides it, and 14 of these companies were already
  // corrected here long ago (CommBank, Westpac, Queensland Sugar, Pharmacare
  // and the rest). Reading the roster field made them look broken when they
  // were fine. Redone against logoFor()'s actual output: 23 of the 24 below
  // really were resolving to the wrong domain, and the 24th, Team Global
  // Express, already had teamglobalexp.com.au here and needed nothing. Audit
  // the RESOLVED host, not the roster field.
  //
  // Each replacement was verified by title, favicon or both. FIVE of them are
  // correct but have NO favicon yet, so those badges go from a wrong logo to
  // blank rather than to the right logo: aub.com.au, evt.com.au, ororagroup.com,
  // teamglobalexpress.com.au and generationdevelopmentgroup.com.au. That is the
  // right direction and the same call as priv-perron-group above.
  //
  // Checked and left alone, because deriveDomain was RIGHT: dexus.com,
  // atlasarteria.com, transurban.com, lendlease.com, mirvac.com, ansell.com,
  // anz.com, shell.com and every .edu.au university. Australian companies with
  // a global business do hold their .com.
  "melbourne-car": "carsales.com.au",
  "melbourne-l1g": "l1.com.au",
  // aub.com.au is NOT AUB Group — it belongs to a restaurant, and its og:image
  // is a logo reading "FLAVIO RESTAURANT". It served no favicon, so the badge
  // was blank rather than wrong, which is the only reason this went unnoticed.
  // Measured 2026-09-23: aubgroup.com.au titles "AUB Group" and draws AUB's
  // blue roundel at 128px.
  "sydney-aub": "aubgroup.com.au",
  "sydney-zip": "zip.co",
  "sydney-sgh": "sgh.com.au",
  "melbourne-arb": "arb.com.au",
  "melbourne-reg": "regis.com.au",
  "sydney-nhf": "nib.com.au",
  "sydney-yal": "yancoal.com.au",
  "sydney-ppt": "perpetual.com.au",
  "melbourne-tlc": "thelotterycorporation.com",
  "sydney-evt": "evt.com.au",
  "melbourne-lov": "lovisa.com.au",
  "melbourne-pme": "promedicus.com.au",
  "melbourne-cwy": "cleanaway.com.au",
  "brisbane-sul": "superretailgroup.com",
  "sydney-eos": "eos-aus.com",
  "sydney-edv": "endeavourgroup.com.au",
  "melbourne-pmv": "premierinvestments.com.au",
  "sydney-mts": "metcash.com.au",
  "sydney-hvn": "harveynorman.com.au",
  // The full name spelled out is NOT their domain — the company writes itself
  // short. generationdevelopmentgroup.com.au resets the connection; measured
  // 2026-09-23, gendevelopmentgroup.com.au titles "Home - Generation
  // Development Group" and carries a 192px gold mark.
  "melbourne-gdg": "gendevelopmentgroup.com.au",
  // A local file now; see localLogos. Kept because the domain is still right
  // for anything else reading it.
  "melbourne-ora": "ororagroup.com",
  // NOT FIXED, and deliberately left wrong rather than guessed at. NGP Group
  // and SMRM Holdings are both private, both currently showing another
  // company's mark, and neither ngpgroup.com.au nor smrm.com.au answers with
  // anything that identifies them — so there is nothing to verify against. A
  // guess here would replace a wrong badge with a differently wrong one and
  // hide the problem. Left for a human who knows what these two are:
  //   priv-ngp-group      ngp.com          -> National Guard Products' logo
  //   priv-smrm-holdings  smrmagazine.com  -> a magazine's logo
  //
  // THE LAST TWO AU BLANKS, both closed 2026-09-24 on the owner's call.
  //
  //   priv-ati-global  The domain was never findable by guessing, because the
  //     hyphen is load-bearing: ati-global.com, supplied by the owner, titles
  //     "A Global LegalTech Leader | Learn About ATI" and draws a 128px mark.
  //     atiglobal.com — the spelling every rule here would produce — serves a
  //     certificate for a different host entirely. Recorded because it is the
  //     one shape deriveDomain() cannot reach even in principle: it strips
  //     punctuation, so a name whose domain KEEPS a separator is unreachable.
  //   priv-competitive-foods  Now on HUNGRY JACK'S mark, at the owner's
  //     instruction, and that is a deliberate exception rather than a find.
  //     Hungry Jack's is a wholly-owned subsidiary; the card names the parent,
  //     Competitive Foods Australia, so the badge and the name do not match,
  //     and a reader who knows the group will read it as the brand rather than
  //     the employer. The trade was made with that understood: the parent has
  //     no mark of its own anywhere — no favicon, no site that answers, and a
  //     LinkedIn page belonging to a 2-10 person entity — and the group is the
  //     Hungry Jack's business in all but name.
  // ── Singapore, Manila, Kuala Lumpur, 2026-09-22 ──────────────────────────
  // Manila (6) and KL (3) needed nothing but QBE: both rosters are Australian
  // and British multinationals already plotted in other cities, so they were
  // already resolving through whatever their home city resolves through.
  //
  // Singapore's 24 are a different story, and the sharpest case of this failure
  // seen so far. A .com built from a Singapore company's full legal name is
  // very often a domain somebody is actively SELLING, because the name is
  // generic in English. Three of these were literally for-sale listings and one
  // was parked:
  //
  //   unitedoverseasbank.com  "UnitedOverseasBank.com is for sale - Premium…"
  //   singaporeexchange.com   "Singaporeexchange.com for sale | Spaceship.com"
  //   venture.com             "Leasing premium domains to help startups"
  //   citydevelopments.com    the parked favicon again, sha1 c20af3aed3de
  //
  // The rest were live businesses that simply are not the company:
  //
  //   uol.com    -> UOL, the Brazilian web portal, on UOL Group's card
  //   sats.com   -> SATS, a Nordic gym chain, on SATS Ltd's card
  //   wilmar.com -> HD Supply, a US industrial distributor
  //
  // Singapore-listed companies overwhelmingly sit on .com.sg or on a short
  // trading name (stengg, sgx, cdl, yzjsgd), which is exactly what the full-name
  // .com rule cannot produce.
  "singapore-v03": "venture.com.sg",
  "singapore-u11": "uobgroup.com",
  "singapore-s68": "sgx.com",
  "singapore-9ci": "capitaland.com",
  "singapore-c38u": "cict.com.sg",
  // CapitaLand Ascendas REIT has no live site of its own — clar.com.sg and
  // ascendas-reit.com both fail to resolve — so it points at the group site
  // that carries it, the same one CapitaLand Investment uses.
  "singapore-a17u": "capitaland.com",
  "singapore-c09": "cdl.com.sg",
  "singapore-s58": "sats.com.sg",
  "singapore-u14": "uol.com.sg",
  "singapore-s63": "stengg.com",
  "singapore-u96": "sembcorp.com",
  "singapore-ov8": "shengsiong.com.sg",
  "singapore-bs6": "yzjsgd.com",
  "singapore-c07": "jcclgroup.com",
  "sydney-qbe": "qbe.com",
  // Confirmed by the repo owner, 2026-09-22, which is the only reason it is
  // here: this was the one domain the usual checks could not settle either way.
  // wilmar-international.com answers 200 but serves 231 KB that is almost
  // entirely a single base64 font blob — no title, no og tags, no links, and
  // the string "wilmar" nowhere in it — so it was left recorded as unverified
  // rather than guessed at.
  //
  // IT CHANGES THE BADGE TO A BLANK, NOT TO WILMAR'S LOGO. The favicon service
  // has no icon for this domain (generic globe), and the site serves an HTML
  // 404 for favicon.ico, favicon.png, apple-touch-icon.png and favicon.svg
  // alike, so there is nothing to fall back to and nothing to commit to
  // public/logos/ either. It is still worth doing: wilmar.com is HD Supply, a
  // US industrial distributor, so this trades another company's mark for an
  // empty badge, which is the direction this whole map exists to move things.
  // A logo file for singapore-f34 is the fix that would finish it.
  "singapore-f34": "wilmar-international.com",
  // NOT FIXED, same rule as NGP and SMRM above: the replacement could not be
  // verified from here, so it is not recorded as fact.
  //   singapore-y92  Thai Beverage, on thaibeverage.com. thaibev.com and
  //     thaibev.com.sg both refuse to answer at all. Costs nothing today:
  //     thaibeverage.com already draws the blank globe, so this is a blank that
  //     stays blank rather than a wrong logo left standing.
  //
  // Verified correct and left alone: singtel.com, dbs.com, ocbc.com,
  // keppel.com, comfortdelgro.com, gentingsingapore.com, seatrium.com and
  // singaporeairlines.com (which redirects to singaporeair.com and serves its
  // favicon, so it already draws the right mark).
  // ── Canberra: the 24 Commonwealth agencies, 2026-09-22 ───────────────────
  // DOMAINS, NOT A CREST, AND THAT IS A CHANGE OF PLAN. Queensland, Victoria
  // and NSW got a shared crest because their agencies genuinely present one
  // identity. The Commonwealth does not: only the DEPARTMENTS use the Coat of
  // Arms lockup, while ABS, the ACCC, the NDIA, Fair Work, Austrade and the War
  // Memorial each have a distinct mark of their own. A blanket crest would have
  // been right for about half of them and wrong for the rest.
  //
  // Fixing the domain gets both for free, because each agency's own favicon IS
  // the right answer for that agency — measured: all 24 resolve, 22 return a
  // real icon, and every one of the 22 has a DIFFERENT hash, which is the proof
  // that these are not all one crest. Opened and checked: the Coat of Arms for
  // the departments, ABS's wordmark, the NDIS 'n', the ACCC triangle, the Fair
  // Work Ombudsman lockup, the War Memorial's dome, Austrade's arms.
  // asio.gov.au and fwc.gov.au are correct but have no favicon indexed, so
  // those two go blank rather than right — the usual trade.
  //
  // AND deriveDomain() COLLIDES ACROSS GOVERNMENTS, which is how a Commonwealth
  // department came to be pointed at a state one. It keys on the agency NAME,
  // not the roster id, so every government that has a "Department of Education"
  // resolves to the same domain — education.wa.gov.au, in that case, for the
  // Commonwealth, Victorian, NSW and WA departments alike. Measured: 12 agency
  // names are shared across governments, covering 30 roster companies, each set
  // collapsed onto one domain. Most are now masked by a crest; these are not,
  // which is why they surfaced here. A map keyed by id is the fix, and this is
  // it.
  "aps-attorney-general-s-department": "ag.gov.au",
  "aps-department-of-agriculture-fisheries-and-forestry": "agriculture.gov.au",
  "aps-department-of-defence": "defence.gov.au",
  "aps-department-of-education": "education.gov.au",
  "aps-department-of-finance": "finance.gov.au",
  "aps-department-of-health-disability-and-ageing": "health.gov.au",
  "aps-department-of-home-affairs": "homeaffairs.gov.au",
  "aps-department-of-industry-science-and-resources": "industry.gov.au",
  "aps-department-of-infrastructure-transport-regional-development-communications-and-the-arts":
    "infrastructure.gov.au",
  "aps-department-of-social-services": "dss.gov.au",
  "aps-department-of-the-treasury": "treasury.gov.au",
  "aps-australian-bureau-of-statistics": "abs.gov.au",
  "aps-national-disability-insurance-agency": "ndis.gov.au",
  "aps-australian-competition-and-consumer-commission": "accc.gov.au",
  "aps-australian-security-intelligence-organisation": "asio.gov.au",
  "aps-australian-digital-health-agency": "digitalhealth.gov.au",
  "aps-australian-transaction-reports-and-analysis-centre": "austrac.gov.au",
  "aps-australian-financial-security-authority": "afsa.gov.au",
  "aps-australian-public-service-commission": "apsc.gov.au",
  "aps-fair-work-commission": "fwc.gov.au",
  "aps-fair-work-ombudsman": "fairwork.gov.au",
  "aps-australian-war-memorial": "awm.gov.au",
  "aps-australian-trade-and-investment-commission": "austrade.gov.au",
  "aps-australian-pesticides-and-veterinary-medicines-authority": "apvma.gov.au",
  // ── the parked-domain sweep, 2026-09-22 ──────────────────────────────────
  // A sweep of all 1,549 companies found 16 still resolving to the domain-
  // parking favicon (sha1 c20af3aed3de, the turquoise heart-swirl), scattered
  // across cities this audit had not reached. Each was showing that parking
  // service's mark rather than its own. 14 are fixed here; each replacement was
  // confirmed by title, or by opening the badge where the site refuses this
  // sandbox — Commercial Bank of Dubai's teal arch and Ping An's orange A were
  // both settled that way.
  "adelaide-tea": "tasmea.com.au",
  "sa-gov-landscape-sa": "landscape.sa.gov.au",
  "calgary-cnq": "cnrl.com",
  "dubai-ajmanbank": "ajmanbank.ae",
  "dubai-cbd": "cbd.ae",
  "dubai-deyaar": "deyaar.ae",
  "ganzhou-688567": "farasis.com",
  "hongkong-02318": "pingan.cn",
  "houston-gpi": "group1auto.com",
  "mumbai-hindunilvr": "hul.co.in",
  "newyork-vno": "vno.com",
  "tokyo-8035": "tel.com",
  "toronto-fnv": "franco-nevada.com",
  // BOTH OF THESE ARE NOW FIXED, 2026-09-24, and the note is kept because the
  // refusal was correct at the time. Moutai's own /mtjt/imageDir/siteIcon.ico
  // does serve its mark — the gateway page that names nobody sits in front of
  // a real site. China Rare Earth was renamed from China Minmetals Rare Earth
  // in October 2022, which is exactly why nothing resolved to it; the company
  // is at cmreltd.com, recorded above as the right domain with no badge,
  // because that host does not answer at all. Neither shows the parking mark
  // any more.
  // ── Dubai, Tokyo, Beijing, Hong Kong, 2026-09-22: the domains ────────────
  // THESE FOUR CITIES FAIL DIFFERENTLY FROM EVERYWHERE ELSE, and the difference
  // decides the fix. In Australia and New Zealand a blank badge almost always
  // meant a wrong domain. Here it usually does not: of 152 companies on the
  // favicon service, 75 draw nothing, and when their titles were read, 35 named
  // the company outright and most of the rest were bot-walls on domains that
  // are plainly right — mitsui.com, tel.com, cnooc.com, hkex.com.hk. The
  // favicon service simply does not index much of the Gulf or East Asia.
  //
  // So correcting domains buys very little in these cities; committed logo
  // files are the fix, and are handled separately. Only three domains were
  // actually WRONG, all three caught by the title naming a different company:
  //
  //   didi.com    -> "Digital Image Design Incorporated"
  //   multiply.com-> "System1", an ad-tech acquisition platform
  //   toyotamotor.com -> a JS shell that renders only "Loading..."
  //
  // Each replacement was confirmed by title and then by opening the favicon:
  // DiDi's orange mark, Toyota's red T, and 2.0 for Multiply.
  "beijing-didi": "didiglobal.com",
  // Multiply Group has rebranded to 2PointZero, so multiply.ae now carries that
  // name — 33 mentions of "2PointZero" on the page against 1 of "Multiply", and
  // the favicon is a 2.0 monogram. It is still Multiply Group's own domain and
  // still enormously better than multiply.com, which belongs to somebody else
  // entirely, but the badge will read 2.0 rather than Multiply. Recorded with
  // that stated rather than quietly.
  "dubai-multiply": "multiply.ae",
  // global.toyota is the corporate site (title: トヨタ自動車株式会社 公式企業サイト).
  // toyota.com is the US sales site and toyotamotor.com renders nothing.
  "tokyo-7203": "global.toyota",
  // LEFT ALONE, and worth recording because it looks wrong: jd.com answers with
  // 686 bytes titled "JoyGen" and no JD content at all, from here and from
  // corporate.jd.com alike. jd.com IS JD.com's domain, so this is far more
  // likely to be what this sandbox's egress is served than a roster error.
  // Changing it on that evidence would be the wrong call.
  // ── Hong Kong, the per-company pass, 2026-09-22 ──────────────────────────
  // Most of Hong Kong's 36 were already on the right domain — alibaba.com,
  // tencent.com, lenovo.com, xiaomi.com, mtr.com.hk, shkp.com, ckh.com.hk,
  // bochk.com, hangseng.com and the rest are what these companies actually
  // use, because a .com built from a short trading name usually IS the Hong
  // Kong listing's domain. Four were not, and each replacement is confirmed by
  // the page titling itself as the company:
  //
  //   hendersonlanddevelopment.com -> "Company Website | Henderson Land Group"
  //   hanglungproperties.com       -> "Hang Lung Properties Limited"
  //   geelyautomobile.com          -> "Geely Automobile Holdings Limited"
  //   antasportsproducts.com       -> anta.com, whose favicon IS the ANTA
  //                                   wordmark and swoosh, opened and checked
  //                                   (the site itself serves no title)
  "hongkong-00012": "hld.com",
  "hongkong-00101": "hanglung.com",
  "hongkong-00175": "geelyauto.com.hk",
  "hongkong-02020": "anta.com",
  // ── 2026-09-24, the rest of the Hong Kong and Singapore badges ───────────
  // China Overseas Land & Investment was left on its guessed domain by the
  // pass above, which could not tell whether coli.com.hk was the company: the
  // site refuses this sandbox, and its icon is a red square holding one glyph
  // that names nobody. It is them — 0688.HK, and the site's own pages title
  // themselves "China Overseas Land & Investment Ltd." So the earlier refusal
  // was right on the evidence it had and wrong on the fact, which is the trade
  // this file keeps choosing: a blank badge over a guessed one.
  "hongkong-00688": "coli.com.hk",
  // CLP Holdings trades as CLP Group; clp.com is somebody else's.
  "hongkong-00002": "clpgroup.com",
  //
  // SEVEN MORE IN THIS REGION NEEDED A FILE, NOT A DOMAIN, because Google's
  // favicon service holds nothing for any of their real domains — a gap that
  // is much wider here than in Australia, and the reason this region looked
  // finished when it was not. Each icon was fetched from the company's own
  // host and opened before it was saved; see public/logos/.
  //
  //   hongkong-00012  Henderson Land     hld.com
  //   hongkong-00941  China Mobile       chinamobileltd.com — only /en/global/
  //                                      home.php answers; the bare host does not
  //   hongkong-00883  CNOOC              cnoocltd.com
  //   hongkong-00288  WH Group           wh-group.com, which serves a meta
  //                                      refresh to c/index.php and so looks
  //                                      like a 56-byte empty page
  //   hongkong-00003  Towngas            towngas.com — the HOME PAGE refuses
  //                                      this sandbox but /favicon.ico answers
  //   hongkong-01929  Chow Tai Fook      ctfjewellerygroup.com
  //   singapore-g13   Genting Singapore  gentingsingapore.com, behind Cloudflare
  //   singapore-y92   Thai Beverage      via sustainability.thaibev.com
  //
  // Towngas at 16px and Genting at 32px are the whole of what those two
  // publish. They upscale badly and are kept anyway: a blurry correct mark
  // beats the alternative, which for both of these was a shared 16px icon off
  // a parked domain — Towngas and Chow Tai Fook were drawing the SAME image.
  // ── 2026-09-24: eighteen cards that were showing a DOMAIN PARKING ICON ───
  //
  // Not blanks. Each of these drew a real, sharp, confident image that was the
  // logo of a domain marketplace, and they were found only because unrelated
  // companies were sharing one. Six sat on the same black-and-orange icon,
  // four on a green ".com" for-sale sign, three on Sedo's blue S, two on the
  // turquoise swirl already recorded above, two on a blue asterisk.
  //
  // This is deriveDomain() meeting the rest of the world: a .com built from a
  // full legal name is FOR SALE precisely because the name is valuable, so the
  // failure is concentrated exactly on the largest companies. Japanese and
  // Korean issuers are on .co.jp and .co.kr, mainland Chinese on .com.cn, and
  // several of these trade under an abbreviation nobody would guess from the
  // name: MUFG is mufg.jp, SMFG is smfg.co.jp, Seven & i is 7andi.com, Union
  // Properties is up.ae, CITIC Securities is citics.com.
  //
  // The one that proves the shape: GS Holdings of Korea was on gs.com, which
  // is GOLDMAN SACHS — a real company's real favicon on another company's
  // card, sharing its image with the Goldman Sachs record two rosters away.
  "tokyo-6981": "murata.com",
  "tokyo-8316": "smfg.co.jp",
  "tokyo-8306": "mufg.jp",
  "tokyo-6367": "daikin.com",
  "tokyo-8411": "mizuhogroup.com",
  "tokyo-3382": "7andi.com",
  "seoul-078930": "gs.co.kr",
  "shanghai-600887": "yili.com",
  "shanghai-600030": "citics.com",
  "shanghai-600519": "moutaichina.com",
  "toronto-rcib": "rogers.com",
  "newyork-ed": "coned.com",
  "atlanta-so": "southerncompany.com",
  "dubai-upp": "up.ae",
  "dubai-ihc": "ihcuae.com",
  "johannesburg-apn": "aspenpharma.com",
  // These two get the right domain and NO badge, which is the trade this file
  // keeps making. Both sites are real and neither publishes an icon the
  // favicon service holds or that this sandbox can reach: Wuliangye's own
  // /icon/favicon.ico 404s, and cmreltd.com does not answer at all. A blank
  // badge is the honest end state; the parked icon they had was not.
  "shenzhen-000858": "wuliangye.com.cn",
  "ganzhou-000831": "cmreltd.com",
  // ── 2026-09-24: China, the UAE and Canada ────────────────────────────────
  //
  // 50 blank badges across the three, and they are blank for three different
  // reasons that look identical on screen.
  //
  // CANADA and the UAE are the familiar failure: the domain was built from
  // the full legal name and the company trades under an abbreviation. Every
  // Canadian bank, the railways, Barrick and Suncor are one short word;
  // Emirates Telecommunications is e& and lives at eand.com, which no rule
  // over the name could reach.
  "toronto-ry": "rbc.com",
  "toronto-bmo": "bmo.com",
  "toronto-cm": "cibc.com",
  "toronto-td": "td.com",
  "toronto-csu": "csisoftware.com",
  "toronto-abx": "barrick.com",
  "toronto-ifc": "intact.ca",
  "calgary-su": "suncor.com",
  "calgary-cp": "cpkcr.com",
  "vancouver-lulu": "lululemon.com",
  "dubai-du": "du.ae",
  "dubai-dfm": "dfm.ae",
  "dubai-dib": "dib.ae",
  "dubai-salik": "salik.ae",
  "dubai-tabreed": "tabreed.ae",
  "dubai-gulfnav": "gulfnav.com",
  "dubai-emiratesnbd": "emiratesnbd.com",
  "dubai-eand": "eand.com",
  "dubai-adcb": "adcb.com",
  "dubai-emsteel": "emsteelgroup.com",
  // CHINA is a different failure and the more interesting one. Several of
  // these were ALREADY on the right domain — saicmotor.com, jd.com, psbc.com,
  // petrochina.com.cn — and still drew nothing, because the favicon service's
  // coverage of Chinese hosts is thin. A blank here never meant the data was
  // wrong, which is why it survived: the usual fix does not apply.
  "shanghai-601012": "longi.com",
  "shanghai-603288": "haitian-food.com",
  "shanghai-600276": "hengrui.com",
  "shanghai-600809": "fenjiu.com.cn",
  "shenzhen-300750": "catl.com",
  "shenzhen-002415": "hikvision.com",
  "shenzhen-000651": "gree.com",
  "shenzhen-300760": "mindray.com",
  "shenzhen-300059": "eastmoney.com",
  "shenzhen-000001": "bank.pingan.com",
  "beijing-601857": "petrochina.com",
  "beijing-601628": "chinalife.com.cn",
  "montreal-cnr": "cn.ca",
  // ── 2026-09-24: the last of the world ────────────────────────────────────
  //
  // The remaining 67 blanks, and they are almost entirely ONE rule failing on
  // the biggest names on the planet. deriveDomain() strips punctuation and
  // spaces and appends .com, and these companies are known by an initialism,
  // a founder's surname or a word that is not their legal name:
  //
  //   Meta Platforms        metaplatforms.com  -> meta.com
  //   Uber Technologies     ubertechnologies   -> uber.com
  //   Cisco Systems         ciscosystems       -> cisco.com
  //   Eli Lilly             elililly           -> lilly.com
  //   Estee Lauder          estelaudercompanies-> elcompanies.com
  //   Dassault Systemes     dassaultsystmes    -> 3ds.com
  //   Block                 block.com          -> block.xyz
  //
  // And the accent-stripping is its own tell: loral.com for L'Oréal,
  // herms.com for Hermès, socitgnrale.com for Société Générale,
  // compagniefinancirerichemont.com for Richemont, khnenagel.com for Kühne +
  // Nagel. Every one of those is a dropped é or ü, and each produced a domain
  // that cannot exist — a class of failure the anglosphere rosters never hit.
  "atlanta-ups": "ups.com",
  "bengaluru-hal": "hal-india.co.in",
  "boston-tjx": "tjx.com",
  "chicago-abt": "abbott.com",
  "chicago-adm": "adm.com",
  "chicago-cna": "cna.com",
  "chicago-gww": "grainger.com",
  "chicago-itw": "itw.com",
  "houston-epd": "enterpriseproducts.com",
  "houston-lng": "cheniere.com",
  "indianapolis-lly": "lilly.com",
  "johannesburg-bid": "bidcorpgroup.com",
  "johannesburg-har": "harmony.co.za",
  "johannesburg-kio": "angloamericankumba.com",
  "johannesburg-mnp": "mondigroup.com",
  "london-aht": "ashtead-group.com",
  "london-anto": "antofagasta.co.uk",
  "london-bats": "bat.com",
  "london-lgen": "legalandgeneral.com",
  "minneapolis-unh": "unitedhealthgroup.com",
  "mumbai-reliance": "ril.com",
  "newyork-el": "elcompanies.com",
  "newyork-trv": "travelers.com",
  "newyork-vz": "verizon.com",
  "paris-cdi": "dior.com",
  "paris-dsy": "3ds.com",
  "paris-gle": "societegenerale.com",
  "paris-or": "loreal.com",
  "paris-rms": "hermes.com",
  "philadelphia-apd": "airproducts.com",
  "sanfrancisco-meta": "meta.com",
  "sanfrancisco-uber": "uber.com",
  "sanfrancisco-xyz": "block.xyz",
  "sanjose-csco": "cisco.com",
  "seattle-tmus": "t-mobile.com",
  "seoul-011200": "hmm21.com",
  "seoul-015760": "kepco.co.kr",
  "seoul-024110": "ibk.co.kr",
  "tokyo-4063": "shinetsu.co.jp",
  "tokyo-4502": "takeda.com",
  "tokyo-4519": "chugai-pharm.co.jp",
  "tokyo-6723": "renesas.com",
  "tokyo-7267": "global.honda",
  "tokyo-8031": "mitsui.com",
  "tokyo-9432": "group.ntt",
  "washington-cof": "capitalone.com",
  "zurich-cfr": "richemont.com",
  "zurich-knin": "kuehne-nagel.com",
  "zurich-pspn": "psp.info",
  // TAQA's own site is taqaglobal.com; taqa.com and taqa.ae hold nothing the
  // favicon service or this sandbox can read, so its mark is a file taken
  // from its LinkedIn page. Same for Shougang, whose shougang.com.cn does not
  // answer at all and whose shougang.com is a parked domain.
  "dubai-taqa": "taqaglobal.com",
  // SIXTEEN STAY BLANK, and each was tried three ways: the company's own host,
  // the favicon service, and LinkedIn. They divide cleanly:
  //
  //   ELEVEN CHINESE ISSUERS whose sites do not answer this sandbox at all,
  //   or answer and serve no icon: Sinotrans, CSCEC, China Yangtze Power,
  //   Huaneng, Anhui Conch, Wuliangye, China Rare Earth, and the four Ganzhou
  //   rare-earth and cobalt names. Several have no LinkedIn page either.
  //   Huaneng's hpi.com.cn favicon IS reachable and is a SHAREPOINT DEFAULT
  //   TILE, which is worse than nothing — a blue "S" that names no company —
  //   so it is deliberately not used.
  //
  //   THREE GULF UTILITIES behind Cloudflare: DEWA, Empower and Dubai
  //   Refreshment. DEWA's LinkedIn image is a photograph of a building with
  //   the logo printed small in one corner, which reads as a building at
  //   badge size, so it is refused on the same grounds as the photographs
  //   removed from PRIVATE_LOGO_URL.
  //
  //   TWO AMERICAN ODDITIES. Marathon Oil's domain now redirects to
  //   ConocoPhillips, which bought it in 2024 — the mark it draws is
  //   ConocoPhillips'. Taking it would put the acquirer's logo on the
  //   acquired company's card, and the roster carrying a company that no
  //   longer trades is the real bug, not the badge. Telephone and Data
  //   Systems serves an 822-byte favicon that renders as nothing and has no
  //   logo on its LinkedIn page.
  // ── the original Top-150 private set ──────────────────────────────────────
  "priv-abc-tissue": "abctissue.com.au",
  "priv-abn-group": "abngroup.com.au",
  "priv-adco-constructions": "adcoconstruct.com.au",
  "priv-agnvet-management-services": "agnvet.com.au",
  "priv-alto": "altogroup.com.au",
  "priv-anytime-fitness": "anytimefitness.com.au",
  "priv-apco-service-stations": "apco.com.au",
  "priv-australian-rugby-league-commission": "nrl.com",
  "priv-avant-mutual": "avant.org.au",
  "priv-bac-holdings": "bne.com.au",
  "priv-baiada-poultry": "baiada.com.au",
  "priv-big4-holiday-parks": "big4.com.au",
  "priv-bing-lee-electrics": "binglee.com.au",
  "priv-bmd-group": "bmd.com.au",
  "priv-bowens-timber-hardware": "bowens.com.au",
  "priv-brisbane-catholic-education": "bne.catholic.edu.au",
  "priv-cci": "ccinsurance.org.au",
  // COGI Pty Ltd trades as the COTTON ON GROUP, and since 2026-09-24 the
  // roster says so — the id moved with the name, priv-cogi -> this one,
  // because a private roster id is "priv-" + slug(name). cogiver.com was a
  // guess off the registered name and answers nothing; linkedin.com/company/
  // cogi is an unrelated Italian firm, COGI srl, still guarded in
  // NOT_THIS_COMPANY in scripts/linkedin_slugs.py.
  "priv-cotton-on-group": "cottonongroup.com.au",
  "priv-cjd-equipment": "cjd.com.au",
  "priv-cnw-electrical": "cnw.com.au",
  "priv-competitive-foods": "competitivefoods.com.au",
  // The hyphen is the whole point — atiglobal.com is somebody else's host.
  "priv-ati-global": "ati-global.com",
  "priv-deloitte-touche-tohmatsu": "deloitte.com",
  "priv-drake-supermarkets": "drakes.com.au",
  "priv-employers-mutual": "eml.com.au",
  "priv-epworth-healthcare": "epworth.org.au",
  "priv-fdc": "fdcbuilding.com.au",
  "priv-fitness-and-lifestyle": "fitnessandlifestylegroup.com",
  "priv-grand-motors": "grandmotors.com.au",
  "priv-hammondcare": "hammond.com.au",
  "priv-herbert-smith-freehills": "hsfkramer.com",
  "priv-hutchies-builders": "hutchinsonbuilders.com.au",
  "priv-kane-constructions": "kane.com.au",
  "priv-kennards-self-storage": "kss.com.au",
  "priv-king-wood-mallesons": "kwm.com",
  "priv-kpmg": "kpmg.com.au",
  "priv-leader-computers": "leadercomputers.com.au",
  "priv-life-without-barriers": "lwb.org.au",
  "priv-mcnab-constructions": "mcnab.net.au",
  "priv-mecca-brands": "mecca.com.au",
  "priv-metricon-homes": "metricon.com.au",
  "priv-midfield": "midfield.com.au",
  "priv-mpc-kinetic": "mpckinetic.com.au",
  "priv-nepean-consolidated": "nepean.com",
  "priv-newcastle-greater-mutual-group": "ngm.com.au",
  "priv-nhp-electrical-engineering-products": "nhp.com.au",
  "priv-norco-co-op": "norco.com.au",
  "priv-nrma-motoring-services": "mynrma.com.au",
  "priv-opal-aged-care": "opalhealthcare.com.au",
  "priv-pallion": "pallion.com.au",
  "priv-people-first-bank": "peoplefirstbank.com.au",
  "priv-pharmacare": "pharmacare.com.au",
  "priv-queensland-sugar": "qsl.com.au",
  "priv-refuelling-solutions": "refuellingsolutions.com.au",
  "priv-richard-crookes-constructions": "richardcrookes.com.au",
  "priv-ritchies-supa-iga": "ritchies.com.au",
  "priv-salvation-army-australia": "salvationarmy.org.au",
  "priv-san-remo": "sanremo.com.au",
  "priv-spotlight": "spotlightstores.com",
  "priv-st-vincent-de-paul": "vinnies.org.au",
  "priv-st-vincent-s-health-australia": "svha.org.au",
  "priv-stowe-australia": "stowe.com.au",
  "priv-suttons-motors": "suttons.com.au",
  "priv-talent-international": "talentinternational.com",
  "priv-teachers-health-fund": "teachershealth.com.au",
  "priv-team-global-express": "teamglobalexp.com.au",
  "priv-teys-australia": "teysgroup.com",
  "priv-vgw-holdings": "vgw.co",
  "priv-walker-corporation": "walkercorp.com.au",
  "priv-winning-appliances": "winnings.com.au",
  "priv-winslow-constructors": "winslow.com.au",
  "priv-workpac": "workpac.com",
};
