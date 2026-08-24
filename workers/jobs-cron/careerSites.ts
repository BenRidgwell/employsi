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
  | "adp"
  | "teamtailor"
  | "ukgready"
  | "recruitee"
  | "trakstar"
  | "jobadderboard"
  | "workgr8"
  | "uwajobs"
  | "carclew"
  | "statetheatre"
  | "expr3ss"
  | "clinch"
  | "johnhughes"
  | "elmo"
  | "attrax"
  | "wprest"
  | "wploop"
  | "pageupclassic"
  | "eightfoldpcs"
  | "radancy"
  | "adlogic"
  | "wpjobmanager"
  | "employmenthero"
  | "chris21"
  | "workable"
  | "bamboohr"
  | "cjd"
  | "delorean";

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
  /**
   * The advertiser name a row must carry to be filed against this company, on
   * boards SHARED with other employers. Defaults to `name`.
   *
   * Bellevue Gold needs it: it advertises on the Gold Industry Group's board
   * alongside nine other miners, so "the rows on this page" and "this
   * company's rows" are only the same thing while the page template holds.
   * Everywhere else the board belongs to one employer and this is unused.
   */
  expectCompany?: string;
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
  // ── WA universities ───────────────────────────────────────────────────────
  // Their own boards, alongside the uniroles.com.au aggregator: a university
  // advertises plenty that never reaches the aggregator, and the two dedupe on
  // job_key anyway, so the overlap costs nothing and the gap is real coverage.
  {
    id: "uni-university-of-western-australia",
    name: "University of Western Australia",
    sector: "Education",
    platform: "uwajobs",
    // Measured 2026-08-17: 34 vacancies over two pages of 30. See fetchUwaJobs
    // for why this board looks client-rendered and is not.
    endpoint: "https://external.jobs.uwa.edu.au/jobs/search",
    origin: "https://external.jobs.uwa.edu.au/jobs/search",
    maxPages: 8,
    homeHub: "perth",
  },
  {
    id: "sa-gov-west-beach-parks",
    name: "West Beach Parks",
    sector: "Government",
    platform: "elmo",
    // Same ELMO shape as Steadfast. Measured 2026-08-24: 6 roles, matching the
    // board's own "West Beach (6)" facet count.
    endpoint: "https://westbeachparks.elmotalent.com.au/careers/default/jobs",
    origin: "https://westbeachparks.elmotalent.com.au",
    homeHub: "adelaide",
  },
  {
    id: "priv-drake-supermarkets",
    name: "Drake Supermarkets",
    sector: "Supermarket retail",
    platform: "expr3ss",
    // The board renders every division in one response, so the query string is
    // part of the endpoint. Measured 2026-08-24: 39 rows, 39 distinct job ids.
    endpoint:
      "https://drakesupermarkets.expr3ss.com/home?action=&display=division&hotjobs=on" +
      "&collapse=on&displaystyle=41&search=",
    origin: "https://drakesupermarkets.expr3ss.com",
    homeHub: "adelaide",
  },
  {
    id: "priv-detmold-group",
    name: "Detmold Group",
    sector: "Packaging manufacturing",
    platform: "livehire",
    // The SEGMENT CODE, not a URL — read out of the careers page's own LiveHire
    // iframe, https://www.livehire.com/widgets/job-listings/detmoldgroup.
    // Measured 2026-08-21: totalCount 12, hasMoreResults false. Roles are not
    // all in Adelaide — one Sydney, one in the Philippines — so the locations
    // the API returns are the placement, not the home hub.
    endpoint: "detmoldgroup",
    // livehire.com, NOT detmoldgroup.com — fetchLiveHire builds both the token
    // and the search URL from `origin`, so pointing it at the employer's own
    // marketing page makes every call 404 and the feed return a silent zero.
    origin: "https://www.livehire.com",
    homeHub: "adelaide",
  },
  {
    id: "sa-gov-state-theatre-company-of-sa",
    name: "State Theatre Company of SA",
    sector: "Government",
    platform: "statetheatre",
    // Measured 2026-08-21: the accordion is present and EMPTY, and the page
    // says "There are currently no vacant positions". See fetchStateTheatre for
    // how that confirmed zero is told apart from a parse that has stopped
    // working.
    endpoint: "https://statetheatrecompany.com.au/careers/",
    origin: "https://statetheatrecompany.com.au/careers/",
    homeHub: "adelaide",
  },
  {
    id: "sa-gov-carclew-youth-arts-centre",
    name: "Carclew Youth Arts Centre",
    sector: "Government",
    platform: "carclew",
    // Measured 2026-08-21: three roles, stated as "the following three roles"
    // on the page itself. See fetchCarclew for why the article scope matters.
    endpoint: "https://carclew.com.au/join-the-team/",
    origin: "https://carclew.com.au/join-the-team/",
    homeHub: "adelaide",
  },
  {
    id: "uni-curtin-university",
    name: "Curtin University",
    sector: "Education",
    platform: "jobadder",
    // The KEY, not a URL — fetchJobAdder passes site.endpoint to JobAdder's
    // RenderJobList widget API. Read out of the board page's own
    // `_jaJobsSettings` on 2026-08-17.
    //
    // WHY THIS WAS FIRST REPORTED AS UNSCRAPEABLE, so the mistake is not made
    // again: staff.curtin.edu.au/job-vacancies/ IS the board, but its listings
    // are drawn client-side by the JobAdder widget, so the served HTML carries
    // the search form and no roles. Two checks then agreed it was empty and
    // both were wrong — a scan for vacancy-shaped anchor text missed titles
    // like "Early Childhood Educators", and a scan of script hosts missed
    // `//apps.jobadder.com/...` because it required an explicit https: scheme.
    // The board was in front of both the whole time.
    //
    // Measured 2026-08-17: Page 1 of 1, so one call takes it.
    endpoint: "AU6_klpob7rbkadenmkicx2r7fya7a",
    origin: "https://staff.curtin.edu.au/job-vacancies/",
    homeHub: "perth",
  },
  {
    id: "uni-murdoch-university",
    name: "Murdoch University",
    sector: "Education",
    platform: "workday",
    // wd3. Measured 2026-08-17: Workday reports total 11 for this tenant — a
    // small board, not a truncated walk, which is exactly the case that looks
    // like a broken feed and is not.
    endpoint: "https://murdoch.wd3.myworkdayjobs.com/wday/cxs/murdoch/MurdochCareers/jobs",
    origin: "https://murdoch.wd3.myworkdayjobs.com/en-GB/MurdochCareers",
    homeHub: "perth",
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
  {
    id: "brisbane-sul",
    name: "Super Retail Group",
    sector: "Consumer and Retail",
    // The LiveHire segment code, same shape as Wesfarmers.
    platform: "livehire",
    endpoint: "superretailgroup",
    origin: "https://www.livehire.com",
    // Measured 2026-08-06: 76 roles across Supercheap Auto, rebel, BCF and
    // Macpac stores plus the Brisbane support centre — so most rows are a
    // store address, not a capital, and they place through HUB_MATCH's state
    // needles rather than the home hub. That is what surfaced the postcode bug
    // fixed in hubFor: "Altona North VIC 3025, Australia" and "Midland WA 6056,
    // Australia" were both landing on Brisbane before it.
    homeHub: "brisbane",
  },
  {
    id: "vancouver-cs",
    name: "Capstone Copper",
    sector: "Energy & Natural Resources",
    platform: "adp",
    // The `cid` is the whole configuration — it is the one parameter the board
    // URL carries, and the JSON service behind the shell wants nothing else.
    endpoint:
      "https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions?cid=ac1fee88-50b8-4eb9-be28-99e42c483a03",
    origin:
      "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=ac1fee88-50b8-4eb9-be28-99e42c483a03&ccId=19000101_000001&lang=en_US",
    // Measured 2026-08-06: 54 roles, every one at Pinto Valley in Miami,
    // Arizona. Arizona is not a hub we plot, so all 54 archive against the
    // company and show on its card without appearing on any city — Capstone
    // advertises nothing in Vancouver today, and that is what the board says.
    homeHub: "vancouver",
  },
  {
    id: "nz-spark-new-zealand",
    name: "Spark New Zealand",
    sector: "Technology, Media and Telecommunications",
    platform: "avature",
    // NOT spark.co.nz/about/careers, which sits behind a Radware bot wall and
    // answers a challenge page, and not sparkjobs.co.nz, which does not resolve
    // from here at all. The board itself is an Avature tenant on its own host,
    // and it answers a plain GET.
    endpoint: "https://careers.sparknz.co.nz/careers/SearchJobs",
    origin: "https://careers.sparknz.co.nz",
    // Measured 2026-08-06: the board prints "17 results" and the reader
    // collects 17. Four are unplaced — Nelson, and the bare "Hamilton" that
    // HUB_MATCH deliberately does not resolve because the name is ambiguous
    // across the archive. Christchurch roles place on Wellington, the nearest
    // hub we plot, as they do for every other NZ feed.
    homeHub: "auckland",
  },
  {
    id: "ilu",
    name: "Iluka Resources",
    sector: "Mineral Sands & Rare Earths",
    platform: "workday",
    // Measured 2026-08-06: 5 roles. Four carry Iluka's own site names rather
    // than a town ("Cataby", "Eneabba"), so they fall back to the home hub.
    endpoint: "https://iluka.wd3.myworkdayjobs.com/wday/cxs/iluka/ilukacareers/jobs",
    origin: "https://iluka.wd3.myworkdayjobs.com/ilukacareers",
    homeHub: "perth",
  },
  {
    id: "priv-hbf",
    name: "HBF",
    sector: "Private health insurance",
    platform: "workday",
    // Measured 2026-08-06: 13 roles — Perth, plus branch roles as far out as
    // Mount Isa, which is why not all of them place on the home hub.
    endpoint: "https://hbf.wd105.myworkdayjobs.com/wday/cxs/hbf/HBF_External/jobs",
    origin: "https://hbf.wd105.myworkdayjobs.com/HBF_External",
    homeHub: "perth",
  },
  {
    id: "priv-rac-of-wa",
    name: "RAC of WA",
    sector: "Insurance & motoring club",
    platform: "workday",
    // Measured 2026-08-06: 27 roles. About half name a Perth suburb and place;
    // the rest carry RAC's own site or product names.
    endpoint: "https://racwa.wd3.myworkdayjobs.com/wday/cxs/racwa/RAC-WA/jobs",
    origin: "https://racwa.wd3.myworkdayjobs.com/en-US/RAC-WA",
    homeHub: "perth",
  },
  {
    id: "priv-cbh-group",
    name: "CBH Group",
    sector: "Grain handling co-operative",
    platform: "successfactors",
    // The standard SuccessFactors theme, unlike Hancock below. Measured
    // 2026-08-06: 13 roles, every one placing on Perth.
    endpoint: "https://careers.cbh.com.au",
    origin: "https://careers.cbh.com.au",
    homeHub: "perth",
  },
  {
    id: "priv-hancock-prospecting",
    name: "Hancock Prospecting",
    sector: "Iron ore mining",
    platform: "sfrmkapi",
    // SuccessFactors, but the UI5/React "NES" theme — the same one Bendigo
    // runs, which server-renders no job rows at all. Read from the source:
    // /search/?q= returns 93 KB with zero `data-row`, `job-tile-cell` or
    // `jobTitle-link` matches, and the page loads bootstrap/3.4.8_NES. So it
    // goes through the RMK JSON service rather than fetchSuccessFactors.
    // Measured 2026-08-06 that way: 11 roles, all Pilbara, all placing Perth.
    endpoint: "https://careers.hancockironore.com.au",
    origin: "https://careers.hancockironore.com.au",
    homeHub: "perth",
  },
  {
    id: "priv-vgw-holdings",
    name: "VGW Holdings",
    sector: "Online social gaming",
    platform: "greenhouse",
    // vgw.co/jobs is WordPress with a greenhouse-connector plugin; the board
    // token appears nowhere in the page, so it was found by probing the
    // Greenhouse API directly — `vgw` answers, `virtualgamingworlds` and
    // `vgwholdings` 404.
    endpoint: "https://boards-api.greenhouse.io/v1/boards/vgw/jobs",
    origin: "https://www.vgw.co/jobs/",
    // Measured 2026-08-06: 10 roles and NOT ONE IS IN PERTH — seven US
    // government-affairs leads and three Chumba Casino general managers. VGW is
    // Perth-headquartered, so the temptation is to read that as a broken feed;
    // the board's own department counts say otherwise (10 across 12
    // departments, ten of them empty). Perth genuinely has nothing on this
    // board today, and a real zero is left as zero.
    homeHub: "perth",
  },
  {
    id: "priv-abn-group",
    name: "ABN Group",
    sector: "Residential construction",
    platform: "clinch",
    // Measured 2026-08-06: 36 roles — 30 on page one, 6 on page two, page
    // three empty. 16 Perth and 20 Melbourne, which is the shape of the
    // business: WA residential building plus the Victorian arm.
    endpoint: "https://careers.abngroup.com.au/jobs/search",
    origin: "https://careers.abngroup.com.au",
    homeHub: "perth",
  },
  {
    id: "priv-john-hughes-group",
    name: "John Hughes Group",
    sector: "Automotive retail",
    platform: "johnhughes",
    // Measured 2026-08-06: 8 roles across two dealership addresses, Welshpool
    // and Wangara. Both suburbs had to be added to HUB_MATCH — the board gives
    // a street address with a postcode where every other feed puts a state, so
    // before that all eight resolved to no hub at all.
    endpoint: "https://www.johnhughes.com.au/careers",
    origin: "https://www.johnhughes.com.au",
    homeHub: "perth",
  },
  {
    id: "sydney-rgn",
    name: "Region Group",
    sector: "Financial Services",
    platform: "workgr8",
    // Measured 2026-08-06: the page header says "8 Job!" and the table lists
    // four, all the same title in Sydney under four ids — so they collapse to
    // one archive row on job_key. The reader logs the shortfall rather than
    // guessing which number is right.
    endpoint: "https://regiongroupau.workgr8.com/jobs",
    origin: "https://regiongroupau.workgr8.com",
    homeHub: "sydney",
  },
  {
    id: "brisbane-dbi",
    name: "Dalrymple Bay Infrastructure",
    sector: "Industrial Manufacturing",
    platform: "bigredsky",
    // The same ATS as NRW Holdings, and the same one-request read: the GET
    // carries the whole table. Measured 2026-08-06: 1 role.
    endpoint: "https://dbct.bigredsky.com/page.php",
    origin: "https://dbct.bigredsky.com",
    homeHub: "brisbane",
  },
  {
    id: "priv-craig-mostyn",
    name: "Craig Mostyn",
    sector: "Agri & protein production",
    platform: "ukgready",
    // The board URL's three ids, in the shape the bundle's own request builder
    // uses: the company id in the path with a percent-encoded pipe, ein_id and
    // career_portal_id as query parameters. `sort` is required by the builder,
    // so it is carried here rather than defaulted in the reader.
    endpoint:
      "https://secure.workforceready.com.au/ta/rest/ui/recruitment/companies/%7C6071620/job-requisitions?ein_id=17489025&lang=en-AU&career_portal_id=1507329&sort=-post_date",
    origin:
      "https://secure.workforceready.com.au/ta/6071620.careers?CareersSearch=&ein_id=17489025&career_portal_id=1507329&lang=en-AU",
    // Measured 2026-08-06: 21 of 21, its WA piggery, feedlot and processing
    // sites (Wundowie, Davenport, Nambeelup, Fremantle) plus two Victorian
    // roles at Indented Head.
    homeHub: "perth",
  },
  {
    id: "perth-aa",
    name: "Alcoa",
    sector: "Energy & Natural Resources",
    platform: "workday",
    endpoint: "https://alcoa.wd5.myworkdayjobs.com/wday/cxs/alcoa/Careers/jobs",
    origin: "https://alcoa.wd5.myworkdayjobs.com/Careers",
    // Measured 2026-08-06: 94 roles, and this is a GLOBAL board — 24 place on
    // Perth (Kwinana, Pinjarra, Wagerup, the Darling Range mines), 4 on
    // Melbourne, and 66 are in Brazil, Spain, Iceland, Canada and the US and
    // archive unplaced. Alcoa is plotted on Perth because that is where its
    // Australian workforce is, not because the board is Australian.
    homeHub: "perth",
  },
  {
    id: "priv-perth-airport",
    name: "Perth Airport",
    sector: "Airport operations",
    platform: "workday",
    endpoint:
      "https://perthairport.wd105.myworkdayjobs.com/wday/cxs/perthairport/PerthAirport/jobs",
    origin: "https://perthairport.wd105.myworkdayjobs.com/en-US/PerthAirport",
    // Measured 2026-08-06: 13 roles, all Perth.
    homeHub: "perth",
  },
  {
    id: "priv-georgiou",
    name: "Georgiou",
    sector: "Civil construction",
    platform: "cornerstone",
    // Cornerstone, same shape as Mirvac and Breville — but careersite/4 rather
    // than /1. The number is the tenant's site id and is not interchangeable.
    endpoint: "https://georgiou.csod.com/ux/ats/careersite/4/home?c=georgiou",
    origin: "https://georgiou.csod.com",
    // Measured 2026-08-06: 26 roles — 12 Perth, 12 Brisbane, 2 Sydney.
    homeHub: "perth",
  },
  {
    id: "melbourne-4dx",
    name: "4DMedical",
    sector: "Healthcare and Life Sciences",
    platform: "rippling",
    // 4dmedical.com/about/careers embeds Rippling's job-board script; the
    // tenant slug is what the reader needs, not the page.
    endpoint: "4dmedical",
    origin: "https://4dmedical.com/about/careers/",
    // Measured 2026-08-06: 5 roles, all Melbourne (Carlton).
    homeHub: "melbourne",
  },
  {
    id: "sydney-rwc",
    key: "sydney-rwc-emea",
    name: "Reliance Worldwide Corporation",
    sector: "Industrial Manufacturing",
    platform: "recruitee",
    // RWC runs TWO boards on two platforms for two regions, so it is two feeds
    // against one company id — the same shape Brambles and Transurban use.
    // This is the EMEA one. Measured 2026-08-06: 7 roles, all England.
    endpoint: "rwc",
    origin: "https://rwc.recruitee.com",
    homeHub: "sydney",
  },
  {
    id: "sydney-rwc",
    key: "sydney-rwc-am",
    name: "Reliance Worldwide Corporation",
    sector: "Industrial Manufacturing",
    platform: "adp",
    // The Americas board, on the same ADP service as Capstone. Measured
    // 2026-08-06: 19 roles — Alabama, Georgia and Tennessee plants. Only the
    // four Atlanta ones place; the rest are in towns we do not plot.
    endpoint:
      "https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions?cid=0d35cdee-8f25-492a-b86e-938916b084d5",
    origin:
      "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=0d35cdee-8f25-492a-b86e-938916b084d5&ccId=19000101_000001&lang=en_US",
    homeHub: "sydney",
  },
  {
    id: "brisbane-flt",
    name: "Flight Centre Travel Group",
    sector: "Consumer & Retail",
    platform: "pageupclassic",
    // The same PageUp classic theme Harvey Norman runs, on FCTG's own host.
    endpoint: "https://careers.fctgcareers.com/en/listing/",
    origin: "https://careers.fctgcareers.com",
    // Measured 2026-08-06: 239 roles — 104 Brisbane, 49 Sydney, 19 Perth, and
    // 54 unplaced because a travel retailer advertises by region ("Central
    // Queensland", "Regional NSW") as often as by city.
    homeHub: "brisbane",
  },
  {
    id: "melbourne-msb",
    name: "Mesoblast",
    sector: "Healthcare and Life Sciences",
    platform: "trakstar",
    // /jobs, not the tenant root: the root serves an EMPTY openings container
    // and the same board is server-rendered one path down.
    endpoint: "https://mesoblast.hire.trakstar.com/jobs",
    origin: "https://mesoblast.hire.trakstar.com",
    // Measured 2026-08-06: 1 opening, in Garland, Texas — which is what the
    // board says ("View 1 Opening"), not a truncated read. Mesoblast is
    // Melbourne-listed but its only current vacancy is American, so it
    // archives unplaced rather than being filed on Melbourne.
    homeHub: "melbourne",
  },
  {
    id: "brisbane-ctd",
    name: "Corporate Travel Management",
    sector: "Consumer & Retail",
    platform: "jobadderboard",
    endpoint: "https://clientapps.jobadder.com/62775/corporate-travel-management",
    origin: "https://clientapps.jobadder.com",
    // Measured 2026-08-06: 12 roles — 9 Brisbane, and one each in Melbourne,
    // Auckland and Wellington. No paginator; the board is the one page.
    homeHub: "brisbane",
  },
  {
    id: "sydney-gyg",
    name: "Guzman y Gomez",
    sector: "Consumer and Retail",
    platform: "smartrecruiters",
    // guzmanygomez.com.au/careers is WordPress with a SmartRecruiters widget;
    // `company_code: "GuzmanYGomez"` in the widget config is the only place the
    // tenant code appears.
    endpoint: "GuzmanYGomez",
    origin: "https://www.guzmanygomez.com.au/careers/",
    // Measured 2026-08-06: 790 roles across the restaurant network — 278
    // Brisbane, 272 Sydney, 161 Melbourne, 48 Perth. The largest AU-only board
    // in the file, which is why it leads its own tick.
    homeHub: "sydney",
  },
  {
    id: "melbourne-lov",
    name: "Lovisa",
    sector: "Consumer & Retail",
    platform: "teamtailor",
    endpoint: "https://careers.lovisa.com/jobs",
    origin: "https://careers.lovisa.com",
    // Measured 2026-08-06: 755 roles, which is what the board itself prints,
    // over 38 pages and about 70 seconds — the deepest walk added since
    // Woolworths, which is why it takes a tick alone. Most are store roles
    // outside Australia (France, the US, the UK), so they archive unplaced;
    // the AU/NZ ones place normally.
    homeHub: "melbourne",
    maxPages: 45,
  },
  {
    id: "chevron",
    name: "Chevron",
    sector: "Oil, Gas & LNG",
    platform: "radancy",
    endpoint: "https://careers.chevron.com/search-jobs/results",
    origin: "https://careers.chevron.com",
    // Measured 2026-08-08: 155 advertised, 155 collected over two pages, and
    // NONE of them in Australia — 41 Bengaluru, 22 Houston, 24 Buenos Aires,
    // 16 Makati City, the rest scattered. Perth roles do appear here when they
    // are open (Chevron Australia's own careers page links to a /job/perth/...
    // URL on this board, now expired), so this is a real zero rather than a
    // parser that found nothing. See fetchRadancy.
    homeHub: "perth",
    pageSize: 100,
    // 155 at 100 a page is 2; 6 leaves room to triple before the bound bites,
    // and the walk stops on the advertised total first.
    maxPages: 6,
  },
  {
    id: "asb",
    name: "Austal",
    sector: "Shipbuilding",
    platform: "adlogic",
    // page_id=4 is the WordPress page the AdLogic search widget is mounted on,
    // read off the inline adlogicJobSearch({ajaxServer: ...}) config. It is
    // per-tenant, not a constant.
    endpoint: "https://careers.austal.com/adlogic-jobs?action=searchJobs&page_id=4",
    origin: "https://careers.austal.com",
    // Measured 2026-08-08: 95 advertised, 95 returned in ONE request, almost
    // all at the Henderson yard with a few at Fremantle. The board's own RSS
    // stops at 50 — see fetchAdLogic.
    homeHub: "perth",
    // The `to` row number asked for. 200 is roughly double the board, so the
    // one-request read survives Austal doubling its hiring; the count it
    // advertises is what actually bounds the result.
    pageSize: 200,
  },
  {
    id: "perth-bgl",
    name: "Bellevue Gold",
    sector: "Gold",
    platform: "wpjobmanager",
    // Bellevue has no ATS of its own — it advertises through the Gold Industry
    // Group's shared board. Which is why expectCompany is set: nine other
    // miners publish on the same site.
    endpoint: "https://jobs.goldindustrygroup.com.au/companies/bellevue-gold/",
    origin: "https://jobs.goldindustrygroup.com.au",
    expectCompany: "Bellevue Gold",
    // Measured 2026-08-08: 7 vacancies, all at Sir Samuel in the Goldfields,
    // rendered in full with no pagination markup anywhere on the page.
    homeHub: "perth",
  },
  {
    id: "boe",
    name: "Boss Energy",
    sector: "Uranium",
    platform: "employmenthero",
    // The org slug is part of the careers URL Boss publishes
    // (employmenthero.com/jobs/organisations/boss-energy-isd9j/); the API is
    // named in that page's own markup.
    endpoint:
      "https://services.employmenthero.com/ats/api/v1/career_page/organisations/boss-energy-isd9j/jobs",
    origin: "https://employmenthero.com",
    // Measured 2026-08-08: 7 roles, every one of them advertised as Adelaide —
    // Boss's producing asset is the Honeymoon mine in South Australia. They
    // plot there. Perth is where the company sits.
    homeHub: "perth",
    pageSize: 100,
  },
  {
    id: "ccv",
    name: "Cash Converters",
    sector: "Consumer finance",
    platform: "chris21",
    endpoint: "https://csz.chris21.com/CSZ_MER21p/Er21Mobile/GetMobileJobs/",
    origin: "https://csz.chris21.com/CSZ_MER21p",
    // Measured 2026-08-08: 16 vacancies — store roles across QLD, NSW, VIC and
    // WA plus a few at the Perth head office. Reaching them needs a cookie the
    // published entry point does not set; see fetchChris21.
    homeHub: "perth",
  },
  {
    id: "perth-cyl",
    name: "Catalyst Metals",
    sector: "Gold",
    platform: "workable",
    // The Workable account slug, from apply.workable.com/catalyst-metals/.
    endpoint: "catalyst-metals",
    origin: "https://apply.workable.com/catalyst-metals",
    // Measured 2026-08-08: 5 roles, all Perth. Catalyst also advertises through
    // the operating entity for its Plutonic mine on SEEK (9 more) — see
    // seekTradingNames.ts; the two feeds cross-check by title.
    homeHub: "perth",
  },
  {
    id: "cxo",
    name: "Core Lithium",
    sector: "Lithium",
    platform: "bamboohr",
    endpoint: "https://corelithium.bamboohr.com",
    origin: "https://corelithium.bamboohr.com",
    // Measured 2026-08-08: 6 roles, every one at Cox Peninsula NT — the Finniss
    // operation — so none of them plots on Perth. That is the board being
    // honest about where the work is, not a parse gap.
    homeHub: "perth",
  },
  {
    id: "del",
    name: "Delorean Corporation",
    sector: "Bioenergy",
    platform: "delorean",
    endpoint: "https://deloreancorporation.com.au/about/careers/",
    origin: "https://deloreancorporation.com.au",
    // Measured 2026-08-08: 2 roles, both Sydney, both advertised as PDFs on an
    // Elementor page with no ATS behind it. See fetchDelorean for why the
    // location has to be paired by position.
    homeHub: "perth",
  },
  {
    id: "mah",
    name: "Macmahon Holdings",
    sector: "Mining services",
    platform: "successfactors",
    endpoint: "https://careers.macmahon.com.au",
    origin: "https://careers.macmahon.com.au",
    // Measured 2026-08-08: 88 advertised. This tenant serves the TILE theme
    // (job-tile-cell) rather than the table one — fetchSuccessFactors reads
    // both, and takes tiles when the page carries no data rows.
    homeHub: "perth",
  },
  {
    id: "perth-obm",
    name: "Ora Banda Mining",
    sector: "Gold",
    platform: "jobadder",
    // The endpoint is the WIDGET KEY, not a URL — `_jaJobsSettings.key` on
    // orabandamining.com.au/job-vacancies/, read the same way BGC's and
    // Ramelius' were. Measured 2026-08-08: the widget serves the location as a
    // classification cell, which is what fetchJobAdder expects.
    endpoint: "au3_gl4lycndetpezbmdfwry3aut2a",
    origin: "https://orabandamining.com.au/job-vacancies/",
    homeHub: "perth",
  },
  {
    id: "perth-prn",
    name: "Perenti",
    sector: "Mining services",
    platform: "successfactors",
    // The URL Perenti publishes is a category page (/go/All-Jobs/7836910/);
    // /search/ is the same board unfiltered, which is what the SF reader walks.
    endpoint: "https://jobs.perentigroup.com",
    origin: "https://jobs.perentigroup.com",
    // This is the OTHER half of Perenti's coverage. Its own SEEK advertiser id
    // serves 0 because the group hires under Barminco, DDH1, Ausdrill, BTP,
    // AUMS, Swick and Strike Drilling — seekTradingNames.ts pulls those. This
    // board is where the group advertises under its own name. Measured
    // 2026-08-08: the table theme, 25 rows a page.
    homeHub: "perth",
  },
  {
    id: "swm",
    name: "Seven West Media",
    sector: "Media",
    platform: "workday",
    endpoint: "https://sevenwestmedia.wd105.myworkdayjobs.com/wday/cxs/sevenwestmedia/SWM/jobs",
    origin: "https://sevenwestmedia.wd105.myworkdayjobs.com/en-GB/SWM",
    // wd105, not the wd3 most tenants here sit on — the pod is part of the host
    // and guessing it wrong 404s. Measured 2026-08-08: 33 roles across Sydney,
    // Melbourne, Perth and the regional mastheads (Narrogin, Port Lincoln).
    // SWM is Perth-listed and hires nationally.
    homeHub: "perth",
  },
  {
    id: "priv-cjd-equipment",
    name: "CJD Equipment",
    sector: "Heavy equipment",
    platform: "cjd",
    endpoint: "https://www.cjd.com.au/careers/current-opportunities/",
    origin: "https://www.cjd.com.au",
    // Measured 2026-08-08: 12 roles across the branch network — Perth,
    // Brisbane, Newcastle and the truck division. The whole board ships inside
    // the page as JSON; see fetchCjd.
    homeHub: "perth",
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
  // (14, one call), Super Retail (76 at 50 a page, so a token plus two
  // searches), Capstone (54 at 20 a page, three calls) and Spark NZ (17,
  // two calls) alongside it.
  ["mnd", "ltr", "brisbane-sul", "vancouver-cs", "nz-spark-new-zealand"],
  // Groups 39-41: the eleven added 2026-08-06 (second batch). Measured that
  // day: Lovisa 755, ABN 36, RAC 27, HBF 13, CBH 13, Hancock 11, VGW 10, John
  // Hughes 8, Iluka 5, Region 4, Dalrymple 1.
  //
  // Lovisa takes a tick alone. 755 roles at 20 a page is 38 sequential
  // requests and about 70 seconds measured — the deepest walk added since
  // Woolworths, and the one a crowded tick would truncate.
  ["melbourne-lov"],
  // The three Workday boards plus BigRedSky. Workday is the slowest reader in
  // the file, so these share rather than joining the single-call group below.
  ["ilu", "priv-hbf", "priv-rac-of-wa", "brisbane-dbi"],
  // The rest are one or two calls each: Greenhouse and the two table readers
  // serve a whole board in a single GET, ABN is two pages, and the two
  // SuccessFactors variants are short walks.
  [
    "priv-cbh-group",
    "priv-hancock-prospecting",
    "priv-abn-group",
    "sydney-rgn",
    "priv-john-hughes-group",
    "priv-vgw-holdings",
    "priv-craig-mostyn",
  ],
  // Groups 42-44: the ten added 2026-08-06 (third batch). Measured that day:
  // Guzman 790, Flight Centre 239, Alcoa 94, Georgiou 26, RWC Americas 19,
  // Perth Airport 13, CTM 12, RWC EMEA 7, 4DMedical 5, Mesoblast 1.
  //
  // Guzman leads its own tick — 790 roles is the largest AU-only board here —
  // with Mesoblast's single call alongside it.
  ["sydney-gyg", "melbourne-msb"],
  // Flight Centre spends a PageUp facet budget plus its listing, so it shares
  // only with single-GET boards.
  ["brisbane-flt", "brisbane-ctd", "sydney-rwc-emea", "sydney-rwc-am"],
  // Two Workday walks plus Cornerstone and Rippling, all short.
  ["perth-aa", "priv-perth-airport", "priv-georgiou", "melbourne-4dx"],
  // Group 45: the five added 2026-08-08, all Perth companies that had no
  // direct feed. Measured that day: Chevron 155 (none in Australia), Austal 95,
  // Cash Converters 16, Bellevue Gold 7, Boss Energy 7.
  //
  // They share one tick because none of them pages: Austal, Bellevue and Boss
  // each serve their whole board in a single request, Chevron takes two at 100
  // a page, and Cash Converters takes two because the first is spent being
  // issued a cookie. Seven requests for 280 roles is the cheapest group here.
  ["chevron", "asb", "ccv", "perth-bgl", "boe"],
  // Groups 46-47: the eight added 2026-08-08 (second batch). Measured that day:
  // Perenti 139, Macmahon 88, Seven West Media 33, Ora Banda 21, CJD 12, Core
  // Lithium 6, Catalyst Metals 5, Delorean 2.
  //
  // The three that page share a tick: Perenti and Macmahon are SuccessFactors
  // at 25 a page (6 and 4 pages), SWM is Workday at 20.
  ["perth-prn", "mah", "swm"],
  // The five single-call boards. Delorean is here rather than with the small
  // ones by rights — its careers page is a 230 KB Elementor document that takes
  // ~21 seconds to serve, measured twice, which is longer than any of the
  // paging walks above and would be the thing that truncates a crowded tick.
  ["perth-obm", "priv-cjd-equipment", "cxo", "perth-cyl", "del"],
  // Group 48 — the two WA university boards. Both are small and quick
  // (UWA 34 vacancies over two pages, Murdoch 11 and Curtin one page each),
  // so they share a tick rather than taking one each.
  ["uni-university-of-western-australia", "uni-murdoch-university", "uni-curtin-university"],
  // Group 49 — three small Adelaide boards: Carclew (a three-role page),
  // Detmold (LiveHire, 12 roles in one call) and State Theatre (an
  // accordion, empty today). One request each.
  ["sa-gov-carclew-youth-arts-centre", "priv-detmold-group", "sa-gov-state-theatre-company-of-sa"],
  // Group 50 — West Beach Parks (ELMO, 6 roles) and Drake (Expr3ss!, 39 in
  // one response). Both single requests.
  ["sa-gov-west-beach-parks", "priv-drake-supermarkets"],
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
      // &apos; is the named form of &#39;, and it turns up in URLs rather than
      // in prose: SuccessFactors builds a job's path from its title, so
      // Perenti's "Driller's Offsider" role is served at
      // /job/Soansville-Driller&apos;s-Offsider-... and the stored link was
      // carrying the entity verbatim.
      .replace(/&apos;/g, "'")
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
  // John Hughes writes its openings as a bare street address — "167 Welshpool
  // Rd, Welshpool 6106" — with a postcode where every other board puts a state,
  // so none of the needles below could reach them and all eight of its roles
  // resolved to no hub. Both suburbs were checked against the archive first,
  // the same way "fishers" was:
  //
  //   welshpool — 7 stored locations contain it and every one is the WA suburb.
  //               There is a Welshpool in Wales; nothing we archive names it.
  //   wangara   — matched BARE it also swallows WANGARATTA, which is in
  //               Victoria and is in the archive twice. So it carries a
  //               trailing space and a trailing comma instead, neither of which
  //               "wangaratta" can satisfy. (hubFor appends a comma before
  //               matching, so the comma form also catches a trailing "Wangara".)
  //
  // These sit in the Perth block, ahead of the NSW needle, on purpose: one
  // archived row says "Wangara, New South Wales, Australia", which is simply
  // wrong — Wangara is a Perth industrial suburb — and matching here files it
  // in the city it is actually in.
  ["welshpool", "perth"],
  ["wangara ", "perth"],
  ["wangara,", "perth"],
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
  // A POSTCODE BETWEEN THE STATE AND THE COMMA HIDES THE STATE. The three
  // needles that end in a comma — " wa,", " nt,", " vic," — are written that
  // way because their bare forms are substrings of ordinary words. But
  // "Altona North VIC 3025, Australia" puts a postcode where the comma was
  // expected, so " vic," never matched and the row fell through to the
  // employer's home hub: measured 2026-08-06 on Super Retail's LiveHire board,
  // Melbourne and Perth stores were being filed under Brisbane, which reads as
  // real data and is not. Dropping the postcode restores the comma the needle
  // is looking for. Only this exact shape is touched — a state abbreviation
  // followed by four digits — so nothing else in the string can be affected.
  // A LEADING SPACE for the same reason as the trailing comma. Several needles
  // are written with a leading space — " nsw", " wa," — because the bare forms
  // are substrings of ordinary words, and that space is a word boundary the
  // START of a string also is. Without it a location that BEGINS with the state
  // went unplaced: measured 2026-08-08 on Perenti's board, "WA, AU" and
  // "NSW, AU" resolved to no hub while "Perth, WA, AU" resolved fine — 34 of
  // 139 roles, which reads as a company hiring nowhere in particular.
  //
  // Like the comma, prepending can only ADD matches: every needle is still
  // tested with includes() against a string that merely starts differently.
  const l =
    " " + raw.toLowerCase().replace(/\b(nsw|vic|qld|wa|sa|nt|act|tas)\s+\d{4}\b/g, "$1,") + ",";
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
  vancouver: /canada/,
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

// ── SnapHire (Mercury NZ, Genesis Energy) ────────────────────────────────────
/**
 * TWO TENANT DIALECTS, and they share nothing but the /jobdetails/ link.
 *
 * Mercury wraps each role in `<div class="jobItem">` and labels its fields
 * inline — `<span class="loc first"><strong>`, `POSTED:</strong>`,
 * `EXPERTISE:</strong>`. Genesis wraps them in `<div class="job-item">` and
 * puts location, work type and posting date as three unlabelled `<span>`s
 * inside a `top-categories` block, with expertise in its own div.
 *
 * So every field is read with a fallback rather than one pattern, and the split
 * accepts both spellings. Measured 2026-08-06 on Genesis: 10 roles, which is
 * the whole board — `?page=2` returns the same ten and the markup carries no
 * paginator, next link or results count, the same single-page shape Mercury has.
 */
async function fetchSnapHire(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const item of html.split(/<div class="job-?item">/i).slice(1)) {
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
    // Genesis's three top-categories spans are positional and unlabelled, so
    // they are read as a group: the posting date is the one that says so, and
    // the location is the FIRST span rather than "the one that isn't a date" —
    // the middle span is the work type ("Permanent full-time") and treating it
    // as a location would file every role under no hub at all.
    const catBlock = item.match(/<div class="top-categories">([\s\S]*?)<\/div>/i);
    const cats = catBlock
      ? [...catBlock[1].matchAll(/<span>([^<]*)<\/span>/gi)].map((m) => trim(m[1])).filter(Boolean)
      : [];
    const loc = item.match(/<span class="loc[^"]*"><strong>([\s\S]*?)<\/strong>/i);
    const posted = item.match(/POSTED:<\/strong>([^<]*)</i);
    const cat = item.match(/EXPERTISE:<\/strong>([^<]*)</i);
    const cats2 = item.match(/<div class="expertise">([^<]*)</i);
    const postedText =
      (posted ? trim(posted[1]) : "") ||
      (cats.find((c) => /posted on:/i.test(c)) ?? "").replace(/^posted on:\s*/i, "");
    out.push(
      job(
        site,
        title,
        loc ? trim(loc[1]) : (cats[0] ?? ""),
        `${site.origin}${href}`,
        postedText ? isoDay(postedText) : "",
        (cat ? trim(cat[1]) : "") || (cats2 ? trim(cats2[1]) : "") || "Career portal",
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
      const loc =
        r.lis.find((x) => JA_LOCATION.test(x)) ??
        // Ora Banda's widget prints a BARE city — "Perth", no state — so the
        // state-suffix test finds nothing and every row fell back to the home
        // hub. That is right for Ora Banda today and would be wrong the moment
        // it advertises off its Goldfields sites, and it would be invisible.
        // So: failing that, take the cell hubFor can actually place. A
        // classification ("Mining / Oil & Gas / Utilities", "Engineering &
        // Maintenance") resolves to nothing; a place name resolves; the
        // work-type cell is already excluded above.
        r.lis.find((x) => !JA_WORKTYPE.test(x) && hubFor(x, null, /$^/)) ??
        "";
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

// ── UWA's own careers board ──────────────────────────────────────────────────
/**
 * UWA runs a self-hosted board at external.jobs.uwa.edu.au rather than an ATS.
 *
 * IT IS SERVER-RENDERED, which is worth stating because it does not look it: the
 * page is driven by a Stimulus controller (`data-jobs--search-target`) and the
 * job links are ABSOLUTE and slug-based —
 * `https://external.jobs.uwa.edu.au/jobs/senior-research-adviser-pre-award-…` —
 * so probing for the usual relative `/jobs/<id>` finds nothing and the board
 * looks like it hydrates client-side. It does not; the cards are in the GET.
 *
 * Measured 2026-08-17: 30 cards on page 1, 4 on page 2, 0 on page 3 — 34
 * vacancies, page size 30. `?page=N` drives it.
 *
 * PAGING STOPS ON AN EMPTY PAGE, and here that is safe in a way it is not
 * elsewhere in this file: page 3 returning zero cards is the documented end of
 * this board, not the ambiguous "fetch failed or list ended" that has silently
 * truncated pagedParallel walks twice. A failed fetch returns null from getText
 * and is told apart from an empty page below.
 *
 * Location comes off the card's own component span; the board gives no posting
 * date, so `created` is the day we first saw the role.
 */
async function fetchUwaJobs(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= (site.maxPages ?? 8); page++) {
    const html = await getText(`${site.endpoint}?page=${page}`);
    // null is a FAILED fetch — stop, but keep what we have rather than
    // treating it as the end of the list.
    if (html === null) break;
    const cards = html.split(/<article[^>]*class="[^"]*job-search-results-card-col/i).slice(1);
    if (!cards.length) break;
    let added = 0;
    for (const card of cards) {
      const m = card.match(
        /class="card-title job-search-results-card-title">\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
      );
      if (!m) continue;
      const title = clean(m[2]);
      if (!title || seen.has(title)) continue;
      seen.add(title);
      const loc = card.match(
        /job-component-location[\s\S]{0,300}?<span[^>]*>\s*([^<]{2,60}?)\s*<\/span>/i,
      );
      out.push(job(site, title, loc ? clean(loc[1]) : "", clean(m[1]), today(), "Career portal"));
      added++;
    }
    if (!added) break;
  }
  return out;
}

// ── Carclew's own careers page ───────────────────────────────────────────────
/**
 * Carclew runs no ATS. Its vacancies are EDITORIAL PROSE on a WordPress page:
 * a lead sentence naming how many roles there are, then one `<h3>` per role
 * with a paragraph and a position-description PDF under each.
 *
 * SCOPE IS THE WHOLE PARSER HERE. Measured 2026-08-21: three `<h3>` inside
 * `<main class="content-main">`, and FOUR in the page — the fourth is site
 * furniture outside the article. Reading h3s document-wide would invent a
 * vacancy called "Areas of interest" every single day, so the article boundary
 * is not tidiness, it is the difference between three roles and four.
 *
 * THE PAGE STATES ITS OWN COUNT — "the following three roles" — and that is
 * checked against what was parsed. It is the same discipline as bounding the
 * uniroles walk by its advertised total: this markup is prose, an editor can
 * add an `<h3>` sub-heading inside the article any day, and the sentence is the
 * only independent statement of how many roles there really are. A mismatch is
 * reported and the parse is still returned, because the count sentence is
 * itself hand-written and may be the half that is stale.
 *
 * The role's URL is its position-description PDF where one follows the heading
 * — that is the only per-role address on the page — else the page itself. No
 * location is published; hubFor falls a blank back to Adelaide, which is right:
 * Carclew is a single-site South Australian agency on North Terrace.
 */
const NUMBER_WORD: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

async function fetchCarclew(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  // Everything below reads the ARTICLE only — see the note above.
  const main = html.match(/<main class="content-main">([\s\S]*?)<\/main>/i);
  if (!main) return [];
  const body = main[1];

  const out: PortalJob[] = [];
  const seen = new Set<string>();
  // Split on the headings so each role keeps the block beneath it, which is
  // where its position-description link lives.
  const blocks = body.split(/<h3[^>]*>/i).slice(1);
  for (const block of blocks) {
    const end = block.indexOf("</h3>");
    if (end < 0) continue;
    const title = clean(block.slice(0, end));
    if (!title || seen.has(title)) continue;
    seen.add(title);
    const pdf = block.slice(end).match(/href="([^"]+\.pdf)"/i);
    out.push(job(site, title, "", pdf ? clean(pdf[1]) : site.endpoint, today(), "Career portal"));
  }

  const stated = clean(body).match(/following\s+([a-z]+)\s+roles?/i);
  const want = stated ? NUMBER_WORD[stated[1].toLowerCase()] : undefined;
  if (want !== undefined && want !== out.length) {
    console.log(
      `carclew: page says ${stated?.[1]} roles, parsed ${out.length} — ` +
        `one of the two is stale, keeping what was parsed`,
    );
  }
  return out;
}

// ── State Theatre Company SA's own careers page ──────────────────────────────
/**
 * State Theatre runs no ATS. Its careers page holds an accordion of vacancies:
 *
 *   <div class="content_items">
 *     <div class="t-copy content_contained"><p><em>There are currently no
 *       vacant positions.</em></p></div>
 *     <ul class="accordion content_contained"></ul>
 *   </div>
 *
 * Measured 2026-08-21, and the board is EMPTY that day — which is why the
 * container is parsed rather than the items. The `<ul class="accordion">` is
 * there in the markup with nothing in it, so its existence is a fact; what a
 * populated `<li>` looks like is not, because there has not been one to look at.
 *
 * THAT UNCERTAINTY IS HANDLED RATHER THAN GUESSED AROUND. Three states are told
 * apart, because two of them look identical to a scraper that only counts rows:
 *
 *   accordion present, empty, and the page says so   -> a confirmed zero, quiet
 *   accordion present, empty, and the page does NOT  -> logged: either they
 *     changed the copy or roles are rendered somewhere this does not read
 *   accordion missing entirely                       -> logged: the page moved
 *
 * Without that, the day this page first advertises a role, a parser written
 * blind against markup nobody has seen would return zero and be indistinguishable
 * from the honest zero it returns today — the ambiguity that made AUB Group's
 * silent feed take a user report to notice.
 */
async function fetchStateTheatre(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  const acc = html.match(/<ul class="accordion[^"]*"[^>]*>([\s\S]*?)<\/ul>/i);
  if (!acc) {
    console.log('statetheatre: no <ul class="accordion"> on the page — the layout moved');
    return [];
  }
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const li of acc[1].split(/<li\b/i).slice(1)) {
    // The title is the item's first heading, or its first link's text.
    const m =
      li.match(/<h[2-5][^>]*>([\s\S]*?)<\/h[2-5]>/i) ?? li.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    if (!m) continue;
    const title = clean(m[1]);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    const href = li.match(/href="([^"]+)"/i);
    out.push(job(site, title, "", href ? clean(href[1]) : site.endpoint, today(), "Career portal"));
  }
  if (!out.length && !/currently no vacant positions/i.test(html)) {
    console.log(
      "statetheatre: accordion is empty but the page no longer says there are no " +
        "vacancies — check whether roles moved out of the accordion",
    );
  }
  return out;
}

