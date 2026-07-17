import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Mail } from "lucide-react";

function SkylineSVG() {
  return (
    <iframe
      src="/skyline-v4.html"
      title="Skyline"
      className="h-full w-full border-0"
      style={{ background: "transparent" }}
      loading="lazy"
    />
  );
}

function PrototypeSlide({ label, tone }: { label: string; tone: "map" | "heat" | "city" | "company" }) {
  const grid = Array.from({ length: 12 * 6 }, (_, i) => i);
  const palette: Record<string, string[]> = {
    map: ["#0a0a0c", "#1c1c1e", "#3a3a3d", "#8e8e93"],
    heat: ["#1c1c1e", "#45454b", "#8e8e93", "#d4d4d8"],
    city: ["#0a0a0c", "#26262a", "#5c5c63", "#a1a1a6"],
    company: ["#1c1c1e", "#3a3a3d", "#6b6b70", "#c4c4ca"],
  };
  const colors = palette[tone];
  return (
    <div className="relative aspect-[2940/1490] w-full flex-none select-none overflow-hidden bg-ink text-white">
      <div className="absolute inset-0 grid grid-cols-12 grid-rows-6">
        {grid.map((i) => (
          <div
            key={i}
            style={{ background: colors[(i * 7 + (i % 5)) % colors.length], opacity: 0.85 - ((i * 3) % 40) / 100 }}
          />
        ))}
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/50" />
      <div className="absolute left-6 top-6 rounded-full bg-white/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] backdrop-blur">
        employsi · live
      </div>
      <div className="absolute bottom-6 left-6 max-w-[70%]">
        <div className="text-2xl font-semibold tracking-tight md:text-4xl">{label}</div>
      </div>
      <div className="absolute right-6 top-6 flex gap-2">
        <span className="h-2 w-2 rounded-full bg-white/40" />
        <span className="h-2 w-2 rounded-full bg-white/40" />
        <span className="h-2 w-2 rounded-full bg-white/70" />
      </div>
    </div>
  );
}

function Carousel() {
  const slides = [
    { label: "Global live market map", tone: "map" as const },
    { label: "Australia — automation demand heat map", tone: "heat" as const },
    { label: "Perth — local 3D city view", tone: "city" as const },
    { label: "BHP — company analysis", tone: "company" as const },
  ];
  const [index, setIndex] = useState(0);
  const go = (i: number) => setIndex((i + slides.length) % slides.length);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % slides.length), 6000);
    return () => clearInterval(id);
  }, [slides.length]);

  return (
    <div className="relative mx-auto mt-6 w-full max-w-[1040px] [perspective:1700px]">
      <div
        className="relative overflow-hidden rounded-2xl shadow-[0_44px_90px_-34px_rgba(20,20,25,0.4)]"
        style={{ transform: "rotateX(26deg)", transformOrigin: "center bottom" }}
      >
        <div
          className="flex transition-transform duration-[550ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {slides.map((s) => (
            <PrototypeSlide key={s.label} label={s.label} tone={s.tone} />
          ))}
        </div>
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-2">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => go(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={`h-2 rounded-full transition-all ${
                i === index ? "w-6 bg-white" : "w-2 bg-white/55"
              }`}
            />
          ))}
        </div>
      </div>
      <button
        onClick={() => go(index - 1)}
        aria-label="Previous"
        className="absolute top-1/2 left-[-12px] z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-white shadow-lg hover:bg-black lg:left-[-68px]"
      >
        <ChevronLeft size={22} />
      </button>
      <button
        onClick={() => go(index + 1)}
        aria-label="Next"
        className="absolute top-1/2 right-[-12px] z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-white shadow-lg hover:bg-black lg:right-[-68px]"
      >
        <ChevronRight size={22} />
      </button>
    </div>
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
          <p className="mx-auto mb-8 max-w-[420px] text-[16px] leading-[1.6] text-[#555]">
            Explore a live 3D world of the workforce economy, showing where talent is being hired,
            retained, promoted, and lost.
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

        <div className="flex h-[420px] w-full items-end justify-center md:h-[440px]">
          <SkylineSVG />
        </div>

        <Carousel />
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
            Track hiring, salaries, and talent movement across every major employer — updated in real
            time, anywhere.
          </p>

          <div className="my-11 h-px bg-[rgba(120,120,130,0.35)]" />

          <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4 md:gap-6">
            <LiveStat min={14} max={19} fmt={(v) => `${Math.round(v)}+`} label="Employers tracked live" />
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
