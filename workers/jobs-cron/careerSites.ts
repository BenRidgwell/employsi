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
 *   - **PageUp Sites** (Qube). A server-rendered Rails board,
 *     `/jobs/search?page=N`, 30 `<article>` cards a page, whose footer prints
 *     "Displaying 1 - 30 of 106 in total" — so the walk is bounded by the
 *     board's own count rather than by a short page.
 *   - **Cornerstone OnDemand** (Mirvac). The career site is a client app, but
 *     its shell carries an anonymous bearer in `csod.context.token`; with that,
 *     `POST https://us.api.csod.com/rec-job-search/external/jobs` returns
 *     `{data:{totalCount,requisitions[]}}` with structured city/state/country.
 *   - **SnapHire** (Mercury NZ). Server-rendered `div.jobItem` tiles on one
 *     page — the board has no paginator because it has never needed one.
 *   - **JobAdder** (BGC). The site embeds a widget; the widget reads
 *     `apps.jobadder.com/widgets/V1/Jobs/RenderJobList`, a JSONP endpoint
 *     returning a chunk of HTML plus a "Page X of N" summary.
 *   - **SuccessFactors RMK, unified search service** (Bendigo & Adelaide
 *     Bank). The newer UI5/React theme renders nothing server-side, but its
 *     own bundle calls `POST /services/recruiting/v1/jobs`, which answers a
 *     plain request with `{jobSearchResult[].response, totalJobs}`. See the
 *     fetcher for why the walk repeats rather than paging once.
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
  | "ampol"
  | "taleo"
  | "aurizon"
  | "pageupsites"
  | "cornerstone"
  | "snaphire"
  | "jobadder"
  | "sfrmkapi"
  | "ashby"
  | "lever"
  | "rippling"
  | "aubgroup"
  | "zipco"
  | "bigredsky"
  | "elmo"
  | "attrax"
  | "wprest"
  | "wploop"
  | "pageupclassic"
  | "eightfoldpcs";

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
   * Taleo only: the career section's portal number, read off the careers page
   * (`FacetedSearchSettings: { portalNo: '8115010150' }`). The REST job board
   * rejects the call without it, so it is per tenant and measured, not derived.
   */
  portalNo?: string;
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
   * Avature only: read each role's fields off its OWN page instead of the
   * listing card, because this tenant's listing has no location on it.
   *
   * a2 Milk runs Avature's portal template, whose cards are [title, business
   * unit, ref, posted date] — there is no location cell and no cell index that
   * could stand in for one, so `avatureCells` cannot express it. The job pages
   * carry a labelled field table that does. Costs one request per role, so it
   * is set only where the board is small enough to be worth it.
   */
  avatureDetail?: boolean;
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
    // The roster id, not the Workday tenant slug. It was "cba" — which matches
    // the myworkdayjobs subdomain but no company in the roster — so every row
    // this feed archived was attributed to a company_id nothing could render.
    // Caught by scripts/check-roster.ts, which exists for exactly this.
    id: "sydney-cba",
    name: "Commonwealth Bank of Australia",
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
    // Qantas was the one board on the roster nobody could read: careers.qantas
    // .com sat behind Akamai fronting an Applyflow widget, and rendering it,
    // its WP REST route, its job sitemap and its /jobs/feed/ all came back with
    // no job links at all.
    //
    // It is readable now because Qantas MOVED. The group migrated onto
    // SmartRecruiters, whose public postings API needs no key, no browser and
    // no proxy — so the board we could not read by any means is now the same
    // one-request feed as NextDC above. Worth remembering the next time a board
    // looks impossible: the platform is the employer's choice, and it changes.
    //
    // The old Workday tenant (qantas.wd3.myworkdayjobs.com/Qantas_Careers) is
    // still up and answers 200 with total: 0. It is deliberately NOT wired —
    // an empty feed that never errors is exactly how a portal silently reads as
    // "no vacancies".
    //
    // Qantas Group, not Qantas Airways: the feed covers Jetstar and QantasLink
    // too, which is the right scope for an employer-level view.
    id: "sydney-qan",
    name: "Qantas Airways",
    sector: "Airlines & Aviation",
    platform: "smartrecruiters",
    endpoint: "QantasGroup",
    origin: "https://careers.qantas.com",
    homeHub: "sydney",
  },
  {
    id: "brisbane-azj",
    name: "Aurizon",
    sector: "Industrial Manufacturing",
    platform: "aurizon",
    endpoint: "https://www.aurizon.com.au",
    origin: "https://www.aurizon.com.au",
    homeHub: "brisbane",
  },
  {
    id: "sydney-hub",
    name: "HUB24",
    sector: "Financial Services",
    platform: "workday",
    // Tenant hub24management on wd105. Verified: 37 postings.
    endpoint:
      "https://hub24management.wd105.myworkdayjobs.com/wday/cxs/hub24management/HUB24_Careers/jobs",
    origin: "https://hub24management.wd105.myworkdayjobs.com/en-US/HUB24_Careers",
    homeHub: "sydney",
  },
  {
    id: "gmd",
    name: "Genesis Minerals",
    sector: "Gold",
    platform: "workday",
    // Tenant genesisminerals on wd103. Verified: 22 postings.
    endpoint:
      "https://genesisminerals.wd103.myworkdayjobs.com/wday/cxs/genesisminerals/genesiscareers/jobs",
    origin: "https://genesisminerals.wd103.myworkdayjobs.com/en-US/genesiscareers",
    homeHub: "perth",
  },
  {
    id: "sydney-cgf",
    name: "Challenger",
    sector: "Financial Services",
    platform: "workday",
    // Tenant challenger on wd3. Verified: 5 postings — a small board, not a
    // broken one, which is why the count is recorded here.
    endpoint:
      "https://challenger.wd3.myworkdayjobs.com/wday/cxs/challenger/Challenger_Careers/jobs",
    origin: "https://challenger.wd3.myworkdayjobs.com/en-US/Challenger_Careers",
    homeHub: "sydney",
  },
  {
    id: "perth-ggp",
    name: "Greatland Resources",
    sector: "Energy & Natural Resources",
    platform: "successfactors",
    // Tile theme. Verified: 13 tiles on page 1 of /search/?q=&startrow=0.
    endpoint: "https://careers.greatland.com.au",
    origin: "https://careers.greatland.com.au",
    homeHub: "perth",
  },
  {
    id: "brisbane-ape",
    name: "Eagers Automotive",
    sector: "Consumer & Retail",
    platform: "successfactors",
    // Table theme. Verified: 5 rows on page 1 of /search/?q=&startrow=0.
    endpoint: "https://careers.eagersautomotive.com.au",
    origin: "https://careers.eagersautomotive.com.au",
    homeHub: "brisbane",
  },
  {
    id: "sydney-tpg",
    name: "TPG Telecom",
    sector: "Technology, Media & Telecom",
    platform: "oracle",
    // Oracle Recruiting Cloud. Verified: 25 requisitions on the CX_1 site via
    // the recruitingCEJobRequisitions REST finder.
    endpoint: "https://fa-ewlx-saasfaprod1.fa.ocs.oraclecloud.com",
    origin: "https://fa-ewlx-saasfaprod1.fa.ocs.oraclecloud.com",
    homeHub: "sydney",
  },
  {
    id: "sydney-lnw",
    name: "Light & Wonder",
    sector: "Technology, Media & Telecom",
    platform: "workday",
    // Tenant "lnw" on wd5. Verified: 100 postings on the cxs endpoint.
    endpoint: "https://lnw.wd5.myworkdayjobs.com/wday/cxs/lnw/LightWonderExternalCareers/jobs",
    origin: "https://lnw.wd5.myworkdayjobs.com/en-US/LightWonderExternalCareers",
    homeHub: "sydney",
  },
  {
    id: "sydney-coh",
    name: "Cochlear",
    sector: "Healthcare & Life Sciences",
    platform: "workday",
    // Tenant "cochlear" on wd3. Verified: 84 postings on the cxs endpoint.
    endpoint: "https://cochlear.wd3.myworkdayjobs.com/wday/cxs/cochlear/Cochlear_Careers/jobs",
    origin: "https://cochlear.wd3.myworkdayjobs.com/en-US/Cochlear_Careers",
    homeHub: "sydney",
  },
  {
    id: "sydney-yal",
    name: "Yancoal Australia",
    sector: "Energy & Natural Resources",
    // The long query string on the careers link is SuccessFactors' own facet
    // syntax (createNewAlert, optionsFacetsDD_*), so this is the ordinary
    // branded career site and the existing fetcher reads it. Verified: 18 rows
    // on page 1 of /search/?q=&startrow=0.
    platform: "successfactors",
    endpoint: "https://careers.yancoal.com.au",
    origin: "https://careers.yancoal.com.au",
    homeHub: "sydney",
  },
  {
    id: "adelaide-cda",
    name: "Codan",
    sector: "Technology, Media & Telecom",
    platform: "successfactors",
    // Verified: 20 rows on page 1 of /search/?q=&startrow=0.
    endpoint: "https://careers.codan.com.au",
    origin: "https://careers.codan.com.au",
    homeHub: "adelaide",
  },
  {
    id: "melbourne-amc",
    name: "Amcor",
    sector: "Energy & Natural Resources",
    // Amcor's careers page is a client-rendered shell on amcor.com with no API
    // in the served HTML — rendering it through Oxylabs is what exposed the
    // apply links, and they point at jobs-sf.amcor.com. "sf" is SuccessFactors:
    // it is the ordinary branded career site, so the existing fetcher reads it
    // unchanged. Measured 31 job tiles on page 1 of /search/?q=&startrow=0.
    platform: "successfactors",
    endpoint: "https://jobs-sf.amcor.com",
    origin: "https://jobs-sf.amcor.com",
    homeHub: "melbourne",
  },
  {
    id: "melbourne-jbh",
    name: "JB Hi-Fi",
    sector: "Consumer & Retail",
    platform: "smartrecruiters",
    // The SmartRecruiters company is the GROUP tenant, not the JB Hi-Fi brand:
    // read off the widget config on jbhifi.com.au/pages/jobs, which is the only
    // place it appears. It covers The Good Guys as well, so rows land under
    // whichever advertiser the posting names. Measured 316 live postings.
    endpoint: "JBHi-FiTheGoodGuys1",
    origin: "https://jobs.smartrecruiters.com",
    homeHub: "melbourne",
  },
  {
    id: "melbourne-car",
    name: "CAR Group (carsales.com)",
    sector: "Technology, Media and Telecommunications",
    // Name matches the roster's, deliberately: the archive attributes rows by
    // this string, and a feed calling the company something the roster does not
    // use shows up in the admin console as a mis-attribution rather than as
    // stale config. Flagged by scripts/check-roster.ts as name drift.
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
    // Sonic Healthcare has no group-wide careers board — Australia is federated
    // across eleven pathology brands (DHM, Melbourne Pathology, SNP, Clinpath …)
    // that each publish a handful of roles on their own CMS. Sonic HealthPlus,
    // the occupational-health arm, is the one Sonic business running a real ATS,
    // and it recruits nationally: measured, its 18 live roles sit in Adelaide,
    // Brisbane, Karratha, Kewdale and Melbourne, not at the Sydney head office.
    // So homeHub is only the fallback; hubFor places each role from its own
    // location cell.
    id: "sydney-shl",
    key: "sydney-shl-healthplus",
    name: "Sonic Healthcare",
    sector: "Healthcare & Medical",
    platform: "taleo",
    endpoint: "https://shp.taleo.net",
    origin: "https://shp.taleo.net",
    // Read off the careers page's FacetedSearchSettings on 2026-08-02.
    portalNo: "8115010150",
    homeHub: "sydney",
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
    id: "sydney-qub",
    name: "Qube Holdings",
    sector: "Industrial Manufacturing",
    platform: "pageupsites",
    // Server-rendered, so no browser is needed — verified by diffing a plain
    // GET against a rendered one: the plain HTML carries all 30 cards, the
    // rendered page carries the same 30 plus a "Featured opportunities" strip
    // of 3 duplicates. Measured 2026-08-03: "Displaying 1 - 30 of 106 in
    // total", 4 pages, 106 distinct job URLs collected.
    endpoint: "https://careers.qube.com.au/jobs/search",
    origin: "https://careers.qube.com.au",
    homeHub: "sydney",
    // 106 at 30 a page is 4; 8 leaves room to double before the bound bites,
    // and the walk stops on the advertised total long before this anyway.
    // `pageSize` is deliberately not set: this fetcher never uses one, because
    // it is bounded by the board's printed total rather than by page arithmetic.
    maxPages: 8,
  },
  {
    id: "sydney-mgr",
    name: "Mirvac",
    sector: "Financial Services",
    platform: "cornerstone",
    // careers.mirvac.com is a redirect to the residential site — the actual
    // board is the Cornerstone tenant, reachable either directly or proxied
    // under www.mirvac.com/careers/job-search. The csod.com host is used
    // because the proxy only forwards page routes, not the API. Measured
    // 2026-08-03: totalCount 33, all Australian, 22 of them Sydney.
    endpoint: "https://mirvac.csod.com/ux/ats/careersite/1/home?c=mirvac",
    origin: "https://mirvac.csod.com",
    homeHub: "sydney",
  },
  {
    id: "nz-mercury-nz",
    name: "Mercury NZ",
    sector: "Electricity & Renewables",
    platform: "snaphire",
    // The board is one server-rendered page and has no paginator: no
    // `?wpjb-page`-style knob, no "next", no results count. Measured
    // 2026-08-03: 9 tiles, all in the central North Island (Rotorua, Taupō,
    // Waikato, Cambridge, Hamilton) — Mercury's generation assets, not its
    // Auckland head office, which is why those regions had to be added to
    // HUB_MATCH for the rows to plot at all.
    endpoint: "https://careers.mercury.co.nz/home",
    origin: "https://careers.mercury.co.nz",
    homeHub: "auckland",
  },
  {
    id: "melbourne-ben",
    name: "Bendigo & Adelaide Bank",
    sector: "Financial Services",
    platform: "sfrmkapi",
    // This is SuccessFactors, but NOT the theme fetchSuccessFactors reads: the
    // UI5/React "NES" theme server-renders nothing (measured: 138 KB of chrome
    // and zero /job/ links, against 81 advertised). It was very nearly a
    // rendered GitHub Action before its own bundle turned out to call a plain
    // JSON service. /viewalljobs/, the obvious way to skip paging, is a dead
    // route on this tenant — empty rendered and not.
    endpoint: "https://careers.bendigobank.com.au",
    origin: "https://careers.bendigobank.com.au",
    homeHub: "melbourne",
  },
  {
    id: "priv-bgc",
    name: "BGC",
    sector: "Construction & building products",
    platform: "jobadder",
    // The endpoint is the WIDGET KEY, not a URL: bgc.com.au/current-opportunities
    // embeds apps.jobadder.com/widgets/v1/jobs.min.js and hands it
    // `_jaJobsSettings.key`, which is the only place the key appears. Measured
    // 2026-08-03: 6 roles, all Perth, confirmed complete by the widget's own
    // pager summary (2 a page → "Page 1 of 3").
    endpoint: "AU5_doy4r5eqk2wuporei5kef4424i",
    origin: "https://www.bgc.com.au/current-opportunities/",
    homeHub: "perth",
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
  // ── The 2026-08-03 batch (second half). Counts are live measurements. ──────
  {
    id: "sydney-dxs",
    name: "Dexus",
    sector: "Property & REITs",
    platform: "workday",
    // Measured 2026-08-03: total 9.
    endpoint: "https://dexus.wd3.myworkdayjobs.com/wday/cxs/dexus/DexusCareers/jobs",
    origin: "https://dexus.wd3.myworkdayjobs.com/en-US/DexusCareers",
    homeHub: "sydney",
  },
  {
    id: "sydney-agl",
    name: "AGL Energy",
    sector: "Electricity & Renewables",
    platform: "workday",
    // Measured 2026-08-03: total 19. Locations are AGL's own site names
    // ("Melbourne Corporate", "2 Locations"), so most fall back to the home hub.
    endpoint: "https://agl.wd3.myworkdayjobs.com/wday/cxs/agl/AGL_Recruitment/jobs",
    origin: "https://agl.wd3.myworkdayjobs.com/en-US/AGL_Recruitment",
    homeHub: "sydney",
  },
  {
    id: "nz-meridian-energy",
    name: "Meridian Energy",
    sector: "Electricity & Renewables",
    platform: "smartrecruiters",
    // The company code is not the employer's name: meridianenergy.co.nz embeds
    // static.smartrecruiters.com/job-widget and hands it
    // `widget({"company_code": "MeridianEnergy1"})`, which is the only place it
    // appears. Measured 2026-08-03: 10 roles.
    endpoint: "MeridianEnergy1",
    origin: "https://www.meridianenergy.co.nz/careers",
    homeHub: "wellington",
  },
  {
    id: "rms",
    name: "Ramelius Resources",
    sector: "Gold",
    platform: "jobadder",
    // Widget key, read off rameliusresources.com.au/careers/current-opportunities
    // the same way BGC's was. Measured 2026-08-03: 24 roles; several carry no
    // location on the card, which is the widget's own omission, not a parse gap.
    endpoint: "AU5_uf7oi7f5zhkevkmrualspwsjru",
    origin: "https://www.rameliusresources.com.au/careers/current-opportunities/",
    homeHub: "perth",
  },
  {
    id: "sydney-whc",
    // Whitehaven advertises across TWO boards and this is only one of them. The
    // other is a Dayforce candidate portal whose search API is a POST that
    // Cloudflare 403s from any datacentre IP, so it runs as a GitHub Action
    // (.github/workflows/whitehaven-dayforce.yml) and writes the same company id.
    key: "sydney-whc-sf",
    name: "Whitehaven Coal",
    sector: "Coal Mining",
    platform: "successfactors",
    // Measured 2026-08-03: 9 roles, all Queensland (Moranbah, Blackwater), so
    // they place on the Brisbane hub rather than the company's Sydney home.
    endpoint: "https://careers.whitehavencoal.com.au",
    origin: "https://careers.whitehavencoal.com.au",
    homeHub: "sydney",
  },
  {
    id: "sydney-hvn",
    name: "Harvey Norman",
    sector: "Retail",
    platform: "pageupclassic",
    // Measured 2026-08-03: 191 roles, 160 of them (84%) placed on a hub. The
    // rest keep their store name ("Mile End Complex") because the board rations
    // the faceted searches that supply a state — see fetchPageUpClassic.
    endpoint: "https://www.harveynormancareers.com.au/en/listing/",
    origin: "https://www.harveynormancareers.com.au",
    homeHub: "sydney",
    maxPages: 12,
  },
  {
    id: "melbourne-nwl",
    name: "Netwealth Group",
    sector: "Financial Services",
    platform: "ashby",
    // Board slug from jobs.ashbyhq.com/netwealth. Measured 2026-08-03: 23 roles,
    // all "Melbourne Office".
    endpoint: "netwealth",
    origin: "https://jobs.ashbyhq.com/netwealth",
    homeHub: "melbourne",
  },
  {
    id: "sydney-sdf",
    name: "Steadfast Group",
    sector: "Insurance",
    platform: "elmo",
    // Measured 2026-08-03: 8 roles on one page, several of them Manila.
    endpoint: "https://steadfast.elmotalent.com.au/careers/default/jobs",
    origin: "https://steadfast.elmotalent.com.au",
    homeHub: "sydney",
  },
  {
    id: "sydney-edv",
    name: "Endeavour Group",
    sector: "Consumer and Retail",
    platform: "attrax",
    // Measured 2026-08-03: 47 cards on `?page=1&size=48`, so the board pages.
    // Store-level roles across the whole country (Dan Murphy's, BWS), which is
    // why maxPages is generous.
    endpoint: "https://endeavourgroupcareers.com.au/jobs",
    origin: "https://endeavourgroupcareers.com.au",
    homeHub: "sydney",
    pageSize: 48,
    maxPages: 30,
  },
  {
    id: "cmm",
    name: "Capricorn Metals",
    sector: "Gold",
    platform: "wprest",
    // The theme registers a `job` post type, so wp-json serves the board
    // directly. Measured 2026-08-03: 6 roles. The records carry no location —
    // it is prose in the post body — so they take the Perth home hub.
    endpoint: "https://capmetals.com.au/wp-json/wp/v2/job?per_page=100",
    origin: "https://capmetals.com.au",
    homeHub: "perth",
  },
  {
    id: "pru",
    name: "Perseus Mining",
    sector: "Gold",
    platform: "wploop",
    // The PAGE, not wp-json: see fetchWpLoop for why (the careers category holds
    // 8 posts the REST API cannot tell apart; the page lists the 4 that are
    // current, and only the page carries a Location). Measured 2026-08-03: 4,
    // in Ghana, Tanzania and Subiaco — the African sites fall back to Perth,
    // which is where Perseus's pin is.
    endpoint: "https://perseusmining.com/current-opportunities/",
    origin: "https://perseusmining.com",
    homeHub: "perth",
  },
  {
    id: "sydney-dow",
    name: "Downer Group",
    sector: "Industrial Manufacturing",
    platform: "oracle",
    // Oracle Recruiting Cloud on the EXFS pod. Measured 2026-08-03: 589
    // requisitions on the CareersAtDowner site, spread over every state plus NZ.
    endpoint: "https://fa-exfs-saasfaprod1.fa.ocs.oraclecloud.com",
    origin:
      "https://fa-exfs-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CareersAtDowner",
    homeHub: "sydney",
    siteNumber: "CareersAtDowner",
  },
  {
    id: "sydney-amp",
    name: "AMP",
    sector: "Financial Services",
    platform: "oracle",
    // Oracle Recruiting Cloud on the ESOW pod, default CX_1 site. Measured
    // 2026-08-03: 34 requisitions. A first probe returned 0 and a retest a
    // minute later returned 34 — the pod rate-limits rather than erroring,
    // which is exactly why an empty pull is never written (see processPortals).
    endpoint: "https://fa-esow-saasfaprod1.fa.ocs.oraclecloud.com",
    origin:
      "https://fa-esow-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1",
    homeHub: "sydney",
  },
  {
    id: "melbourne-cwy",
    name: "Cleanaway",
    sector: "Industrial Manufacturing",
    platform: "pageupclassic",
    // PageUp's hosted classic listing, instance 621. Measured 2026-08-03: 119
    // roles, 100% placed on a hub — this board's table is
    // [Position, Location, Opened, Closes], which is why fetchPageUpClassic
    // reads the location column out of <thead> rather than taking the last cell.
    endpoint: "https://careers.pageuppeople.com/621/cw/en/listing/",
    origin: "https://careers.pageuppeople.com",
    homeHub: "melbourne",
  },
  {
    id: "igo",
    name: "IGO",
    sector: "Battery Metals — Nickel & Lithium",
    platform: "pageupclassic",
    // Self-hosted PageUp classic (same `search-results-content` theme, no
    // <article> cards). Measured 2026-08-03: zero roles — the board renders
    // "No results found", not an error. That is a real zero and the card should
    // show it, so this is wired like any other feed; it will simply write
    // nothing until IGO advertises again.
    endpoint: "https://careers.igo.com.au/jobs/search",
    origin: "https://careers.igo.com.au",
    homeHub: "perth",
  },
  {
    id: "sydney-wor",
    name: "Worley",
    sector: "Energy & Natural Resources",
    platform: "eightfoldpcs",
    // Eightfold's newer PCSX search API, not the /api/apply/v2/jobs endpoint the
    // other eightfold sites use — jobs.worley.com serves only the former.
    // Measured 2026-08-03: 1,116 positions worldwide at 10 a page, so this is
    // the deepest walk in the file after Woolworths and it leads its own tick.
    endpoint: "https://jobs.worley.com/api/pcsx/search?domain=worley.com",
    origin: "https://jobs.worley.com",
    homeHub: "sydney",
  },
  {
    id: "sydney-sgm",
    name: "Sims Metal",
    sector: "Energy & Natural Resources",
    platform: "successfactors",
    // Measured 2026-08-04: 105 roles, matching the board's own "Results 1 – 25
    // of 105". Only 26 place on a hub, and that is right rather than a gap —
    // most of them are US scrapyard towns (Mays Landing NJ, Tabb VA, Monessen
    // PA) which are real places the map does not plot. Falling them back to
    // Sydney because Sims is Australian would put a Virginia labourer on the
    // Sydney pin.
    endpoint: "https://careers.simsltd.com",
    origin: "https://careers.simsltd.com",
    homeHub: "sydney",
  },
  // Telix runs THREE Greenhouse boards, one per region, and its own careers
  // page is just a switch between them (`?region=telixus|telixapac|telixemea`).
  // They share the roster company and so need distinct keys — see `key`.
  // Measured 2026-08-04: 46 + 11 + 18 = 75 roles.
  {
    id: "melbourne-tlx",
    key: "melbourne-tlx-us",
    name: "Telix Pharmaceuticals",
    sector: "Healthcare and Life Sciences",
    platform: "greenhouse",
    endpoint: "https://boards-api.greenhouse.io/v1/boards/telixus/jobs",
    origin: "https://telixpharma.com/careers/find-a-job",
    homeHub: "melbourne",
  },
  {
    id: "melbourne-tlx",
    key: "melbourne-tlx-apac",
    name: "Telix Pharmaceuticals",
    sector: "Healthcare and Life Sciences",
    platform: "greenhouse",
    endpoint: "https://boards-api.greenhouse.io/v1/boards/telixapac/jobs",
    origin: "https://telixpharma.com/careers/find-a-job",
    homeHub: "melbourne",
  },
  {
    id: "melbourne-tlx",
    key: "melbourne-tlx-emea",
    name: "Telix Pharmaceuticals",
    sector: "Healthcare and Life Sciences",
    platform: "greenhouse",
    endpoint: "https://boards-api.greenhouse.io/v1/boards/telixemea/jobs",
    origin: "https://telixpharma.com/careers/find-a-job",
    homeHub: "melbourne",
  },
  {
    id: "nz-the-a2-milk-company",
    name: "The a2 Milk Company",
    sector: "Dairy & Nutrition",
    platform: "avature",
    // Avature's PORTAL template, not the search grid the other Avature tenants
    // run — its cards carry no location, so the roles are read off their own
    // pages. See avatureDetail. Measured 2026-08-04: 4 roles, Pokeno and NSW.
    endpoint: "https://a2milkkf.avature.net/careers/SearchJobs",
    origin: "https://a2milkkf.avature.net",
    homeHub: "auckland",
    avatureDetail: true,
  },
  {
    id: "sydney-brg",
    name: "Breville Group",
    sector: "Consumer & Retail",
    platform: "cornerstone",
    // Same Cornerstone shape as Mirvac: the shell carries the bearer token and
    // the API cloud host, and the walk is bounded by the response's totalCount.
    // Measured 2026-08-05: 22 roles worldwide — 8 at the Alexandria (Sydney)
    // head office, 4 Torrance CA, 2 Seattle, 2 London, the rest Korea, the
    // Netherlands and Germany. `c=brevillesage` is the corp key the tenant
    // needs on every deep link, and it is read back out of the shell rather
    // than hardcoded, so the job URLs stay right if it ever changes.
    endpoint: "https://brevillesage.csod.com/ux/ats/careersite/1/home?c=brevillesage",
    origin: "https://brevillesage.csod.com",
    homeHub: "sydney",
  },
  {
    id: "sydney-vnt",
    name: "Ventia Services Group",
    sector: "Industrial Manufacturing",
    platform: "phenom",
    // Measured 2026-08-05: totalHits 222, and 222 collected — the island
    // reports the true total, so the walk is bounded rather than paging until
    // it sees a short page. Ventia is a services contractor, so this is the
    // most geographically spread board in the file: 46 Brisbane, 41 Perth, 40
    // Sydney, 17 Adelaide, 18 across NZ, and ~45 in towns hubFor has no needle
    // for (Carnarvon, Paihia, East Sale). Those keep the archive row and lose
    // only the city tag, which is the right way round.
    endpoint: "https://jobs.ventia.com/global/en/search-results",
    origin: "https://jobs.ventia.com",
    homeHub: "sydney",
    // 222 at 10 an island page is 23; 40 leaves room to roughly double before
    // the bound bites, and the walk stops on the advertised total first.
    maxPages: 40,
  },
  {
    id: "melbourne-ann",
    name: "Ansell",
    sector: "Healthcare and Life Sciences",
    platform: "taleo",
    // Ansell runs the OLD (non-faceted) Taleo career section, and it renders
    // NOTHING for an anonymous client: jobsearch.ftl is a 151 KB shell whose
    // job list arrives over the stateful JSF flow, and joblist.ftl is the same
    // shell with the rows left out. Both were fetched and parsed to confirm
    // that — zero jobdetail links in either, and posting the form back with all
    // 197 hidden fields and a cookie jar returns the shell again. It looked
    // like a job for a rendered browser.
    //
    // It is not: the REST jobboard the modern tenants use is still mounted on
    // this host, it just refuses to resolve the career section without the
    // portal number. `careerSectionUnAvailable: true` is what an empty, wrong
    // or non-numeric portal gets, and it is indistinguishable from a dead
    // board — which is why this is written down. Measured 2026-08-05: of "",
    // "ex", 1, 123456789, 999999999, Sonic's 8115010150 and 101430233, only
    // 101430233 resolves, and it returns Ansell's own requisitions (the
    // Seeduwa and Melaka plants, the EMEA and LATAM sales roles). 103
    // advertised, 25 a page.
    endpoint: "https://ansell.taleo.net",
    origin: "https://ansell.taleo.net",
    portalNo: "101430233",
    // Ansell is a global manufacturer with a small home office: on the day it
    // was added, none of the 103 roles was in Australia. homeHub is where the
    // company plots, not a claim about where the roles are — hubFor places each
    // one from its own location cell and leaves the rest untagged.
    homeHub: "melbourne",
    // 103 at 25 a page is 5; 12 leaves room to double, and the walk stops on
    // the first page that adds no new requisition id anyway.
    maxPages: 12,
  },
  {
    id: "wgx",
    name: "Westgold Resources",
    sector: "Energy & Natural Resources",
    platform: "workday",
    // wd103, not the wd3 every other Workday tenant here sits on — the pod is
    // part of the host and guessing it wrong 404s.
    endpoint: "https://westgold.wd103.myworkdayjobs.com/wday/cxs/westgold/westgold/jobs",
    origin: "https://westgold.wd103.myworkdayjobs.com/en-GB/westgold",
    // Measured 2026-08-05: 86 roles, 85 of them placed in Perth — Westgold's
    // sites are all Murchison/Bryah, and Workday prints "Perth, WA" for the
    // residential and FIFO postings alike. The one that does not place is
    // "Beta Hunt", the Kambalda mine, named as a SITE with no town or state
    // beside it — hubFor has no needle for it and it does not read as
    // Australian, so it stays untagged. A blank location would have fallen
    // back to Perth instead; this one is unplaced because it says something
    // hubFor cannot read, not because it says nothing.
    homeHub: "perth",
  },
  {
    id: "brisbane-boq",
    name: "Bank of Queensland",
    sector: "Financial Services",
    platform: "workday",
    endpoint: "https://boq.wd3.myworkdayjobs.com/wday/cxs/boq/Careers-at-BOQGroup/jobs",
    origin: "https://boq.wd3.myworkdayjobs.com/en-GB/Careers-at-BOQGroup",
    // Measured 2026-08-05: 61 roles. A retail bank advertises by BRANCH, so
    // half the location cells are suburb names ("Chermside") or the literal
    // "2 Locations" that Workday prints for a multi-site requisition. 30 place,
    // 31 do not, and the 31 keep their row untagged.
    homeHub: "brisbane",
  },
  {
    id: "melbourne-vea",
    name: "Viva Energy",
    sector: "Energy & Natural Resources",
    platform: "smartrecruiters",
    // The careers page is a shell that links out to SmartRecruiters; the
    // company token is the one in those links, not the page's own path.
    endpoint: "VivaEnergyAustralia",
    origin: "https://www.vivaenergy.com.au/career-opportunities",
    // Measured 2026-08-05: 13 roles and all 13 placed, spread over every
    // mainland capital — refinery, terminal and retail network sites.
    homeHub: "melbourne",
  },
  {
    id: "rrl",
    name: "Regis Resources",
    sector: "Energy & Natural Resources",
    platform: "elmo",
    // The careers page embeds this board in an iframe (?layout=iframe); the
    // same path without the layout parameter is the server-rendered list the
    // ELMO reader already knows how to walk.
    endpoint: "https://regisresources.elmotalent.com.au/careers/careers/jobs",
    origin: "https://regisresources.elmotalent.com.au",
    // Measured 2026-08-05: the board prints "1 - 5 of 5 jobs shown" and serves
    // exactly those 5, four of them at the Duketon operation near Laverton.
    // No paginator, so there is nothing to truncate.
    homeHub: "perth",
  },
  {
    id: "nhc",
    name: "New Hope Group",
    sector: "Energy & Natural Resources",
    platform: "livehire",
    // The LiveHire segment code, same shape as Wesfarmers. Found by probing the
    // ATS hosts directly: newhopegroup.com.au itself is unreachable from this
    // network, so the careers page could not be read to confirm the platform
    // the usual way. `newhope` is not the segment — it returns nothing —
    // `newhopegroup` is.
    endpoint: "newhopegroup",
    origin: "https://www.livehire.com",
    // Measured 2026-08-05: 4 roles — Toowoomba and Port of Brisbane in
    // Queensland, Muswellbrook and Bengalla in the NSW Hunter Valley.
    homeHub: "brisbane",
  },
  {
    id: "brisbane-mp1",
    name: "Megaport",
    sector: "Technology, Media & Telecom",
    platform: "lever",
    endpoint: "megaport",
    origin: "https://jobs.lever.co/megaport",
    // Measured 2026-08-05: 38 postings in one call. Megaport sells worldwide
    // from a Brisbane base, so two thirds of the board is in places the hub
    // list has no entry for (Arizona, Gurugram, Sofia, São Paulo); 9 land on
    // Brisbane and the rest keep their row untagged.
    homeHub: "brisbane",
  },
  {
    id: "sanfrancisco-xyz",
    name: "Block",
    sector: "Technology, Media & Telecom",
    platform: "greenhouse",
    // block.xyz/careers/jobs is a front end over Greenhouse board "block" —
    // the token is in the page's GREENHOUSE_BOARD constant. The endpoint is the
    // full board URL because that is what fetchGreenhouse takes; handing it the
    // bare token returns zero rows and looks exactly like an empty board.
    endpoint: "https://boards-api.greenhouse.io/v1/boards/block/jobs",
    origin: "https://block.xyz/careers/jobs",
    // Measured 2026-08-05: 198 roles across 23 hubs, dates spanning 75 distinct
    // days back to 2025-06-12. Block is plotted on San Francisco rather than
    // Oakland, which is where it actually is, because the hub list has no
    // Oakland — the roles themselves are placed from their own location cells.
    homeHub: "sanfrancisco",
  },
  {
    id: "melbourne-twe",
    name: "Treasury Wine Estates",
    sector: "Consumer & Retail",
    platform: "oracle",
    endpoint: "https://ebpm.fa.us2.oraclecloud.com",
    origin: "https://ebpm.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1",
    siteNumber: "CX_1",
    // Measured 2026-08-05: 48 roles. TWE sells wine worldwide, so the board is
    // mostly Asian sales roles — 13 Shanghai, 6 Singapore, 2 Tokyo — and only 3
    // in Australia. 24 sit in cities the hub list has no entry for (Bangkok,
    // Kuala Lumpur, Seoul) and stay untagged.
    homeHub: "melbourne",
  },
  {
    id: "sydney-gqg",
    name: "GQG Partners",
    sector: "Financial Services",
    platform: "cornerstone",
    // Same Cornerstone shape as Mirvac and Breville. Measured 2026-08-05: 5
    // roles — 2 Seattle, 1 Sydney, 2 unplaced.
    endpoint: "https://gqg.csod.com/ux/ats/careersite/1/home?c=gqg",
    origin: "https://gqg.csod.com",
    // GQG Partners is headquartered in Fort Lauderdale, which the hub list does
    // not carry; it is ASX-listed with a Sydney office, so it plots on Sydney.
    // The roles themselves are placed from their own location cells.
    homeHub: "sydney",
  },
  {
    id: "nz-contact-energy",
    name: "Contact Energy",
    sector: "Electricity & Renewables",
    platform: "smartrecruiters",
    // contact.co.nz/about-us/careers is a shell that mounts the SmartRecruiters
    // job widget; the company token is the one that widget loads, not the page
    // path. Measured 2026-08-05: 11 roles, all placed — 7 Auckland, 4
    // Wellington. "ContactEnergy1" returns nothing, so the token is exact.
    endpoint: "ContactEnergy",
    origin: "https://contact.co.nz/about-us/careers",
    homeHub: "auckland",
  },
  {
    id: "sydney-pni",
    name: "Pinnacle Investment Management",
    sector: "Financial Services",
    platform: "rippling",
    // Measured 2026-08-05: 5 roles in a single call.
    endpoint: "pinnacle-investment-management",
    origin: "https://ats.rippling.com/en-GB/pinnacle-investment-management/jobs",
    homeHub: "sydney",
  },
  {
    id: "sydney-aub",
    name: "AUB Group",
    sector: "Insurance",
    platform: "aubgroup",
    // AUB runs no ATS: its careers page links each opening straight to a
    // LinkedIn posting. The roles are read off AUB's own page, which carries a
    // title and nothing else — see fetchAubGroup for why that is preferred to
    // following the links through a proxy for data already in front of us.
    endpoint: "https://www.aubgroup.com.au/careers/",
    origin: "https://www.aubgroup.com.au/careers/",
    homeHub: "sydney",
  },
  {
    id: "sydney-nhf",
    name: "Nib",
    sector: "Insurance",
    platform: "workday",
    // wd105, like Westgold — the pod is part of the host.
    endpoint: "https://nib.wd105.myworkdayjobs.com/wday/cxs/nib/careers/jobs",
    origin: "https://nib.wd105.myworkdayjobs.com/en-GB/careers",
    // Measured 2026-08-05: ONE role, an ISMS Manager marked "2 Locations".
    // That is the whole board, not a truncated walk — Workday reports total 1.
    // A single-role portal looks like a broken feed and is not, which is
    // exactly why the count is written down here.
    homeHub: "sydney",
  },
  {
    id: "sydney-mts",
    name: "Metcash",
    sector: "Consumer & Retail",
    platform: "successfactors",
    endpoint: "https://careers.metcash.com",
    origin: "https://careers.metcash.com",
    // Measured 2026-08-05: 72 roles across every mainland capital plus Hobart —
    // a wholesaler with distribution centres in each. 70 of 72 place.
    homeHub: "sydney",
  },
  {
    id: "nz-fletcher-building",
    name: "Fletcher Building",
    sector: "Industrial Manufacturing",
    platform: "avature",
    endpoint: "https://careers.fbcareers.com/careers/SearchJobs",
    origin: "https://careers.fbcareers.com",
    // Measured 2026-08-05: 144 roles. Fletcher is why fetchAvature now prefers
    // the `list-item-location` class over guessing the cell by position — its
    // subtitle ends in a CLOSE date, not a posted one, so the positional anchor
    // found nothing and all 144 came back location-less. That is not the same
    // as unplaced: hubFor falls a blank back to the home hub, so the entire
    // board silently plotted on Auckland, including roles whose own titles say
    // Masterton. With the class read: 41 Auckland, 25 Wellington, and 76 in NZ
    // regions the hub list has no entry for (Wairarapa, Hawke's Bay, Bay of
    // Plenty), which now stay honestly untagged.
    homeHub: "auckland",
  },
  {
    id: "perth-waf",
    name: "West African Resources",
    sector: "Gold",
    platform: "jobadder",
    // The JobAdder widget key, read off the careers page's `_jaJobsSettings`
    // the same way BGC's and Ramelius' were — the page itself is a WordPress
    // shell whose only job content is an empty <div id="ja-jobs-widget">.
    // Measured 2026-08-05: 1 role, and the widget publishes no location for it,
    // which is its own omission rather than a parse gap (Ramelius does the same).
    endpoint: "AU3_aerfbzsbvsze3n3hkg3let2rmi",
    origin: "https://www.westafricanresources.com/careers/",
    homeHub: "perth",
  },
  {
    id: "sydney-zip",
    name: "Zip",
    sector: "Financial Services",
    platform: "zipco",
    // No third-party ATS: the list is server-rendered into Zip's own page.
    // Measured 2026-08-05: 30 roles, exactly matching the page's own
    // "30 roles in 4 locations" — 13 Sydney, 7 Melbourne, 10 offshore.
    endpoint: "https://zip.co/careers/roles",
    origin: "https://zip.co",
    homeHub: "sydney",
  },
  {
    id: "nwh",
    name: "NRW Holdings",
    sector: "Energy & Natural Resources",
    platform: "bigredsky",
    endpoint: "https://nrw-joinus.bigredsky.com/page.php?pageID=106",
    origin: "https://nrw-joinus.bigredsky.com",
    // Measured 2026-08-06: the board says "Viewing records: 1 to 20 of 25" and
    // the showAllRecords POST returns all 25. NRW is a Perth contractor whose
    // divisions (AES Equipment Solutions, Golding, Primero) hire across WA and
    // Queensland, so the LOCATION column carries the real spread.
    homeHub: "perth",
  },
  {
    id: "nz-chorus",
    name: "Chorus",
    sector: "Technology, Media & Telecom",
    platform: "successfactors",
    // Chorus LIMITED, the New Zealand telecommunications company (NZX: CNU) —
    // not Chorus Australia, the Perth community-care provider, whose Employment
    // Hero board was the first one offered for this id. They share nothing but
    // a name, and filing one's roles under the other is the fault class that
    // once put 31 Manila roles under IGO. The board was found from
    // company.chorus.co.nz/careers, which is the company's own site.
    //
    // ZERO ROLES TODAY, AND THAT IS THE BOARD'S OWN ANSWER. Measured
    // 2026-08-06, the search page says "There are currently no open positions"
    // and "The 0 most recent jobs posted by chorusnz are listed below" — so the
    // walk returning nothing is agreement with the source, not a parse failure.
    // The same reader pulls 72 from Metcash, so it is proven against this
    // markup. An empty pull is never written (see processPortals), so a quiet
    // period cannot blank a card that later fills.
    endpoint: "https://chorusnz.jobs.hr.cloud.sap",
    origin: "https://chorusnz.jobs.hr.cloud.sap",
    homeHub: "auckland",
  },
  {
    id: "ltr",
    name: "Liontown Resources",
    sector: "Energy & Natural Resources",
    platform: "successfactors",
    // liontown.com/careers is a WordPress page that links out to this board.
    // Measured 2026-08-06: 14 roles, every one at Kathleen Valley, the
    // company's WA lithium operation — which is why all 14 place on Perth.
    endpoint: "https://jobs.ltresources.com.au",
    origin: "https://jobs.ltresources.com.au",
    homeHub: "perth",
  },
  {
    id: "mnd",
    name: "Monadelphous Group",
    sector: "Industrial Manufacturing",
    platform: "avature",
    // NOT careers.monadelphous.com.au, which is the marketing site — its
    // "current vacancies" link redirects here, and here is the Avature tenant.
    endpoint: "https://jobs.monadelphous.com.au/careers/SearchJobs",
    origin: "https://jobs.monadelphous.com.au",
    // Measured 2026-08-06: 156 roles — 107 Perth, 28 Brisbane, 10 Sydney, and
    // a scatter across Darwin and Adelaide. A maintenance contractor, so many
    // rows carry several sites at once ("Newman, WA, Perth, WA, Port Hedland,
    // WA") and hubFor takes the first it recognises.
    homeHub: "perth",
    // Avature fixes this tenant's page size at 6 and ignores the size
    // parameter, so 156 roles really is a 26-request walk.
    maxPages: 40,
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
  ["bhp", "wds", "sydney-cba", "melbourne-anz"],
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
  // Sonic HealthPlus joins an existing tick rather than taking a new one: its
  // Taleo board is 18 roles served in a single POST, so it costs one request.
  ["brisbane-nxt", "melbourne-car", "min", "sydney-shl-healthplus", "sydney-qan"],
  // Groups 24-26: the boards added 2026-08 — Aurizon, HUB24, Genesis Minerals,
  // Challenger, Greatland, Eagers, TPG, Light & Wonder, Cochlear, Yancoal,
  // Codan, Amcor and JB Hi-Fi. Given their own ticks rather than packed into
  // existing slices because six of them are Workday or SuccessFactors, which
  // page hardest, and a tick that runs out of subrequests truncates silently.
  ["brisbane-azj", "sydney-hub", "gmd", "sydney-cgf"],
  ["perth-ggp", "brisbane-ape", "sydney-tpg", "sydney-lnw"],
  ["sydney-coh", "sydney-yal", "adelaide-cda", "melbourne-amc", "melbourne-jbh"],
  // Group 27: the five boards whose platforms were reverse-engineered in the
  // 2026-08-03 batch — Qube (PageUp Sites), Mirvac (Cornerstone), Mercury NZ
  // (SnapHire), BGC (JobAdder) and Bendigo (the SuccessFactors RMK search
  // service). Measured 106 / 33 / 9 / 6 / 81 = 235 roles. Bendigo is the only
  // one that costs real requests — its pager overlaps, so it walks twice — but
  // they are small JSON calls, so the five still share one tick. The sixth
  // board in the batch, Sandfire, genuinely needs a browser and runs as a
  // GitHub Action (.github/workflows/sandfire-portal.yml).
  ["sydney-qub", "sydney-mgr", "nz-mercury-nz", "priv-bgc", "melbourne-ben"],
  // Groups 28-29: the eleven in-Worker boards from the 2026-08-03 batch.
  // Measured 2026-08-03: Endeavour 561, Harvey Norman 191, Ramelius 24,
  // Netwealth 23, AGL 19, Meridian 10, Dexus 9, Whitehaven (SuccessFactors) 9,
  // Steadfast 8, Capricorn 6, Perseus 4 = 864 roles.
  //
  // Endeavour and Harvey Norman are the only expensive ones and they lead
  // separate ticks: Endeavour walks 12 pages of 48, and Harvey Norman spends a
  // rationed facet budget plus the listing (its board serves an EMPTY result
  // set rather than a 429 once the quota is gone, so packing it beside another
  // deep walk would silently cost rows rather than error).
  ["sydney-edv", "melbourne-nwl", "cmm", "pru"],
  [
    "sydney-hvn",
    "sydney-dxs",
    "sydney-agl",
    "nz-meridian-energy",
    "rms",
    "sydney-whc-sf",
    "sydney-sdf",
  ],
  // Groups 30-31: the five boards added 2026-08-03. Measured that day:
  // Worley 1,116, Downer 589, Cleanaway 119, AMP 34, IGO 0.
  //
  // Worley leads its own tick. Its PCSX API is fixed at ten positions a call,
  // so 1,116 is ~112 requests — the deepest walk in the file after Woolworths,
  // and the one most likely to be the thing a crowded tick truncates.
  //
  // The other four share: Downer's Oracle pod serves 25 a page (24 requests),
  // Cleanaway spends the PageUp facet budget plus its listing, AMP is two
  // calls and IGO one. IGO currently advertises nothing at all — that is a
  // real zero, not a failure, and it costs the tick a single request either way.
  ["sydney-wor"],
  ["sydney-dow", "melbourne-cwy", "sydney-amp", "igo"],
  // Group 32: the five feeds added 2026-08-04 — Sims (105), Telix's three
  // Greenhouse boards (46 + 11 + 18) and a2 Milk (4). One tick between them:
  // Greenhouse serves a whole board in a single call, a2 Milk is one listing
  // plus four job pages, and Sims is the only one that pages at all.
  [
    "sydney-sgm",
    "melbourne-tlx-us",
    "melbourne-tlx-apac",
    "melbourne-tlx-emea",
    "nz-the-a2-milk-company",
  ],
  // Group 33: the three added 2026-08-05. Measured that day: Ventia 222,
  // Ansell 103, Breville 22. Ventia is the only deep one (23 island pages);
  // Ansell is five REST pages and Breville a shell fetch plus one 50-row API
  // call, so all three share a tick.
  ["sydney-vnt", "melbourne-ann", "sydney-brg"],
  // Groups 34-35: the seven added 2026-08-05. Measured that day: Block 198,
  // Westgold 86, BOQ 61, Megaport 38, Viva 13, Regis 5, New Hope 4.
  //
  // The two Workday walks lead their own tick. Workday pages 20 at a time and
  // is the slowest reader in the file, so 86 + 61 is ~8 requests more than
  // everything else here put together.
  //
  // The other five are all single-call or near it: Greenhouse and Lever each
  // serve a whole board in one request, SmartRecruiters is a short walk, and
  // ELMO and LiveHire are one page each.
  ["wgx", "brisbane-boq"],
  ["sanfrancisco-xyz", "brisbane-mp1", "melbourne-vea", "rrl", "nhc"],
  // Group 36: the five added 2026-08-05 (second batch). Measured that day:
  // Treasury Wine 48, Contact Energy 11, GQG 5, Pinnacle 5, AUB 5. Treasury
  // Wine is the only one that pages; the other four are one or two calls each,
  // so all five share a tick.
  ["melbourne-twe", "nz-contact-energy", "sydney-gqg", "sydney-pni", "sydney-aub"],
  // Group 37: the five added 2026-08-06. Measured that day: Fletcher 144,
  // Metcash 72, Zip 30, nib 1, West African 1. Fletcher is the only deep walk
  // (Avature pages its result list); the other four are one or two calls each,
  // so all five share a tick.
  [
    "nz-fletcher-building",
    "sydney-mts",
    "sydney-zip",
    "sydney-nhf",
    "perth-waf",
    "nwh",
    "nz-chorus",
  ],
  // Group 38: added 2026-08-06. Monadelphous leads its own tick — 156 roles at
  // six a page is 26 requests, the deepest walk added this week — with Liontown
  // (14, one call) alongside it.
  ["mnd", "ltr"],
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
  ["pannawonica", "perth"],
  ["kewdale", "perth"],
  ["western australia", "perth"],
  // WA is also the US postal code for Washington State, and now that " wa,"
  // fires at the end of a string as well as mid-string (see hubFor), "Seattle,
  // WA" reaches it. Seattle is the only city we plot in Washington State, so it
  // is tested first — the entry further down in the North America block is then
  // unreachable for this spelling, and deliberately left there so the US list
  // still reads as a complete list of US hubs.
  ["seattle", "seattle"],
  [" wa,", "perth"],
  ["perth", "perth"],
  ["brisbane", "brisbane"],
  ["gladstone", "brisbane"],
  ["townsville", "brisbane"],
  ["weipa", "brisbane"],
  ["oxley", "brisbane"],
  ["queensland", "brisbane"],
  [" qld", "brisbane"],
  // Northern Territory. Darwin IS a tracked hub — it has coordinates in
  // HUB_LNGLAT, a state and a name in geo.ts, companies on the map and its own
  // nt-gov feed — but it was missing from this table entirely, so every role a
  // career portal advertised in the NT resolved to no hub, or fell back to the
  // employer's homeHub and landed in the wrong city. Measured on the archive
  // before this fix: 380 rows whose location names Darwin or the NT carried no
  // hub, and 59 more were placed in Canberra, Brisbane or Sydney. The 320 that
  // were right came from nt-gov, which sets the hub itself and never consulted
  // this table — which is exactly why the gap stayed invisible.
  //
  // "palmerston" is deliberately NOT matched bare: there is a Palmerston in the
  // ACT and a Palmerston North in New Zealand, and this is a substring test.
  ["darwin", "darwin"],
  ["northern territory", "darwin"],
  [" nt,", "darwin"],
  ["berrimah", "darwin"],
  ["palmerston nt", "darwin"],
  ["palmerston, nt", "darwin"],
  ["alice springs", "darwin"],
  ["katherine, nt", "darwin"],
  ["nhulunbuy", "darwin"],
  ["tennant creek", "darwin"],
  ["melbourne", "melbourne"],
  ["broadmeadows", "melbourne"],
  ["geelong", "melbourne"],
  ["dandenong", "melbourne"],
  ["victoria, austral", "melbourne"],
  [" vic,", "melbourne"],
  ["adelaide", "adelaide"],
  ["south australia", "adelaide"],
  [" sa,", "adelaide"],
  ["canberra", "canberra"],
  ["woden", "canberra"],
  ["belconnen", "canberra"],
  ["australian capital territory", "canberra"],
  [" act,", "canberra"],
  // Tasmania. Hobart is a tracked hub — coordinates in mapboxWorldGeo, a state
  // and a name in geo.ts, and its own tas-gov feed — but like Darwin before it,
  // it was missing from this table entirely, so a career portal advertising in
  // Tasmania resolved to no hub at all. tas-gov sets the hub itself and never
  // consults this table, which is why the gap stayed invisible until Bendigo
  // advertised in Huonville and Rosny Park.
  ["hobart", "hobart"],
  ["tasmania", "hobart"],
  [" tas,", "hobart"],
  ["launceston", "hobart"],
  ["devonport, tas", "hobart"],
  ["burnie, tas", "hobart"],
  // Erskineville (Sydney) must be tested BEFORE Erskine (Mandurah, WA) —
  // this is a substring match, so the shorter needle would otherwise swallow
  // the longer name and put an inner-Sydney role in Perth.
  ["erskineville", "sydney"],
  // Erskine PARK is in western Sydney (Penrith) and is a national logistics
  // hub, so employers advertise there constantly — Cleanaway's depot surfaced
  // it. It has to precede the Erskine (Mandurah, WA) needle for the same reason
  // Erskineville does. Measured against the archive before adding: 42 stored
  // locations name Erskine Park, every one of them New South Wales, against a
  // single "Erskine".
  ["erskine park", "sydney"],
  ["erskine", "perth"],
  ["sydney", "sydney"],
  ["wollongong", "sydney"],
  ["new south wales", "sydney"],
  [" nsw", "sydney"],
  // New Zealand. These were missing entirely, which only showed up once a
  // GLOBAL employer started advertising here: the NZ-based sites all set
  // homeHub to auckland, so their own roles landed correctly by fallback and
  // the gap stayed invisible. Qantas advertises in Auckland from a Sydney
  // homeHub, and those roles resolved to no hub at all.
  ["auckland", "auckland"],
  ["wellington", "wellington"],
  ["christchurch", "wellington"], // no Christchurch hub; Wellington is nearest
  // Central North Island. Mercury's nine roles are all here and none are in
  // Auckland — its generation assets sit on the Waikato river and the Taupō
  // geothermal field — so without these the whole feed resolved to no hub.
  // Auckland is the nearest plotted hub for every one of them, the same
  // nearest-hub reading as christchurch → wellington above.
  //
  // A bare "hamilton" is deliberately NOT one of them. Checked against the
  // 10,354 distinct locations already in the archive: of the 25 that contain
  // it, only four are the New Zealand city, and the rest are Hamilton in NSW,
  // QLD, VIC, Ohio, New Jersey, Manhattan and Hamilton Hill in Perth. Every
  // genuine NZ one but Qube's already says "NZ", "New Zealand" or "Waikato",
  // so the region needles below cover them and the ambiguous name is left out.
  // Qube's one bare "Hamilton" stays unplaced, which is the right answer: the
  // card does not say which Hamilton it means.
  //
  // These sit AFTER every Australian needle on purpose. Bendigo advertises a
  // "Hamilton, VIC, AUS" branch role and Qube a "Portland VIC" one; both match
  // [" vic,"] earlier and land on Melbourne. Reordering this block above the
  // Australian entries would move them to Auckland.
  ["waikato", "auckland"],
  ["rotorua", "auckland"],
  ["taupō", "auckland"],
  ["taupo", "auckland"],
  ["tauranga", "auckland"],
  ["new plymouth", "auckland"],
  // Mercury writes its Karāpiro/Arapuni hydro roles as "Cambridge, Hamilton".
  // The pairing is unambiguous — Cambridge NZ is 20 km from Hamilton NZ — where
  // either name alone is not.
  ["cambridge, hamilton", "auckland"],
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
  // Telix's US manufacturing site. Fishers is an Indianapolis suburb, ~30km
  // north-east, and the board names only the suburb. Added after measuring the
  // archive: not one of its rows carried "fishers" in a location, so the needle
  // can only match this employer's Indiana roles rather than colliding with
  // something already placed elsewhere.
  ["fishers", "indianapolis"],
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
export function hubFor(loc: string, home: string | null, homeCountry: RegExp): string | null {
  // A trailing comma is appended before matching so that the three needles that
  // END in one — " wa,", " nt,", " vic," — also fire when the abbreviation is
  // the last thing in the string. Those three are written with the comma on
  // purpose, because the bare forms are substrings of ordinary words
  // (" wa" is in " waikato" and " warsaw", " nt" in " ntaria", " vic" in
  // " vicenza"), and without this a state that is merely last went unplaced:
  // Qube's "Broome, WA", "Albany, WA" and "North Fremantle, WA" all resolved to
  // no hub while "Gladstone, QLD, Australia" resolved fine.
  //
  // Appending can only ever ADD matches, never remove one, since every needle
  // is tested with includes() against a string that now merely ends differently.
  const raw = (loc || "").trim();
  const l = raw.toLowerCase() + ",";
  for (const [needle, hub] of HUB_MATCH) if (l.includes(needle)) return hub;
  // Emptiness is tested on the ORIGINAL string, not the comma-appended one.
  // Appending the comma above quietly broke this: `l` for a blank location is
  // "," which is truthy, so "no location stated" stopped falling back to the
  // employer's home hub and started resolving to no hub at all. That is wrong
  // for every board whose cards omit a location — JobAdder and the WordPress
  // readers routinely do — and it is invisible, because an unplaced row still
  // archives, it just stops appearing on the map.
  if (!raw || homeCountry.test(l)) return home;
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
export const HOME_COUNTRY: Record<string, RegExp> = {
  perth: /australia/,
  adelaide: /australia/,
  melbourne: /australia/,
  sydney: /australia/,
  brisbane: /australia/,
  canberra: /australia/,
  // The NZ-homed sites had no entry here, so an NZ role in a town HUB_MATCH
  // does not name fell through to null instead of the employer's own hub —
  // the same fallback every Australian site has always had.
  auckland: /new zealand|\bnz\b/,
  wellington: /new zealand|\bnz\b/,
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
      // BOTH parameter families, because Avature tenants disagree on which one
      // they answer to. Monadelphous pages with folderRecordsPerPage /
      // folderOffset and ignored the job* pair entirely, so every page request
      // returned page one and the walk collected six roles out of fifty-five.
      // Unknown parameters are ignored, so sending both is safe for the
      // tenants that only read the job* pair.
      `${site.endpoint}/?listFilterMode=1&jobRecordsPerPage=${size}&jobOffset=${i * size}` +
        `&folderRecordsPerPage=${size}&folderOffset=${i * size}`,
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
          .filter((b) => /<a[^>]*href="[^"]*(?:Job|Folder)Detail[^"]*"/i.test(b))
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
    `${site.endpoint}/?listFilterMode=1&jobRecordsPerPage=${size}&jobOffset=${from * size}&folderRecordsPerPage=${size}&folderOffset=${from * size}`,
  );
  const totalM = first?.match(/aria-label="([\d,]+) results"/i);
  const total = totalM ? Number(totalM[1].replace(/,/g, "")) : 0;
  const last = total > 0 ? Math.min(Math.ceil(total / size), from + max) : from + max;

  const blocks: string[] = first
    ? first
        .split(/class="article[^"]*article--result/i)
        .slice(1)
        .filter((b) => /<a[^>]*href="[^"]*(?:Job|Folder)Detail[^"]*"/i.test(b))
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
  // a2 Milk's portal publishes NO location on the listing at all — its cards
  // run [title, business unit, ref, posted date] and the location exists only
  // on the job's own page. Reading a cell by position there would write "Ref
  // #410" as the location, so those tenants take the detail-page path below
  // instead. See avatureDetail.
  if (site.avatureDetail) return avatureFromDetails(site, blocks);

  for (const b of blocks) {
    // JobDetail OR FolderDetail. Avature tenants use both link shapes for the
    // same thing — Monadelphous publishes FolderDetail and matched nothing, so
    // its whole board read as empty rather than as unparsed.
    const a = b.match(/<a[^>]*href="([^"]*(?:Job|Folder)Detail[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
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
    // Avature's own class for the cell, where the tenant emits it. Preferred
    // over every positional guess below because it is the template SAYING which
    // cell is the location rather than us inferring it from neighbours.
    //
    // Fletcher Building is why this exists. Its subtitle runs
    // [location, ref, "Close date 10-Sep-2026"], and that date is an EXPIRY,
    // not a posting — so the DATE anchor finds nothing, `dateAt` is -1, and
    // every one of its 144 roles came back with an empty location. Empty does
    // not read as unplaced: hubFor falls a blank back to the home hub, so the
    // whole board silently plotted on Auckland, including the ones whose own
    // titles say Masterton.
    const semantic = b.match(/class="[^"]*list-item-location[^"]*"[^>]*>([^<]+)</i);
    // Failing that, the FIRST span of the card's subtitle. Avature's own
    // template puts the location there and the reference after it — Monadelphous
    // renders "<span> Newman, WA </span> · <span> Ref #300050311 </span>" and
    // carries no date at all, so the positional anchor below had nothing to
    // work from and every role came back location-less onto the home hub.
    //
    // Bounded at 900, not 400, and matching the SPAN directly rather than the
    // enclosing </div>. Avature indents its markup so heavily that a single
    // subtitle spans several hundred characters of whitespace — the same trap
    // the cells regex above documents — and a 400 bound matched nothing here
    // while looking perfectly reasonable.
    const subtitle = b.match(
      /article__header__text__subtitle[\s\S]{0,900}?<span[^>]*>([^<]+)<\/span>/i,
    )?.[1];
    const loc = semantic
      ? clean(semantic[1])
      : subtitle && !/^\s*Ref\s*#/i.test(subtitle)
        ? clean(subtitle)
        : at
          ? (cells[at.loc] ?? "")
          : dateAt > 0
            ? cells[dateAt - 1]
            : "";
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

/**
 * One labelled field off an Avature job page.
 *
 * The portal template renders each field as a label div followed by a value
 * div, with the tenant's own indentation between them:
 *
 *   <div class="article__content__view__field__label">  Location  </div>
 *   <div class="article__content__view__field__value">  New Zealand - Pokeno  </div>
 *
 * The gap is bounded so a field the page does not carry cannot silently pick up
 * the NEXT field's value — an unbounded `[\s\S]*?` would make a missing
 * "Location" resolve to whatever label follows it.
 */
function avatureField(html: string, label: string): string {
  const m = html.match(
    new RegExp(
      `field__label"[^>]*>\\s*${label}\\s*</div>[\\s\\S]{0,240}?field__value"[^>]*>([\\s\\S]*?)</div>`,
      "i",
    ),
  );
  return m ? clean(m[1]) : "";
}

/**
 * Avature tenants whose LISTING carries no location (see avatureDetail).
 *
 * Each job's own page is fetched and its labelled field table read: Location,
 * Date Published and Business Unit. That is one request per role on top of the
 * listing walk, which is why the flag is opt-in per site rather than the
 * default — it is only worth paying on a small board.
 *
 * The date comes from the detail page too. The listing's "Posted 07-Jul-2026"
 * agrees with it, but the detail page states the field explicitly rather than
 * leaving it to be found by shape, so there is no reason to prefer the guess.
 */
async function avatureFromDetails(site: SiteDef, blocks: string[]): Promise<PortalJob[]> {
  const links: { href: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    const a = b.match(/<a[^>]*href="([^"]*(?:Job|Folder)Detail[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const href = clean(a[1]);
    const title = clean(a[2]);
    if (!title || !href || seen.has(href)) continue;
    seen.add(href);
    links.push({ href: href.startsWith("http") ? href : site.origin + href, title });
  }

  const out: PortalJob[] = [];
  for (let i = 0; i < links.length; i += PAGE_CONCURRENCY) {
    const window = links.slice(i, i + PAGE_CONCURRENCY);
    const pages = await Promise.all(window.map((l) => getText(l.href)));
    window.forEach((l, n) => {
      const html = pages[n];
      // A detail page that failed to fetch is skipped rather than archived with
      // an empty location: an empty location falls back to the home hub, which
      // would quietly move an Auckland role to wherever the employer is pinned.
      if (!html) return;
      out.push(
        job(
          site,
          avatureField(html, "Job Title") || l.title,
          avatureField(html, "Location"),
          l.href,
          isoDay(avatureField(html, "Date Published")),
          avatureField(html, "Business Unit") || "Career portal",
        ),
      );
    });
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
  /** Phenom's permalink id — the only usable one, since applyUrl is empty. */
  jobSeqNo?: string;
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
    // NO PHENOM TENANT ACTUALLY SERVES applyUrl. Measured 2026-08-05 across all
    // three: Coles returns "", Newmont and Ventia omit the field entirely — so
    // `site.origin + ""` was writing the careers homepage as every role's link.
    // The canonical Phenom permalink is the search path with /job/<jobSeqNo> in
    // place of /search-results, which was checked against a live role on each of
    // the three tenants (200, and the page names the right requisition).
    const applyUrl = String(r.applyUrl ?? "");
    const seq = String(r.jobSeqNo ?? "");
    const url = applyUrl.startsWith("http")
      ? applyUrl
      : applyUrl
        ? site.origin + applyUrl
        : seq
          ? site.endpoint.replace(/\/search-results\/?$/, `/job/${encodeURIComponent(seq)}`)
          : site.endpoint;
    out.push(
      job(
        site,
        title,
        loc,
        url,
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

// ── Oracle Taleo (faceted career section) ────────────────────────────────────
interface TaleoReq {
  jobId?: string;
  contestNo?: string;
  /** Display cells, tenant-ordered; `locationsColumns` names which hold them. */
  column?: string[];
  linkedColumn?: number;
  locationsColumns?: number[];
}
interface TaleoPage {
  requisitionList?: TaleoReq[];
  pagingData?: { currentPageNo?: number; pageSize?: number; totalCount?: number };
}

/**
 * Taleo's career section renders nothing server-side, but the faceted search it
 * runs in the browser is a plain JSON POST, so the Worker can call that directly
 * rather than needing a headless browser:
 *
 *   POST /careersection/rest/jobboard/searchjobs?lang=en&portal=<portalNo>
 *
 * The `tz`/`tzname` headers are NOT optional. Without them the endpoint answers
 * 500 "An Error Occurred in TEE" — measured against Sonic HealthPlus, where the
 * identical body succeeds the moment the two headers are added. They are what
 * SearchHandler.js sends, so we send them too.
 *
 * Columns are positional and tenant-ordered. `linkedColumn` is the index of the
 * title and `locationsColumns[0]` the index of the locations cell (itself a
 * JSON array of strings), so both are read from the response rather than
 * assumed — a tenant that orders them differently still parses.
 *
 * Paging: `pageNo` in the body is honoured, but a request past the last page
 * CLAMPS to the last page rather than returning empty. So the walk stops when a
 * page adds no new requisition ids, not when it comes back short — otherwise a
 * one-page board would loop to maxPages re-reading the same rows.
 */
async function fetchTaleo(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  let advertised = 0;
  for (let page = 1; page <= max; page++) {
    const json = await getJson<TaleoPage>(
      `${site.endpoint}/careersection/rest/jobboard/searchjobs?lang=en&portal=${site.portalNo ?? ""}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          tz: "GMT+10:00",
          tzname: "Australia/Sydney",
        },
        body: JSON.stringify({
          multilineEnabled: false,
          sortingSelection: { sortBySelectionParam: "3", ascendingSortingOrder: "false" },
          fieldData: { fields: { KEYWORD: "", LOCATION: "" }, valid: true },
          filterSelectionParam: { searchFilterSelections: [] },
          advancedSearchFiltersSelectionParam: { searchFilterSelections: [] },
          pageNo: page,
        }),
      },
    );
    const rows = json?.requisitionList;
    if (!rows || !rows.length) break;
    advertised = json?.pagingData?.totalCount ?? advertised;
    let added = 0;
    for (const r of rows) {
      const id = r.jobId ?? r.contestNo ?? "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const cells = r.column ?? [];
      const title = clean(cells[r.linkedColumn ?? 0] ?? "");
      if (!title) continue;
      // The locations cell is a JSON array ("[\"AU-SA-Adelaide\"]"). Taleo
      // prefixes each with country/state codes, which hubFor cannot read, so
      // the trailing segment is what gets matched to a hub.
      let loc = "";
      const rawLoc = cells[r.locationsColumns?.[0] ?? -1];
      if (rawLoc) {
        try {
          const parsed = JSON.parse(rawLoc) as string[];
          loc = (parsed[0] ?? "").split("-").pop()?.trim() ?? "";
        } catch {
          loc = clean(rawLoc);
        }
      }
      // Tenants disagree on how the date cell is written and there is no header
      // to say which column it is, so the cell is found by shape. Measured
      // 2026-08-05: Sonic HealthPlus prints "04-Aug-2026", Ansell prints
      // "Aug 5, 2026". Date.parse reads both, but only once the right cell has
      // been picked out — matching one shape alone silently dated a whole board
      // to the day it was scraped.
      const posted =
        cells.find((c) => /^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(c ?? "")) ??
        cells.find((c) => /^[A-Za-z]{3}\.? \d{1,2}, \d{4}$/.test(c ?? "")) ??
        "";
      out.push(
        job(
          site,
          title,
          loc,
          `${site.origin}/careersection/jobdetail.ftl?job=${encodeURIComponent(id)}`,
          posted ? isoDay(posted) : today(),
          "Career portal",
        ),
      );
      added++;
    }
    // Clamped page (every id already seen) = end of list.
    if (added === 0) break;
  }
  // The board's own total routinely exceeds what it will serve anonymously
  // (Sonic HealthPlus: 22 advertised, 18 returned, stable across pages and
  // across multiline on/off). Collected is what we archive; the gap is logged
  // rather than back-filled, because inventing the difference is exactly the
  // failure mode this codebase is built to avoid.
  if (advertised && out.length < advertised) {
    console.log(`[taleo] ${site.name}: collected ${out.length} of ${advertised} advertised`);
  }
  return out;
}

/**
 * Aurizon's own careers site (aurizon.com.au/careers/job-opportunities).
 *
 * Not a platform — a bespoke site — but it is included as one because it serves
 * its ENTIRE board as HTML in a single response, which makes it cheaper and
 * more complete than most of the tenanted platforms here. Measured: 51 distinct
 * roles, no pagination control, no load-more, no client-side list. That is the
 * whole board, so this deliberately does not page.
 *
 * The markup was mistaken for PageUp at first glance because the page mentions
 * it; it does not use it. Each role is a `link-list__item` carrying:
 *
 *   <a href="/careers/job-description?jn=683277">        the requisition number
 *   <div class="link-list__label">Locomotive Driver</div>            the title
 *   <div class="link-list__description">Permanent - Full Time — …</div>  type + category
 *   <div class="link-list__description">Berrimah, Darwin</div>        the locations
 *
 * The two descriptions are distinguished by ORDER, not by class — both carry the
 * same `link-list__description`, and only a colour utility separates them
 * visually. Keying on the colour class would tie this to a restyle; keying on
 * order ties it to the content, which is the more stable of the two.
 *
 * The page also carries hidden `data-field="location" data-value-state="…"`
 * spans, which are richer, but they sit OUTSIDE the item they describe and are
 * matched to it only by document order. The visible location text says the same
 * thing inside the row, so it is used instead and the pairing risk is avoided.
 *
 * Roles appear twice in the document (desktop and mobile renderings — 102 items
 * for 51 roles), so the requisition number deduplicates.
 */
async function fetchAurizon(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(`${site.endpoint}/careers/job-opportunities?search=`);
  if (!html) return [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const item of html.split("link-list__item").slice(1)) {
    const a = item.match(/href="(\/careers\/job-description\?jn=(\d+))"/i);
    const label = item.match(/link-list__label[^>]*>([\s\S]*?)<\/div>/i);
    if (!a || !label) continue;
    const ref = a[2];
    if (seen.has(ref)) continue;
    const title = clean(label[1]);
    if (!title) continue;
    seen.add(ref);
    const descs = [...item.matchAll(/link-list__description[^>]*>([\s\S]*?)<\/div>/gi)].map((m) =>
      clean(m[1]),
    );
    // [0] is "Permanent - Full Time — Category, Sub-category", [1] the locations.
    const cat = descs[0] ?? "";
    const loc = descs[1] ?? "";
    out.push(job(site, title, loc, `${site.origin}${a[1]}`, "", cat));
  }
  return out;
}

// ── PageUp Sites (Qube) ──────────────────────────────────────────────────────
/**
 * A card's fields are labelled by class, not by position:
 *
 *   <li class="… job-component-location"><i …/><span …> Tauranga </span></li>
 *   <li class="… job-component-category"><i …/><span …> Mechanical … </span></li>
 *   <li class="… job-component-employment-type">…<span …> Full time </span></li>
 *   <li class="… job-component-opening-on">…<span …> Opening on: Jul 31 2026 </span></li>
 *
 * so each is read by its own class rather than by index — verified across all
 * four pages, where cards carry between two and four of these.
 *
 * THE CARD'S LOCATION IS THE CITY ONLY, and for the New Zealand roles that
 * means no country ("Tauranga", "Auckland", "Hamilton"). The job URL's slug is
 * `<title-slug>-<location-slug>` and does carry it, but it is not usable as the
 * location: measured over the 106, the tail also carries raw UUIDs
 * ("…-0f8d4208-21b0-40c0-8040-48373b06264f") and concatenated multi-site lists
 * ("…-melbourne-vic-perth-sydney-nsw-brisbane-qld-adelaide-sa"). The card text
 * is the clean field, so it is what gets stored, and the NZ city names were
 * added to HUB_MATCH instead.
 */
async function fetchPageUpSites(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  let advertised = 0;
  for (let page = 1; page <= max; page++) {
    const html = await getText(`${site.endpoint}?page=${page}`);
    if (!html) break;
    if (!advertised) {
      const t = html.match(/of\s*<b>\s*([\d,]+)\s*<\/b>\s*in total/i);
      if (t) advertised = Number(t[1].replace(/,/g, ""));
    }
    // "Featured opportunities" above the results is a `div.job` strip of roles
    // already in the list below; only <article> cards are the result set, so
    // splitting on <article> both parses the list and skips the duplicates.
    const cards = html.split(/<article\b/i).slice(1);
    if (!cards.length) break;
    let added = 0;
    for (const card of cards) {
      const a = card.match(
        /job-search-results-card-title">\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
      );
      if (!a) continue;
      const url = clean(a[1]);
      if (seen.has(url)) continue;
      const title = clean(a[2]);
      if (!title) continue;
      seen.add(url);
      added++;
      const field = (name: string): string => {
        const m = card.match(
          new RegExp(`job-component-${name}"[\\s\\S]*?<span[^>]*>([\\s\\S]*?)<\\/span>`, "i"),
        );
        return m ? clean(m[1]) : "";
      };
      const cat = [field("category"), field("employment-type")].filter(Boolean).join(" — ");
      const opening = field("opening-on").replace(/^Opening on:\s*/i, "");
      out.push(job(site, title, field("location"), url, opening ? isoDay(opening) : "", cat));
    }
    // Bounded by the board's own count rather than by a short page: a fetch
    // failure also returns zero rows, and stopping on that would be
    // indistinguishable from reaching the end.
    if (!added) break;
    if (advertised && out.length >= advertised) break;
  }
  return out;
}

// ── Cornerstone OnDemand (Mirvac) ────────────────────────────────────────────
interface CsodJob {
  requisitionId: number;
  displayJobTitle?: string;
  postingEffectiveDate?: string;
  locations?: { city?: string; state?: string; country?: string }[];
}

/**
 * Two steps. The career site is a client app that serves a 5 KB shell, but the
 * shell embeds an anonymous bearer good for about a day, and the API it unlocks
 * returns everything in one structured call.
 *
 * The token is pulled with a field-level regex rather than by JSON.parse-ing
 * the whole `csod.context={…}` blob: the blob is one 2 KB line whose only
 * reliable terminator is the trailing semicolon, and a tenant that ever puts a
 * semicolon in a string would turn a parse of it into a hard failure.
 *
 * `Bearer ` is REQUIRED and was the whole difficulty here — the raw token, and
 * the `csod-accessToken` header the older player used, both return
 * "CSOD Unauthorized Exception:Check your credentials." against the same body.
 * The endpoint is on the shared cloud host (us.api.csod.com), not the tenant
 * host: the tenant host answers 404 for it.
 */
async function fetchCornerstone(site: SiteDef): Promise<PortalJob[]> {
  const shell = await getText(site.endpoint);
  if (!shell) return [];
  const token = shell.match(/"token"\s*:\s*"([^"]+)"/)?.[1];
  const cloud = shell.match(/"cloud"\s*:\s*"([^"]+)"/)?.[1];
  if (!token || !cloud) return [];
  const corp = shell.match(/"corp"\s*:\s*"([^"]+)"/)?.[1] ?? "";
  const cultureId = Number(shell.match(/"cultureID"\s*:\s*(\d+)/)?.[1] ?? 1);
  const cultureName = shell.match(/"cultureName"\s*:\s*"([^"]+)"/)?.[1] ?? "en-US";
  // The career site id is in csodPlayerRouteInfo, not csod.context, and it is a
  // string there ("cid": "1"). It is also the careerSitePageId — the request
  // builder in the player passes the same value for both.
  const siteId = Number(shell.match(/"cid"\s*:\s*"?(\d+)"?/)?.[1] ?? 1);

  const out: PortalJob[] = [];
  const size = 50;
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  let total = 0;
  for (let page = 1; page <= max; page++) {
    const res = await getJson<{ data?: { totalCount?: number; requisitions?: CsodJob[] } }>(
      `${cloud}rec-job-search/external/jobs`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          careerSiteId: siteId,
          careerSitePageId: siteId,
          pageNumber: page,
          pageSize: size,
          cultureId,
          cultureName,
          searchText: "",
          states: [],
          countryCodes: [],
          cities: [],
          placeID: "",
          radius: 0,
          postingsWithinDays: null,
          customFieldCheckboxKeys: [],
          customFieldDropdowns: [],
          customFieldRadios: [],
        }),
      },
    );
    const rows = res?.data?.requisitions ?? [];
    if (!rows.length) break;
    total = res?.data?.totalCount ?? total;
    for (const r of rows) {
      const title = clean(r.displayJobTitle ?? "");
      if (!title) continue;
      const l = r.locations?.[0];
      // The tenant writes the state two ways in the same response — "AU-NSW"
      // on most rows and "NSW" on a few — so the ISO country prefix is
      // stripped rather than the string being trusted as-is.
      const loc = [l?.city, l?.state?.replace(/^[A-Z]{2}-/, ""), l?.country]
        .filter(Boolean)
        .join(", ");
      out.push(
        job(
          site,
          title,
          loc,
          `${site.origin}/ux/ats/careersite/${siteId}/home/requisition/${r.requisitionId}?c=${corp}`,
          // dd/MM/yyyy — Date.parse would read it as the US ordering, so it is
          // reordered before isoDay rather than handed over raw.
          isoDay((r.postingEffectiveDate ?? "").replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1")),
          "Career portal",
        ),
      );
    }
    if (out.length >= total) break;
  }
  return out;
}

// ── SnapHire (Mercury NZ) ────────────────────────────────────────────────────
async function fetchSnapHire(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const item of html.split(/<div class="jobItem">/i).slice(1)) {
    const a = item.match(/<a href="(\/jobdetails\/[^"]+)"[^>]*>\s*<span>([\s\S]*?)<\/span>/i);
    if (!a) continue;
    const href = clean(a[1]);
    if (seen.has(href)) continue;
    const title = clean(a[2]);
    if (!title) continue;
    seen.add(href);
    // The location sits in the title line as `<span class="loc first"><strong>`,
    // and the tile joins its metadata with " // " separators, which are layout
    // and not part of any field.
    const trim = (s: string): string =>
      clean(s)
        .replace(/\s*\/+\s*$/, "")
        .trim();
    const loc = item.match(/<span class="loc[^"]*"><strong>([\s\S]*?)<\/strong>/i);
    const posted = item.match(/POSTED:<\/strong>([^<]*)</i);
    const cat = item.match(/EXPERTISE:<\/strong>([^<]*)</i);
    out.push(
      job(
        site,
        title,
        loc ? trim(loc[1]) : "",
        `${site.origin}${href}`,
        posted ? isoDay(trim(posted[1])) : "",
        cat ? trim(cat[1]) : "Career portal",
      ),
    );
  }
  return out;
}