// ── Expr3ss! ─────────────────────────────────────────────────────────────────
/**
 * Expr3ss! server-renders its whole board into one table. Rows are
 * `<tr class='jobSearchN'>` — SINGLE-quoted attributes, which is why the usual
 * `class="` patterns find nothing here.
 *
 *   <td class='jobTitle'>
 *     <div class='link jobdescription' onclick="location.href='jobDetails?selectJob=2073&…'">
 *       After School and Weekend Casuals <span class='location'>[Drakes Kingscote]</span>
 *     </div>
 *   </td>
 *   <td class='jobWorkType center'>Casual / Temp</td>
 *
 * DEDUPE BY JOB ID, NEVER BY TITLE. Measured on Drake 2026-08-24: 39 rows, 39
 * distinct selectJob ids, 39 distinct (title, location) pairs — but only 25
 * distinct TITLES. A supermarket group advertises "Bakery Assistant Manager" at
 * several stores at once, and they are different vacancies in different suburbs.
 * Keying on the title would have thrown away 14 of 39 real roles and looked
 * tidy doing it.
 *
 * THE PAGE'S OWN COUNTERS CANNOT BE USED AS A TOTAL, which is worth writing down
 * because they look like one. The board renders a "N Current Jobs" heading per
 * DIVISION panel — 19, 14, 2, 17, 13, 4, 7 on that measurement — and a role can
 * sit in more than one panel, so they neither sum to the board nor agree with
 * each other. The row count after id-dedupe is the honest figure.
 *
 * The location is the store name in square brackets. It is kept as published:
 * hubFor resolves "Drakes Kingscote" through the home hub, and inventing a
 * suburb for it would be worse than an approximate pin.
 */
