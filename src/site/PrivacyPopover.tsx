import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

const PRIVACY_CONTACT = "support@employsi.com.au";
const ENTITY = "Employsi, ABN 59 964 624 290";

// Each claim below was checked against the code on 2026-09-29: sessions expire
// after 30 days (lib/auth.ts), a search is recorded without its text
// (lib/analytics.ts), and sign-in is Google or LinkedIn only. Change the code
// and this text together.
const PRINCIPLES = [
  "We identify why we are collecting personal information before or at the time we collect it.",
  "We use it solely to run the service — to keep you signed in, to favourite and follow companies and/or skills relevant to you, and to understand in aggregate which parts of the product are used. We never sell it or use it for advertising.",
  "We retain it only as long as necessary. Sign-in sessions expire after 30 days; your account is kept until you ask us to delete it.",
  "We collect it by lawful and fair means, and with your knowledge. Sign-in is through Google or LinkedIn only, so we never receive or store a password. We record that a search happened, never the text you typed.",
  "Personal data is relevant, accurate, and no broader than the purpose. Where we analyse public career-movement data, records are reduced to a one-way key as they are collected: we keep the employers moved between and the skills involved, never names, job titles, profile links or contact details.",
  "We protect it with reasonable security safeguards. Traffic is encrypted and session cookies are restricted to our own site. Our hosting, mapping and AI providers operate internationally, so information may be processed outside Australia.",
  `We make our practices readily available. Ask us what we hold about you, have it corrected, or have your account deleted: ${PRIVACY_CONTACT}. We respond within 30 days, and you may contact the Office of the Australian Information Commissioner (oaic.gov.au) if you are not satisfied.`,
];

/** "Privacy policy" in the site footer: the same pop-out pattern as About. */
export function PrivacyPopover() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {open &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-40 bg-black/10 backdrop-blur-sm"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />,
          document.body,
        )}
      <PopoverTrigger asChild>
        <button type="button" className="ws-eyebrow ws-footer-link">
          Privacy policy
        </button>
      </PopoverTrigger>
      {/* Wider than About and scrollable: the policy is several times longer,
          and it opens upward from the footer where there is little room. */}
      <PopoverContent
        align="end"
        side="top"
        sideOffset={10}
        collisionPadding={16}
        className="z-50 max-h-[min(72vh,640px)] w-[min(calc(100vw-32px),460px)] overflow-y-auto rounded-3xl border-hairline bg-surface p-0 shadow-[0_32px_80px_-24px_rgba(0,0,0,0.28)]"
      >
        <div className="space-y-3 px-6 pt-7 pb-6 text-left">
          <h2 className="text-lg font-bold tracking-tight text-ink">Privacy Policy</h2>
          <p className="text-[13px] leading-relaxed text-ink-2">
            Your privacy is very important to us. Employsi shows job-vacancy and skill-demand data
            drawn from employer career pages, government job boards and official statistics. This
            Policy explains how we collect, use, disclose and protect personal information.
          </p>
          <ul className="list-disc space-y-2 pl-5 text-[13px] leading-relaxed text-ink-2">
            {PRINCIPLES.map((p) => {
              const [before, after] = p.split(PRIVACY_CONTACT);
              return (
                <li key={p}>
                  {after === undefined ? (
                    p
                  ) : (
                    <>
                      {before}
                      <a href={`mailto:${PRIVACY_CONTACT}`} className="text-ink underline">
                        {PRIVACY_CONTACT}
                      </a>
                      {after}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[13px] leading-relaxed text-ink-2">
            We are committed to conducting our business in accordance with these principles in order
            to ensure that the confidentiality of personal information is protected and maintained.
          </p>
          <p className="pt-1 text-[11px] text-ink-3">{ENTITY}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
