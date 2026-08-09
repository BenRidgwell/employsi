import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, Check } from "lucide-react";
import { getLandingStats, type LandingStats } from "@/employsi/lib/landingStatsFn";

function SkylineSVG() {
  return (
    <iframe
      src="/waitlist-preview.html"
      title="Preview"
      scrolling="no"
      className="h-full w-full border-0 overflow-hidden"
      style={{ background: "transparent", pointerEvents: "none" }}
      loading="lazy"
    />
  );
}

const NUM_CLASS =
  "bg-gradient-to-br from-[#5c5c63] via-[#35353a] to-[#1f1f22] bg-clip-text text-[clamp(40px,5vw,64px)] font-bold leading-none tracking-tight text-transparent";

/**
 * One measured counter.
 *
 * The count-up is an ENTRANCE, not a churn. What was here before tweened the
 * figure back and forth between two hard-coded bounds every couple of seconds
 * to imitate liveness, which meant the number on screen was never a number
 * anyone had counted. This runs once, from zero to the value the archive
 * actually returned, and then stops there — the animation is decoration on a
 * real figure rather than a substitute for one.
 *
 * `value === null` is "the archive could not be read", and prints an em dash.
 * A zero is printed as zero: if the pipeline breaks, the page should say so
 * rather than keep showing the last plausible-looking number.
 */
function Stat({ value, label }: { value: number | null | undefined; label: string }) {
  const [shown, setShown] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    if (value == null || done.current) return;
    done.current = true;
    if (value === 0) return;
    let raf = 0;
    const t0 = performance.now();
    const dur = 900;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setShown(value * e);
      if (p < 1) raf = requestAnimationFrame(step);
      else setShown(value);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <div>
      {value === undefined ? (
        // Loading. A pulsing bar rather than a zero or a placeholder figure —
        // the same rule the app's ticker skeleton follows: say "reading"
        // without asserting anything.
        <div className="h-[clamp(40px,5vw,64px)] w-[70%] animate-pulse rounded-lg bg-white/15" />
      ) : (
        <div className={NUM_CLASS}>
          {value === null ? "—" : Math.round(shown).toLocaleString("en-US")}
        </div>
      )}
      <div className="mt-3 text-[15px] text-[#4a4a50]">{label}</div>
    </div>
  );
}