async function fetchExpr3ss(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const row of html.split(/<tr class='jobSearch\d+'/i).slice(1)) {
    const block = row.slice(0, row.indexOf("</tr>") + 1 || 4000);
    const cell = block.match(/class='link jobdescription'[^>]*>([\s\S]*?)<\/div>/i);
    if (!cell) continue;
    const inner = cell[1];
    const locM = inner.match(/<span class='location'>\[?([^\]<]*)\]?<\/span>/i);
    const title = clean(inner.replace(/<span class='location'>[\s\S]*?<\/span>/i, ""));
    // The id is the only thing that distinguishes two stores hiring the same
    // role — see the note above.
    const id = block.match(/selectJob=(\d+)/i)?.[1] ?? "";
    const key = id || `${title}|${locM?.[1] ?? ""}`;
    if (!title || seen.has(key)) continue;
    seen.add(key);
    const work = block.match(/<td class='jobWorkType[^']*'\s*>([\s\S]*?)<\/td>/i);
    out.push(
      job(
        site,
        title,
        locM ? clean(locM[1]) : "",
        id ? `${site.origin}/jobDetails?selectJob=${id}` : site.endpoint,
        today(),
        clean(work?.[1] ?? "") || "Career portal",
      ),
    );
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

// ── ADP WorkforceNow (Capstone Copper) ───────────────────────────────────────
interface AdpRequisition {
  itemID?: string;
  requisitionTitle?: string;
  postDate?: string;
  workLevelCode?: { shortName?: string };
  customFieldGroup?: {
    stringFields?: { stringValue?: string; nameCode?: { codeValue?: string } }[];
  };
  requisitionLocations?: { nameCode?: { shortName?: string } }[];
}