// ── JobAdder widget (BGC) ────────────────────────────────────────────────────
/**
 * `site.endpoint` is the widget key. The endpoint answers JSONP — a callback
 * wrapping a JSON *string* whose contents are the rendered list markup — so the
 * body is unwrapped, JSON-parsed once to get the HTML, then parsed as HTML.
 *
 * `pageNumber` is the paging parameter: `page` and `pageIndex` are both
 * accepted and both silently ignored, which is the kind of knob that looks like
 * it works because page 1 is a valid answer. Verified by asking for
 * jobsPerPage=2 and checking the job ids actually changed.
 */
interface JobAdderRow {
  id: string;
  title: string;
  lis: string[];
  posted: string;
}

const JA_WORKTYPE = /permanent|contract|casual|temporary|full[ -]time|part[ -]time|fixed[ -]term/i;
// The location cell is the one that ends in an Australian state or territory
// abbreviation — "CBD, Inner & Western Suburbs, Perth WA". Nothing else in the
// classification list does, and the cells are NOT in a fixed order across
// tenants, so this is a content test rather than an index.
const JA_LOCATION = /\b(?:NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\b\s*$/;

function parseJobAdderRows(markup: string): JobAdderRow[] {
  const rows: JobAdderRow[] = [];
  for (const block of markup.split(/<div class="job(?: alt)?">/i).slice(1)) {
    const a = block.match(/data-job-id="(\d+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const title = clean(a[2]);
    if (!title) continue;
    const lis = [...block.matchAll(/<li data-id="\d+">([\s\S]*?)<\/li>/gi)]
      .map((m) => clean(m[1]))
      .filter(Boolean);
    const d = block.match(/date-posted">\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
    rows.push({
      id: a[1],
      title,
      lis,
      // d/M/yyyy on this widget.
      posted: d ? `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}` : "",
    });
  }
  return rows;
}

async function fetchJobAdder(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  let pages = 1;
  for (let page = 1; page <= Math.min(pages, max); page++) {
    const body = await getText(
      "https://apps.jobadder.com/widgets/V1/Jobs/RenderJobList" +
        `?key=${encodeURIComponent(site.endpoint)}&jobsPerPage=100&pageNumber=${page}` +
        "&showDatePosted=true&showClassifications=true&alwaysShowPager=true" +
        "&showPagerSummary=true&callback=cb",
    );
    if (!body) break;
    const open = body.indexOf("(");
    const close = body.lastIndexOf(")");
    if (open < 0 || close <= open) break;
    let markup = "";
    try {
      markup = JSON.parse(body.slice(open + 1, close)) as string;
    } catch {
      break;
    }
    const summary = markup.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
    if (summary) pages = Number(summary[2]);
    const rows = parseJobAdderRows(markup);
    if (!rows.length) break;
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const loc = r.lis.find((x) => JA_LOCATION.test(x)) ?? "";
      const cat = r.lis.filter((x) => x !== loc && !JA_WORKTYPE.test(x));
      const work = r.lis.find((x) => JA_WORKTYPE.test(x));
      out.push(
        job(
          site,
          r.title,
          loc,
          // The widget's own deep link — the anchors are href="#" and the list
          // is drawn client-side, so ?ja-job=<id> (what the widget pushes onto
          // history) is the only address a reader can open.
          `${site.origin}?ja-job=${r.id}`,
          r.posted,
          [cat.join(", "), work].filter(Boolean).join(" — ") || "Career portal",
        ),
      );
    }
  }
  return out;
}

// ── SuccessFactors RMK unified search service (Bendigo & Adelaide Bank) ──────
interface SfRmkJob {
  id?: string;
  urlTitle?: string;
  unifiedStandardTitle?: string;
  unifiedStandardStart?: string;
  jobLocationShort?: string[];
  filter2?: string[];
  businessUnit_obj?: string[];
  custEmploymentType?: string[];
}

/**
 * THE PAGER IS NON-DETERMINISTIC, and this is the whole reason the fetcher
 * looks the way it does. `pageNumber` walks 10 at a time and the service
 * honours neither `sortBy: "recent"` nor any page-size parameter
 * (pageSize/numberOfRows/rows/limit/count/numRows/resultsPerPage/size were all
 * tried and all returned 10), so consecutive pages OVERLAP: with an empty query
 * every row ties on relevance and the tie-break differs per query execution.
 * Two identical requests seconds apart shared only 5 of 10 ids on page 1.
 *
 * A single nine-page walk therefore collects a SAMPLE, not the board — measured
 * 66 of 81 one run and 72 of 81 another. So the walk is repeated until the
 * collected count reaches the board's own `totalJobs` or a whole pass adds
 * nothing new. Measured: pass 1 collected 61 of 81 and pass 2 completed it, so
 * PASSES = 4 is generous. This is cheap precisely because it is JSON — 20-odd
 * small requests, not 20 browser renders, which is what the first version of
 * this cost before the service was found.
 *
 * A pass that adds nothing ends the walk, so a board that genuinely serves
 * fewer than it advertises costs one wasted pass rather than looping to the cap.
 */
const SFRMK_PASSES = 4;
const SFRMK_PAGES = 40;

async function fetchSfRmkApi(site: SiteDef): Promise<PortalJob[]> {
  const rows = new Map<string, SfRmkJob>();
  let total = 0;
  for (let pass = 0; pass < SFRMK_PASSES; pass++) {
    const before = rows.size;
    for (let page = 0; page < SFRMK_PAGES; page++) {
      const res = await getJson<{
        jobSearchResult?: { response?: SfRmkJob }[];
        totalJobs?: number;
      }>(`${site.endpoint}/services/recruiting/v1/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: "",
          locale: "en_GB",
          location: "",
          pageNumber: page,
          sortBy: "recent",
        }),
      });
      const hits = res?.jobSearchResult ?? [];
      if (!hits.length) break;
      if (res?.totalJobs) total = res.totalJobs;
      for (const h of hits) {
        const r = h.response;
        if (r?.id) rows.set(r.id, r);
      }
    }
    if (total && rows.size >= total) break;
    if (rows.size === before) break;
  }

  const out: PortalJob[] = [];
  for (const r of rows.values()) {
    const title = clean(r.unifiedStandardTitle ?? "");
    if (!title) continue;
    // 11 of the 81 carry more than one location; they are joined rather than
    // truncated so a role open in two states is not silently filed in one.
    const loc = (r.jobLocationShort ?? [])
      .map((x) => clean(x))
      .filter(Boolean)
      .join("; ");
    const cat = [r.filter2?.[0], r.businessUnit_obj?.[0], r.custEmploymentType?.[0]]
      .filter(Boolean)
      .map((x) => clean(String(x)))
      .join(" — ");
    // dd/MM/yyyy — reordered before isoDay, which would otherwise read it as
    // the US ordering.
    const posted = (r.unifiedStandardStart ?? "").replace(
      /^(\d{2})\/(\d{2})\/(\d{4})$/,
      "$3-$2-$1",
    );
    out.push(
      job(
        site,
        title,
        loc,
        `${site.origin}/job/${r.urlTitle ?? ""}/${r.id}-en_GB`,
        posted ? isoDay(posted) : "",
        cat || "Career portal",
      ),
    );
  }
  return out;
}

// ── Ashby (Netwealth) ────────────────────────────────────────────────────────
interface AshbyJob {
  title?: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  department?: string;
  team?: string;
  publishedAt?: string;
  jobUrl?: string;
  isListed?: boolean;
}

/**
 * Ashby publishes a documented, unauthenticated job-board API keyed by the
 * board's slug, and returns the WHOLE board in one call — no paging, no token,
 * no HTML. `endpoint` is the slug as it appears in jobs.ashbyhq.com/<slug>.
 *
 * `isListed` is honoured because Ashby uses it for postings that exist but are
 * deliberately not on the public board (confidential searches, evergreen
 * pipelines). Archiving those would over-report a vacancy the employer has not
 * advertised.
 */
async function fetchAshby(site: SiteDef): Promise<PortalJob[]> {
  const data = await getJson<{ jobs?: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${site.endpoint}`,
  );
  const rows = data?.jobs ?? [];
  const out: PortalJob[] = [];
  for (const r of rows) {
    const title = (r.title || "").trim();
    if (!title || r.isListed === false) continue;
    const locs = [r.location, ...(r.secondaryLocations ?? []).map((s) => s.location)]
      .map((s) => (s || "").trim())
      .filter(Boolean);
    out.push(
      job(
        site,
        title,
        [...new Set(locs)].join(", "),
        r.jobUrl || `https://jobs.ashbyhq.com/${site.endpoint}`,
        (r.publishedAt || "").slice(0, 10),
        [r.department, r.team].filter(Boolean).join(" — ") || "Career portal",
      ),
    );
  }
  return out;
}

// ── Lever (Megaport) ─────────────────────────────────────────────────────────
interface LeverJob {
  id?: string;
  text?: string;
  createdAt?: number;
  hostedUrl?: string;
  categories?: {
    location?: string;
    allLocations?: string[];
    department?: string;
    team?: string;
  };
}

/**
 * Lever publishes a whole board in ONE unauthenticated call and returns every
 * posting — no paging, no total to reconcile, so there is nothing here that can
 * silently truncate. Measured 2026-08-05 against Megaport: 38 postings.
 *
 * A posting can be open in several places at once (`allLocations`), and the
 * primary `location` is not always the one we care about — Megaport advertises
 * roles as "Arizona" with Utah alongside. All of them are joined so hubFor sees
 * every city the role is actually offered in, not just the first.
 */
async function fetchLever(site: SiteDef): Promise<PortalJob[]> {
  const rows =
    (await getJson<LeverJob[]>(`https://api.lever.co/v0/postings/${site.endpoint}?mode=json`)) ??
    [];
  const out: PortalJob[] = [];
  for (const r of rows) {
    const title = clean(r.text ?? "");
    if (!title) continue;
    const locs = [r.categories?.location, ...(r.categories?.allLocations ?? [])]
      .map((s) => clean(s ?? ""))
      .filter(Boolean);
    out.push(
      job(
        site,
        title,
        [...new Set(locs)].join(", "),
        r.hostedUrl || `https://jobs.lever.co/${site.endpoint}`,
        // createdAt is epoch milliseconds, not seconds — isoFromEpoch takes
        // seconds, so this divides rather than reusing it and landing in 1970.
        r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : today(),
        clean(r.categories?.department ?? "") || "Career portal",
      ),
    );
  }
  return out;
}

// ── Rippling ATS (Pinnacle Investment Management) ────────────────────────────
interface RipplingJob {
  uuid?: string;
  name?: string;
  url?: string;
  department?: { label?: string };
  workLocation?: { label?: string };
}

/**
 * Rippling serves a whole board in one unauthenticated call, like Lever, so
 * there is no paging to truncate. Measured 2026-08-05 against Pinnacle: 5 jobs.
 *
 * NO POSTING DATE. The board API returns uuid, name, department, url and
 * workLocation and nothing else — checked field by field on the live response.
 * So `created` is the day we first saw the role, not the day it was advertised.
 * That is the same treatment several portals here already get; it is recorded
 * because a date that is really "when we looked" reads exactly like a date that
 * is really "when it was posted".
 */
async function fetchRippling(site: SiteDef): Promise<PortalJob[]> {
  const rows =
    (await getJson<RipplingJob[]>(
      `https://api.rippling.com/platform/api/ats/v1/board/${site.endpoint}/jobs`,
    )) ?? [];
  const out: PortalJob[] = [];
  for (const r of rows) {
    const title = clean(r.name ?? "");
    if (!title) continue;
    out.push(
      job(
        site,
        title,
        clean(r.workLocation?.label ?? ""),
        r.url || `https://ats.rippling.com/${site.endpoint}/jobs`,
        today(),
        clean(r.department?.label ?? "") || "Career portal",
      ),
    );
  }
  return out;
}

// ── AUB Group's own careers page ─────────────────────────────────────────────
/**
 * AUB runs NO ATS. Its careers page lists each opening as a card whose "Find
 * out more" link goes straight to a LinkedIn job posting — checked 2026-08-05,
 * every link on the page is linkedin.com/jobs/view/<id>.
 *
 * The roles are read off AUB's own page rather than by following those links,
 * which would mean fetching LinkedIn through a proxy for data already sitting
 * in front of us. The trade is that the page carries a TITLE and nothing else:
 * no location and no posting date.
 *
 * WHAT THAT MEANS FOR THE MAP, stated plainly because it is easy to misread.
 * An empty location is not "unplaced" — hubFor deliberately falls a blank back
 * to the employer's home hub, so all of these plot on Sydney whether or not the
 * role is in Sydney. AUB is a broker network with member firms across Australia
 * and New Zealand, so some of them will not be. The alternative is following
 * each LinkedIn link for a location, which is a proxy fetch per role; until
 * that is worth doing, these are Sydney-by-default and this comment is the
 * record of why. `created` is likewise the day we first saw the role.
 */
async function fetchAubGroup(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const block of html.split(/<div class="job">/i).slice(1)) {
    const card = block.slice(0, 2000);
    const title = card.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i);
    if (!title) continue;
    const t = clean(title[1]);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    const href = card.match(/href="(https?:\/\/[^"]+)"/i);
    out.push(job(site, t, "", href ? clean(href[1]) : site.endpoint, today(), "Career portal"));
  }
  return out;
}

// ── BigRedSky (NRW Holdings) ─────────────────────────────────────────────────
/**
 * BigRedSky renders its job list into a `brs_report_table_16` on the page —
 * the same ATS the SA government board runs, but a much simpler tenant: SA's
 * results only appear after a stateful search POST, whereas this one ships
 * page one in the GET.
 *
 * PAGING IS AVOIDED RATHER THAN WALKED. The board serves 20 a page and the
 * pager is not driven by a query parameter — `&Start=20` and `rowCount=100`
 * were both tried and both returned page one again. What does work is posting
 * the page's own hidden fields back with `reload_data[showAllRecords]=1`, which
 * returns every record in one response. Measured 2026-08-06: 20 of 25 on the
 * GET, 25 of 25 with the flag. One request, nothing to truncate.
 *
 * No session cookie is needed — verified by posting without one and getting the
 * same 25 — so this stays a plain two-request fetch in the Worker.
 *
 * COLUMNS ARE FOUND BY HEADER NAME, not position. NRW's run
 * [CLOSING DATE, JOB TITLE, DIVISION, LOCATION, Apply] and another tenant's
 * will not; reading cell 3 because it happens to be the location here is how
 * the Avature reader ended up writing a whole board onto the wrong city.
 *
 * That first column is a CLOSING date, not a posting date, so it is not used
 * for `created`. A date that says when an ad expires is not a lesser version of
 * when it appeared — it is a different fact, and recording it as the other one
 * would age every row wrongly.
 */
async function fetchBigRedSky(site: SiteDef): Promise<PortalJob[]> {
  const shell = await getText(site.endpoint);
  if (!shell) return [];
  const fields = new URLSearchParams();
  for (const m of shell.matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) {
    const n = m[0].match(/name="([^"]+)"/)?.[1];
    if (n) fields.set(n, m[0].match(/value="([^"]*)"/)?.[1] ?? "");
  }
  fields.set("reload_data[showAllRecords]", "1");
  const full =
    (await getText(site.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: site.endpoint },
      body: fields.toString(),
    })) || shell;

  const table = full.match(/<table[^>]*id="brs_report_table_16"[\s\S]*?<\/table>/i)?.[0];
  if (!table) return [];
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
    [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => c[1]),
  );
  const head = rows.find((r) => r.some((c) => /JOB TITLE/i.test(clean(c))));
  if (!head) return [];
  const col = (name: RegExp) => head.findIndex((c) => name.test(clean(c)));
  const iTitle = col(/^job title$/i);
  const iLoc = col(/^location$/i);
  const iDiv = col(/^division|department$/i);

  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r === head || iTitle < 0 || !r[iTitle]) continue;
    const title = clean(r[iTitle]);
    const id = r.join(" ").match(/AdvertID=(\d+)/)?.[1] ?? "";
    if (!title || /^job title$/i.test(title) || seen.has(id || title)) continue;
    seen.add(id || title);
    out.push(
      job(
        site,
        title,
        iLoc >= 0 ? clean(r[iLoc] ?? "") : "",
        id ? `${site.origin}/page.php?pageID=160&windowUID=0&AdvertID=${id}` : site.endpoint,
        today(),
        (iDiv >= 0 ? clean(r[iDiv] ?? "") : "") || "Career portal",
      ),
    );
  }
  const advertised = Number(
    clean(full)
      .match(/Viewing\s+records:\s*[\d,]+\s*to\s*[\d,]+\s*of\s*([\d,]+)/i)?.[1]
      ?.replace(/,/g, "") ?? 0,
  );
  if (advertised && out.length < advertised) {
    console.log(`[bigredsky] ${site.name}: collected ${out.length} of ${advertised} advertised`);
  }
  return out;
}

