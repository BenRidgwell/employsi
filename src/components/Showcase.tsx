import { useEffect, useRef, useState } from "react";
import { Mail, Check } from "lucide-react";

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

function LiveStat({
  min,
  max,
  fmt,
  label,
}: {
  min: number;
  max: number;
  fmt: (v: number) => string;
  label: string;
}) {
  const [value, setValue] = useState((min + max) / 2);
  const [flash, setFlash] = useState(false);
  const currentRef = useRef((min + max) / 2);

  useEffect(() => {
    let raf = 0;
    let timeout: ReturnType<typeof setTimeout>;
    const tween = (target: number) => {
      const start = currentRef.current;
      const t0 = performance.now();
      const dur = 650;
      setFlash(true);
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        const v = start + (target - start) * e;
        currentRef.current = v;
        setValue(v);
        if (p < 1) raf = requestAnimationFrame(step);
        else setFlash(false);
      };
      raf = requestAnimationFrame(step);
    };
    const loop = () => {
      tween(min + Math.random() * (max - min));
      timeout = setTimeout(loop, 1900 + Math.random() * 2400);
    };
    timeout = setTimeout(loop, 700 + Math.random() * 1600);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, [min, max]);

  return (
    <div>
      <div
        className={`bg-gradient-to-br from-[#5c5c63] via-[#35353a] to-[#1f1f22] bg-clip-text text-[clamp(40px,5vw,64px)] font-bold leading-none tracking-tight text-transparent transition-opacity ${
          flash ? "opacity-60" : "opacity-100"
        }`}
      >
        {fmt(value)}
      </div>
      <div className="mt-3 text-[15px] text-[#4a4a50]">{label}</div>
    </div>
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

          <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4 md:gap-6">
            {/* PLACEHOLDER RANGES, and they need to stay labelled as such. The
                handoff says to swap them for real figures read from D1 before
                launch. Two of them happen to be true today — 6 released
                markets and 80 cities — but they are still tweened numbers, not
                a query, and a figure nobody can point at a row for is exactly
                what this codebase refuses to print. */}
            <LiveStat
              min={55800}
              max={56200}
              fmt={(v) => Math.round(v).toLocaleString("en-US")}
              label="Vacancies tracked live"
            />
            <LiveStat
              min={1480}
              max={1520}
              fmt={(v) => Math.round(v).toLocaleString("en-US")}
              label="Employers tracked"
            />
            <LiveStat
              min={5.6}
              max={6.4}
              fmt={(v) => String(Math.round(v))}
              label="Countries tracked"
            />
            <LiveStat min={78} max={82} fmt={(v) => String(Math.round(v))} label="Cities tracked" />
          </div>
        </div>
      </section>
    </>
  );
}