/**
 * ADP WorkforceNow's "career center" is a JS shell, but the data behind it is a
 * plain unauthenticated JSON service — the same host, /public/events/staffing.
 * The `cid` in the board URL is the only parameter it needs.
 *
 * THIS BOARD RETURNS SHORT PAGES IN THE MIDDLE OF THE LIST, so "fewer rows than
 * asked for" is NOT end-of-list here. Measured 2026-08-06 against Capstone:
 * `$top=200` returned 19 while advertising 54, and `$top=5&$skip=0` returned 4
 * where `$top=5&$skip=15` returned 5. Every heuristic this file normally uses to
 * end a walk — a short page, an empty page — would have stopped at 19 of 54 and
 * looked like a complete board.
 *
 * So the walk is bounded by `meta.totalNumber`, which the service reports on
 * every response, and it keeps going until `skip` passes it regardless of how
 * few rows any one page returned. Verified: 54 distinct of 54 advertised.
 *
 * The whole board is Capstone's Pinto Valley operation in Miami, Arizona, which
 * is not a hub we plot, so these rows archive against the company and appear on
 * its card without appearing on any city. That is the honest reading — Capstone
 * advertises nothing at its Vancouver head office today — and filing 54 Arizona
 * roles onto Vancouver to make the map look busier would be inventing a fact.
 */