// ── Zip's own careers page ───────────────────────────────────────────────────
/**
 * Zip runs no third-party ATS on this page: the role list is SERVER-RENDERED
 * into zip.co/careers/roles, so it is read directly rather than through a
 * board API. Checked 2026-08-05 — the markup carries the title in an <h3> and
 * then three <li> cells, [location, employment type, department].
 *
 * The class names are build-hashed ("mv3T5", "Xh6i9") and will change on any
 * redeploy of their site, so NOTHING here anchors on one. The anchors are the
 * href shape and the element order, which are the parts the page cannot change
 * without changing what it is.
 *
 * The page prints its own total ("30 roles in 4 locations"), which is logged
 * against what was collected — a silent shortfall here would look exactly like
 * Zip having stopped hiring.
 */
async function fetchZipCo(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  const advertised = Number(
    html.match(/([\d,]+)\s+roles?\s+in\s+\d+\s+locations?/i)?.[1]?.replace(/,/g, "") ?? 0,
  );
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const block of html.split(/href="\/careers\/roles\//).slice(1)) {
    const id = block.slice(0, block.indexOf('"'));
    if (!id || seen.has(id)) continue;
    const card = block.slice(0, 1200);
    const title = clean(card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "");
    if (!title) continue;
    seen.add(id);
    // The first cell is the location; the rest are employment type and team.
    const cells = [...card.matchAll(/<li[^>]*>([^<]{2,60})<\/li>/g)].map((m) => clean(m[1]));
    out.push(
      job(
        site,
        title,
        cells[0] ?? "",
        `${site.origin}/careers/roles/${id}`,
        today(),
        cells[2] || "Career portal",
      ),
    );
  }
  if (advertised && out.length < advertised) {
    console.log(`[zipco] ${site.name}: collected ${out.length} of ${advertised} advertised`);
  }
  return out;
}

