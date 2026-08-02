/**
 * Employer career-portal feeds.
 *
 * Companies advertise on their own portals as well as on the job boards we
 * already pull, and the portal is the authoritative list — it carries roles
 * that never reach an aggregator. This module fetches those portals directly
 * and hands the rows to the same archive/dedup/skills path everything else
 * uses, so a role advertised on both a portal and Adzuna is counted once.
 *
 * Thirteen platforms are covered. Each was reverse-engineered against the live
 * site before being written here, and the contract is recorded next to its
 * fetcher so a future breakage is traceable to a named assumption rather than
 * showing up as a silent zero:
 *
 *   - **SAP SuccessFactors** (BHP, Woodside, ANZ). Server-rendered
 *     `/search/?q=&startrow=N`. Ships in TWO themes and we see both: BHP and
 *     ANZ render `<tr class="data-row">`, Woodside renders tiles
 *     (`<div class="job-tile-cell">`) whose fields are
 *     `id="job-<id>-desktop-section-<field>-value"` divs. Both carry the same
 *     `jobTitle-link` anchor, so the parser splits on whichever wrapper the
 *     page uses. Page size differs per tenant (BHP/Woodside 25, ANZ 100), so
 *     it is read off the first page rather than assumed.
 *   - **Workday** (CBA). POST `/wday/cxs/<tenant>/<site>/jobs` with
 *     `{appliedFacets,limit,offset,searchText}` → `jobPostings`.
 *   - **Eightfold AI** (HSBC). GET `/api/apply/v2/jobs?domain=<d>&start=N&num=`
 *     → `{positions,count}`. `num` is accepted and ignored — the API hands back
 *     10 a page whatever you ask for — so the page size is pinned at 10.
 *   - **Symphony Talent / SmashFly** (Rio Tinto). jobs.riotinto.com is a
 *     WordPress shell; the jobs come from `jobsapi-google.m-cloud.io/api/
 *     job/search?companyName=companies/<uuid>`, the org id and host both read
 *     out of the page's `cws_opts`. Returns `{totalHits,searchResults[].job}`.
 *   - **Oracle Recruiting Cloud** (Westpac). GET
 *     `/hcmRestApi/resources/latest/recruitingCEJobRequisitions` with the
 *     `finder=findReqs;siteNumber=CX_1,limit=,offset=` finder syntax →
 *     `items[0].requisitionList` plus a `TotalJobsCount`.
 *   - **LiveHire** (Wesfarmers). Two steps: GET an anonymous bearer from
 *     `/api/jobsapi/careers/auth/token/<segment>`, then POST
 *     `/careers-api/search/<segment>/<page>/<size>`.
 *   - **Greenhouse** (Goodman). The public board API,
 *     `boards-api.greenhouse.io/v1/boards/<token>/jobs` — one call, no paging.
 *   - **Avature** (Macquarie). Server-rendered
 *     `/en_US/careers/SearchJobs/?jobOffset=N`. Page size is fixed at 9 by the
 *     tenant — `jobRecordsPerPage` is accepted and ignored — so the offset
 *     steps by 9.
 *   - **Next.js data island** (Fortescue). careers.fortescue.com is a client
 *     app, but its `__NEXT_DATA__` already carries the whole list under
 *     `componentProps.<uuid>.fetchedJobs`, so no API hunt is needed.
 *   - **CSL's own board** (CSL). jobs.csl.com is bespoke Tailwind markup, one
 *     `<a class="block hover:bg-gray-50 group">` a role, 25 to a `?page=N`.
 *   - **Phenom People** (Coles, IAG). A `phApp.ddo` island for the total, then
 *     `POST /widgets` for 100 roles a page — see the note on the fetcher for
 *     the two response-shape traps.
 *   - **REA's own board** (REA Group). A server-rendered WordPress list, no
 *     paging, fields labelled by `<span class="sr-only">`.
 *   - **Scentre's own board** (Scentre Group). A bespoke Rails board; AWS WAF
 *     guards the interactive JS but not the rendered cards.
 *
 * NOT covered here, and why:
 *   - NAB (careers.nab.com.au, Clinch). Its AWS WAF returns an empty shell to a
 *     Cloudflare Worker — measured: zero roles while every other site in the
 *     same tick returned hundreds. It needs a rendered fetch with a wait for
 *     the challenge to settle, so it runs as a GitHub Action through Oxylabs
 *     instead: scripts/nab-to-d1.py, writing the same `portal-cl` rows into the
 *     same archive.
 *   - Jora: 403s a plain request; it needs the Oxylabs path the Indeed and
 *     JobsDB scrapers use, which runs as a GitHub Action rather than in the
 *     Worker (datacentre IPs are blocked).
 */

import { skillsForText } from "../../src/employsi/data/skillsTaxonomy";
import type { ArchiveRow } from "../../src/employsi/lib/jobArchive";

export interface PortalJob {
  t: string;
  loc: string;
  cat: string;
  url: string;
  created: string;
  city: string | null;
  skills: string[];
}

type Platform =
  | "successfactors"
  | "workday"
  | "eightfold"
  | "symphony"
  | "oracle"
  | "livehire"
  | "greenhouse"
  | "avature"
  | "nextdata"
  | "phenom"
  | "csl"
  | "rea"
  | "scentre"
  | "smartrecruiters"
  | "careercentre"
  | "martianlogic"
  | "plscareers"
  | "xmlfeed"
  | "ampol";

interface SiteDef {
  /** App company id — what the archive rows are attributed to. */
  id: string;
  /**
   * Unique key for this FEED, where one employer runs more than one portal.
   * Defaults to `id`. Transurban runs separate Workday sites for its Australian
   * and North American roads: both belong to the one roster company, so they
   * share an id, but they need distinct keys or the second one's KV snapshot
   * overwrites the first and the card shows only half the group.
   */
  key?: string;
  name: string;
  /** The employer's industry, passed to the skills matcher so seniority words
   *  like "Principal" aren't read as their literal job title. */
  sector: string;
  platform: Platform;
  /** The platform's entry point. See each fetcher for what it expects. */
  endpoint: string;
  /** Origin used to absolutise a job's relative path. */
  origin: string;
  /** Default hub when a role's location text matches no known city. */
  homeHub: string | null;
  /** Hard ceiling on pages, so a paging bug can't run away with the budget. */
  maxPages?: number;
  /** Rows a page, where the tenant fixes it at something other than the
   *  platform default. Avature tenants differ: Macquarie serves 9, Woolworths 6, and
   *  both ignore a larger jobRecordsPerPage — so it has to be per site. */
  pageSize?: number;
  /** Oracle Recruiting Cloud only: the tenant's careers site number, as it
   *  appears in the portal URL (`/sites/CX_2001/jobs`). Defaults to CX_1. */
  siteNumber?: string;
  /**
   * Avature only: where the location and category sit in a result card's text
   * cells, zero-based, when the tenant does not use Macquarie's ordering.
   *
   * There is no shape that identifies a location across tenants — "Brisbane",
   * "Sydney Office" and "Australia, QLD, Chermside" have nothing in common
   * that a category like "Retail Operations" lacks — and the three tenants we
   * read order their cells three different ways:
   *
   *   Macquarie  [title, reqId, LOCATION, date, CATEGORY]
   *   Woolworths [title, date, store, LOCATION, reqId, CATEGORY, brand, type]
   *   Santos     [title, LOCATION, reqId, date]
   *
   * So the index is measured per tenant and recorded, rather than inferred.
   * Omitted = Macquarie's layout, which the date anchors on its own.
   */
  avatureCells?: { loc: number; cat?: number };
  /**
   * Avature only: the page this feed STARTS at, so one portal can be walked
   * across several ticks. Defaults to 0; `maxPages` then bounds how many pages
   * this feed walks from there.
   *
   * Woolworths needs it. Its ~1,300 roles at a fixed six a page is a 50-second
   * walk, and a scheduled Worker cancels a waitUntil that long — measured, the
   * run logged "waitUntil() tasks did not complete within the allowed time".
   * Split into three 80-page windows it is three ~20-second walks, which is the
   * shape that was already completing before the cap was raised.
   */
  pageFrom?: number;
}