async function fetchAdp(site: SiteDef): Promise<PortalJob[]> {
  const size = site.pageSize ?? 20;
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  let advertised = 0;
  for (let skip = 0; skip < (site.maxPages ?? DEFAULT_MAX_PAGES) * size; skip += size) {
    const json = await getJson<{
      jobRequisitions?: AdpRequisition[];
      meta?: { totalNumber?: number };
    }>(`${site.endpoint}&$top=${size}&$skip=${skip}`);
    // A failed fetch is indistinguishable from an empty page, and this board
    // serves empty-looking pages legitimately — so a null response ends the
    // walk rather than being read as "the rest of the board is empty".
    if (!json) break;
    advertised = json.meta?.totalNumber ?? advertised;
    for (const r of json.jobRequisitions ?? []) {
      const title = (r.requisitionTitle || "").trim();
      const key = String(r.itemID || title);
      if (!title || seen.has(key)) continue;
      seen.add(key);
      const ext = (r.customFieldGroup?.stringFields ?? []).find(
        (f) => f.nameCode?.codeValue === "ExternalJobID",
      )?.stringValue;
      // The location's shortName is "<site>, <city>, <state>, <country>" and
      // sometimes leads with a bare comma when the site name is blank.
      const loc = (r.requisitionLocations?.[0]?.nameCode?.shortName || "").replace(/^[\s,]+/, "");
      out.push(
        job(
          site,
          title,
          loc,
          ext ? `${site.origin}&jobId=${ext}` : site.origin,
          isoDay(r.postDate || ""),
          (r.workLevelCode?.shortName || "").trim() || "Career portal",
        ),
      );
    }
    if (advertised && skip + size >= advertised) break;
  }
  if (advertised && out.length < advertised) {
    console.log(`[adp] ${site.name}: collected ${out.length} of ${advertised} advertised`);
  }
  return out;
}

// ── Recruitee (RWC, EMEA) ────────────────────────────────────────────────────
interface RecruiteeOffer {
  id?: number;
  title?: string;
  location?: string;
  careers_url?: string;
  department?: string;
  created_at?: string;
}

/**
 * Recruitee publishes an unauthenticated board API at
 * `https://<tenant>.recruitee.com/api/offers/`, which returns the whole board
 * in one call — no paging, no token. `site.endpoint` is the tenant.
 *
 * `location` is already the composed "City, Region, Country" string, so it is
 * used as-is rather than rebuilt from the separate city/state/country fields
 * that sit beside it; those disagree with it on some records.
 *
 * Measured 2026-08-06 on RWC: 7 roles, all in England (West Drayton and
 * Maidenhead). This is RWC's EMEA board only — its Americas roles are on a
 * separate ADP tenant, wired as a second feed against the same company id.
 */
async function fetchRecruitee(site: SiteDef): Promise<PortalJob[]> {
  const json = await getJson<{ offers?: RecruiteeOffer[] }>(
    `https://${site.endpoint}.recruitee.com/api/offers/`,
  );
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const o of json?.offers ?? []) {
    const title = clean(o.title ?? "");
    const key = String(o.id ?? title);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push(
      job(
        site,
        title,
        clean(o.location ?? ""),
        o.careers_url || site.origin,
        isoDay(o.created_at ?? ""),
        clean(o.department ?? "") || "Career portal",
      ),
    );
  }
  return out;
}

// ── Trakstar Hire (Mesoblast) ────────────────────────────────────────────────
/**
 * The tenant root renders an EMPTY openings container — `js-openings-list` with
 * nothing in it — so the board reads as a JS app. /jobs is the same board
 * server-rendered, and that is what this reads.
 *
 * Title and location are taken from the `title=` ATTRIBUTES rather than the
 * element text. Both elements carry `cut-text`, which is a CSS ellipsis class:
 * the visible text is truncated for layout and the attribute holds the whole
 * value. Reading the text would archive "Customer Service/Administrative…".
 *
 * Measured 2026-08-06 on Mesoblast: 1 opening, in Garland, Texas — the board
 * says "View 1 Opening" and one card is what it serves.
 */
async function fetchTrakstar(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const card of html.split(/js-careers-page-job-list-item/i).slice(1)) {
    const href = clean(card.match(/data-href="([^"]+)"/i)?.[1] ?? "");
    const title = clean(
      card.match(/js-job-list-opening-name[\s\S]{0,300}?title="([^"]*)"/i)?.[1] ?? "",
    );
    if (!title || seen.has(href || title)) continue;
    seen.add(href || title);
    const loc = clean(
      card.match(/js-job-list-opening-loc[\s\S]{0,300}?title="([^"]*)"/i)?.[1] ?? "",
    );
    out.push(
      job(site, title, loc, href ? `${site.origin}${href}` : site.origin, today(), "Career portal"),
    );
  }
  return out;
}

// ── JobAdder hosted board (Corporate Travel Management) ──────────────────────
/**
 * NOT the JobAdder widget the `jobadder` platform reads. That one is a JSONP
 * call keyed by a widget id embedded in the employer's own site; this is
 * JobAdder's hosted board on clientapps.jobadder.com, which server-renders
 * every role into `pricing-item` cards. Same vendor, different product, so it
 * gets its own reader rather than a flag on the other one.
 *
 * THE LOCATION IS POSITIONAL AND THAT IS A RISK, so it is guarded. The card's
 * `<ul class="list">` carries category, sub-category, location and work type as
 * four unlabelled `<li>`s with nothing to tell them apart. Measured 2026-08-06
 * across all 12 of CTM's cards: every one has exactly four, and the third is
 * always the location (Brisbane, Auckland, Wellington, Melbourne, "Australia -
 * Any Office Location"). So the third is read ONLY when there are exactly four
 * — a card with a different shape yields no location rather than filing a
 * work type as a place.
 *
 * The date is "04th August, 2026"; the ordinal suffix is stripped because
 * Date.parse rejects it, and rejecting it would silently date every role today.
 */
async function fetchJobAdderBoard(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const card of html.split(/<div class="pricing-item/i).slice(1)) {
    const a = card.match(/<a href="([^"]+)"[^>]*class="viewjob"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const href = clean(a[1]);
    const title = clean(a[2]);
    if (!title || seen.has(href)) continue;
    seen.add(href);
    const lis = [...card.matchAll(/<li>(?:<i[^>]*><\/i>)?([^<]*)<\/li>/g)].map((m) => clean(m[1]));
    const posted = clean(card.match(/<sub>([^<]*)<\/sub>/i)?.[1] ?? "").replace(
      /(\d+)(st|nd|rd|th)\b/i,
      "$1",
    );
    out.push(
      job(
        site,
        title,
        lis.length === 4 ? lis[2] : "",
        href.startsWith("http") ? href : `${site.origin}${href}`,
        posted ? isoDay(posted) : today(),
        lis[0] || "Career portal",
      ),
    );
  }
  return out;
}

// ── UKG Ready / WorkforceReady (Craig Mostyn) ────────────────────────────────
interface UkgRequisition {
  id?: number;
  job_title?: string;
  employee_type?: { name?: string };
  location?: { city?: string; state?: string; country?: string };
}

/**
 * The careers page is a React shell that renders nothing — 4.4 KB with no job
 * anywhere in it — so this looked like the one board in this batch that needed
 * a browser. It does not. The shell's own bundle builds the request, and the
 * service behind it is unauthenticated:
 *
 *   /ta/rest/ui/recruitment/companies/|<companyId>/job-requisitions
 *
 * The pipe is literal and must be percent-encoded. `ein_id` and
 * `career_portal_id` come from the board URL and are both required — the
 * bundle appends them on every call. Found by reading getSearchResults() in
 * jobs-jobs-*.js rather than by guessing paths; four rounds of guessing
 * returned nothing but 404s and a sign-in page.
 *
 * `_paging.total` is authoritative and the walk is bounded by it. Measured
 * 2026-08-06: 21 of 21 in one call — Craig Mostyn's WA piggery, feedlot and
 * processing sites plus two Victorian roles.
 *
 * THERE IS NO POSTING DATE ON THIS BOARD. Not an empty one — the field does
 * not exist on the record at all. So `created` is the day we saw it, the same
 * as every other dateless feed here, rather than a date inferred from
 * something that means something else.
 */
