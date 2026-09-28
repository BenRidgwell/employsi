import { useEffect, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import siteCss from "@/site/site.css?url";
import { ClosingCta, ShotStack, Site, SiteFooter, SiteNav } from "@/site/SiteChrome";
import { HeroCallouts } from "@/site/HeroCallouts";

/** The one address this page wants to be found at. See the canonical link below. */
const CANONICAL_URL = "https://employsi.com.au/";

const TITLE = "employsi — Explore the world of work";
const DESCRIPTION =
  "Employsi is the HR intelligence platform that treats the job market like a stock market: search a skill and see live demand and supply across countries, cities and companies.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: CANONICAL_URL },
    ],
    links: [
      { rel: "stylesheet", href: siteCss },
      // Start the hero film and its poster early; they are the first paint.
      { rel: "preload", as: "image", href: "/site/hero-poster.jpg" },
      // ABSOLUTE, and hardcoded to the apex on purpose.
      //
      // This page is served on employsi.com.au and on the workers.dev URL, and
      // they are byte-identical. A search engine that finds both has to pick
      // one, and left to guess it can split the ranking across them or settle
      // on the workers.dev address — which is the development URL, not the one
      // being advertised. Naming the apex here makes every copy point at the
      // same original, whatever host served it.
      //
      // Deriving this from the request host would defeat the entire point: each
      // copy would declare itself canonical.
      { rel: "canonical", href: CANONICAL_URL },
    ],
  }),
  component: Landing,
});

const HERO_SHOTS = [
  { src: "/site/shot-globe-demand.jpg", alt: "employsi app — skill demand on the live globe" },
  {
    src: "/site/shot-mining-engineering.jpg",
    alt: "employsi app — mining engineering demand across Australian cities",
  },
  {
    src: "/site/shot-perth-project-managers.jpg",
    alt: "employsi app — Perth local view of employers hiring project managers",
  },
];

const ECONOMY_SHOTS = [
  {
    src: "/site/shot-sydney-strategy-pathways.jpg",
    alt: "employsi app — career pathways for strategy roles in Sydney",
  },
  {
    src: "/site/shot-rio-tinto-flows.jpg",
    alt: "employsi app — where Rio Tinto hires from, Perth local view",
  },
  { src: "/site/shot-afl-profile.jpg", alt: "employsi app — AFL employer profile, Melbourne" },
];

/**
 * The hero film. Muted/inline are set on the ELEMENT as well as in markup:
 * React does not reliably serialise `muted` during SSR, and without it iOS
 * refuses to autoplay and shows a play button over the banner instead.
 */
function HeroVideo() {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      v.pause();
      return;
    }
    const play = () => void v.play().catch(() => {});
    play();
    const onVis = () => {
      if (!document.hidden) play();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return (
    <video
      ref={ref}
      src="/site/hero.mp4"
      poster="/site/hero-poster.jpg"
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden
    />
  );
}

function Landing() {
  return (
    <Site>
      <SiteNav />
      <main>
        <section className="ws-banner" data-screen-label="Top banner">
          <HeroVideo />
          <div className="scrim" />
          <HeroCallouts />
          <div className="copy">
            <h1 className="ws-display xl">
              Explore the
              <br />
              world of work.
            </h1>
            <p className="ws-lede">
              See what your skills are worth, from your company, to your city, to the world.
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
              <Link to="/login" search={{ mode: "create" }} className="ws-btn light">
                Access now for free
              </Link>
            </div>
          </div>
        </section>

        <section className="ws-split" data-screen-label="Hero">
          <div className="text">
            <h2 className="ws-display lg">
              A stock market,
              <br />
              for jobs.
            </h2>
            <p className="ws-lede">
              Employsi is the HR intelligence platform that treats the job market like a stock
              market. Built on a live interactive 3D globe, it lets anyone search a skill and see
              real-time demand and supply across countries, cities, and individual companies.
            </p>
          </div>
          <div className="ws-stackwrap end">
            <div className="ws-stack">
              <ShotStack shots={HERO_SHOTS} fan="right" />
            </div>
          </div>
        </section>

        <section className="ws-split reverse" data-screen-label="Workforce economy">
          <div className="ws-stackwrap start">
            <div className="ws-stack">
              <ShotStack shots={ECONOMY_SHOTS} fan="left" />
            </div>
          </div>
          <div className="text">
            <h2 className="ws-display lg" style={{ lineHeight: 1.05, letterSpacing: "-0.03em" }}>
              Learn what the market wants, build the skills employers need.
            </h2>
            <p className="ws-lede">
              Job seekers discover where their skills are worth most, and employers see exactly who
              they're competing with for talent and where.
            </p>
          </div>
        </section>

        <ClosingCta />
      </main>
      <SiteFooter />
    </Site>
  );
}