export const SITES: SiteDef[] = [
  {
    id: "bhp",
    name: "BHP",
    sector: "Iron Ore & Metals",
    platform: "successfactors",
    endpoint: "https://careers.bhp.com",
    origin: "https://careers.bhp.com",
    homeHub: "perth",
  },
  {
    id: "wds",
    name: "Woodside Energy",
    sector: "Oil & Gas",
    platform: "successfactors",
    endpoint: "https://careers.woodside.com.au",
    origin: "https://careers.woodside.com.au",
    homeHub: "perth",
  },
  {
    id: "cba",
    name: "Commonwealth Bank",
    sector: "Banking & Financial Services",
    platform: "workday",
    endpoint: "https://cba.wd3.myworkdayjobs.com/wday/cxs/cba/CommBank_Careers/jobs",
    origin: "https://cba.wd3.myworkdayjobs.com/en-US/CommBank_Careers",
    homeHub: "sydney",
  },
  {
    id: "melbourne-anz",
    name: "ANZ Group Holdings",
    sector: "Financial Services",
    platform: "successfactors",
    endpoint: "https://careers.anz.com",
    origin: "https://careers.anz.com",
    homeHub: "melbourne",
  },
  {
    id: "rio",
    name: "Rio Tinto",
    sector: "Iron Ore & Metals",
    // companyName is the org id out of the site's own cws_opts config.
    endpoint:
      "https://jobsapi-google.m-cloud.io/api/job/search?companyName=companies%2Fde826bcc-d0cf-4689-9fc1-c1d9b100d59c",
    platform: "symphony",
    origin: "https://jobs.riotinto.com",
    homeHub: "perth",
  },
  {
    id: "fmg",
    name: "Fortescue",
    sector: "Iron Ore & Green Energy",
    platform: "nextdata",
    endpoint: "https://careers.fortescue.com/en/jobs",
    origin: "https://careers.fortescue.com",
    homeHub: "perth",
  },
  {
    id: "sydney-wbc",
    name: "Westpac Banking Corporation",
    sector: "Financial Services",
    platform: "oracle",
    endpoint: "https://ebuu.fa.ap1.oraclecloud.com",
    origin: "https://ebuu.fa.ap1.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX",
    homeHub: "sydney",
  },
  {
    id: "wes",
    name: "Wesfarmers",
    sector: "Diversified Retail",
    // The LiveHire segment code; both the token and the search hang off it.
    platform: "livehire",
    endpoint: "wesfarmerscorporate",
    origin: "https://www.livehire.com",
    homeHub: "perth",
  },
  {
    id: "sydney-mqg",
    name: "Macquarie Group",
    sector: "Financial Services",
    platform: "avature",
    endpoint: "https://recruitment.macquarie.com/en_US/careers/SearchJobs",
    origin: "https://recruitment.macquarie.com",
    homeHub: "sydney",
  },
  {
    id: "sydney-gmg",
    name: "Goodman Group",
    sector: "Financial Services",
    platform: "greenhouse",
    endpoint: "https://boards-api.greenhouse.io/v1/boards/goodman/jobs",
    origin: "https://ce.goodman.com/about-goodman/careers/job-vacancies",
    homeHub: "sydney",
  },
  {
    id: "melbourne-csl",
    name: "CSL Limited",
    sector: "Healthcare and Life Sciences",
    platform: "csl",
    endpoint: "https://jobs.csl.com/en/jobs",
    origin: "https://jobs.csl.com",
    homeHub: "melbourne",
  },
  {
    id: "melbourne-tls",
    name: "Telstra Group",
    sector: "Technology, Media & Telecom",
    platform: "workday",
    endpoint: "https://telstra.wd3.myworkdayjobs.com/wday/cxs/telstra/Telstra_Careers/jobs",
    origin: "https://telstra.wd3.myworkdayjobs.com/Telstra_Careers",
    homeHub: "melbourne",
  },
  {
    id: "melbourne-tcl",
    key: "melbourne-tcl-au",
    name: "Transurban Group",
    sector: "Infrastructure & Government",
    platform: "workday",
    endpoint: "https://transurban.wd3.myworkdayjobs.com/wday/cxs/transurban/TU_AU/jobs",
    origin: "https://transurban.wd3.myworkdayjobs.com/TU_AU",
    homeHub: "melbourne",
  },
  {
    // Transurban runs a SECOND Workday site for its North American roads, on
    // the same tenant. Both are archived against the one roster company — it is
    // one employer — but the US site's roles carry US locations, so they land
    // on the US hubs rather than Melbourne and the card shows the whole group.
    id: "melbourne-tcl",
    key: "melbourne-tcl-us",
    name: "Transurban Group",
    sector: "Infrastructure & Government",
    platform: "workday",
    endpoint: "https://transurban.wd3.myworkdayjobs.com/wday/cxs/transurban/TU_US/jobs",
    origin: "https://transurban.wd3.myworkdayjobs.com/TU_US",
    homeHub: "washington",
  },
  {
    id: "sydney-all",
    name: "Aristocrat Leisure",
    sector: "Consumer & Retail",
    platform: "workday",
    endpoint:
      "https://aristocrat.wd3.myworkdayjobs.com/wday/cxs/aristocrat/AristocratExternalCareersSite/jobs",
    origin: "https://aristocrat.wd3.myworkdayjobs.com/AristocratExternalCareersSite",
    homeHub: "sydney",
  },
  {
    // QBE's site is live and correctly identified — every other site id 404s
    // and the page's own shell names this one — but it returned 0 postings when
    // this was wired. It is included so the moment they publish, the roles are
    // collected; until then it legitimately writes nothing.
    id: "sydney-qbe",
    name: "QBE Insurance",
    sector: "Financial Services",
    platform: "workday",
    endpoint: "https://qbe.wd3.myworkdayjobs.com/wday/cxs/qbe/QBE-Careers/jobs",
    origin: "https://qbe.wd3.myworkdayjobs.com/QBE-Careers",
    homeHub: "sydney",
  },
  // Woolworths, walked in three windows. Avature, like Macquarie, but this
  // tenant fixes the page at 6 and needs jobRecordsPerPage alongside jobOffset
  // — without it the offset is ignored and every page returns the first six.
  //
  // It also caps its own result count at "999+", so the extent was measured
  // rather than read: jobOffset 1260 still returns six roles and 1300 returns
  // none, putting the list a little under 1,300 — ~217 pages. Walking that in
  // one go takes 50 seconds and the Worker cancels the waitUntil, so it is
  // split into three 80-page windows on three ticks. All three carry the same
  // id, so every row lands on the one company.
  {
    id: "sydney-wow",
    key: "sydney-wow-a",
    name: "Woolworths Group",
    sector: "Consumer & Retail",
    platform: "avature",
    endpoint: "https://careers.woolworthsgroup.com.au/en_GB/apply/search-jobs",
    origin: "https://careers.woolworthsgroup.com.au",
    homeHub: "sydney",
    pageSize: 6,
    avatureCells: { loc: 3, cat: 5 },
    pageFrom: 0,
    maxPages: 80,
  },
  {
    id: "sydney-wow",
    key: "sydney-wow-b",
    name: "Woolworths Group",
    sector: "Consumer & Retail",
    platform: "avature",
    endpoint: "https://careers.woolworthsgroup.com.au/en_GB/apply/search-jobs",
    origin: "https://careers.woolworthsgroup.com.au",
    homeHub: "sydney",
    pageSize: 6,
    avatureCells: { loc: 3, cat: 5 },
    pageFrom: 80,
    maxPages: 80,
  },
  {
    id: "sydney-wow",
    key: "sydney-wow-c",
    name: "Woolworths Group",
    sector: "Consumer & Retail",
    platform: "avature",
    endpoint: "https://careers.woolworthsgroup.com.au/en_GB/apply/search-jobs",
    origin: "https://careers.woolworthsgroup.com.au",
    homeHub: "sydney",
    pageSize: 6,
    avatureCells: { loc: 3, cat: 5 },
    pageFrom: 160,
    maxPages: 80,
  },
  // ── Added 2026-08 ────────────────────────────────────────────────────────
  // Each endpoint below was probed live before being added, and each reuses a
  // handler that already exists — no new platform code. Job counts at the time
  // of adding are noted so a later run returning zero is visibly a regression
  // rather than an unknown.
  {
    id: "sydney-rmd",
    name: "ResMed",
    sector: "Healthcare and Life Sciences",
    platform: "workday",
    endpoint: "https://resmed.wd3.myworkdayjobs.com/wday/cxs/resmed/Resmed_External_Careers/jobs",
    origin: "https://resmed.wd3.myworkdayjobs.com/en-US/Resmed_External_Careers",
    homeHub: "sydney", // AU head office, Bella Vista; global HQ is San Diego
  },
  {
    id: "perth-gov-gold-corporation",
    name: "Gold Corporation",
    sector: "Infrastructure and Government",
    // The LiveHire segment code, same shape as Wesfarmers above.
    platform: "livehire",
    endpoint: "perthmint",
    origin: "https://www.livehire.com",
    homeHub: "perth",
  },
  {
    id: "priv-st-john-of-god-health-care",
    name: "St John of God Health Care",
    sector: "Hospitals",
    platform: "workday",
    endpoint: "https://wd105.myworkdaysite.com/wday/cxs/sjog/SJGHC_External_Career_Site/jobs",
    origin: "https://wd105.myworkdaysite.com/en-GB/recruiting/sjog/SJGHC_External_Career_Site",
    homeHub: "perth",
  },
  {
    id: "sydney-apa",
    name: "APA Group",
    sector: "Infrastructure and Government",
    platform: "workday",
    endpoint: "https://apa.wd105.myworkdayjobs.com/wday/cxs/apa/APA-Careers/jobs",
    origin: "https://apa.wd105.myworkdayjobs.com/APA-Careers",
    homeHub: "sydney",
  },
  {
    id: "melbourne-mpl",
    name: "Medibank",
    sector: "Financial Services",
    platform: "successfactors",
    endpoint: "https://jobs.medibank.com.au",
    origin: "https://jobs.medibank.com.au",
    homeHub: "melbourne",
  },
  {
    id: "melbourne-tlc",
    name: "The Lottery Corporation",
    sector: "Consumer and Retail",
    platform: "oracle",
    endpoint: "https://fa-exnj-saasfaprod1.fa.ocs.oraclecloud.com",
    origin:
      "https://fa-exnj-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/TLC-Careers",
    homeHub: "melbourne",
    siteNumber: "TLC-Careers",
  },
  // BlueScope runs a separate board per region and they do not share a tenant,
  // so each is its own feed under the one company id — the same arrangement
  // Transurban and Brambles already use. The Australian and NZ boards are on
  // different platforms again and are NOT here yet; see the commit message.
  {
    id: "sydney-bsl",
    key: "sydney-bsl-asean",
    name: "BlueScope",
    sector: "Energy & Natural Resources",
    platform: "workday",
    endpoint: "https://wd3.myworkdaysite.com/wday/cxs/bluescope/careers/jobs",
    origin: "https://wd3.myworkdaysite.com/en-GB/recruiting/bluescope/careers",
    homeHub: "sydney", // Malaysia / Indonesia / Thailand / Vietnam
  },
  {
    id: "sydney-bsl",
    key: "sydney-bsl-nac",
    name: "BlueScope",
    sector: "Energy & Natural Resources",
    platform: "workday",
    endpoint: "https://bluescopenac.wd5.myworkdayjobs.com/wday/cxs/bluescopenac/BNACareers/jobs",
    origin: "https://bluescopenac.wd5.myworkdayjobs.com/BNACareers",
    homeHub: "sydney", // North America; several trading names, one tenant
  },
  {
    id: "sydney-bsl",
    key: "sydney-bsl-au",
    name: "BlueScope",
    sector: "Energy & Natural Resources",
    // SmartRecruiters company slug; the bluescope.com page is only a widget.
    platform: "smartrecruiters",
    endpoint: "BlueScope",
    origin: "https://www.bluescope.com/careers",
    homeHub: "sydney",
  },
  {
    id: "sydney-bsl",
    key: "sydney-bsl-nz",
    name: "BlueScope",
    sector: "Energy & Natural Resources",
    platform: "careercentre",
    endpoint: "https://nzsteel.careercentre.net.nz/Job",
    origin: "https://nzsteel.careercentre.net.nz",
    homeHub: "auckland", // New Zealand Steel, Glenbrook
  },
  {
    id: "perth-lyc",
    name: "Lynas Rare Earths",
    sector: "Energy & Natural Resources",
    // MartianLogic / MyRecruitment+ client code.
    platform: "martianlogic",
    endpoint: "lynasrareearths",
    origin: "https://careers.lynasrareearths.com",
    homeHub: "perth",
  },
  {
    id: "pls",
    name: "Pilbara Minerals",
    sector: "Lithium",
    platform: "plscareers",
    endpoint: "https://careers.pls.com/jobs/search",
    origin: "https://careers.pls.com",
    homeHub: "perth",
  },
  // ── Added 2026-08, second batch ─────────────────────────────────────────
  // All probed live; all reuse handlers that already exist. Counts at the time
  // of adding are in the PORTAL_GROUPS comment below.
  {
    id: "melbourne-vcx",
    name: "Vicinity Centres",
    sector: "Financial Services",
    platform: "workday",
    endpoint:
      "https://vicinity.wd3.myworkdayjobs.com/wday/cxs/vicinity/VicinityExternalCareers/jobs",
    origin: "https://vicinity.wd3.myworkdayjobs.com/VicinityExternalCareers",
    homeHub: "melbourne",
  },
  {
    id: "sydney-chc",
    name: "Charter Hall",
    sector: "Financial Services",
    platform: "workday",
    endpoint: "https://charterhall.wd3.myworkdayjobs.com/wday/cxs/charterhall/Careers/jobs",
    origin: "https://charterhall.wd3.myworkdayjobs.com/Careers",
    homeHub: "sydney",
  },
  {
    id: "brisbane-alq",
    name: "ALS Limited",
    sector: "Professional Services",
    platform: "workday",
    endpoint: "https://alsglobal.wd103.myworkdayjobs.com/wday/cxs/alsglobal/External/jobs",
    origin: "https://alsglobal.wd103.myworkdayjobs.com/External",
    homeHub: "brisbane", // global HQ, Bowen Hills
  },
  {
    id: "sydney-asx",
    name: "ASX Limited",
    sector: "Financial Services",
    platform: "workday",
    endpoint: "https://asx.wd105.myworkdayjobs.com/wday/cxs/asx/ASX_Careers/jobs",
    origin: "https://asx.wd105.myworkdayjobs.com/ASX_Careers",
    homeHub: "sydney",
  },
  {
    id: "melbourne-reh",
    name: "Reece Group",
    sector: "Industrial Manufacturing",
    platform: "workday",
    endpoint: "https://reece.wd105.myworkdayjobs.com/wday/cxs/reece/ReeceCareers/jobs",
    origin: "https://reece.wd105.myworkdayjobs.com/en-GB/ReeceCareers",
    homeHub: "melbourne",
  },
  {
    id: "sydney-rhc",
    key: "sydney-rhc-uk",
    name: "Ramsay Health Care",
    sector: "Hospitals",
    platform: "workday",
    endpoint:
      "https://ramsayhealthcare.wd3.myworkdayjobs.com/wday/cxs/ramsayhealthcare/Ramsay_Careers/jobs",
    origin: "https://ramsayhealthcare.wd3.myworkdayjobs.com/en-GB/Ramsay_Careers",
    homeHub: "london", // the UK arm; the AU board is a separate site (see below)
  },
  {
    id: "sydney-jhx",
    name: "James Hardie",
    sector: "Industrial Manufacturing",
    platform: "successfactors",
    endpoint: "https://careers.jameshardie.com",
    origin: "https://careers.jameshardie.com",
    homeHub: "sydney",
  },
  // These three were the boards that 403'd the build sandbox. Re-probed from
  // the Worker (which egresses from Cloudflare, not from here) and all three
  // answer it — so they need configuration, not scrapers.
  {
    id: "nz-xero",
    name: "Xero",
    sector: "Technology, Media and Telecommunications",
    platform: "xmlfeed",
    endpoint: "https://careers.xero.com/jobs/xml/?rss=true",
    origin: "https://careers.xero.com",
    homeHub: "auckland",
  },
  {
    id: "sydney-rhc",
    key: "sydney-rhc-au",
    name: "Ramsay Health Care",
    sector: "Hospitals",
    // The AU board is a SmartRecruiters widget; the UK arm is Workday (above).
    platform: "smartrecruiters",
    endpoint: "RamsayHealthCare1",
    origin: "https://www.ramsaycareers.com.au",
    homeHub: "sydney",
  },
  {
    id: "sydney-ald",
    name: "Ampol",
    sector: "Energy & Natural Resources",
    platform: "ampol",
    endpoint: "https://www.careers.ampol.com/jobs",
    origin: "https://www.careers.ampol.com",
    homeHub: "sydney",
  },
  {
    id: "melbourne-ori",
    name: "Orica",
    sector: "Energy & Natural Resources",
    platform: "successfactors",
    endpoint: "https://careers.orica.com",
    origin: "https://careers.orica.com",
    homeHub: "melbourne",
  },
  {
    id: "sydney-gpt",
    name: "GPT Group",
    sector: "Financial Services",
    platform: "successfactors",
    endpoint: "https://careers.gpt.com.au",
    origin: "https://careers.gpt.com.au",
    homeHub: "sydney",
  },
  {
    id: "min",
    name: "Mineral Resources",
    sector: "Energy & Natural Resources",
    // Same platform as Pilbara Minerals — server-rendered cards on
    // careers.<company>/jobs/search.
    platform: "plscareers",
    endpoint: "https://careers.mineralresources.com.au/jobs/search",
    origin: "https://careers.mineralresources.com.au",
    homeHub: "perth",
  },
  {
    id: "brisbane-nxt",
    name: "NextDC",
    sector: "Technology, Media and Telecommunications",
    platform: "smartrecruiters",
    endpoint: "NEXTDC",
    origin: "https://www.nextdc.com/careers",
    homeHub: "brisbane",
  },
  {
    id: "melbourne-car",
    name: "CAR Group",
    sector: "Technology, Media and Telecommunications",
    // The SmartRecruiters company is still "carsales", the pre-rename brand.
    platform: "smartrecruiters",
    endpoint: "carsales",
    origin: "https://careers.carsales.com.au",
    homeHub: "melbourne",
  },
  {
    id: "denver-nem",
    name: "Newmont",
    sector: "Energy & Natural Resources",
    platform: "phenom",
    endpoint: "https://jobs.newmont.com/us/en/search-results",
    origin: "https://jobs.newmont.com",
    homeHub: "denver",
  },
  {
    id: "melbourne-col",
    name: "Coles Group",
    sector: "Consumer & Retail",
    platform: "phenom",
    endpoint: "https://colescareers.com.au/au/en/search-results",
    origin: "https://colescareers.com.au",
    homeHub: "melbourne",
    // 531 roles. Six pages through the widget API, but 54 if this tenant ever
    // closes it and the walk falls back to the ten-a-page island — so the cap
    // is set for the fallback, not the fast path.
    maxPages: 60,
  },
  {
    id: "nst",
    name: "Northern Star Resources",
    sector: "Gold Mining",
    platform: "successfactors",
    endpoint: "https://careers.nsrltd.com",
    origin: "https://careers.nsrltd.com",
    homeHub: "perth",
  },
  {
    id: "s32",
    name: "South32",
    sector: "Metals & Mining",
    platform: "successfactors",
    endpoint: "https://careers.south32.net",
    origin: "https://careers.south32.net",
    homeHub: "perth",
  },
  {
    id: "sydney-evn",
    name: "Evolution Mining",
    sector: "Gold Mining",
    platform: "successfactors",
    endpoint: "https://careers.evolutionmining.com.au",
    origin: "https://careers.evolutionmining.com.au",
    homeHub: "sydney",
  },
  {
    id: "sydney-org",
    name: "Origin Energy",
    sector: "Energy & Utilities",
    platform: "successfactors",
    endpoint: "https://careers.originenergy.com.au",
    origin: "https://careers.originenergy.com.au",
    homeHub: "sydney",
  },
  {
    id: "nz-fisher-and-paykel-healthcare",
    name: "Fisher & Paykel Healthcare",
    sector: "Medical Devices",
    platform: "successfactors",
    endpoint: "https://careers.fphcare.com",
    origin: "https://careers.fphcare.com",
    homeHub: "auckland",
  },
  {
    // Brambles runs two Workday sites on one tenant: the corporate/office
    // roles, and CHEP's plant and depot roles. Same employer, so one id — but
    // distinct keys, or the second overwrites the first's KV snapshot.
    id: "sydney-bxb",
    key: "sydney-bxb-office",
    name: "Brambles",
    sector: "Logistics & Supply Chain",
    platform: "workday",
    endpoint: "https://brambles.wd5.myworkdayjobs.com/wday/cxs/brambles/Brambles_Careers/jobs",
    origin: "https://brambles.wd5.myworkdayjobs.com/Brambles_Careers",
    homeHub: "sydney",
  },
  {
    id: "sydney-bxb",
    key: "sydney-bxb-plant",
    name: "Brambles",
    sector: "Logistics & Supply Chain",
    platform: "workday",
    endpoint: "https://brambles.wd5.myworkdayjobs.com/wday/cxs/brambles/CHEP_Plant_Careers/jobs",
    origin: "https://brambles.wd5.myworkdayjobs.com/CHEP_Plant_Careers",
    homeHub: "sydney",
  },
  {
    // Santos runs the same Avature product as Macquarie and Woolworths, but
    // does honour jobRecordsPerPage, so the platform default applies.
    id: "sto",
    name: "Santos",
    sector: "Oil & Gas",
    platform: "avature",
    endpoint: "https://recruitment.santos.com/careers/SearchJobs",
    origin: "https://recruitment.santos.com",
    homeHub: "perth",
    avatureCells: { loc: 1 },
  },
  {
    id: "melbourne-cpu",
    name: "Computershare",
    sector: "Financial Services",
    platform: "oracle",
    endpoint: "https://fa-evdq-saasfaprod1.fa.ocs.oraclecloud.com",
    origin:
      "https://fa-evdq-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2001",
    homeHub: "melbourne",
    siteNumber: "CX_2001",
  },
  {
    id: "brisbane-sun",
    name: "Suncorp Group",
    sector: "Financial Services",
    platform: "oracle",
    endpoint: "https://fa-evew-saasfaprod1.fa.ocs.oraclecloud.com",
    origin:
      "https://fa-evew-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1",
    homeHub: "brisbane",
  },
  {
    id: "sydney-iag",
    name: "Insurance Australia Group",
    sector: "Insurance",
    platform: "phenom",
    endpoint: "https://careers.iag.com.au/global/en/search-results",
    origin: "https://careers.iag.com.au",
    homeHub: "sydney",
  },
  {
    id: "melbourne-rea",
    name: "REA Group",
    sector: "Technology, Media & Telecom",
    platform: "rea",
    endpoint: "https://www.rea-group.com/careers/jobs/",
    origin: "https://www.rea-group.com",
    homeHub: "melbourne",
  },
  {
    id: "sydney-scg",
    name: "Scentre Group",
    sector: "Real Estate",
    platform: "scentre",
    endpoint: "https://careers.scentregroup.com/jobs/search",
    origin: "https://careers.scentregroup.com",
    homeHub: "sydney",
  },
  {
    // HSBC's portal is global and the roster carries the issuer twice (LSE and
    // HKEX). It is archived once, against the primary listing; the Hong Kong
    // line reads the same rows through COMPANY_ID_ALIAS in openRolesFn, so the
    // roles are shown on both cards without being counted twice.
    id: "london-hsba",
    name: "HSBC Holdings",
    sector: "Financial Services",
    platform: "eightfold",
    endpoint: "https://portal.careers.hsbc.com/api/apply/v2/jobs?domain=hsbc.com",
    origin: "https://portal.careers.hsbc.com",
    homeHub: "london",
  },
];