async function fetchUkgReady(site: SiteDef): Promise<PortalJob[]> {
  const size = site.pageSize ?? 50;
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let offset = 0; offset < (site.maxPages ?? DEFAULT_MAX_PAGES) * size; offset += size) {
    const json = await getJson<{
      job_requisitions?: UkgRequisition[];
      _paging?: { total?: number };
    }>(`${site.endpoint}&offset=${offset}&size=${size}`);
    if (!json) break;
    total = json._paging?.total ?? total;
    for (const r of json.job_requisitions ?? []) {
      const title = clean(r.job_title ?? "");
      const key = String(r.id ?? title);
      if (!title || seen.has(key)) continue;
      seen.add(key);
      // city/state/country are separate fields, so the string is composed here
      // rather than read — "AUS" is spelled out to "Australia" because the
      // home-hub fallback tests for the country name, not the ISO code.
      const l = r.location ?? {};
      const loc = [l.city, l.state, l.country === "AUS" ? "Australia" : l.country]
        .filter(Boolean)
        .join(", ");
      out.push(
        job(
          site,
          title,
          loc,
          site.origin,
          today(),
          (r.employee_type?.name ?? "").trim() || "Career portal",
        ),
      );
    }
    if (total && out.length >= total) break;
  }
  if (total && out.length < total) {
    console.log(`[ukgready] ${site.name}: collected ${out.length} of ${total} advertised`);
  }
  return out;
}

// ── Teamtailor (Lovisa) ──────────────────────────────────────────────────────
/**
 * Teamtailor server-renders its list, 20 to a page, and prints the board total
 * ("755 jobs") above it — so the walk is bounded by that number rather than by
 * a short page. Measured 2026-08-06: 37 full pages plus 15, exactly the 755
 * advertised, and page 39 comes back empty.
 *
 * MOST OF THIS BOARD IS NOT AUSTRALIAN. Lovisa is a global retailer and the
 * bulk of these are store roles in France, the US, the UK and so on, which
 * resolve to no hub and archive unplaced. That is the honest reading: the
 * company card shows what Lovisa is actually advertising worldwide, and the
 * map shows only the ones in cities we plot.
 *
 * The card's two `<span>`s are department then location, in that order. They
 * are read positionally because neither carries a class of its own — so if a
 * tenant ever emits one span instead of two, the location goes missing rather
 * than silently picking up "Retail Stores" as a place.
 */
async function fetchTeamtailor(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const size = site.pageSize ?? 20;
  let advertised = 0;
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  for (let page = 1; page <= max; page++) {
    const html = await getText(`${site.endpoint}?page=${page}`);
    if (!html) break;
    if (!advertised) {
      advertised = Number(html.match(/([\d,]+)\s+jobs?\b/i)?.[1]?.replace(/,/g, "") ?? 0);
    }
    const items = html.split(/<li class="group border-b/i).slice(1);
    if (!items.length) break;
    for (const item of items) {
      const a = item.match(
        /<a class="no-company-style[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
      );
      if (!a) continue;
      const url = clean(a[1]);
      // The anchor wraps an absolutely-positioned overlay span before the text.
      const title = clean(a[2].replace(/<span[^>]*><\/span>/gi, ""));
      if (!title || seen.has(url)) continue;
      seen.add(url);
      const spans = [...item.matchAll(/<span>([^<]{2,80})<\/span>/g)].map((m) => clean(m[1]));
      out.push(job(site, title, spans[1] ?? "", url, today(), spans[0] || "Career portal"));
    }
    if (advertised && out.length >= advertised) break;
  }
  if (advertised && out.length < advertised) {
    console.log(`[teamtailor] ${site.name}: collected ${out.length} of ${advertised} advertised`);
  }
  return out;
}

// ── workgr8 (Region Group) ───────────────────────────────────────────────────
/**
 * One server-rendered table, three columns: id, a linked title, and a location.
 * No paginator and no query knobs — the whole board is the one GET.
 *
 * THE HEADER COUNT AND THE TABLE DISAGREE, so both are recorded. Measured
 * 2026-08-06: the page says "8 Job! at Region Group AU" and the table carries
 * four rows. Which is right is not something this reader can decide, so it
 * archives what the table actually lists and logs the shortfall — the same
 * collected-vs-advertised shape used everywhere else here, so a board that
 * starts hiding rows shows up in the logs rather than as a quiet decline.
 *
 * Those four rows are the same title at the same location under four ids, so
 * they collapse to ONE archive row on job_key. That is correct — one advertised
 * position is one vacancy however many requisition numbers it carries — but it
 * is why this feed contributes far fewer rows than it appears to.
 */
async function fetchWorkGr8(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(
    /<tr>\s*<td>(\d+)<\/td>\s*<td><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/td>\s*<td>([\s\S]*?)<\/td>/g,
  )) {
    const id = m[1];
    const title = clean(m[3]);
    if (!title || seen.has(id)) continue;
    seen.add(id);
    out.push(job(site, title, clean(m[4]), clean(m[2]), today(), "Career portal"));
  }
  const advertised = Number(html.match(/(\d+)\s*Job!/i)?.[1] ?? 0);
  if (advertised && out.length < advertised) {
    console.log(`[workgr8] ${site.name}: collected ${out.length} of ${advertised} advertised`);
  }
  return out;
}

// ── Clinch (ABN Group; NAB, via the Oxylabs script) ──────────────────────────
/**
 * Clinch, named by scripts/nab-to-d1.py — which had the vendor written down all
 * along. This reader first shipped as `abngroup` because ABN's page carries no
 * "powered by", no generator meta and no vendor domain, so the platform was
 * named for the employer. That was wrong: NAB runs the same product (identical
 * cloudfront asset host, identical importmap hashes, same /jobs/search route
 * and `jobs--search` controller), and naming a shared platform after one of its
 * tenants makes the second one look like a different thing.
 *
 * TWO RESULT VIEWS, and a tenant picks one. ABN renders a TABLE
 * (`<tr role="link">` with `data-job-url`); NAB renders CARDS
 * (`job-search-results-card-col`). A reader that knew only the table would
 * return zero on a card tenant and look exactly like an employer with no
 * vacancies — so both are read, table first, cards when the table is absent.
 * The card path was verified against 30 real NAB cards, 30 of 30 parsed.
 *
 * FIELDS ARE FOUND BY CLASS OR ID, NEVER POSITION. In the table that is
 * `job-search-results-title` / `-location` / `-category`; in the cards it is
 * the `location_icon_text_*` and `category_icon_text_*` ids. The id matters on
 * the card path for a reason scripts/nab-to-d1.py records: the LABEL span
 * beside each value ("Primary position location: ") carries
 * `class="job-attribute"` and appears only in the rendered page, so a generic
 * "first span in the item" match passes a raw-HTML test and then silently fills
 * every row with the label.
 *
 * NAB IS NOT WIRED HERE and cannot be. Its AWS WAF returns an empty shell to a
 * Worker and a challenge page to a datacentre IP; only a rendered fetch that
 * waits out the challenge gets the listing, which is what the Python script
 * does daily through Oxylabs. The card path exists because the NEXT Clinch
 * tenant may well be reachable, not to serve NAB.
 *
 * Measured 2026-08-06 on ABN: 30 on page one, 6 on page two, page three empty —
 * 36 roles. The walk ends on the first page with no rows, which is safe because
 * the pager is a plain `?page=N` over server-rendered HTML rather than a lazy
 * list that can serve an empty page mid-run.
 */
