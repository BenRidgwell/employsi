import { useEffect, useRef, useState } from "react";
import { Mail } from "lucide-react";

function SkylineSVG() {
  return (
    <iframe
      src="/skyline-3d.html"
      title="Skyline"
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
  const [submitted, setSubmitted] = useState(false);

  const submit = async () => {
    const e = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      alert("Please enter a valid email address.");
      return;
    }
    try {
      await fetch("https://submit-form.com/GnhYzrssE", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: e, _source: "employsi waitlist" }),
      });
      setSubmitted(true);
    } catch {
      alert("Something went wrong joining the waitlist. Please try again.");
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
            real-time demand across countries, cities, and individual companies. Job seekers
            discover where their skills are worth most, and employers see exactly who they're
            competing with for talent — and where.
          </p>

          {submitted ? (
            <p className="text-[15px] text-[#333]">
              You're on the list — we'll be in touch at <strong>{email}</strong>.
            </p>
          ) : (
            <div className="mx-auto flex max-w-[500px] items-center gap-2.5 rounded-full border border-[#e6e6ea] bg-[#f1f1f3] py-2 pr-2 pl-[22px] transition focus-within:border-[#dcdce1] focus-within:bg-[#ececef]">
              <Mail size={20} className="shrink-0 text-[#9a9aa2]" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="Enter your email"
                autoComplete="email"
                className="min-w-0 flex-1 border-none bg-transparent px-1 py-3.5 text-[15px] text-ink outline-none placeholder:text-[#9a9aa2]"
              />
              <button
                onClick={submit}
                className="whitespace-nowrap rounded-full bg-ink px-7 py-3.5 text-[15px] font-semibold text-white transition hover:-translate-y-px hover:bg-black"
              >
                Join waitlist
              </button>
            </div>
          )}
        </div>

        <div className="flex w-full justify-center">
          <div className="w-full max-w-[1100px] aspect-[3/2] max-h-[520px] md:max-h-[580px]">
            <SkylineSVG />
          </div>
        </div>
      </div>

      <section
        className="relative mx-[-5vw] mt-24 overflow-hidden rounded-t-[44px] px-[8vw] pt-24 pb-18 text-white"
        style={{
          background:
            "radial-gradient(140% 90% at 50% -10%, rgba(255,255,255,0.16), rgba(255,255,255,0) 55%), linear-gradient(to bottom, #0a0a0c 0%, #151517 22%, #45454b 44%, #c4c4ca 62%, #ffffff 76%)",
        }}
      >
        <div className="mx-auto max-w-[1100px]">
          <h2 className="mb-6 max-w-[780px] text-[clamp(30px,4vw,52px)] font-bold leading-[1.1] tracking-[-0.03em]">
            One live map for the entire workforce economy.
          </h2>
          <p className="mb-9 max-w-[560px] text-[17px] leading-[1.6] text-white/75">
            Track hiring, salaries, and talent movement across every major employer — updated in
            real time, anywhere.
          </p>

          <div className="my-11 h-px bg-[rgba(120,120,130,0.35)]" />

          <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4 md:gap-6">
            <LiveStat
              min={14}
              max={19}
              fmt={(v) => `${Math.round(v)}+`}
              label="Employers tracked live"
            />
            <LiveStat
              min={2338}
              max={2394}
              fmt={(v) => Math.round(v).toLocaleString("en-US")}
              label="Open roles mapped"
            />
            <LiveStat
              min={60700}
              max={61500}
              fmt={(v) => `${(v / 1000).toFixed(1)}K`}
              label="Workforce covered"
            />
            <LiveStat
              min={99.5}
              max={100}
              fmt={(v) => `${v >= 99.95 ? "100" : v.toFixed(1)}%`}
              label="Real-time data"
            />
          </div>
        </div>
      </section>
    </>
  );
}