/**
 * Which nightly tick fetches which sites.
 *
 * Sized by how deep each portal pages, not by how many there are. The binding
 * constraint is wall time, not subrequests: several of these hand back 9-25
 * roles a request over hundreds of roles (HSBC ~1,500 at 10 a page, Macquarie
 * ~500 at 9, CSL ~1,300 at 25). Walked one page at a time in a single
 * invocation that overruns the waitUntil budget and the remaining sites are
 * cancelled with no error — which is exactly what a first run here did. Pages
 * are now fetched in parallel windows (see pagedParallel) AND the sites split
 * four ways, so no tick depends on the budget being generous.
 */
export const PORTAL_GROUPS: string[][] = [
  ["bhp", "wds", "cba", "melbourne-anz"],
  ["rio", "fmg", "sydney-wbc", "wes"],
  ["sydney-mqg", "sydney-gmg"],
  ["london-hsba", "melbourne-csl"],
  // The seven added later. Grouped by how deep each pages rather than evenly:
  // Coles walks 531 roles at 10 a page and Woolworths at 6, so each of those
  // gets a tick largely to itself, while the Workday sites (which serve 20 a
  // page and total a few hundred between them) share one.
  ["melbourne-tls", "sydney-all", "sydney-qbe"],
  ["melbourne-tcl-au", "melbourne-tcl-us"],
  ["melbourne-col"],
  // The thirteen added after those. SuccessFactors is the constraint here, not
  // role count: its walk is sequential (each page's size is read off the one
  // before), so Northern Star's 128 roles at 7 a page cost 19 round trips
  // where Brambles' 249 cost 13 parallel ones. The SF sites are therefore
  // spread across three ticks and everything API-driven shares the fourth.
  ["nst", "s32"],
  ["sydney-evn", "sydney-org"],
  ["nz-fisher-and-paykel-healthcare", "sto", "melbourne-rea", "sydney-scg"],
  ["sydney-bxb-office", "sydney-bxb-plant", "melbourne-cpu", "brisbane-sun", "sydney-iag"],
  // Woolworths alone. It is the deepest walk we run — ~1,300 roles at a fixed
  // six a page is 216 requests and about 50 seconds — and a scheduled Worker's
  // waitUntil is the budget that actually binds here, so it does not share.
  ["sydney-wow-a"],
  ["sydney-wow-b"],
  ["sydney-wow-c"],
  // The eight added 2026-08. Counts probed live when added: ResMed 247,
  // BlueScope NA 152, SJOG 95, BlueScope ASEAN 36, APA 22, TLC 10, plus
  // Medibank (SuccessFactors) and Gold Corporation (LiveHire), which page
  // rather than report a total. ResMed is the only deep one, so it takes a
  // tick with the two smallest; the SuccessFactors walk is sequential, so
  // Medibank shares with the API-driven rest.
  ["sydney-rmd", "sydney-apa", "melbourne-tlc"],
  ["sydney-bsl-nac", "sydney-bsl-asean", "priv-st-john-of-god-health-care"],
  ["melbourne-mpl", "perth-gov-gold-corporation"],
  // The four added once their platforms were reverse-engineered: BlueScope's
  // Australian (SmartRecruiters) and NZ (CareerCentre) boards, Lynas
  // (MartianLogic) and Pilbara Minerals. All four are small and API- or
  // single-page-driven, so they share one tick.
  ["sydney-bsl-au", "sydney-bsl-nz", "perth-lyc", "pls"],
  // The twelve added in the second 2026-08 batch. Counts when probed: ALS 419,
  // Reece 247, Ramsay UK 122, ASX 73, NextDC 36, carsales 30, MinRes 30,
  // Vicinity 22, Charter Hall 7, plus Orica / GPT (SuccessFactors) and Newmont
  // (Phenom), which page rather than report a total. ALS and Reece are the deep
  // ones so they lead separate ticks; the SuccessFactors walk is sequential, so
  // those two share with the small API-driven boards.
  ["brisbane-alq", "sydney-chc", "melbourne-vcx"],
  ["melbourne-reh", "sydney-rhc-uk", "sydney-asx"],
  ["melbourne-ori", "sydney-gpt", "denver-nem"],
  ["sydney-jhx", "nz-xero"],
  ["sydney-rhc-au", "sydney-ald"],
  ["brisbane-nxt", "melbourne-car", "min"],
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const WD_PAGE = 20;
const DEFAULT_MAX_PAGES = 40;

function clean(s: string): string {
  return (
    s
      .replace(/&amp;/g, "&")
      // Numeric entities, so a decorative separator like "&#8226;" becomes a
      // bullet a filter can recognise instead of surviving as literal text.
      .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
      .replace(/&#x([0-9a-f]+);/gi, (_, d: string) => String.fromCodePoint(parseInt(d, 16)))
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&nbsp;|\u00a0/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** ISO day from anything Date.parse understands, else today. */
function isoDay(s: string): string {
  const t = Date.parse(s);
  return Number.isNaN(t) ? today() : new Date(t).toISOString().slice(0, 10);
}

/** ISO day from a unix timestamp in seconds (Eightfold's t_update). */
function isoFromEpoch(sec: number): string {
  return sec > 0 ? new Date(sec * 1000).toISOString().slice(0, 10) : today();
}

/**
 * Free-text location → a hub the app actually plots. Specific before general,
 * so "Port Hedland" beats "Perth" and "Western Australia" beats "Australia".
 *
 * This list has to cover the world now, not just Australia. The first three
 * portals were AU-only, so anything unrecognised could safely fall back to the
 * employer's home city. These are global employers — HSBC advertises in New
 * York, CSL in Bremen, Goodman in Madrid — and that fallback would have plotted
 * a German plasma-centre role on Melbourne. See hubFor.
 */
const HUB_MATCH: [string, string | null][] = [
  // Australia — mine sites and states resolve to their capital.
  ["port hedland", "perth"],
  ["newman", "perth"],
  ["karratha", "perth"],
  ["kalgoorlie", "perth"],
  ["tom price", "perth"],
  ["paraburdoo", "perth"],
  ["pilbara", "perth"],
  ["western australia", "perth"],
  [" wa,", "perth"],
  ["perth", "perth"],
  ["brisbane", "brisbane"],
  ["gladstone", "brisbane"],
  ["townsville", "brisbane"],
  ["weipa", "brisbane"],
  ["queensland", "brisbane"],
  [" qld", "brisbane"],
  ["melbourne", "melbourne"],
  ["broadmeadows", "melbourne"],
  ["geelong", "melbourne"],
  ["victoria, austral", "melbourne"],
  [" vic,", "melbourne"],
  ["adelaide", "adelaide"],
  ["south australia", "adelaide"],
  ["canberra", "canberra"],
  ["sydney", "sydney"],
  ["new south wales", "sydney"],
  [" nsw", "sydney"],
  // Asia-Pacific
  ["singapore", "singapore"],
  ["hong kong", "hongkong"],
  ["hongkong", "hongkong"],
  ["tokyo", "tokyo"],
  ["seoul", "seoul"],
  ["beijing", "beijing"],
  ["shanghai", "shanghai"],
  ["shenzhen", "shenzhen"],
  ["ganzhou", "ganzhou"],
  ["dubai", "dubai"],
  // Europe / Africa
  ["london", "london"],
  ["paris", "paris"],
  ["zurich", "zurich"],
  ["zürich", "zurich"],
  ["johannesburg", "johannesburg"],
  // North America
  ["new york", "newyork"],
  ["san francisco", "sanfrancisco"],
  ["san jose", "sanjose"],
  ["san diego", "sandiego"],
  ["los angeles", "losangeles"],
  ["seattle", "seattle"],
  ["denver", "denver"],
  ["houston", "houston"],
  ["chicago", "chicago"],
  ["austin", "austin"],
  ["atlanta", "atlanta"],
  ["bentonville", "bentonville"],
  ["omaha", "omaha"],
  ["indianapolis", "indianapolis"],
  ["charlotte", "charlotte"],
  ["minneapolis", "minneapolis"],
  ["cincinnati", "cincinnati"],
  ["boston", "boston"],
  ["dallas", "dallas"],
  ["washington", "washington"],
  ["philadelphia", "philadelphia"],
  ["portland", "portland"],
  ["toronto", "toronto"],
  ["calgary", "calgary"],
  ["montreal", "montreal"],
  ["vancouver", "vancouver"],
  ["ottawa", "ottawa"],
];

/**
 * Map a role's location onto a hub we plot.
 *
 * The home-hub fallback only applies when the text names the employer's own
 * country without a city ("Australia", "QLD, Australia") or is blank. A role
 * in a country we don't plot returns null — unplaced — because putting a
 * Vilvoorde role on Sydney because Goodman is Sydney-listed would be inventing
 * a fact the source never carried.
 */
function hubFor(loc: string, home: string | null, homeCountry: RegExp): string | null {
  const l = (loc || "").toLowerCase();
  for (const [needle, hub] of HUB_MATCH) if (l.includes(needle)) return hub;
  if (!l.trim() || homeCountry.test(l)) return home;
  return null;
}

/** "Posted Yesterday" / "Posted 5 Days Ago" → an ISO date, best effort. */
function workdayPosted(s: string): string {
  const t = (s || "").toLowerCase();
  const d = new Date();
  if (t.includes("today")) return today();
  if (t.includes("yesterday")) {
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  const m = /(\d+)\+?\s*days?/.exec(t);
  if (m) {
    d.setUTCDate(d.getUTCDate() - Number(m[1]));
    return d.toISOString().slice(0, 10);
  }
  return today();
}

/** Country patterns for the home-hub fallback, keyed by the hub itself. */
const HOME_COUNTRY: Record<string, RegExp> = {
  perth: /australia/,
  adelaide: /australia/,
  melbourne: /australia/,
  sydney: /australia/,
  brisbane: /australia/,
  canberra: /australia/,
  london: /united kingdom|england|\buk\b/,
  hongkong: /hong kong|china/,
};

/** One row built the same way whatever platform it came from. */
function job(site: SiteDef, title: string, loc: string, url: string, created: string, cat: string) {
  return {
    t: title,
    loc,
    cat,
    url,
    created,
    city: hubFor(loc, site.homeHub, HOME_COUNTRY[site.homeHub ?? ""] ?? /$^/),
    skills: skillsForText(title, undefined, { sector: site.sector }),
  };
}

/**
 * One retry on a transient failure, because `pagedParallel` cannot tell a
 * failed page from the end of the list: both arrive as zero rows, and the walk
 * stops at the first short page. On a portal paged six at a time that is 80
 * requests deep — Woolworths — a single dropped page silently truncates
 * everything after it (measured: 84 roles collected against 480 present).
 *
 * Only a thrown fetch or a 5xx/429 is retried. A 404 is an answer, not a
 * failure, and retrying it would just spend the subrequest budget twice.
 */
async function getText(url: string, init?: RequestInit): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", ...init?.headers },
      });
      if (res.ok) return await res.text();
      if (res.status < 500 && res.status !== 429) return null;
    } catch {
      // fall through to the retry
    }
  }
  return null;
}