async function fetchClinch(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  for (let page = 1; page <= max; page++) {
    const html = await getText(`${site.endpoint}?page=${page}`);
    if (!html) break;
    const rows = html.split(/<tr role="link"/i).slice(1);
    const cards = rows.length ? [] : html.split(/job-search-results-card-col/i).slice(1);
    if (!rows.length && !cards.length) break;
    for (const raw of rows) {
      const row = raw.split(/<\/tr>/i)[0];
      const url = clean(row.match(/data-job-url="([^"]+)"/i)?.[1] ?? "");
      const title = clean(
        row.match(/class="job-search-results-title"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "",
      );
      if (!title || !url || seen.has(url)) continue;
      seen.add(url);
      const cell = (name: string) =>
        clean(
          row.match(
            new RegExp(`class="job-search-results-${name}"[\\s\\S]*?<li[^>]*>([^<]*)<`, "i"),
          )?.[1] ?? "",
        );
      out.push(
        job(site, title, cell("location"), url, today(), cell("category") || "Career portal"),
      );
    }
    for (const card of cards) {
      const a = card.match(
        /job-search-results-card-title[\s\S]{0,300}?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
      );
      if (!a) continue;
      const url = clean(a[1]);
      const title = clean(a[2]);
      if (!title || !url || seen.has(url)) continue;
      seen.add(url);
      // Keyed off the id, not "the first span": see the note above about the
      // label span that only exists in the rendered page.
      const byId = (name: string) =>
        clean(
          card.match(
            new RegExp(`id="${name}_icon_text_[^"]*"[^>]*>([\\s\\S]*?)</span>`, "i"),
          )?.[1] ?? "",
        );
      out.push(
        job(site, title, byId("location"), url, today(), byId("category") || "Career portal"),
      );
    }
  }
  return out;
}

// ── John Hughes' careers page ────────────────────────────────────────────────
/**
 * A Next.js dealer site that server-renders its openings under a "Positions
 * Available" heading: one card per role carrying an `<h5>` title, a
 * `<p class="text-muted">` street address, a blurb, and an "Apply Now" link to
 * /careers/<slug>.
 *
 * THE CARD IS FOUND FROM ITS LINK, not from its wrapper. The wrapper is a
 * string of Tailwind utility classes ("rounded border p-4 shadow-sm mb-3")
 * which is a styling decision, not a contract — a designer changing the shadow
 * would silently empty this feed. The /careers/<slug> href is the thing the
 * page cannot work without.
 *
 * The address is a street address ("167 Welshpool Rd, Welshpool 6106"), so it
 * places through the suburb rather than a state needle; John Hughes is a Perth
 * dealer group and its suburbs are Perth ones.
 */
async function fetchJohnHughes(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  // Bounded to the section that lists openings, so the site's own nav links to
  // /careers/... are not read as vacancies.
  const body = html.slice(html.search(/Positions Available/i));
  for (const m of body.matchAll(
    /<h5[^>]*>([\s\S]{2,120}?)<\/h5>\s*<p class="text-muted">([\s\S]{0,160}?)<\/p>[\s\S]{0,900}?href="(\/careers\/[^"]+)"/g,
  )) {
    const slug = clean(m[3]);
    const title = clean(m[1]);
    if (!title || seen.has(slug)) continue;
    seen.add(slug);
    out.push(job(site, title, clean(m[2]), `${site.origin}${slug}`, today(), "Career portal"));
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

// ── Radancy TalentBrew (Chevron) ─────────────────────────────────────────────
/**
 * The visible page is a shell; its list arrives from /search-jobs/results as
 * JSON whose `results` field is the rendered `<ul>`. Read that rather than the
 * page, because the page is one fixed slice of the same thing.
 *
 * BOUNDED BY THE ADVERTISED TOTAL, not by a short page. `data-total-results` on
 * the results section is the board's own count and it agrees with what is
 * served: measured 2026-08-08 on Chevron, 155 advertised, 100 on page 1 and 55
 * on page 2, 155 collected. Walking until a short page would work here and is
 * the habit that has truncated two other feeds silently, so the total is used.
 *
 * `RecordsPerPage` is honoured up to at least 100 (the default page serves 15).
 *
 * Chevron is a global board with nothing in Australia on the day it was added —
 * 41 Bengaluru, 22 Houston, 24 Buenos Aires, 16 Makati, and no AU role at all.
 * That is a real zero, not a parse failure: the `/job/perth/...` URL shape is
 * on the board's own site (the link Chevron Australia publishes points at an
 * expired Perth cadet role, which now 404s), so Perth roles do appear here when
 * they are open. homeHub is where the company plots; hubFor places each role
 * from its own location cell and leaves the rest untagged, as it does for
 * Ansell.
 */
async function fetchRadancy(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const pageSize = site.pageSize ?? 100;
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  let total = 0;
  for (let page = 1; page <= max; page++) {
    const params = new URLSearchParams({
      ActiveFacetID: "0",
      CurrentPage: String(page),
      RecordsPerPage: String(pageSize),
      Distance: "50",
      RadiusUnitType: "0",
      Keywords: "",
      Location: "",
      ShowRadius: "False",
      IsPagination: page === 1 ? "False" : "True",
      CustomFacetName: "",
      FacetTerm: "",
      FacetType: "0",
      SearchResultsModuleName: "Search Results",
      SearchFiltersModuleName: "Search Filters",
      SortCriteria: "0",
      SortDirection: "0",
      SearchType: "5",
      PostalCode: "",
    });
    const json = await getJson<{ results?: string }>(`${site.endpoint}?${params.toString()}`);
    const html = json?.results;
    if (!html) break;
    if (page === 1) {
      total = Number(html.match(/data-total-results="(\d+)"/i)?.[1] ?? 0);
      // No total means the section shape changed. Stopping is right: paging on
      // regardless would walk to maxPages against a board that may be serving
      // something else entirely.
      if (!total) break;
    }
    let added = 0;
    for (const li of html.split(/<li>/i).slice(1)) {
      const a = li.match(/<a href="([^"]+)"[^>]*data-job-id="([^"]*)"/i);
      if (!a) continue;
      const href = clean(a[1]);
      const id = clean(a[2]) || href;
      const title = clean(li.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "");
      if (!title || seen.has(id)) continue;
      seen.add(id);
      added++;
      out.push(
        job(
          site,
          title,
          clean(li.match(/class="job-location"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ""),
          href.startsWith("http") ? href : `${site.origin}${href}`,
          // The list carries no posting date, only the job page does. Dating
          // every row "today" would be a fabricated field; the archive's
          // last_seen is what actually tracks a role's life here.
          today(),
          "Career portal",
        ),
      );
    }
    if (!added || out.length >= total) break;
  }
  return out;
}

// ── AdLogic (Austal) ─────────────────────────────────────────────────────────
/**
 * A WordPress theme over AdLogic's recruitment-ad feed. The board's own RSS
 * (/adlogic-jobs/rss and /bulk-rss) is the obvious read and is WRONG: measured
 * 2026-08-08, both cap at 50 items against a board advertising 95. That is the
 * silent-truncation shape this file keeps running into — a feed that answers
 * successfully with half the roles.
 *
 * The searchJobs endpoint the page's own widget calls has no such cap. `from`
 * and `to` are absolute row numbers, and asking for a window wider than the
 * board returns everything: 95 advertised, 95 returned in one request. The
 * count is read from `JobPostings.@attributes.count` and the walk stops on it.
 *
 * `page_id` is the WordPress page the search widget is mounted on. It is part
 * of the tenant's endpoint, not a constant — it comes out of the inline
 * `adlogicJobSearch({ajaxServer: ...})` config on the careers page.
 *
 * Locations arrive as a three-level array (country / state / town), joined
 * most-specific-first so hubFor sees "Henderson, Western Australia, Australia"
 * and reads the town before the country.
 */
interface AdLogicPosting {
  "@attributes"?: { ad_id?: string };
  JobTitle?: string;
  pubDate?: string;
  locations?: { location?: { value?: string }[] | { value?: string } };
  classifications?: { classification?: { value?: string }[] | { value?: string } };
}

/**
 * The JSON is a serialised XML document, so an EMPTY element arrives as `{}`
 * rather than as "" — `{"value": {}}` for a classification with no text, and
 * likewise for `reference` and the salary fields. Measured 2026-08-08: one of
 * Austal's 95 postings carries exactly that, and passing it to clean() threw
 * "s.replace is not a function" and lost the whole board. So the type is
 * checked rather than defaulted, which `?? ""` cannot do — `{}` is not nullish.
 */
function adLogicText(v: unknown): string {
  return typeof v === "string" ? clean(v) : "";
}

function adLogicValues(node: { value?: string }[] | { value?: string } | undefined): string[] {
  if (!node) return [];
  const list = Array.isArray(node) ? node : [node];
  return list.map((v) => adLogicText(v?.value)).filter(Boolean);
}

async function fetchAdLogic(site: SiteDef): Promise<PortalJob[]> {
  const want = (site.pageSize ?? 200) + 1;
  const json = await getJson<{
    JobPostings?: {
      "@attributes"?: { count?: string };
      JobPosting?: AdLogicPosting[] | AdLogicPosting;
    };
  }>(`${site.endpoint}&from=1&to=${want}&currentPage=0`);
  const postings = json?.JobPostings?.JobPosting;
  if (!postings) return [];
  const rows = Array.isArray(postings) ? postings : [postings];
  const total = Number(json?.JobPostings?.["@attributes"]?.count ?? 0);
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const p of rows) {
    const title = adLogicText(p.JobTitle);
    const id = adLogicText(p["@attributes"]?.ad_id) || title;
    if (!title || seen.has(id)) continue;
    seen.add(id);
    // Most specific first: hubFor takes the first needle it recognises, and
    // country-first would resolve every role to the home hub.
    const parts = adLogicValues(p.locations?.location).reverse();
    const state = parts[1] ?? parts[0] ?? "";
    out.push(
      job(
        site,
        title,
        parts.join(", "),
        // The canonical shape the board's own RSS emits. Only the trailing id
        // is load-bearing — the title and state segments are decorative, and a
        // wrong one still resolves (measured 2026-08-08) — but they are built
        // properly so the stored link is the one a visitor would see.
        `${site.origin}/job-details/query/${encodeURIComponent(title).replace(/%20/g, "+")}` +
          `/in/${encodeURIComponent(state).replace(/%20/g, "+")}/${id}/`,
        isoDay(adLogicText(p.pubDate)),
        adLogicValues(p.classifications?.classification)[0] || "Career portal",
      ),
    );
  }
  // A short answer against the board's own count means the window was too
  // narrow or the feed truncated; both are worth seeing rather than archiving
  // silently. The rows already collected are still returned — a partial pull
  // beats none — but the gap is logged.
  if (total && out.length < total) {
    console.log(`adlogic ${site.id}: ${out.length} of ${total} advertised`);
  }
  return out;
}

// ── WP Job Manager / WorkScout (Bellevue Gold, via the Gold Industry Group) ──
/**
 * Bellevue Gold has no ATS of its own: it advertises through the Gold Industry
 * Group's shared board, whose company pages are WordPress (WP Job Manager rows
 * in the WorkScout theme) rendered server-side in full — no pagination markup
 * of any kind on the page, so one GET is the whole board (measured 2026-08-08:
 * 7 vacancies, zero pagination/load-more markers).
 *
 * BECAUSE THE BOARD IS SHARED, the advertiser is checked. Ten employers publish
 * here — AngloGold, Evolution, Gold Fields, Northern Star, Ramelius, Regis,
 * Saturn, the Perth Mint and Westgold as well as Bellevue — and the company
 * page is a WordPress template, so a layout change that widened the query would
 * file another gold miner's roles against this one. `expectCompany` is the
 * guard: a row whose own `company-name` cell disagrees is dropped.
 *
 * Location and category come from the icon-labelled cells, which is the only
 * thing that distinguishes them: they are sibling <li>s with identical markup
 * apart from the icon class (ln-icon-Map2 / ln-icon-Tag).
 */
async function fetchWpJobManager(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const want = clean(site.expectCompany ?? site.name).toLowerCase();
  for (const card of html.split(/<li data-longitude/i).slice(1)) {
    const href = clean(card.match(/<a href="([^"]+\/job\/[^"]+)"/i)?.[1] ?? "");
    if (!href || seen.has(href)) continue;
    // The title cell holds a work-type badge as well; the badge is stripped by
    // cutting at its <span> rather than by cleaning the whole h4, which would
    // run "Mine Surveyor" and "Full Time" together into one title.
    const h4 = card.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i)?.[1] ?? "";
    const title = clean(h4.split(/<span/i)[0]);
    if (!title) continue;
    const company = clean(card.match(/class="company-name"[^>]*>([\s\S]*?)<\/li>/i)?.[1] ?? "");
    if (want && company && company.toLowerCase() !== want) continue;
    seen.add(href);
    out.push(
      job(
        site,
        title,
        clean(card.match(/ln-icon-Map2[^>]*><\/i>([\s\S]*?)<\/li>/i)?.[1] ?? ""),
        href,
        // WP Job Manager prints "Posted 3 weeks ago" rather than a date, which
        // is not a date. last_seen carries the freshness instead.
        today(),
        clean(card.match(/ln-icon-Tag[^>]*><\/i>([\s\S]*?)<\/li>/i)?.[1] ?? "") || "Career portal",
      ),
    );
  }
  return out;
}

// ── Employment Hero ATS (Boss Energy) ────────────────────────────────────────
/**
 * The careers page is server-rendered, but it names its own API in the markup —
 * services.employmenthero.com/ats/api/v1/career_page/organisations/<org>/jobs —
 * and that is read instead, because it carries `total_items` to bound the walk
 * and a location field the cards only render as free text.
 *
 * `item_per_page` is honoured to at least 100 (the default is 10), so a board
 * this size is one request. Measured 2026-08-08 on Boss Energy: 7 roles, all at
 * the Honeymoon mine and all advertised as Adelaide, which is where they plot —
 * homeHub is Perth because that is where the company sits, not a claim about
 * where it hires.
 */
interface EmploymentHeroJob {
  title?: string;
  friendly_id?: string;
  vendor_location_name?: string;
  created_at?: string;
  team_name?: string;
}

async function fetchEmploymentHero(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const perPage = site.pageSize ?? 100;
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  let pages = 1;
  for (let page = 1; page <= pages && page <= max; page++) {
    const json = await getJson<{
      data?: { items?: EmploymentHeroJob[]; total_pages?: number };
    }>(`${site.endpoint}?page_index=${page}&item_per_page=${perPage}`);
    const items = json?.data?.items;
    if (!items?.length) break;
    if (page === 1) pages = Math.max(1, Number(json?.data?.total_pages ?? 1));
    for (const j of items) {
      const title = clean(j.title ?? "");
      const slug = clean(j.friendly_id ?? "");
      const id = slug || title;
      if (!title || seen.has(id)) continue;
      seen.add(id);
      out.push(
        job(
          site,
          title,
          clean(j.vendor_location_name ?? ""),
          slug ? `${site.origin}/jobs/position/${slug}/` : site.origin,
          isoDay(j.created_at ?? ""),
          clean(j.team_name ?? "") || "Career portal",
        ),
      );
    }
  }
  return out;
}

// ── Frontier Software chris21 (Cash Converters) ──────────────────────────────
/**
 * An AngularJS candidate portal whose vacancy list comes from
 * Er21Mobile/GetMobileJobs. That endpoint is [Authorize]-gated even for
 * anonymous browsing, and the fix is not obvious enough to leave unwritten:
 *
 *   GET the published entry point (/Home/index)  -> ASP.NET_SessionId only
 *   GET /Account/Login                           -> ASP.NET_SessionId AND
 *                                                   .AspNet.ApplicationCookie
 *
 * Only the second satisfies the gate. Measured 2026-08-08, three runs each:
 * with no cookie, and with a jar seeded from /Home/index, GetMobileJobs 302s to
 * /Account/Login every time and returns nothing; with a jar seeded from
 * /Account/Login it returns the full 190 KB list every time. So the login page
 * is fetched purely to be issued the anonymous auth ticket — nothing is posted
 * to it and no credentials exist.
 *
 * That 302 is exactly what a block looks like, which is why it is written down.
 *
 * TWO NON-OBVIOUS REQUIREMENTS, both of which cost a run to find:
 *
 *  - `redirect: "manual"` on the seed. /Account/Login answers 302, and the
 *    auth ticket is set ON THAT 302. Following it — the default — discards
 *    those Set-Cookie headers and hands back only the destination's, so the
 *    ticket is silently lost and the API 302s straight back.
 *  - an explicit Accept-Language. Without one the runtime sends
 *    `accept-language: *`, which this ASP.NET app answers with a 500 (it is not
 *    a parseable culture). Measured: seed 500 with no header, 302 with one.
 *
 * The board carries no server-side per-vacancy route: the detail view is an
 * Angular hash state driven by an id, and /Home/Vacancy/<id>,
 * /Home/Vacancy?VacancyId=<id>, /Home/index?VacancyId=<id>, ?vacancy=<id> and
 * /Home/index/<id> were all tried — the first two 404 and the rest serve the
 * same shell with an empty GoVacancy. So every row links to the board itself
 * rather than to a URL invented to look specific.
 */
interface Chris21Row {
  Vacancy?: {
    Id?: string | number;
    Title?: string;
    Location?: string;
    JobSector?: string;
    AdvertisedDate?: string;
  };
}