// ── ELMO Talent (Steadfast) ──────────────────────────────────────────────────
/**
 * ELMO's careers module is server-rendered Bootstrap: one `<li class=
 * "list-group-item">` per role, the title in an `a.redirect_elmo_link` pointing
 * at /careers/default/job/view/<id>, and the location in the row carried by the
 * map-marker glyph.
 *
 * There is no paginator, and that is not an oversight to work around — the
 * board serves every role on the one page. Measured on Steadfast 2026-08-03:
 * 8 job links, and the category filter's own counts (Administration 1, Customer
 * Service 1, Information Technology 3, Marketing 1, Other 2) sum to exactly 8.
 * That sum is a free cross-check the fetcher uses: if the board ever starts
 * paging, the counts will exceed the rows and the mismatch is logged rather
 * than silently truncating.
 */
async function fetchElmo(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const item of html.split(/<li class="list-group-item"/i).slice(1)) {
    const a = item.match(
      /<a[^>]*class="[^"]*redirect_elmo_link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!a) continue;
    const href = clean(a[1]);
    const title = clean(a[2]);
    if (!title || seen.has(href)) continue;
    seen.add(href);
    // The location sits in the div that follows the map-marker glyph; the
    // pencil glyph below it carries the employment type. The capture has to be
    // generous because ELMO indents its template heavily — the value is one
    // short line inside ~250 characters of whitespace, and a tighter bound
    // matched nothing at all.
    const glyph = (name: string): string => {
      const m = item.match(
        new RegExp(`glyphicon-${name}[\\s\\S]{0,240}?<div[^>]*>([^<]{2,400})<\\/div>`, "i"),
      );
      return m ? clean(m[1]) : "";
    };
    const loc = glyph("map-marker");
    const type = glyph("pencil");
    out.push(
      job(
        site,
        title,
        loc,
        href.startsWith("http") ? href : site.origin + href,
        today(),
        type || "Career portal",
      ),
    );
  }
  // The cross-check is per FILTER, not across all of them. The page carries
  // several <select>s — job category, location, work type — and each one's
  // counts sum to the board's total independently, so adding every option on
  // the page triples it (measured on Steadfast: 8 roles, 24 across the three).
  // The largest single filter's sum is the board's own claim about its size.
  const advertised = Math.max(
    0,
    ...html
      .split(/<select\b/i)
      .slice(1)
      .map((sel) =>
        [...sel.split(/<\/select>/i)[0].matchAll(/\((\d+)\)\s*<\/option>/g)]
          .map((m) => Number(m[1]))
          .reduce((a, b) => a + b, 0),
      ),
  );
  if (advertised && out.length < advertised) {
    console.log(`elmo ${site.id}: ${out.length} rows vs ${advertised} advertised — board paging?`);
  }
  return out;
}

