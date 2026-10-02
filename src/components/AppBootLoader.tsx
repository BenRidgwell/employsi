import { useEffect, useState } from "react";

/**
 * What `/app` shows while the app itself is still arriving.
 *
 * WHY THIS EXISTS AT ALL. The /app document is ~3.4KB and does not contain the
 * app: routes/app.tsx renders nothing until mount and then lazy-loads
 * employsi/App, which is ~1.3MB compressed. Until that resolves the page was
 * literally blank — `<Suspense fallback={null}>` over a component that returns
 * `null` before mount — with only the browser's tab spinner to say anything was
 * happening. On a slow connection that is a white screen for many seconds, and
 * a dynamic import that FAILS looks exactly the same forever, with nothing in
 * the console. Both were reported as "the app isn't loading", which is a fair
 * description of what they look like.
 *
 * IT CANNOT USE THE APP'S STYLESHEET. employsi/global.css is imported by
 * App.tsx, so it ships inside the very chunk this is covering — every class in
 * it is unstyled while this is on screen. Hence inline styles plus one small
 * <style> for the keyframes, and nothing imported from employsi/.
 *
 * IT RENDERS ON THE SERVER TOO. routes/app.tsx returns this before `mounted`,
 * so it is in the SSR HTML and is the FIRST paint rather than something that
 * appears once React has booted. Server and first client render are identical,
 * so hydration matches.
 *
 * NO PROGRESS BAR. There is no denominator — one chunk, whose size the browser
 * knows and this does not — so a bar would be an invented number, which is the
 * thing this codebase does not do. After SLOW_MS it says it is taking a while
 * instead, which is true and is also the difference between "slow" and "stuck"
 * made visible.
 */

/** When a load stops being ordinary and the wait is worth naming. */
const SLOW_MS = 9000;

const STAGES = ["Loading the map", "Fetching live vacancies", "Indexing benchmarks"];

export function AppBootLoader() {
  const [i, setI] = useState(0);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % STAGES.length), 1900);
    const s = setTimeout(() => setSlow(true), SLOW_MS);
    return () => {
      clearInterval(t);
      clearTimeout(s);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      aria-busy="true"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        background: "#fff",
        zIndex: 9999,
      }}
    >
      {/* The sweep rests at a QUARTER width, so if animation never runs the
          mark sits as a stub and reads as a broken graphic rather than a
          logo — which is the opposite of what a holding screen is for. Under
          reduced motion the bars are simply drawn whole. */}
      <style>{`@keyframes ablt-sweep{0%,100%{transform:scaleX(.25);opacity:.35}
        45%{transform:scaleX(1);opacity:1}}
        @media (prefers-reduced-motion:reduce){.ablt-bar{animation:none!important;
        transform:none!important;opacity:1!important}}`}</style>
      {/* The in-app loader's mark (components/panels/CardLoader), redrawn with
          its animation inline so the two look like one product even though the
          stylesheet carrying the original is still downloading. */}
      <svg viewBox="0 0 120 120" width="46" height="46" aria-hidden fill="#1c1c1e">
        <rect x="24" y="24" width="15" height="72" rx="7.5" />
        {[
          { y: 24, w: 40, d: "0s" },
          { y: 52.5, w: 55, d: ".18s" },
          { y: 81, w: 72, d: ".36s" },
        ].map((b) => (
          <rect
            key={b.y}
            className="ablt-bar"
            x="24"
            y={b.y}
            width={b.w}
            height="15"
            rx="7.5"
            style={{
              transformOrigin: "24px center",
              animation: `ablt-sweep 1.6s ${b.d} ease-in-out infinite`,
            }}
          />
        ))}
      </svg>
      <span
        style={{
          font: "400 12px/1 'Inter',system-ui,sans-serif",
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: "#8e8e93",
        }}
      >
        {STAGES[i % STAGES.length]}
      </span>
      {slow && (
        <span
          style={{
            maxWidth: 320,
            textAlign: "center",
            font: "400 13px/1.5 'Inter',system-ui,sans-serif",
            color: "#8e8e93",
            textWrap: "pretty",
          }}
        >
          Still loading. The map is a large download the first time — it is cached after that.
        </span>
      )}
    </div>
  );
}

/**
 * The app chunk failed to arrive.
 *
 * ONE AUTOMATIC RELOAD, GUARDED. The common cause is a stale document: assets
 * are immutable and content-hashed, so a page held from before a deploy asks
 * for a chunk that no longer exists, and a fresh document fixes it. Retrying
 * the same URL cannot. The guard is sessionStorage rather than a ref, because
 * the reload is what destroys the ref — without it a permanently missing chunk
 * would reload forever, which is worse than the blank page this replaces.
 *
 * After that it says so and offers the reload rather than retrying, because a
 * second failure is not a stale document and the honest thing is to stop.
 */
const RELOADED_KEY = "employsi.chunkReload";

export function AppBootError({ error }: { error: unknown }) {
  const [tried, setTried] = useState(true);

  useEffect(() => {
    let already = true;
    try {
      already = sessionStorage.getItem(RELOADED_KEY) === "1";
      if (!already) sessionStorage.setItem(RELOADED_KEY, "1");
    } catch {
      // Private mode: no guard available, so do not auto-reload at all. An
      // unbounded reload loop is the one outcome worse than this screen.
      already = true;
    }
    if (!already) {
      window.location.reload();
      return;
    }
    setTried(already);
  }, []);

  const detail = error instanceof Error ? error.message : "";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 24,
        background: "#fff",
        textAlign: "center",
      }}
    >
      <span style={{ font: "600 19px/1.3 'Mona Sans',system-ui,sans-serif", color: "#1c1c1e" }}>
        The map didn’t finish loading
      </span>
      <span
        style={{
          maxWidth: 420,
          font: "400 14px/1.6 'Inter',system-ui,sans-serif",
          color: "#6c6c72",
          textWrap: "pretty",
        }}
      >
        Its code could not be fetched. This is usually a dropped connection or a page held open
        across a release.
      </span>
      <button
        type="button"
        onClick={() => {
          try {
            sessionStorage.removeItem(RELOADED_KEY);
          } catch {
            /* nothing to clear */
          }
          window.location.reload();
        }}
        style={{
          marginTop: 4,
          padding: "10px 18px",
          border: 0,
          borderRadius: 999,
          background: "#1c1c1e",
          color: "#fff",
          font: "500 14px/1 'Inter',system-ui,sans-serif",
          cursor: "pointer",
        }}
      >
        Reload
      </button>
      {/* The actual message, small and last. A blank screen told nobody
          anything; this is what turns "it isn't loading" into a report. */}
      {tried && detail && (
        <span style={{ font: "400 11.5px/1.5 ui-monospace,monospace", color: "#a1a1a6" }}>
          {detail.slice(0, 180)}
        </span>
      )}
    </div>
  );
}