/** "2026-08-09" → "9 Aug 2026", for the measurement date under the counters. */
function fmtAsAt(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function LiveStats() {
  // The archive only changes on the nightly cron, so this is read once a
  // session and cached hard. The server memoises it too — see landingStatsFn.
  const { data, isPending } = useQuery<LandingStats | null>({
    queryKey: ["landingStats"],
    queryFn: () => getLandingStats(),
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
  });
  // undefined = still reading, null = could not read. The two render
  // differently and neither invents a figure.
  const v = (k: keyof LandingStats) =>
    isPending ? undefined : data == null ? null : (data[k] as number);

  return (
    <>
      <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4 md:gap-6">
        <Stat value={v("vacancies")} label="Vacancies tracked live" />
        <Stat value={v("employers")} label="Employers tracked" />
        <Stat value={v("countries")} label="Countries tracked" />
        <Stat value={v("cities")} label="Cities tracked" />
      </div>
      {data && (
        // Names the source and the day. A counter with no provenance is what
        // the placeholder version was; this is the difference.
        <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.12em] text-[#4a4a50]">
          Counted from the live job archive · {fmtAsAt(data.asAt)}
        </p>
      )}
    </>
  );
}

export function Showcase() {
  const [email, setEmail] = useState("");
  // Bots fill every field they can see. A real person never touches this one,
  // so any value in it means the submit is automated and is dropped silently —
  // silently on purpose, because telling a bot it failed teaches it to retry.
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");

  const submit = async () => {
    if (status === "sending") return;
    if (honeypot) return;
    const e = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setStatus("error");
      setError("Enter a valid email address.");
      return;
    }
    setStatus("sending");
    setError("");
    try {
      const r = await fetch("https://submit-form.com/GnhYzrssE", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: e, _source: "employsi waitlist" }),
      });
      // A 2xx is the only success. The previous version awaited the fetch and
      // then showed the confirmation regardless, so a rejected submission read
      // to the visitor exactly like an accepted one.
      if (!r.ok) throw new Error(String(r.status));
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <>
      <div className="mx-auto flex w-full max-w-[1100px] flex-col items-center gap-10 px-[5vw] pt-16 pb-12 text-center">
        <div className="w-full pt-4">
          <h1 className="mb-5 text-[clamp(30px,5.4vw,64px)] font-bold leading-[1.1] tracking-[-0.03em] text-black md:whitespace-nowrap">
            Explore the world of work.
          </h1>
          <p className="mx-auto mb-8 max-w-[900px] text-[16px] leading-[1.6] text-[#555]">
            Employsi is the HR intelligence platform that treats the labour market like a stock
            market. Built on a live interactive 3D globe, it lets anyone search a skill and see
            real-time demand across countries, cities, and individual companies.
          </p>

          {status === "done" ? (
            <div className="mx-auto flex max-w-[500px] items-center justify-center gap-2.5 rounded-full border border-[#d7e6dd] bg-[#e8f3ec] px-6 py-4">
              <Check size={18} strokeWidth={2.2} className="shrink-0 text-[#2f8f63]" />
              <span className="text-[15px] text-[#1f6a48]">
                You're on the list. We'll be in touch at <strong>{email}</strong>.
              </span>
            </div>
          ) : (
            <>
              <div
                className="mx-auto flex max-w-[500px] items-center gap-2.5 rounded-full border bg-[#f1f1f3] py-2 pr-2 pl-[22px]"
                style={{
                  borderColor: status === "error" ? "#e3b8b3" : "#e6e6ea",
                  transition: "border-color 160ms",
                }}
              >
                <Mail size={20} className="shrink-0 text-[#9a9aa2]" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    // Typing is the visitor answering the error, so the error
                    // should not still be on screen while they do.
                    if (status === "error") {
                      setStatus("idle");
                      setError("");
                    }
                  }}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder="Enter your email"
                  autoComplete="email"
                  className="min-w-0 flex-1 border-none bg-transparent px-1 py-3.5 text-[15px] text-ink outline-none placeholder:text-[#9a9aa2]"
                />
                <input
                  type="text"
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden
                  style={{ position: "absolute", left: -9999, width: 1, height: 1 }}
                />
                <button
                  onClick={submit}
                  disabled={status === "sending"}
                  className={`whitespace-nowrap rounded-full bg-ink px-7 py-3.5 text-[15px] font-semibold text-white transition duration-[120ms] hover:-translate-y-px hover:bg-black ${
                    status === "sending" ? "opacity-60" : ""
                  }`}
                >
                  {status === "sending" ? "Joining…" : "Join waitlist"}
                </button>
              </div>
              {error && <p className="mt-3 text-[13px] text-[#c4463b]">{error}</p>}
            </>
          )}
        </div>

        <div className="flex w-full justify-center">
          <div className="w-full max-w-[1100px] aspect-[3/2]">
            <SkylineSVG />
          </div>
        </div>
      </div>

      <section
        // `mx-[-5vw]` was here and caused ~92px of horizontal document overflow:
        // this section is a SIBLING of the padded hero container, so there was no
        // parent padding for the negative margin to cancel.
        className="relative mt-24 overflow-hidden rounded-t-[44px] px-[8vw] pt-24 pb-18 text-white"
        style={{
          background:
            "radial-gradient(140% 90% at 50% -10%, rgba(255,255,255,0.16), rgba(255,255,255,0) 55%), linear-gradient(to bottom, #0a0a0c 0%, #151517 22%, #45454b 44%, #c4c4ca 62%, #ffffff 76%)",
        }}
      >
        <div className="mx-auto max-w-[1100px]">
          <h2 className="mb-6 max-w-[780px] text-[clamp(30px,4vw,52px)] font-bold leading-[1.1] tracking-[-0.03em]">
            One live, dynamic world for the entire workforce economy.
          </h2>
          <p className="mb-9 max-w-[560px] text-[17px] leading-[1.6] text-white/75">
            Job seekers discover where their skills are worth most, and employers see exactly who
            they're competing with for talent - and where.
          </p>

          <div className="my-11 h-px bg-[rgba(120,120,130,0.35)]" />

          <LiveStats />
        </div>
      </section>
    </>
  );
}