// ── Attrax (Endeavour Group) ─────────────────────────────────────────────────
/**
 * Endeavour's careers site is SmartRecruiters-backed but served through Attrax,
 * which renders the results server-side as `attrax-vacancy-tile` cards. The
 * SmartRecruiters API is NOT usable here: the public postings endpoint answers
 * for a company code, and Endeavour's board is not exposed under one (every
 * plausible code returns totalFound 0), so the rendered page is the only feed.
 *
 * Each card repeats its href three times (title, location, apply), so rows are
 * grouped by `data-jobid` rather than counted by anchor — the same mistake the
 * NSW parser made.
 */
async function fetchAttrax(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  const size = site.pageSize ?? 48;
  for (let page = 1; page <= max; page++) {
    const html = await getText(`${site.endpoint}?page=${page}&size=${size}`);
    if (!html) break;
    const tiles = html.split(/<div[^>]*class="[^"]*attrax-vacancy-tile[^"]*"[^>]*data-jobid="/i);
    let added = 0;
    for (const tile of tiles.slice(1)) {
      const id = tile.slice(0, tile.indexOf('"'));
      if (!id || seen.has(id)) continue;
      const a = tile.match(
        /<a[^>]*class="[^"]*attrax-vacancy-tile__title[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
      );
      if (!a) continue;
      const title = clean(a[2]);
      if (!title) continue;
      seen.add(id);
      added++;
      // Every field is the same two-paragraph shape: a wrapper div named for
      // the field, then `<p class="…item-label">Location</p>` followed by
      // `<p class="…item-value">SPRINGWOOD, QLD, 4127</p>`. Reading the first
      // <p> after the wrapper therefore returns the LABEL, not the value —
      // which is what a first pass did, tagging every Endeavour role with the
      // location "Location".
      const field = (name: string): string => {
        const block = tile.split(new RegExp(`attrax-vacancy-tile__${name}\\b`, "i"))[1];
        if (!block) return "";
        const v = block.match(/attrax-vacancy-tile__item-value[^>]*>([\s\S]{0,200}?)<\/p>/i);
        return v ? clean(v[1]) : "";
      };
      const href = clean(a[1]);
      out.push(
        job(
          site,
          title,
          // The free-text location is the specific one ("SPRINGWOOD, QLD,
          // 4127"); the `option-locations` facet is just the state.
          field("location-freetext") || field("option-locations"),
          href.startsWith("http") ? href : site.origin + href,
          today(),
          field("option-departments") || "Career portal",
        ),
      );
    }
    if (added < size) break;
  }
  return out;
}

// ── WordPress REST (Capricorn Metals) ────────────────────────────────────────
interface WpPost {
  title?: { rendered?: string };
  link?: string;
  date?: string;
}

/**
 * Some employers run their vacancies as ordinary WordPress content rather than
 * an ATS. Where the theme registers a `job` post type, wp-json serves it
 * directly: `endpoint` is the full REST URL, so one site can point at a custom
 * type and another at a category of posts.
 *
 * There is no location on these records — the post body carries it as prose —
 * so the row falls back to the employer's home hub, which is where its pin is.
 */
async function fetchWpRest(site: SiteDef): Promise<PortalJob[]> {
  const rows = await getJson<WpPost[]>(site.endpoint);
  if (!Array.isArray(rows)) return [];
  const out: PortalJob[] = [];
  for (const r of rows) {
    const title = clean(r.title?.rendered || "");
    if (!title || !r.link) continue;
    out.push(job(site, title, "", r.link, (r.date || "").slice(0, 10), "Career portal"));
  }
  return out;
}

// ── WordPress / Elementor loop (Perseus Mining) ──────────────────────────────
/**
 * Perseus publishes vacancies as posts in a `careers` category and lists the
 * current ones through an Elementor loop on /current-opportunities/.
 *
 * READ THE PAGE, NOT THE REST API, and the difference is not cosmetic. Measured
 * 2026-08-03: the `careers` category holds 8 posts, all `publish`, with
 * identical meta — the REST API cannot tell a live ad from a closed one. The
 * page renders 4. Those 4 are what the employer advertises as current, and they
 * are also the only ones carrying a Location. There is no pagination (`page/2/`
 * and `?e-page-…=2` both return the same 4), so one fetch is the whole list.
 *
 * The first loop-item in the markup is Elementor's template stub and has no
 * href; it is skipped rather than counted.
 */
async function fetchWpLoop(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const item of html.split(/data-elementor-type="loop-item"/i).slice(1)) {
    const block = item.slice(0, 6000);
    const href = block.match(/href="(https?:\/\/[^"]+)"/i);
    const title = block.match(/<h2 class="elementor-heading-title[^"]*">([^<]+)<\/h2>/i);
    if (!href || !title) continue;
    const url = clean(href[1]);
    if (seen.has(url)) continue;
    seen.add(url);
    const loc = block.match(/Location:\s*([^<]{2,70})/i);
    out.push(job(site, clean(title[1]), loc ? clean(loc[1]) : "", url, "", "Career portal"));
  }
  return out;
}

