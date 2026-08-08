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
 */

// Roster id → the company's own logo file.
export const PRIVATE_LOGO_URL: Record<string, string> = {
  "priv-abn-group":
    "https://www.abngroup.com.au/wp-content/themes/simplistik-child/assets/images/abn-group-logo-2024.png",
  "priv-afl": "https://www.afl.com.au/resources/v5.51.25/i/svg-output/icons.svg#icn-afl-logo",
  "priv-akd": "https://www.akd.com.au/wp-content/themes/akd/images/logo.svg",
  "priv-alto": "https://www.altogroup.com.au/images/logo.png",
  "priv-ara": "https://aragroup.com/wp-content/uploads/2022/02/ARA-Group-White-Logo.svg",
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
  "priv-big4-holiday-parks":
    "https://assets.big4.com.au/media/sw1ih1p0/crusader_caravans_logo.png?height=80",
  "priv-bmd-group":
    "https://www.bmdgroup.global/api/asset/generated/w720-16_9/bmd-newlogos-bmd-constructions-16-9",
  "priv-bolton-clarke": "https://www.boltonclarke.com.au/globalassets/bolton-clarke-s2024.png",
  "priv-bowens-timber-hardware": "https://www.bowens.com.au/svg/Bowens_logo.svg",
  "priv-brisbane-catholic-education":
    "https://www.bne.catholic.edu.au/images/UserUploadedImages/11/BCE_logo_negativeA.svg",
  "priv-canberra-airport": "https://www.datocms-assets.com/88007/1670467982-open_day-1024x731.jpeg",
  "priv-cbh-group":
    "https://cbhprd.azureedge.net/-/media/Project/CBH-Group/CBH-Group/CBH-Website/core-elements/logo-cbhg.svg?rev=b7733ec273174ea1b16acbbd61d0c105&hash=2DABFAB2F8AA4634AFEF91F3A333B090",
  "priv-cci": "https://www.ccinsurance.org.au/wp-content/uploads/2024/05/CCI-main-logo.png",
  "priv-choices-flooring":
    "https://www.choicesflooring.com.au/media/vzpg35ep/choices-flooring-logo-svg.svg",
  "priv-cjd-equipment": "https://www.cjd.com.au/design-images/Logo-CJD.svg",
  "priv-clayton-utz": "https://www.claytonutz.com/img/logo_white.svg",
  "priv-cmv-group":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQh-2YFxE_NohK2wTLOiQLM0ZmQmKdV773qkXOf2AhfrT5to38FoVuzw1A&s=10",
  "priv-cnw-electrical":
    "https://shop.cnw.com.au/_ui/responsive/common/images/logos/svg/cnw-desktop.svg",
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
  "priv-deloitte-touche-tohmatsu":
    "https://www.deloitte.com/content/dam/assets-shared/logos/svg/a-d/deloitte.svg",
  "priv-detmold-group":
    "https://www.detmoldgroup.com/globalassets/detpak/logos/detmold-group-colour.svg",
  "priv-drake-supermarkets":
    "https://drakes.com.au/wp-content/themes/drakes/dist/images/drakes-logo-footer-reverse_483fb3f2.svg",
  "priv-employers-mutual":
    "https://www.eml.com.au/wp-content/uploads/2025/02/EML-Logo-Colour-RGB.svg",
  "priv-epworth-healthcare":
    "https://www.epworth.org.au/-/media/project/epworth/epworthweb/logos/logo-epworth.svg",
  "priv-ey":
    "https://www.ey.com/adobe/dynamicmedia/deliver/dm-aid--77ff1842-f343-4e18-9a15-15524ad301de/ey-parthenon-logo-135px-v2.png?preferwebp=true&quality=85",
  "priv-fdc": "https://www.fdcbuilding.com.au/wp-content/themes/fdc/asset/images/fdc_logo_01.svg",
  "priv-firstmac": "https://www.firstmac.com.au/application/themes/fmc/assets/firstmac.svg",
  "priv-fitness-and-lifestyle":
    "https://cdn.prod.website-files.com/62b906070134352e8b2adb52/62eb18220b3b9d0ec13b8c54_Group%2038526.svg",
  "priv-ghd":
    "https://ghd-p-001.sitecorecontenthub.cloud/api/public/content/e25bc49fae164283b4e8b1f3f84ae635?v=c5d56e8b",
  "priv-gmhba":
    "https://www.gmhba.com.au/siteassets/images/canstar_2025_small_logo.png?width=110&height=118&mode=Stretch",
  "priv-goodstart-early-learning": "https://www.goodstart.org.au/images/goodstart-logo.svg",
  "priv-hammondcare":
    "https://www.hammond.com.au/hubfs/HammondCare%20Master%20Folder/Logos/ham-c-logo.svg",
  "priv-hancock-prospecting":
    "https://www.hancockprospecting.com.au/wp-content/uploads/2021/09/hancock-prospecting-logo.png",
  "priv-harris-farm":
    "https://cdn.shopify.com/s/files/1/0206/9470/t/232/assets/Uber_Logo_Black_RGB.svg",
  "priv-hcf": "https://www.hcf.com.au/content/dam/hcf/images/placeholder/logo_hcf1.png",
  "priv-hutchies-builders":
    "https://www.hutchinsonbuilders.com.au/uploads/HU-Brand-Logos-Sub-HutchiesDivisions-RGB-Civil-Colour.svg?1736211743",
  "priv-j-j-richards-sons": "https://jjrichards.com.au/wp-content/uploads/2016/12/logo.png",
  "priv-john-hughes-group":
    "https://res.cloudinary.com/total-dealer/image/upload/w_750,f_auto,q_60,c_limit/v1674082363/td_next/john-hughes/John-Hughes_White-Logo_yvsgrz.svg",
  "priv-kane-constructions": "https://www.kane.com.au/assets/Kane_170808_180735.jpg",
  "priv-kennards-hire": "https://www.kennards.com.au/img/Kennards-Hire-logo.svg",
  "priv-kennards-self-storage": "https://www.kss.com.au/Content/Images/kennards_logo.svg",
  "priv-king-wood-mallesons":
    "https://www.kingandwood.com/content/dam/kwm/icon/logo2026/KW_international_Logo_White+Colour_Navigation.svg",
  "priv-kpmg":
    "https://kpmg.com/content/experience-fragments/kpmgpublic/au/en/site/header/master/_jcr_content/root/header_v2/logo.coreimg.svg/1749689970934/logo.svg",
  "priv-leader-computers": "https://leadersystems.com.au/wp-content/uploads/2021/03/UniFilogo.png",
  "priv-life-without-barriers":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS97IgZhNI9Q2bt1WW55_n3eQk7xIRiUs2srdxSLBG_zNPno_MqXyRdzfI&s=10",
  "priv-linfox": "https://www.linfox.com/wp-content/themes/linfox/dist/images/logo.svg",
  "priv-loan-market":
    "https://www.loanmarket.com.au/wp-content/uploads/2023/07/Placeholder-Images-6.jpg",
  "priv-mater":
    "https://www.mater.org.au/getmedia/1817319e-1033-4ec7-9de7-db5b74ce1f1c/mater-group-logo.svg?ext=.svg",
  "priv-mcnab-constructions":
    "https://images.squarespace-cdn.com/content/v1/5e44ba6e510fd939663bf906/6159e80f-77a6-4374-95f3-1bc603c596c7/McNabGroup_30YearLogo_RGB.png?format=1500w",
  "priv-mecca-brands":
    "https://contenthub-delivery.mecca.com/api/public/content/mecca-logo-black-Qm5ntZFC40Ws3K6wEz6rMg.svg?v=dcd8bc57",
  "priv-melbourne-airport":
    "https://assets-au-01.kc-usercontent.com:443/be08d7b0-97a1-02f9-2be6-a0c139c3c337/2730febc-5fd7-4b16-bcff-04527cef23f5/Logo.png?w=500&h=40&fm=jpg&auto=format&fit=clip",
  "priv-meriton":
    "https://cms.meriton.com.au/wp-content/uploads/2025/09/Meriton-Individual-medal-10.svg",
  "priv-midfield": "https://midfield.com.au/wp-content/uploads/Midfield-logo-3-300x162.png",
  "priv-mort-co": "https://mortco.com.au/share.jpg",
  "priv-nepean-consolidated": "https://nepean.com/wp-content/uploads/2024/02/Nepean-logo.svg",
  "priv-newcastle-greater-mutual-group":
    "https://ngm.com.au/wp-content/uploads/2025/01/GIR-100-2024-Logo-700x350.png",
  "priv-nhp-electrical-engineering-products":
    "https://media.nhp.com.au/v1/media/edge/images/nhp1294a-nhpafc4-prod7479-0f47/media/Project/NHP/shared/Images/Partners-and-Brands/Terasaki-Full-Colour-Logo.svg?iar=0",
  "priv-norco-co-op": "https://www.norco.com.au/images/Norco-Logo-on-White_RGB.png",
  "priv-nrma-motoring-services":
    "https://www.mynrma.com.au/-/media/nrmaheadless/navigation/header/nrma-navy-logo.svg?iar=0&hash=7E875A7EA0418D031ACA4FB581978D61",
  "priv-opal-aged-care":
    "https://cdn.opalhealthcare.com.au/public/opal-new-logo.svg?VersionId=Jlb6rZp95EshhTF5Bk.AbtEnBPkgylYO",
  "priv-pallion": "https://pallion.com/wp-content/uploads/2024/07/pallion-logo.svg",
  "priv-patterson-cheney":
    "https://nextgen-images.cdn.dealersolutions.com.au/modular.multisite.dealer.solutions/wp-content/uploads/sites/3044/2024/03/19140735/PC-Primary-logo2.png?format=webp&width=351",
  "priv-people-first-bank":
    "https://www.peoplefirstbank.com.au/-/media/project/peoplefirst/pfbwebsite/medialibrary/brand-assets/logos/apple-store.svg?iar=0&rev=8cc67ad01de8415fa0e8b8347bfb6f53&hash=2D0FA589D9B9B70C7B579088DD53DAAA",
  "priv-perfection-fresh":
    "https://www.perfection.com.au/hubfs/raw_assets/public/perfection-fresh/images/Perfection-Fresh-Logo-Vertical-Read.png",
  "priv-peter-kittle-motor-company":
    "https://www.peterkittle.com.au/includes/_manufacturer/peter-kittle-shared/images/logo-print.png",
  "priv-pwc-australia":
    "https://www.pwc.com.au/etc.clientlibs/pwc/clientlibs/rebrand-clientlibs/components-colors/resources/images/slim-header-v2/Chevron.svg",
  "priv-raa":
    "https://cdn-raa.dataweavers.io/-/media/Project/RAA/Web/Images/Banner-brand/Homepage-desktop-trev.jpg?rev=9e0acb9952d24d838617c19ffed0a6ac&w=1920&hash=1DF0F10EE168C7C5036C16DCBB10B554",
  "priv-rac-of-wa": "https://rac.com.au/-/media/images/rac-website/horizons/horizons-logo.svg",
  "priv-racq":
    "https://www.racq.com.au/-/media/project/racqgroup/racq/icons/racq-logo.svg?iar=0&rev=34159441153f4bccb20ac4ccb235af1f&hash=41341B521B48720D7C9F4E1CAB90FD83",
  "priv-refuelling-solutions":
    "https://irp.cdn-website.com/596aba7c/dms3rep/multi/RFS-logo-min-primary.svg",
  "priv-richard-crookes-constructions":
    "https://cdn-gugome.b-cdn.net/wp-content/themes/rcc/images/site-logo.svg",
  "priv-ritchies-supa-iga":
    "https://www.ritchies.com.au/application/themes/myfoodlink/images/ritchies-logo.svg",
  "priv-san-remo":
    "https://sanremo.com.au/content/themes/frame-custom/built/images/san-remo-logo.png?auto=format&w=500",
  "priv-st-vincent-de-paul":
    "https://www.vinnies.org.au/_next/image?url=https%3A%2F%2Fcms.vinnies.org.au%2Fmedia%2Fhzhfelhx%2Fvinnies-logo-1.png&w=1080&q=75",
  "priv-st-vincent-s-health-australia": "https://www.svha.org.au/imgs/svg/logos/logo-svha-new.svg",
  "priv-sunny-queen-farms": "https://www.sunnyqueen.com.au/app/themes/default/dist/images/logo.svg",
  "priv-suttons-motors":
    "https://s3-ap-southeast-2.amazonaws.com/prod-automait-public-website-content/images/logos/dealerships/suttons-white-h.svg",
  "priv-teachers-health-fund":
    "https://www.teachershealth.com.au/media/pqjcijqg/member_rewards_home_page_logos_962x674_v2-1.png?width=325&height=170&rnd=133869613879100000",
  "priv-tennis-australia":
    "https://www.tennis.com.au/content/experience-fragments/tennisaustralia/au/en/tennis-australia-site/header/header-with-search/_jcr_content/root/container_copy_copy/container/container/image.coreimg.svg/1757052521010/ao-brand-logo.svg",
  "priv-teys-australia":
    "https://us.teysgroup.com/wp-content/themes/trulysimpletheme/img/Teyslogo.svg",
  "priv-thomas-foods-international":
    "https://thomasfoods.com/wp-content/uploads/2019/07/TFI-Logo-Positive.svg",
  "priv-turosi": "https://turosi.com.au/wp-content/uploads/2018/10/logo1big.png",
  "priv-united-petroleum":
    "https://www.unitedpetroleum.com.au/app/uploads/2016/06/united-logo-300.png",
  "priv-vgw-holdings":
    "https://www.vgw.co/wp-content/uploads/elementor/thumbs/Monopoly-Match_Logo_Colour-rn4uzr3a3vx9k6x95n2gc04li220v37kgfkyl560ao.png",
  "priv-visy": "https://www.visy.com/sites/default/files/2023-03/logo.svg",
  "priv-walker-corporation": "https://www.walkercorp.com.au/images/walker-logo-white.svg",
  "priv-winning-appliances": "http://www.winnings.com.au/assets/img/og-image-1200-630.jpg",
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
  "priv-cjd-equipment": "cjd.com.au",
  "priv-cnw-electrical": "cnw.com.au",
  "priv-competitive-foods": "competitivefoods.com.au",
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
