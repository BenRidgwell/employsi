import { createFileRoute } from "@tanstack/react-router";
import siteCss from "@/site/site.css?url";
import { Site, SiteFooter, SiteNav } from "@/site/SiteChrome";
import { TERMS, TERMS_CONTACT, TERMS_DRAFT, TERMS_ENTITY } from "@/site/terms";

const TITLE = "Terms and conditions — employsi";
const DESCRIPTION = "The terms for using employsi and its subscription.";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: "https://employsi.com.au/terms" },
    ],
    links: [
      { rel: "stylesheet", href: siteCss },
      { rel: "canonical", href: "https://employsi.com.au/terms" },
    ],
  }),
  component: TermsPage,
});

/** The text lives in site/terms.ts — edit it there, not here. */
function TermsPage() {
  return (
    <Site>
      <SiteNav />
      <main className="ws-legal">
        <h1 className="ws-display lg">Terms and conditions</h1>
        {TERMS_DRAFT ? (
          <p className="ws-legal-draft">
            Draft for review. These terms are not yet final and may change before they take effect.
          </p>
        ) : null}
        {TERMS.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            {s.paragraphs.map((p) => (
              <p key={p.slice(0, 48)}>{p}</p>
            ))}
          </section>
        ))}
        <p className="ws-legal-foot">
          {TERMS_ENTITY} · <a href={`mailto:${TERMS_CONTACT}`}>{TERMS_CONTACT}</a>
        </p>
      </main>
      <SiteFooter />
    </Site>
  );
}