/** Pages fetched at once from one portal. Enough to keep the walk inside a
 *  cron invocation, small enough to stay a polite trickle to the employer. */
const PAGE_CONCURRENCY = 6;

/**
 * Walk an offset-paged source, fetching pages in parallel windows instead of
 * one at a time.
 *
 * `page(i)` returns the rows of zero-based page `i` (empty when past the end).
 * The walk stops at the first page that comes back empty or short, which for a
 * stable offset pager means every later page is empty too.
 */
async function pagedParallel<T>(
  page: (i: number) => Promise<T[]>,
  pageSize: number,
  maxPages: number,
): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; start < maxPages; start += PAGE_CONCURRENCY) {
    const idx: number[] = [];
    for (let i = start; i < Math.min(start + PAGE_CONCURRENCY, maxPages); i++) idx.push(i);
    const windows = await Promise.all(idx.map(page));
    let done = false;
    for (const rows of windows) {
      out.push(...rows);
      if (rows.length < pageSize) {
        done = true;
        break;
      }
    }
    if (done) break;
  }
  return out;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "User-Agent": UA, Accept: "application/json", ...init?.headers },
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

// ── SAP SuccessFactors ───────────────────────────────────────────────────────
async function fetchSuccessFactors(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  // Page size is a tenant setting (BHP/Woodside 25, ANZ 100). It is read off
  // the first page rather than assumed, because guessing low silently skips
  // roles and guessing high ends the walk after one page.
  let pageSize = 0;
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  for (let page = 0; page < max; page++) {
    const startrow = pageSize ? page * pageSize : 0;
    const html = await getText(`${site.endpoint}/search/?q=&startrow=${startrow}`);
    if (!html) break;
    // Table theme first; tile theme when the page carries no table rows.
    const table = html.split(/<tr class="data-row">/i).slice(1);
    const tiles = table.length ? [] : html.split(/<div class="job-tile-cell">/i).slice(1);
    const rows = table.length ? table : tiles;
    if (!rows.length) break;
    if (!pageSize) pageSize = rows.length;
    let added = 0;
    for (const raw of rows) {
      const row = table.length ? raw.split(/<\/tr>/i)[0] : raw;
      const a =
        row.match(/<a href="([^"]+)"[^>]*class="jobTitle-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ??
        row.match(/<a[^>]*class="jobTitle-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!a) continue;
      const href = clean(a[1]);
      const title = clean(a[2]);
      if (!href || !title || seen.has(href)) continue;
      seen.add(href);
      const locM =
        row.match(/<span class="jobLocation">([\s\S]*?)<\/span>/i) ??
        row.match(/id="job-\d+-desktop-section-location-value"[^>]*>([\s\S]*?)<\/div>/i);
      const dateM =
        row.match(/<span class="jobDate[^"]*">([\s\S]*?)<\/span>/i) ??
        row.match(/id="job-\d+-desktop-section-date-value"[^>]*>([\s\S]*?)<\/div>/i);
      const loc = locM ? clean(locM[1]) : "";
      out.push(
        job(
          site,
          title,
          loc,
          href.startsWith("http") ? href : site.origin + href,
          dateM ? isoDay(clean(dateM[1])) : today(),
          "Career portal",
        ),
      );
      added++;
    }
    // A short page is the last page.
    if (added === 0 || rows.length < pageSize) break;
  }
  return out;
}