async function fetchChris21(site: SiteDef): Promise<PortalJob[]> {
  // The cookie the API needs, taken from the login page's response headers.
  // getSetCookie() rather than get(): two Set-Cookie headers arrive and get()
  // would fold them into one comma-joined string that no server parses back.
  const lang = { "Accept-Language": "en-AU,en;q=0.9" };
  let jar = "";
  try {
    const seed = await fetch(`${site.origin}/Account/Login`, {
      headers: { "User-Agent": UA, ...lang },
      redirect: "manual",
    });
    jar = seed.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .filter(Boolean)
      .join("; ");
  } catch {
    return [];
  }
  // No ticket means the gate will bounce us; returning early keeps the failure
  // in one place instead of as an empty JSON parse two calls later.
  if (!jar.includes("AspNet")) return [];
  const rows = await getJson<Chris21Row[]>(
    `${site.endpoint}?isInternalApplicant=false&isLoggedOn=false`,
    { headers: { ...lang, Cookie: jar, Referer: `${site.origin}/Home/index` } },
  );
  if (!Array.isArray(rows)) return [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const v = r?.Vacancy;
    const title = clean(v?.Title ?? "");
    const id = String(v?.Id ?? "") || title;
    if (!title || seen.has(id)) continue;
    seen.add(id);
    out.push(
      job(
        site,
        title,
        clean(v?.Location ?? ""),
        `${site.origin}/Home/index#!/`,
        // d/M/yyyy with a time — Date.parse reads the US order and would turn
        // 5/08/2026 into May. Reordered to ISO before isoDay sees it.
        chris21Date(v?.AdvertisedDate ?? ""),
        clean(v?.JobSector ?? "") || "Career portal",
      ),
    );
  }
  return out;
}

/** "5/08/2026 12:00:00 AM" (d/M/yyyy) -> ISO day. */
function chris21Date(s: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec((s || "").trim());
  if (!m) return today();
  return isoDay(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
}

// ── Workable (Catalyst Metals) ───────────────────────────────────────────────
/**
 * The board is a JS shell (5 KB); its list comes from the v2 accounts API,
 * which is a POST — a GET on the same path answers 400, so this is not the
 * usual "try the JSON endpoint" case. An empty body is the whole board.
 *
 * `total` is the board's own count and bounds the walk. `limit`/`offset` exist
 * for larger tenants; this one returns everything in one call.
 *
 * Measured 2026-08-08 on Catalyst Metals: 5 roles, all Perth.
 */
interface WorkableJob {
  shortcode?: string;
  title?: string;
  published?: string;
  location?: { city?: string; region?: string; country?: string };
  department?: string[];
}

async function fetchWorkable(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  let total = 0;
  let token = "";
  for (let page = 0; page < max; page++) {
    const json = await getJson<{ total?: number; results?: WorkableJob[]; nextPage?: string }>(
      `https://apply.workable.com/api/v2/accounts/${site.endpoint}/jobs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // An EMPTY body, deliberately. `limit` and `offset` are rejected
        // outright — the API answers 400 {"limit":"Not allowed"} — and passing
        // them as query parameters is silently ignored. Paging is a cursor:
        // the response carries `nextPage` when there is more, and nothing when
        // there is not. Measured 2026-08-08 on Catalyst Metals, which returns
        // its whole board (total 5) in the first call with no cursor, so the
        // cursor branch below is written from the API's contract rather than
        // from a board large enough to exercise it.
        body: JSON.stringify(token ? { token } : {}),
      },
    );
    const rows = json?.results;
    if (!rows?.length) break;
    if (page === 0) total = Number(json?.total ?? 0);
    for (const j of rows) {
      const code = clean(j.shortcode ?? "");
      const title = clean(j.title ?? "");
      const id = code || title;
      if (!title || seen.has(id)) continue;
      seen.add(id);
      out.push(
        job(
          site,
          title,
          // City first so hubFor reads the town before the country, as
          // everywhere else.
          [j.location?.city, j.location?.region, j.location?.country]
            .map((p) => clean(p ?? ""))
            .filter(Boolean)
            .join(", "),
          code ? `${site.origin}/j/${code}/` : site.origin,
          isoDay(j.published ?? ""),
          (j.department ?? []).map((d) => clean(d)).filter(Boolean)[0] || "Career portal",
        ),
      );
    }
    token = clean(json?.nextPage ?? "");
    if (!token || (total && out.length >= total)) break;
  }
  if (total && out.length < total) {
    console.log(`workable ${site.id}: ${out.length} of ${total} advertised`);
  }
  return out;
}

// ── BambooHR (Core Lithium) ──────────────────────────────────────────────────
/**
 * /careers is a JS shell; /careers/list is the JSON it reads, and it carries
 * `meta.totalCount` — so the walk is bounded by the board's own number rather
 * than by an empty page. There is no paging: the endpoint returns the lot.
 *
 * Measured 2026-08-08 on Core Lithium: 6 roles, every one at Cox Peninsula in
 * the Northern Territory (the Finniss operation), so none of them plots on
 * Perth. homeHub is where the company sits.
 */
interface BambooJob {
  id?: string | number;
  jobOpeningName?: string;
  departmentLabel?: string;
  employmentStatusLabel?: string;
  location?: { city?: string; state?: string; country?: string };
}

async function fetchBambooHr(site: SiteDef): Promise<PortalJob[]> {
  const json = await getJson<{ meta?: { totalCount?: number }; result?: BambooJob[] }>(
    `${site.endpoint}/careers/list`,
  );
  const rows = json?.result;
  if (!rows?.length) return [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const j of rows) {
    const id = String(j.id ?? "");
    const title = clean(j.jobOpeningName ?? "");
    if (!title || seen.has(id || title)) continue;
    seen.add(id || title);
    out.push(
      job(
        site,
        title,
        [j.location?.city, j.location?.state, j.location?.country]
          .map((p) => clean(p ?? ""))
          .filter(Boolean)
          .join(", "),
        id ? `${site.endpoint}/careers/${id}` : `${site.endpoint}/careers`,
        // The list carries no posting date — only a closing date on some rows,
        // which is a different fact. last_seen tracks freshness instead.
        today(),
        clean(j.departmentLabel ?? "") || "Career portal",
      ),
    );
  }
  const total = Number(json?.meta?.totalCount ?? 0);
  if (total && out.length < total) {
    console.log(`bamboohr ${site.id}: ${out.length} of ${total} advertised`);
  }
  return out;
}

// ── CJD Equipment ────────────────────────────────────────────────────────────
/**
 * An Umbraco site whose careers page is drawn client-side from props embedded
 * in the page itself: `<script id="careersListingData">` holds the whole board
 * as JSON. So no API call and no browser — the list is already in the HTML the
 * server sends, it is simply not in the markup.
 *
 * Locations are branch names ("CJD Perth", "CJD Brisbane", "CJD Trucks"). The
 * city ones resolve through HUB_MATCH on their own; "CJD Trucks" is a business
 * unit rather than a place and correctly falls back to the home hub — the row
 * is real either way, and inventing a city for it would not be.
 *
 * Measured 2026-08-08: 12 roles across the national branch network.
 */
interface CjdJob {
  id?: string | number;
  title?: string;
  location?: string;
  url?: string;
  categories?: string[];
}

async function fetchCjd(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  const island = html.match(/<script[^>]*id="careersListingData"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!island) return [];
  let rows: CjdJob[] = [];
  try {
    rows = JSON.parse(island) as CjdJob[];
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const j of rows) {
    const title = clean(j.title ?? "");
    const id = String(j.id ?? "") || title;
    if (!title || seen.has(id)) continue;
    seen.add(id);
    const path = clean(j.url ?? "");
    out.push(
      job(
        site,
        title,
        clean(j.location ?? ""),
        path ? `${site.origin}${path}` : site.endpoint,
        // closingDate is the only date on a row, and a closing date is not a
        // posting date. Storing it as one would misdate every role.
        today(),
        (j.categories ?? []).map((c) => clean(c)).filter(Boolean)[0] || "Career portal",
      ),
    );
  }
  return out;
}

// ── Delorean Corporation ─────────────────────────────────────────────────────
/**
 * No ATS at all. The careers page is Elementor, and each vacancy is a LINK TO A
 * PDF — "DEL Job Opportunity – Engineering Manager" — with its location in a
 * SEPARATE text widget further down the page. There is no container tying a
 * title to its location; the page is a two-column grid and the only thing
 * relating them is document order.
 *
 * So the two lists are read separately and paired by index, which is stated
 * plainly because it is an assumption a redesign will break. It is guarded:
 * pairing only happens when the counts match. When they do not, the roles are
 * still archived — they are real vacancies — but with no location, which puts
 * them on the company's home hub the way every unreadable location here does,
 * and the mismatch is logged so it is visible rather than silent.
 *
 * Measured 2026-08-08: 2 roles, both Sydney. Delorean is a Perth company
 * advertising interstate, which is exactly the case the index-pairing exists to
 * get right — dropping the location would file both on Perth.
 */
async function fetchDelorean(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  const links = [...html.matchAll(/<a href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)].filter(
    (m) => /job[-\s]?opportunity/i.test(m[1]) || /job opportunity/i.test(clean(m[2])),
  );
  if (!links.length) return [];
  const locations = [...html.matchAll(/Location:\s*([^<]{2,60})</gi)].map((m) => clean(m[1]));
  const paired = locations.length === links.length;
  if (!paired && locations.length) {
    console.log(`delorean ${site.id}: ${links.length} roles but ${locations.length} locations`);
  }
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const [i, m] of links.entries()) {
    const href = clean(m[1]);
    // "DEL Job Opportunity – Engineering Manager" is a document name, not a job
    // title. The role is what follows the last dash; the prefix is dropped so
    // the archive and the skills matcher see "Engineering Manager".
    const raw = clean(m[2]);
    const title = clean(raw.split(/[–—-]/).slice(1).join("-")) || raw;
    if (!title || seen.has(href)) continue;
    seen.add(href);
    out.push(job(site, title, paired ? locations[i] : "", href, today(), "Career portal"));
  }
  return out;
}

const FETCHERS: Record<Platform, (s: SiteDef) => Promise<PortalJob[]>> = {
  workable: fetchWorkable,
  bamboohr: fetchBambooHr,
  cjd: fetchCjd,
  delorean: fetchDelorean,
  radancy: fetchRadancy,
  adlogic: fetchAdLogic,
  wpjobmanager: fetchWpJobManager,
  employmenthero: fetchEmploymentHero,
  chris21: fetchChris21,
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
  adp: fetchAdp,
  teamtailor: fetchTeamtailor,
  ukgready: fetchUkgReady,
  recruitee: fetchRecruitee,
  trakstar: fetchTrakstar,
  jobadderboard: fetchJobAdderBoard,
  workgr8: fetchWorkGr8,
  uwajobs: fetchUwaJobs,
  carclew: fetchCarclew,
  statetheatre: fetchStateTheatre,
  expr3ss: fetchExpr3ss,
  clinch: fetchClinch,
  johnhughes: fetchJohnHughes,
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
  adp: "adp",
  teamtailor: "teamtailor",
  ukgready: "ukgready",
  recruitee: "recruitee",
  trakstar: "trakstar",
  jobadderboard: "jobadderboard",
  workgr8: "workgr8",
  // UWA runs its own board rather than an ATS, so the tag names the site.
  uwajobs: "uwajobs",
  // Carclew runs no ATS; the tag names the page, as aubgroup and zipco do.
  carclew: "carclew",
  // State Theatre runs no ATS; the tag names the page.
  statetheatre: "statetheatre",
  // Expr3ss! is a real ATS, so the tag is the platform.
  expr3ss: "expr3ss",
  clinch: "cl",
  johnhughes: "johnhughes",
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
  radancy: "radancy",
  adlogic: "adlogic",
  // The employer's roles on a THIRD-PARTY industry board, not on its own
  // WordPress site — so this does not share the "wp" tag the wprest/wploop
  // readers use. Where a row came from is the thing a source tag records.
  wpjobmanager: "wpjm",
  employmenthero: "eh",
  chris21: "chris21",
  workable: "workable",
  bamboohr: "bamboo",
  // Neither of these is a platform — each names the page the vacancy came from,
  // as `aubgroup` and `zipco` already do for employers with no ATS.
  cjd: "cjd",
  delorean: "delorean",
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