// ── PageUp, classic theme (Harvey Norman) ────────────────────────────────────
/**
 * PageUp ships two themes and they share no markup. `pageupsites` reads the
 * newer one (`<article>` cards, `job-search-results-card-title`, an "of <b>N</b>
 * in total" label). Harvey Norman runs the classic one, which is a plain
 * `<table id="search-results-content">`: `a.job-link` → /en/job/<id>/<slug> in
 * the first cell, the location in the second, and nothing else.
 *
 * `page-items` is honoured by the classic theme — measured: `?page=1` serves 20
 * rows and `?page=1&page-items=100` serves 100.
 *
 * WHY THE WALK IS PER LOCATION FACET RATHER THAN STRAIGHT DOWN THE LIST
 * The location cell is the STORE, not a place a map can find: "Osborne Park
 * Complex", "Bondi Junction Complex", "Springvale Complex". Walking the plain
 * listing collected 191 roles of which 20 placed on a hub — 10% — and the other
 * 171 archived with no city at all. Suburb names cannot be resolved by guessing
 * either: Springwood is in both Queensland and New South Wales.
 *
 * But the board's own sidebar carries a Locations facet whose values ARE states
 * ("NSW – Sydney Metro Area", "QLD – Other"), each with a count, and
 * /en/search/?location=<value> honours it — measured: the "NSW – Sydney Metro
 * Area" facet says 29 and the filtered search returns exactly 29. So the walk
 * reads the facets once, then queries each one and appends its name to the
 * store, turning "Bondi Junction Complex" into a string hubFor can place.
 *
 * Each facet is bounded by its OWN advertised count rather than by a short page,
 * which is the bound this file prefers everywhere. Facets overlap slightly (they
 * sum to 204 against 191 distinct roles — a role advertised in two regions
 * appears in both), so rows are deduped by href across the whole walk.
 */