// ── Workday ──────────────────────────────────────────────────────────────────
interface WorkdayPosting {
  title?: string;
  locationsText?: string;
  externalPath?: string;
  postedOn?: string;
}

async function fetchWorkday(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  for (let page = 0; page < max; page++) {
    const json = await getJson<{ jobPostings?: WorkdayPosting[] }>(site.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appliedFacets: {},
        limit: WD_PAGE,
        offset: page * WD_PAGE,
        searchText: "",
      }),
    });
    const postings = json?.jobPostings ?? [];
    if (!postings.length) break;
    for (const p of postings) {
      const title = (p.title || "").trim();
      const path = (p.externalPath || "").trim();
      if (!title || !path || seen.has(path)) continue;
      seen.add(path);
      const loc = (p.locationsText || "").trim();
      out.push(
        job(site, title, loc, site.origin + path, workdayPosted(p.postedOn || ""), "Career portal"),
      );
    }
    if (postings.length < WD_PAGE) break;
  }
  return out;
}

// ── Eightfold AI ─────────────────────────────────────────────────────────────
interface EightfoldPos {
  name?: string;
  location?: string;
  t_update?: number;
  canonicalPositionUrl?: string;
  department?: string;
  id?: number | string;
}

// `num` is not honoured by this API — it returns 10 whatever you ask for — so
// the page size is fixed here rather than requested.
const EF_PAGE = 10;

async function fetchEightfold(site: SiteDef): Promise<PortalJob[]> {
  const max = site.maxPages ?? 200; // HSBC alone is ~1,500 roles at 10 a page
  const positions = await pagedParallel<EightfoldPos>(
    async (i) => {
      const json = await getJson<{ positions?: EightfoldPos[] }>(
        `${site.endpoint}&start=${i * EF_PAGE}&num=${EF_PAGE}`,
      );
      return json?.positions ?? [];
    },
    EF_PAGE,
    max,
  );
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const p of positions) {
    const title = (p.name || "").trim();
    const key = String(p.id ?? p.canonicalPositionUrl ?? title);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push(
      job(
        site,
        title,
        (p.location || "").trim(),
        p.canonicalPositionUrl || `${site.origin}/careers/job/${p.id ?? ""}`,
        isoFromEpoch(Number(p.t_update) || 0),
        (p.department || "").trim() || "Career portal",
      ),
    );
  }
  return out;
}

// ── Symphony Talent / SmashFly ───────────────────────────────────────────────
interface SymphonyJob {
  title?: string;
  url?: string;
  open_date?: string;
  primary_category?: string;
  google_locations?: { city?: string; state?: string; country?: string; address?: string }[];
  primary_city?: string;
}

// `limit` is accepted and ignored; the tenant returns 10 a page.
const SY_PAGE = 10;

async function fetchSymphony(site: SiteDef): Promise<PortalJob[]> {
  const max = site.maxPages ?? 60;
  const results = await pagedParallel<{ job?: SymphonyJob }>(
    async (i) => {
      const json = await getJson<{ searchResults?: { job?: SymphonyJob }[] }>(
        `${site.endpoint}&limit=${SY_PAGE}&offset=${i * SY_PAGE}`,
        { headers: { Referer: site.origin + "/" } },
      );
      return json?.searchResults ?? [];
    },
    SY_PAGE,
    max,
  );
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    const j = r.job;
    const title = (j?.title || "").trim();
    const url = (j?.url || "").trim();
    if (!title || seen.has(url || title)) continue;
    seen.add(url || title);
    const g = j?.google_locations?.[0];
    const loc =
      [g?.city, g?.state, g?.country].filter(Boolean).join(", ") || (j?.primary_city ?? "");
    out.push(
      job(
        site,
        title,
        loc,
        url || site.origin,
        isoDay(j?.open_date || ""),
        (j?.primary_category || "").trim() || "Career portal",
      ),
    );
  }
  return out;
}

// ── Oracle Recruiting Cloud ──────────────────────────────────────────────────
interface OracleReq {
  Title?: string;
  PrimaryLocation?: string;
  PostedDate?: string;
  Id?: string | number;
  JobFunction?: string;
}

const OR_PAGE = 25;

async function fetchOracle(site: SiteDef): Promise<PortalJob[]> {
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  const list = await pagedParallel<OracleReq>(
    async (i) => {
      // The site number is per tenant, not a constant: Westpac and Suncorp
      // both run CX_1, Computershare runs CX_2001. Sending the wrong one
      // returns an empty requisitionList rather than an error.
      const finder = `findReqs;siteNumber=${site.siteNumber ?? "CX_1"},limit=${OR_PAGE},offset=${i * OR_PAGE},sortBy=POSTING_DATES_DESC`;
      const url =
        `${site.endpoint}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` +
        `?onlyData=true&expand=requisitionList.secondaryLocations&finder=${encodeURIComponent(finder)}`;
      const json = await getJson<{ items?: { requisitionList?: OracleReq[] }[] }>(url);
      return json?.items?.[0]?.requisitionList ?? [];
    },
    OR_PAGE,
    max,
  );
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    const title = (r.Title || "").trim();
    const id = String(r.Id ?? "");
    if (!title || seen.has(id || title)) continue;
    seen.add(id || title);
    out.push(
      job(
        site,
        title,
        (r.PrimaryLocation || "").trim(),
        `${site.origin}/job/${id}`,
        isoDay(r.PostedDate || ""),
        (r.JobFunction || "").trim() || "Career portal",
      ),
    );
  }
  return out;
}

// ── LiveHire ─────────────────────────────────────────────────────────────────
interface LiveHireJob {
  roleName?: string;
  physicalLocation?: string;
  workLocationName?: string;
  countryName?: string;
  postedFrom?: string;
  urlCode?: string;
  seoSlug?: string;
  workType?: string;
}

async function fetchLiveHire(site: SiteDef): Promise<PortalJob[]> {
  const segment = site.endpoint; // the LiveHire segment code
  const tok = await getJson<{ access_token?: string; token_type?: string }>(
    `${site.origin}/api/jobsapi/careers/auth/token/${segment}`,
  );
  if (!tok?.access_token) return [];
  const auth = `${tok.token_type || "Bearer"} ${tok.access_token}`;
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const size = 50;
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  for (let page = 1; page <= max; page++) {
    const json = await getJson<{ jobs?: LiveHireJob[]; hasMoreResults?: boolean }>(
      `${site.origin}/careers-api/search/${segment}/${page}/${size}`,
      {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ multiSegment: true }),
      },
    );
    const jobs = json?.jobs ?? [];
    if (!jobs.length) break;
    for (const j of jobs) {
      const title = (j.roleName || "").trim();
      const code = (j.urlCode || j.seoSlug || "").trim();
      if (!title || seen.has(code || title)) continue;
      seen.add(code || title);
      const loc = [j.physicalLocation, j.workLocationName, j.countryName]
        .filter(Boolean)
        .join(", ")
        .trim();
      out.push(
        job(
          site,
          title,
          loc,
          code
            ? `${site.origin}/widgets/job-listings/${segment}/job/${code}`
            : `${site.origin}/widgets/job-listings/${segment}`,
          isoDay(j.postedFrom || ""),
          (j.workType || "").trim() || "Career portal",
        ),
      );
    }
    if (!json?.hasMoreResults) break;
  }
  return out;
}

