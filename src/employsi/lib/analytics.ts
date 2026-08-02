import type { ClientEvent, EventName } from "./events";

/**
 * The client half of product-event capture (see events.ts and
 * migrations/0005_app_event.sql).
 *
 * Small on purpose. It queues events, flushes them in batches, and makes sure a
 * session's length is recorded even when the tab is closed rather than
 * navigated away from. Everything that decides what a number MEANS — who the
 * person is, what time it is, which names are legal — is settled on the server;
 * this side only says what happened.
 *
 * WHAT IS NOT SENT
 * No search text. `track("search")` records that a search ran, never the query,
 * because a search box is where people type things they would not want kept and
 * a table that holds one query eventually holds all of them. Same reasoning for
 * URLs and referrers: none are collected.
 *
 * WHY IT BATCHES
 * Zooming the map fires nothing, but opening a card, following a company and
 * running a search inside ten seconds is ordinary. One request per event would
 * put a write on the critical path of every interaction for a table nobody but
 * an administrator reads. Events queue and go out together, at most once every
 * few seconds.
 *
 * WHY THE UNLOAD PATH IS DIFFERENT
 * `session_end` carries the session's length, and it is emitted exactly when the
 * page is going away — the moment a normal fetch is least likely to survive. It
 * goes out through sendBeacon, which the browser completes after the document
 * is gone. Without that, session length would be measured only for people who
 * happened to click something else first, which is a biased sample of precisely
 * the thing being measured.
 *
 * FAILURE IS SILENT AND MUST STAY THAT WAY. A rejected write loses an event.
 * Losing an event makes one admin figure slightly low; throwing would break a
 * page for a visitor over telemetry, which is never a trade worth making.
 */

const FLUSH_MS = 4000;
/** Queue longer than this flushes immediately rather than waiting out the timer. */
const FLUSH_AT = 12;
const ANON_KEY = "employsi.anon";

let queue: ClientEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sessionId = "";
let startedAt = 0;
let ended = false;

function rid(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

/**
 * A stable-per-browser id for signed-out visitors, so "visitors" and "signed-in
 * users" are countable separately. Dropped server-side the moment the person is
 * signed in, so the two can never be joined back together.
 */
function anonKey(): string {
  try {
    let v = localStorage.getItem(ANON_KEY);
    if (!v) {
      v = rid();
      localStorage.setItem(ANON_KEY, v);
    }
    return v;
  } catch {
    // Private mode. A per-load id still separates visitors from signed-in
    // users within a session, which is what the counts need.
    return sessionId;
  }
}

/**
 * One endpoint for both paths, mounted at /api/events in src/server.ts.
 *
 * `keepalive` is what makes the unload flush work: the browser finishes the
 * request after the document is gone. sendBeacon does the same thing and is
 * tried first because it is the only option in a couple of older engines, but
 * it cannot set headers, so keepalive is the primary and it is the one the
 * ordinary flushes use too.
 */
const ENDPOINT = "/api/events";

function send(events: ClientEvent[], unloading: boolean): void {
  if (!events.length) return;
  const body = JSON.stringify({ events });
  if (unloading && typeof navigator !== "undefined" && navigator.sendBeacon) {
    try {
      if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
    } catch {
      /* fall through to fetch */
    }
  }
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      body,
      keepalive: true,
      headers: { "content-type": "application/json" },
      // The cookie is what identifies the person; without it every event would
      // be filed as a signed-out visitor.
      credentials: "same-origin",
    }).catch(() => {
      /* telemetry never surfaces */
    });
  } catch {
    /* nor here */
  }
}

function flush(unloading = false): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const batch = queue;
  queue = [];
  send(batch, unloading);
}

/** Record that something happened. Never throws, never blocks. */
export function track(name: EventName, detail?: string): void {
  if (typeof window === "undefined") return;
  if (!sessionId) sessionId = rid();
  queue.push({ name, detail, sessionId, anonKey: anonKey() });
  if (queue.length >= FLUSH_AT) {
    flush();
    return;
  }
  if (!timer) timer = setTimeout(() => flush(), FLUSH_MS);
}

/** Close the session out, once, with its length. */
function endSession(): void {
  if (ended || !startedAt) return;
  ended = true;
  queue.push({
    name: "session_end",
    sessionId,
    anonKey: anonKey(),
    ms: Date.now() - startedAt,
  });
  flush(true);
}

let started = false;

/**
 * Begin a session. Called once from the app root.
 *
 * `pagehide` rather than `unload`: `unload` is ignored by bfcache-capable
 * browsers and simply does not fire on mobile Safari, which is where sessions
 * are most often ended by switching apps rather than closing a tab.
 * `visibilitychange` covers the case where the tab is backgrounded and then
 * discarded without a pagehide ever arriving.
 */
export function startSession(): () => void {
  if (typeof window === "undefined" || started) return () => {};
  started = true;
  sessionId = sessionId || rid();
  startedAt = Date.now();
  ended = false;
  track("session_start");

  const onHide = () => endSession();
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flush(true);
  };
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("pagehide", onHide);
    document.removeEventListener("visibilitychange", onVisibility);
    endSession();
  };
}