const PAGEUP_CLASSIC_PAGE = 100;

async function fetchPageUpClassic(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;

  /** Parses one results page. Returns how many job rows the PAGE carried, not
   *  how many were new — a role can sit in two facets, and "every row here was
   *  already collected" must not read the same as "this page came back empty". */
  const rowsOf = (html: string, facet: string): number => {
    const body = html.split(/<tbody id="search-results-content">/i)[1];
    if (!body) return 0;
    // THE COLUMN ORDER IS PER TENANT, so the header decides which cell is the
    // location. Harvey Norman publishes [Position, Location]; Cleanaway
    // publishes [Position, Location, Opened, Closes]. Taking the LAST cell —
    // which is what a positional read does — gave Cleanaway an empty location
    // on the rows whose closing date was blank and a DATE on the rest, and
    // nothing errors when it happens. -1 means the header named no location, in
    // which case the last cell is the best remaining guess.
    const heads = (html.split(/<thead[^>]*>/i)[1] ?? "")
      .split(/<\/thead>/i)[0]
      .split(/<th[^>]*>/i)
      .slice(1)
      .map((h) => clean(h).toLowerCase());
    const locCol = heads.findIndex((h) => h.startsWith("location"));
    let onPage = 0;
    for (const row of body.split(/<\/tr>/i)) {
      const a = row.match(/<a[^>]*class="job-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!a) continue;
      const href = clean(a[1]);
      const title = clean(a[2]);
      if (!title) continue;
      onPage++;
      if (seen.has(href)) continue;
      seen.add(href);
      const cells = row.split(/<td[^>]*>/i).slice(1);
      const store =
        locCol > 0 && locCol < cells.length
          ? clean(cells[locCol])
          : cells.length > 1
            ? clean(cells[cells.length - 1])
            : "";
      out.push(
        job(
          site,
          title,
          // The facet is appended only when the cell does not already say where
          // the role is. Harvey Norman's cell is a store name and NEEDS the
          // state; Cleanaway's already reads "Melbourne VIC Australia", and
          // appending there just duplicated it.
          [store, store.toLowerCase().includes(facet.toLowerCase()) ? "" : facet]
            .filter(Boolean)
            .join(", "),
          href.startsWith("http") ? href : site.origin + href,
          "",
          "",
        ),
      );
    }
    return onPage;
  };

  const listing = await getText(`${site.endpoint}?page=1&page-items=${PAGEUP_CLASSIC_PAGE}`);
  if (!listing) return [];
  const facets = [
    ...listing.matchAll(
      /name="location" value="([^"]+)"[\s\S]{0,240}?<span class="count">(\d+)<\/span>/g,
    ),
  ].map((m) => ({ value: clean(m[1]), n: Number(m[2]) }));

  // THE BOARD RATIONS FACETED SEARCHES, and it does it by serving an EMPTY
  // result set rather than a 429 — which `getText` cannot see, because a 200
  // with no rows is a valid answer. Measured three times over: walking all 15
  // facets back to back, the first six or seven returned exactly their
  // advertised counts and every one after that returned zero. It is a quota,
  // not a rate: inserting 1s and then 2.5s between requests changed nothing,
  // and only a ~20s pause restored capacity. Retrying inside the walk does not
  // help for the same reason.
  //
  // So the walk spends its allowance on the LARGEST facets and then reads the
  // plain listing for the rest. The roles are all collected either way — the
  // facet is only there to supply a state, because the location cell alone is a
  // store name — so the effect of the quota is that the biggest regions get a
  // mappable location and the long tail keeps the store name. Deduping is by
  // href, so a role already collected under its facet is not overwritten by the
  // listing's less specific version.
  const FACET_BUDGET = 6;
  const search = site.endpoint.replace(/\/listing\/?$/, "/search/");
  for (const f of [...facets].sort((a, b) => b.n - a.n).slice(0, FACET_BUDGET)) {
    for (let page = 1; page <= max; page++) {
      const html = await getText(
        `${search}?page=${page}&page-items=${PAGEUP_CLASSIC_PAGE}&location=${encodeURIComponent(f.value)}`,
      );
      if (!html || rowsOf(html, f.value) < PAGEUP_CLASSIC_PAGE) break;
    }
  }
  for (let page = 1; page <= max; page++) {
    const html =
      page === 1
        ? listing
        : await getText(`${site.endpoint}?page=${page}&page-items=${PAGEUP_CLASSIC_PAGE}`);
    if (!html || rowsOf(html, "") < PAGEUP_CLASSIC_PAGE) break;
  }
  return out;
}