// ── Greenhouse ───────────────────────────────────────────────────────────────
interface GreenhouseJob {
  title?: string;
  location?: { name?: string };
  absolute_url?: string;
  updated_at?: string;
  first_published?: string;
  id?: number;
}

async function fetchGreenhouse(site: SiteDef): Promise<PortalJob[]> {
  const json = await getJson<{ jobs?: GreenhouseJob[] }>(site.endpoint);
  const jobs = json?.jobs ?? [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const j of jobs) {
    const title = (j.title || "").trim();
    const key = String(j.id ?? title);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    const loc = (j.location?.name || "").trim();
    out.push(
      job(
        site,
        title,
        loc,
        j.absolute_url || site.origin,
        isoDay(j.first_published || j.updated_at || ""),
        "Career portal",
      ),
    );
  }
  return out;
}

// ── Avature (Macquarie) ──────────────────────────────────────────────────────
// The tenant fixes the page size at 9; jobRecordsPerPage is accepted and
// ignored, so the offset steps by 9.
const AV_PAGE = 9;

async function fetchAvature(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const max = site.maxPages ?? 80;
  // Page size is per TENANT, not per platform: Macquarie serves 9 and
  // Woolworths 6, and both accept-and-ignore a bigger jobRecordsPerPage
  // (asking Woolworths for 50 still returns 6). Sending it anyway matters —
  // without jobRecordsPerPage in the query, Woolworths ignores jobOffset
  // entirely and every page comes back as the first six.
  const size = site.pageSize ?? AV_PAGE;
  const page = async (i: number): Promise<string[]> => {
    const html = await getText(
      `${site.endpoint}/?listFilterMode=1&jobRecordsPerPage=${size}&jobOffset=${i * size}`,
    );
    // The result wrapper carries tenant-specific modifiers between the two
    // class names — Woolworths renders `article article--w--full
    // article--result` — so an exact "article article--result" split found
    // nothing there. Match the pair with anything allowed in between.
    //
    // Only blocks carrying a job link count. Past the end of its list
    // Woolworths returns a page holding ONE result-shaped wrapper with no job
    // in it, so counting raw blocks would read every page after the end as
    // non-empty and the walk would never detect that it had finished.
    return html
      ? html
          .split(/class="article[^"]*article--result/i)
          .slice(1)
          .filter((b) => /<a[^>]*href="[^"]*JobDetail[^"]*"/i.test(b))
      : [];
  };

  // NOT pagedParallel, which ends the walk at the first short page. Woolworths
  // throttles a six-wide window and answers a throttled request with a short
  // page, so that rule made the collected count a coin toss — three runs
  // against an unchanged portal returned 30, 84 and 480 roles. Here a short
  // page is only evidence of the end when the page after it is empty too.
  //
  // The tenant advertises its own total (`aria-label="502 results"`), which
  // bounds the walk when it is exact. Woolworths caps the display at "999+" —
  // the regex deliberately does not match that, because a capped figure is not
  // a total — so there the walk runs until a window of pages comes back with
  // no jobs in them, bounded by maxPages.
  //
  // `from` is where THIS feed starts. It is 0 for every tenant but Woolworths,
  // which is walked as three windows on three ticks; `last` is the page after
  // the end of this feed's window, not of the portal.
  const from = site.pageFrom ?? 0;
  const first = await getText(
    `${site.endpoint}/?listFilterMode=1&jobRecordsPerPage=${size}&jobOffset=${from * size}`,
  );
  const totalM = first?.match(/aria-label="([\d,]+) results"/i);
  const total = totalM ? Number(totalM[1].replace(/,/g, "")) : 0;
  const last = total > 0 ? Math.min(Math.ceil(total / size), from + max) : from + max;

  const blocks: string[] = first
    ? first
        .split(/class="article[^"]*article--result/i)
        .slice(1)
        .filter((b) => /<a[^>]*href="[^"]*JobDetail[^"]*"/i.test(b))
    : [];
  // A whole window of consecutive empty pages, not two. Two was still being
  // tripped early by throttling — the same portal returned 1072 roles on one
  // run and 1294 on the next — because a throttled page and the end of the
  // list are indistinguishable, and two in a row is common under load. Six in
  // a row is not, and the walk is bounded by maxPages regardless, so the cost
  // of being wrong here is one wasted window rather than a truncated portal.
  let emptyRun = 0;
  for (
    let start = from + 1;
    start < last && emptyRun < PAGE_CONCURRENCY;
    start += PAGE_CONCURRENCY
  ) {
    const idx: number[] = [];
    for (let i = start; i < Math.min(start + PAGE_CONCURRENCY, last); i++) idx.push(i);
    const windows = await Promise.all(idx.map(page));
    for (const rows of windows) {
      if (rows.length) {
        emptyRun = 0;
        blocks.push(...rows);
      } else {
        emptyRun++;
      }
    }
  }
  for (const b of blocks) {
    const a = b.match(/<a[^>]*href="([^"]*JobDetail[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const href = clean(a[1]);
    const title = clean(a[2]);
    if (!title || seen.has(href || title)) continue;
    seen.add(href || title);
    // Text cells run roughly: req id, location, posted date, category. Only the
    // date has a fixed shape, so it anchors the other two rather than any of
    // them being read by position — the order is not the same on every tenant.
    // The node is matched before cleaning, so no length bound is applied —
    // Avature indents its markup heavily and a "{2,60}" bound rejected every
    // cell on the grounds of the surrounding whitespace.
    const cells = [...b.matchAll(/>([^<>]+)</g)]
      .map((m) => clean(m[1]))
      .filter(
        (s) =>
          s.length > 1 &&
          !/^(View details|Apply|ID)$/i.test(s) &&
          // Santos renders "•" separators between its cells, which would sit
          // between the date and the location and be read as the location.
          /[a-z0-9]/i.test(s),
      );
    // Three date formats across the tenants we read: Macquarie's "31 Jul 2026",
    // Woolworths' "31-Jul-2026" and Santos' "Posted 22-Jul-2026". The old
    // anchor only accepted the first, which is why Woolworths' rows carried
    // neither a real posted date nor a location.
    const DATE = /^(?:Posted\s+)?\d{1,2}[ -][A-Za-z]{3}[ -]\d{4}$/;
    const dateAt = cells.findIndex((c) => DATE.test(c));
    const at = site.avatureCells;
    const loc = at ? (cells[at.loc] ?? "") : dateAt > 0 ? cells[dateAt - 1] : "";
    const cat = at
      ? at.cat != null && cells[at.cat]
        ? cells[at.cat]
        : "Career portal"
      : dateAt >= 0 && cells[dateAt + 1]
        ? cells[dateAt + 1]
        : "Career portal";
    out.push(
      job(
        site,
        title,
        loc,
        href.startsWith("http") ? href : site.origin + href,
        dateAt >= 0 ? isoDay(cells[dateAt].replace(/^Posted\s+/i, "").replace(/-/g, " ")) : today(),
        cat,
      ),
    );
  }
  return out;
}

// ── Phenom People (Coles, IAG) ───────────────────────────────────────────────
// A Phenom career site is a client app, but the FIRST page of results is
// embedded in a `phApp.ddo = {…}` island under `eagerLoadRefineSearch`,
// together with the total. That island is the entry point: it is what the page
// itself renders from, so it is always present.
//
// Paging goes through Phenom's own widget API rather than the island, because
// the island serves TEN roles a page — walking Coles' 531 that way is 54
// requests — while `POST /widgets` serves 100. Both were verified against the
// live sites. Two things about that API are easy to get wrong and cost a
// silent zero:
//
//   - the response nests under `refineSearch`, NOT `eagerLoadRefineSearch`
//     like the island does. Reading the island's key off the API returns
//     undefined and looks exactly like an empty portal.
//   - `lang`/`country` in the body are decoration. Sending `en_us`/`us` to an
//     Australian tenant returns the same 34 IAG roles as `en_au`/`au`, so no
//     per-tenant locale has to be recorded.
//
// The island's own `?from=N` paging is kept as the fallback for a tenant whose
// widget API is closed — it was measured working on Coles at from=0/10/…/200,
// each returning a different role — so a closed API costs speed, not data.
interface PhenomJob {
  title?: string;
  cityState?: string;
  city?: string;
  state?: string;
  country?: string;
  category?: string;
  applyUrl?: string;
  jobId?: string;
  reqId?: string;
  postedDate?: string;
}

/** Pull the `phApp.ddo = {…}` object out of a Phenom page. */
function phenomIsland(html: string): Record<string, unknown> | null {
  const at = html.indexOf("phApp.ddo =");
  if (at < 0) return null;
  const from = html.slice(at + "phApp.ddo =".length);
  // Brace-match rather than regex: the object contains job descriptions with
  // braces in them, so a lazy match to the first "}" truncates it.
  let depth = 0;
  for (let i = 0; i < from.length; i++) {
    const ch = from[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(from.slice(0, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** One page of Phenom's widget API, or null when the tenant has it closed. */
async function phenomWidget(
  site: SiteDef,
  from: number,
  size: number,
): Promise<PhenomJob[] | null> {
  const res = await getJson<{ refineSearch?: { data?: { jobs?: PhenomJob[] } } }>(
    `${site.origin}/widgets`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lang: "en_us",
        deviceType: "desktop",
        country: "us",
        pageName: "search-results",
        ddoKey: "refineSearch",
        sortBy: "",
        subsearch: "",
        from,
        jobs: true,
        counts: true,
        all_fields: [],
        size,
        clearAll: false,
        jdsource: "facets",
        isSliderEnable: false,
        pageId: "page11",
        siteType: "external",
        keywords: "",
        global: true,
      }),
    },
  );
  return res?.refineSearch?.data?.jobs ?? null;
}

const PH_PAGE = 100;

async function fetchPhenom(site: SiteDef): Promise<PortalJob[]> {
  const first = await getText(`${site.endpoint}?keywords=`);
  const island = first ? phenomIsland(first) : null;
  const eager = (island?.eagerLoadRefineSearch ?? {}) as {
    hits?: number;
    totalHits?: number;
    data?: { jobs?: PhenomJob[] };
  };
  const total = Number(eager.totalHits) || 0;
  if (!total) return [];
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;

  const rows: PhenomJob[] = [];
  // Probe the widget API with the first page before committing to it, so a
  // tenant that has it closed falls back rather than returning nothing.
  const probe = await phenomWidget(site, 0, PH_PAGE);
  if (probe?.length) {
    rows.push(...probe);
    const pages = Math.min(Math.ceil(total / PH_PAGE), max);
    if (pages > 1) {
      rows.push(
        ...(await pagedParallel<PhenomJob>(
          async (i) => (await phenomWidget(site, (i + 1) * PH_PAGE, PH_PAGE)) ?? [],
          PH_PAGE,
          pages - 1,
        )),
      );
    }
  } else {
    // Island paging. `pagedParallel` reads a short page as end-of-list, so the
    // walk must start at page 1 — handing it a page 0 that returns nothing
    // (because the island already holds it) ends the walk on its first window,
    // which is how this previously collected 10 of Coles' 531 roles.
    const size = eager.hits && eager.hits > 0 ? eager.hits : 10;
    rows.push(...(eager.data?.jobs ?? []));
    const pages = Math.min(Math.ceil(total / size), max);
    if (pages > 1) {
      rows.push(
        ...(await pagedParallel<PhenomJob>(
          async (i) => {
            const html = await getText(`${site.endpoint}?keywords=&from=${(i + 1) * size}&s=1`);
            const isl = html ? phenomIsland(html) : null;
            const e = (isl?.eagerLoadRefineSearch ?? {}) as { data?: { jobs?: PhenomJob[] } };
            return e.data?.jobs ?? [];
          },
          size,
          pages - 1,
        )),
      );
    }
  }

  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const title = clean(String(r.title ?? ""));
    if (!title) continue;
    // The island calls it jobId and the widget API calls it reqId; they carry
    // the same requisition number, so either one dedupes across both paths.
    const key = String(r.jobId ?? r.reqId ?? "") || title;
    if (seen.has(key)) continue;
    seen.add(key);
    const loc = clean(
      String(r.cityState ?? [r.city, r.state].filter(Boolean).join(", ") ?? r.country ?? ""),
    );
    const url = String(r.applyUrl ?? "");
    out.push(
      job(
        site,
        title,
        loc,
        url.startsWith("http") ? url : site.origin + url,
        isoDay(String(r.postedDate ?? "")) || today(),
        clean(String(r.category ?? "")) || "Career portal",
      ),
    );
  }
  return out;
}

// ── Next.js data island (Fortescue) ──────────────────────────────────────────
interface FortescueJob {
  id?: string;
  title?: string;
  country?: string;
  site?: string;
  category?: string;
  createdDateTime?: string;
}

/** ASP.NET's `/Date(1785118637000+0000)/` → an ISO day. */
function dotNetDate(s: string): string {
  const m = /\/Date\((\d+)/.exec(s || "");
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : today();
}

async function fetchNextData(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  const m = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return [];
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  // The component id is a generated uuid, so the list is found by shape rather
  // than by path — any componentProps entry carrying a fetchedJobs array.
  const props = (data as { props?: { pageProps?: { componentProps?: Record<string, unknown> } } })
    ?.props?.pageProps?.componentProps;
  let jobs: FortescueJob[] = [];
  for (const v of Object.values(props ?? {})) {
    const f = (v as { fetchedJobs?: FortescueJob[] })?.fetchedJobs;
    if (Array.isArray(f) && f.length) {
      jobs = f;
      break;
    }
  }
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const j of jobs) {
    const title = (j.title || "").trim();
    const id = String(j.id ?? "");
    if (!title || seen.has(id || title)) continue;
    seen.add(id || title);
    // `site` is "Australia - Perth"; `country` is the fallback when it is blank
    // (the exploration roles carry a country only).
    const loc = (j.site || "").trim() || (j.country || "").trim();
    out.push(
      job(
        site,
        title,
        loc,
        id ? `${site.endpoint}/${id}` : site.endpoint,
        dotNetDate(j.createdDateTime || ""),
        (j.category || "").trim() || "Career portal",
      ),
    );
  }
  return out;
}

// ── CSL's own board ──────────────────────────────────────────────────────────
const CSL_PAGE = 25;

async function fetchCsl(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const max = site.maxPages ?? 60;
  // `?page=` is 1-based here, unlike the offset pagers.
  const rows = await pagedParallel<RegExpMatchArray>(
    async (i) => {
      const html = await getText(`${site.endpoint}?page=${i + 1}`);
      if (!html) return [];
      return [
        ...html.matchAll(
          /<a class="block hover:bg-gray-50 group" href="([^"]+)">([\s\S]*?)<\/a>/gi,
        ),
      ];
    },
    CSL_PAGE,
    max,
  );
  for (const r of rows) {
    const href = clean(r[1]);
    // Text cells run: title, work type, department(s), business unit,
    // location, requisition id, "Posted on", date. The requisition id is the
    // one field with a fixed shape, so the location is read as the cell
    // before it rather than by counting from the start.
    const cells = [...r[2].matchAll(/>([^<>]{2,140})</g)].map((m) => clean(m[1])).filter(Boolean);
    const title = cells[0] || "";
    if (!title || seen.has(href || title)) continue;
    seen.add(href || title);
    const reqAt = cells.findIndex((c) => /^R-\d+$/.test(c));
    const posted = cells[cells.length - 1] || "";
    out.push(
      job(
        site,
        title,
        reqAt > 0 ? cells[reqAt - 1] : "",
        href.startsWith("http") ? href : site.origin + href,
        /\d{4}/.test(posted) ? isoDay(posted) : today(),
        cells[1] || "Career portal",
      ),
    );
  }
  return out;
}

// ── REA Group's own board ────────────────────────────────────────────────────
// rea-group.com/careers/jobs/ is a WordPress page, but a server-rendered one:
// the whole list ships in the HTML as `<li class="l-job-listing__item">`, with
// no pagination at all (34 roles in one page when this was written, and no
// `?page=` link anywhere in the markup). The requisition ids are Workday's
// `R00…`, so REA runs Workday behind this, but the tenant is not public — the
// rendered page is the only way in.
//
// Fields are labelled for screen readers rather than classed, which is what
// makes this parseable: each cell is preceded by `<span class="sr-only">Team:
// </span>` and friends, so the labels anchor the values instead of position.
async function fetchRea(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const block of html.split(/<li class="l-job-listing__item"[^>]*>/i).slice(1)) {
    const a = block.match(/<a class="c-job" href="([^"]+)"/i);
    const t = block.match(/<span class="sr-only">Position:\s*<\/span>([\s\S]*?)<\/div>/i);
    if (!a || !t) continue;
    const href = clean(a[1]);
    const title = clean(t[1]);
    if (!title || seen.has(href || title)) continue;
    seen.add(href || title);
    const loc = block.match(/<span class="sr-only">Location:\s*<\/span>([\s\S]*?)<\/div>/i);
    const team = block.match(/<span class="sr-only">Team:\s*<\/span>([\s\S]*?)<\/div>/i);
    out.push(
      job(
        site,
        title,
        loc ? clean(loc[1]) : "",
        href.startsWith("http") ? href : site.origin + href,
        // The list carries no posted date — only the detail page does, and
        // fetching 34 of those to learn it is not worth the budget. `today()`
        // is what every other dateless source falls back to.
        today(),
        (team ? clean(team[1]) : "") || "Career portal",
      ),
    );
  }
  return out;
}

// ── Scentre Group's own board ────────────────────────────────────────────────
// careers.scentregroup.com is a bespoke Rails board behind AWS WAF, but the
// challenge only guards the interactive JS — a plain GET returns the fully
// rendered result cards. One card per `job-search-results-card-col`, paged
// 1-based on `?page=N&query=`, and page 2 comes back with zero cards rather
// than an error once the list is exhausted.
const SCG_PAGE = 20;