// ── Eightfold "PCS" career sites (Worley) ────────────────────────────────────
interface PcsPosition {
  id?: number | string;
  name?: string;
  locations?: string[];
  department?: string;
  postedTs?: number;
  positionUrl?: string;
}

/**
 * Eightfold's newer career-site product, and NOT the same API as the
 * `eightfold` platform above.
 *
 * HSBC's site answers /api/apply/v2/jobs. Worley's returns
 * `{"message": "Not authorized for PCSX"}` for that path however it is called —
 * with the right domain, with a Referer, with the position id from the page's
 * own URL. The page config names the product: `configPath: "PCS>"`. Its search
 * lives at /api/pcsx/search and answers a plain request with
 * `{data: {positions[], count}}`.
 *
 * `num` IS IGNORED — measured, the endpoint returns 10 rows whether asked for
 * 10, 50 or 100 — which is the same quirk the older Eightfold API has, so the
 * page size is fixed here rather than requested. Worley advertises 1,116 roles,
 * so that is ~112 requests, run in windows.
 *
 * The walk is bounded by the advertised `data.count`, NOT by a short page.
 * Measured: stopping at the first short page returned 1,070 and 1,084 on two
 * consecutive runs against a board that reported 1,116 both times — the API
 * hands back fewer than ten rows mid-list often enough that "short page" is
 * not a reliable end marker, and a fetch failure is indistinguishable from one.
 * Reading the total first means a dropped page costs its ten rows instead of
 * every page after it.
 *
 * `endpoint` is the full search URL including the tenant's `domain` parameter,
 * because the domain is not derivable from the host (jobs.worley.com serves
 * domain=worley.com).
 */
const PCS_PAGE = 10;

interface PcsSearch {
  data?: { positions?: PcsPosition[]; count?: number };
}

async function fetchEightfoldPcs(site: SiteDef): Promise<PortalJob[]> {
  const max = site.maxPages ?? 200;
  const pageAt = (i: number) =>
    getJson<PcsSearch>(`${site.endpoint}&start=${i * PCS_PAGE}&num=${PCS_PAGE}`);

  const first = await pageAt(0);
  const positions: PcsPosition[] = [...(first?.data?.positions ?? [])];
  if (!positions.length) return [];
  const total = first?.data?.count ?? 0;
  const pages = Math.min(max, Math.ceil(total / PCS_PAGE) || 1);

  for (let start = 1; start < pages; start += PAGE_CONCURRENCY) {
    const idx: number[] = [];
    for (let i = start; i < Math.min(start + PAGE_CONCURRENCY, pages); i++) idx.push(i);
    const windows = await Promise.all(idx.map(pageAt));
    for (const w of windows) positions.push(...(w?.data?.positions ?? []));
  }
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const p of positions) {
    const title = (p.name || "").trim();
    const id = String(p.id ?? title);
    if (!title || seen.has(id)) continue;
    seen.add(id);
    // postedTs is epoch SECONDS. Multiplying is what keeps a 2026 posting from
    // being stored as 1970.
    const posted = p.postedTs ? new Date(p.postedTs * 1000).toISOString().slice(0, 10) : "";
    out.push(
      job(
        site,
        title,
        (p.locations ?? []).join(", "),
        site.origin + (p.positionUrl || `/careers/job/${p.id ?? ""}`),
        posted,
        (p.department || "").trim() || "Career portal",
      ),
    );
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
  taleo: fetchTaleo,
  aurizon: fetchAurizon,
  pageupsites: fetchPageUpSites,
  cornerstone: fetchCornerstone,
  snaphire: fetchSnapHire,
  jobadder: fetchJobAdder,
  sfrmkapi: fetchSfRmkApi,
  ashby: fetchAshby,
  lever: fetchLever,
  rippling: fetchRippling,
  aubgroup: fetchAubGroup,
  zipco: fetchZipCo,
  bigredsky: fetchBigRedSky,
  elmo: fetchElmo,
  attrax: fetchAttrax,
  wprest: fetchWpRest,
  wploop: fetchWpLoop,
  pageupclassic: fetchPageUpClassic,
  eightfoldpcs: fetchEightfoldPcs,
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
  taleo: "tl",
  aurizon: "azj",
  pageupsites: "pu",
  cornerstone: "csod",
  snaphire: "snap",
  jobadder: "ja",
  // Same archive source as the other SuccessFactors tenants: it is the same
  // ATS, only a different front end, so its rows should dedupe against an
  // SF row for the same role rather than sitting beside it.
  sfrmkapi: "sf",
  ashby: "ashby",
  lever: "lever",
  rippling: "rippling",
  // AUB has no ATS; the tag names the page it came from, not a platform.
  aubgroup: "aubgroup",
  // Zip has no ATS; the tag names the page, not a platform.
  zipco: "zipco",
  bigredsky: "bigredsky",
  elmo: "elmo",
  attrax: "attrax",
  // Both WordPress readers write the same tag: the difference between them is
  // how the page is parsed, not where the vacancy came from.
  wprest: "wp",
  wploop: "wp",
  // Same ATS as `pageupsites`, only the older theme — so the same source tag,
  // for the same reason sfrmkapi shares "sf".
  pageupclassic: "pu",
  // Same vendor as `eightfold`, different product and different API — but an
  // advertisement is an advertisement, so it dedupes against an ef row rather
  // than sitting beside one.
  eightfoldpcs: "ef",
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