async function fetchScentre(site: SiteDef): Promise<PortalJob[]> {
  const cards = await pagedParallel<string>(
    async (i) => {
      const html = await getText(`${site.endpoint}?page=${i + 1}&query=`);
      return html ? html.split(/class="col-12 job-search-results-card-col"/i).slice(1) : [];
    },
    SCG_PAGE,
    site.maxPages ?? 20,
  );
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const c of cards) {
    const a = c.match(/<a id="link_job_title[^"]*" href="([^"]+)">([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const href = clean(a[1]);
    const title = clean(a[2]);
    if (!title || seen.has(href || title)) continue;
    seen.add(href || title);
    // Every detail cell is an `id="<field>_icon_text_<hash>"` span, so the
    // field name in the id identifies it — no positional counting.
    const loc = c.match(/id="location_icon_text_[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const cat = c.match(/id="category_icon_text_[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    out.push(
      job(
        site,
        title,
        loc ? clean(loc[1]) : "",
        href.startsWith("http") ? href : site.origin + href,
        today(), // no posted date on the card
        (cat ? clean(cat[1]) : "") || "Career portal",
      ),
    );
  }
  return out;
}

// ── SmartRecruiters ─────────────────────────────────────────────────────────
// BlueScope's Australian board is a SmartRecruiters widget embedded in an AEM
// page, so the page itself carries no jobs — but SmartRecruiters publishes an
// unauthenticated postings API, which is a better source than the widget: it
// paginates cleanly and states its own total.
interface SrPosting {
  id?: string;
  name?: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string };
  department?: { label?: string };
  ref?: string;
}

const SR_PAGE = 100;

async function fetchSmartRecruiters(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  for (let page = 0; page < max; page++) {
    const url = `https://api.smartrecruiters.com/v1/companies/${site.endpoint}/postings?limit=${SR_PAGE}&offset=${page * SR_PAGE}`;
    const data = await getJson<{ content?: SrPosting[]; totalFound?: number }>(url);
    const rows = data?.content ?? [];
    if (!rows.length) break;
    for (const r of rows) {
      const title = (r.name || "").trim();
      const id = String(r.id ?? r.ref ?? title);
      if (!title || seen.has(id)) continue;
      seen.add(id);
      const l = r.location ?? {};
      const loc = [l.city, l.region, l.country].filter(Boolean).join(", ");
      out.push(
        job(
          site,
          title,
          loc,
          `https://jobs.smartrecruiters.com/${site.endpoint}/${r.id ?? ""}`,
          (r.releasedDate || "").slice(0, 10),
          (r.department?.label || "").trim() || "Career portal",
        ),
      );
    }
    if (rows.length < SR_PAGE) break;
  }
  return out;
}

// ── CareerCentre (NZ) ───────────────────────────────────────────────────────
// BlueScope's New Zealand Steel board. Server-rendered, and the job URL carries
// title, location and id as slug segments — /job/<title>/<location>/<id> — so
// the listing page alone gives everything without opening each ad.
async function fetchCareerCentre(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const max = site.maxPages ?? 20;
  const title = (slug: string) =>
    slug
      .split("-")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  for (let page = 1; page <= max; page++) {
    const html = await getText(page === 1 ? site.endpoint : `${site.endpoint}?page=${page}`);
    if (!html) break;
    const links = [...html.matchAll(/href="(\/job\/([^/"]+)\/([^/"]+)\/(\d+))"/gi)];
    if (!links.length) break;
    let fresh = 0;
    for (const m of links) {
      const id = m[4];
      if (seen.has(id)) continue;
      seen.add(id);
      fresh++;
      out.push(
        job(
          site,
          title(decodeURIComponent(m[2])),
          title(decodeURIComponent(m[3])),
          new URL(m[1], site.origin).toString(),
          "",
          "Career portal",
        ),
      );
    }
    // The pager keeps serving the last page rather than 404ing past the end,
    // so the walk stops when a page adds nothing new.
    if (!fresh) break;
  }
  return out;
}

// ── MartianLogic / MyRecruitment+ ───────────────────────────────────────────
// Lynas. The careers site is a Next.js shell whose own /api/search/ route
// proxies the ATS. The trailing slash matters — without it the route 308s, and
// a redirect that changes nothing but the path is easy to mistake for a dead
// endpoint.
interface MlJob {
  id?: number;
  title?: string;
  location?: string;
  type?: string;
  pay?: string;
  postedDate?: string;
  advertUrl?: string;
}

async function fetchMartianLogic(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const max = site.maxPages ?? 20;
  for (let page = 1; page <= max; page++) {
    const data = await getJson<{ total?: number; pageSize?: number; jobAds?: MlJob[] }>(
      `${site.origin}/api/search/?clientCode=${site.endpoint}&page=${page}&filter=&systemFilter=`,
    );
    const rows = data?.jobAds ?? [];
    if (!rows.length) break;
    for (const r of rows) {
      const t = (r.title || "").trim();
      const id = String(r.id ?? t);
      if (!t || seen.has(id)) continue;
      seen.add(id);
      out.push(
        job(
          site,
          t,
          // "Kalgoorlie | Western Australia" — the pipe is the site's own
          // separator, not part of either field.
          (r.location || "").split("|").map(clean).filter(Boolean).join(", "),
          r.advertUrl || site.origin,
          (r.postedDate || "").slice(0, 10),
          (r.type || "").trim() || "Career portal",
        ),
      );
    }
    const size = data?.pageSize ?? rows.length;
    if (rows.length < size) break;
    if (data?.total && out.length >= data.total) break;
  }
  return out;
}

// ── PLS (Pilbara Minerals) ──────────────────────────────────────────────────
// Server-rendered cards. The job links are ABSOLUTE urls, which is worth noting
// because the obvious `href="/...` pattern finds only the page's asset links
// and makes the board look like a JS app when it is not.
async function fetchPlsCareers(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const max = site.maxPages ?? 20;
  for (let page = 1; page <= max; page++) {
    const html = await getText(`${site.endpoint}?page=${page}&query=`);
    if (!html) break;
    const cards = html.split(/class="card job-search-results-card"/i).slice(1);
    if (!cards.length) break;
    let fresh = 0;
    for (const card of cards) {
      const a = card.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!a) continue;
      const url = a[1];
      const t = clean(a[2].replace(/<[^>]+>/g, " "));
      if (!t || seen.has(url)) continue;
      seen.add(url);
      fresh++;
      // The location text sits in a <span> AFTER an icon <i>, so the whole
      // <li> runs ~250 characters — a tighter cap silently yields no location
      // while still returning the job, which is the kind of half-empty row
      // that is easy to ship and hard to notice.
      const loc = card.match(/job-component-location[^>]*>([\s\S]{0,500}?)<\/li>/i);
      out.push(
        job(site, t, loc ? clean(loc[1].replace(/<[^>]+>/g, " ")) : "", url, "", "Career portal"),
      );
    }
    if (!fresh) break;
  }
  return out;
}

// ── Plain XML job feed ──────────────────────────────────────────────────────
// Xero. Its careers HTML challenges anything that is not a browser — from the
// build sandbox AND from the Worker — but the board also publishes an indexing
// feed of <job> elements carrying title, city, country, category, date and url
// in CDATA, and that endpoint is not gated at all. A feed the employer
// publishes for aggregators is the better source anyway: stable, complete in
// one request, and it states its fields instead of implying them from markup.
async function fetchXmlFeed(site: SiteDef): Promise<PortalJob[]> {
  const xml = await getText(site.endpoint);
  if (!xml) return [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const field = (block: string, name: string) => {
    const m = block.match(
      new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`, "i"),
    );
    return m ? clean(m[1]) : "";
  };
  for (const m of xml.matchAll(/<job>([\s\S]*?)<\/job>/gi)) {
    const b = m[1];
    const title = field(b, "title");
    const id = field(b, "requisitionid") || field(b, "referencenumber") || title;
    if (!title || seen.has(id)) continue;
    seen.add(id);
    const loc = [field(b, "city"), field(b, "state"), field(b, "country")]
      .filter(Boolean)
      .join(", ");
    // RFC-822 ("Fri, 31 Jul 2026 00:00:00 GMT") → YYYY-MM-DD.
    const raw = field(b, "date");
    const d = raw ? new Date(raw) : null;
    const posted = d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : "";
    out.push(
      job(
        site,
        title,
        loc,
        field(b, "url") || site.origin,
        posted,
        field(b, "category") || "Career portal",
      ),
    );
  }
  return out;
}

// ── Ampol ───────────────────────────────────────────────────────────────────
// Server-rendered, with title, location and id all in the slug:
//   /job/team-member-chinchilla-in-chinchilla-au-jid-1366
// so the listing page alone is enough.
//
// This parser was written against what the WORKER receives, not the sandbox:
// the same URL returns 49 job links to the build environment and 145 to a
// Cloudflare egress. Reverse-engineering it locally would have produced a
// parser fitted to a page the cron never sees.
const AMPOL_PAGE = 48;

async function fetchAmpol(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const max = site.maxPages ?? 20;
  const titleCase = (s: string) =>
    s
      .split("-")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  // The board caps a page at 48 whatever `size` asks for — requesting 200
  // returns 48 and looks complete, which is how a walk silently keeps only the
  // first third of the roles. So it pages until a page adds nothing new.
  for (let page = 1; page <= max; page++) {
    const html = await getText(`${site.endpoint}?page=${page}&size=${AMPOL_PAGE}`);
    if (!html) break;
    let fresh = 0;
    for (const m of html.matchAll(/href="(\/job\/([a-z0-9-]+?)-in-([a-z0-9-]+?)-jid-(\d+))"/gi)) {
      const id = m[4];
      if (seen.has(id)) continue;
      seen.add(id);
      fresh++;
      // The location tail carries a country code ("chinchilla-au"); drop it so
      // the hub matcher sees a place name rather than a place plus "Au".
      const place = m[3].replace(/-(au|nz|sg|us|gb)$/i, "");
      out.push(
        job(
          site,
          titleCase(m[2]),
          titleCase(place),
          new URL(m[1], site.origin).toString(),
          "",
          "Career portal",
        ),
      );
    }
    if (!fresh) break;
  }
  return out;
}

const FETCHERS: Record<Platform, (s: SiteDef) => Promise<PortalJob[]>> = {
  successfactors: fetchSuccessFactors,
  workday: fetchWorkday,
  eightfold: fetchEightfold,
  symphony: fetchSymphony,
  oracle: fetchOracle,
  livehire: fetchLiveHire,
  greenhouse: fetchGreenhouse,
  avature: fetchAvature,
  phenom: fetchPhenom,
  nextdata: fetchNextData,
  csl: fetchCsl,
  rea: fetchRea,
  scentre: fetchScentre,
  smartrecruiters: fetchSmartRecruiters,
  careercentre: fetchCareerCentre,
  martianlogic: fetchMartianLogic,
  plscareers: fetchPlsCareers,
  xmlfeed: fetchXmlFeed,
  ampol: fetchAmpol,
};

export async function fetchPortal(site: SiteDef): Promise<PortalJob[]> {
  return FETCHERS[site.platform](site);
}

/** Short source tag per platform, so an archive row says where it came from. */
const SOURCE_TAG: Record<Platform, string> = {
  successfactors: "sf",
  workday: "wd",
  eightfold: "ef",
  symphony: "sy",
  oracle: "or",
  livehire: "lh",
  greenhouse: "gh",
  avature: "av",
  nextdata: "nx",
  phenom: "ph",
  csl: "csl",
  rea: "rea",
  scentre: "scg",
  smartrecruiters: "sr",
  careercentre: "cc",
  martianlogic: "ml",
  plscareers: "pls",
  xmlfeed: "xml",
  ampol: "ale",
};

/** Portal rows → archive rows, attributed to the employer they came from. */
export function portalToArchive(jobs: PortalJob[], site: SiteDef): ArchiveRow[] {
  return jobs.map((j) => ({
    source: `portal-${SOURCE_TAG[site.platform]}`,
    title: j.t,
    company: site.name,
    companyId: site.id,
    hub: j.city,
    location: j.loc,
    category: j.cat,
    url: j.url,
    posted: j.created,
    skills: j.skills,
  }));
}

interface PortalEnv {
  OPEN_ROLES_HISTORY: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
  };
  JOBS_ARCHIVE?: unknown;
}

/**
 * One pass over the configured portals. Each employer's roles are stored under
 * `portal:<id>` for the card to read, and appended to the shared archive, which
 * is what dedups them against the same role pulled from a job board.
 *
 * `group` selects one slice of PORTAL_GROUPS; omit it to walk every site (what
 * the /run-portals trigger does).
 */
export async function processPortals(
  env: PortalEnv,
  archive: (rows: ArchiveRow[], day: string) => Promise<void>,
  group?: number,
): Promise<{ site: string; count: number }[]> {
  const day = today();
  const out: { site: string; count: number }[] = [];
  const only = group == null ? null : new Set(PORTAL_GROUPS[group] ?? []);
  for (const site of SITES) {
    const siteKey = site.key ?? site.id;
    if (only && !only.has(siteKey)) continue;
    const jobs = await fetchPortal(site);
    // An empty pull is never written: a portal that rate-limited or changed its
    // markup should leave yesterday's roles in place, not blank the card.
    if (!jobs.length) {
      out.push({ site: siteKey, count: 0 });
      continue;
    }
    await env.OPEN_ROLES_HISTORY.put(
      `portal:${siteKey}`,
      JSON.stringify({ updated: day, count: jobs.length, jobs }),
    );
    await archive(portalToArchive(jobs, site), day);
    out.push({ site: siteKey, count: jobs.length });
  }
  return out;
}
