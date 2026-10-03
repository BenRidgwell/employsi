/**
 * The employsi Terms and Conditions — FIRST DRAFT (2026-10-03), for legal review.
 *
 * Written against how the product actually works, so each clause can be
 * checked against the code rather than taken on trust:
 *   - sign-in is Google or LinkedIn only (lib/auth.ts) — no passwords;
 *   - one monthly subscription, price read from Stripe (lib/billingFn.ts),
 *     renewing until cancelled, sold through Stripe Managed Payments;
 *   - figures are counts of advertisements, and an ad on several boards is
 *     counted once per board (CLAUDE.md, "IT DEDUPES ACROSS RUNS, NOT ACROSS
 *     BOARDS") — said plainly in clause 5 because it is a real limit;
 *   - the AI analyst may only state figures a tool returned (analystLlmFn.ts),
 *     but its wording can still be wrong;
 *   - O*NET (CC BY 4.0) and map credits are licence conditions.
 *
 * The three facts first left as [CONFIRM] markers were supplied by the owner on
 * 2026-10-03: Western Australian law; Stripe as merchant of record (Managed
 * Payments); self-service cancellation through Settings → Manage subscription
 * (openBillingPortal in lib/billingFn.ts). TERMS_DRAFT keeps a
 * "draft" notice on the page until the text is final — set it to false then.
 *
 * Australian Consumer Law: guarantees under the ACL cannot be excluded, so the
 * liability and refund clauses are written "to the extent the law allows" and
 * clause 9 says so in plain words. A lawyer should still read them.
 */
export const TERMS_DRAFT = true;

export const TERMS_ENTITY = "Employsi (ABN 59 964 624 290)";
export const TERMS_CONTACT = "support@employsi.com.au";

export interface TermsSection {
  heading: string;
  paragraphs: string[];
}

export const TERMS: TermsSection[] = [
  {
    heading: "1. About these terms",
    paragraphs: [
      `These terms are an agreement between you and ${TERMS_ENTITY} ("employsi", "we", "us") for your use of the employsi website and app at employsi.com.au (the "Service"). By creating an account or using the Service you agree to them. If you do not agree, please do not use the Service.`,
      "Our Privacy Policy explains how we handle personal information and forms part of these terms.",
    ],
  },
  {
    heading: "2. Your account",
    paragraphs: [
      "You sign in with a Google or LinkedIn account. You must be at least 18, and the details those services give us must be yours.",
      "An account is for one person. Please do not share it or let anyone else use it, and keep your Google or LinkedIn account secure — anyone who can sign in to it can sign in to employsi. Tell us straight away if you think your account has been used without your permission.",
    ],
  },
  {
    heading: "3. Subscription and payment",
    paragraphs: [
      "Access to the app needs an active subscription. The price and billing period are shown before you pay, and include GST where it applies.",
      "Your subscription is billed in advance and renews automatically at the end of each billing period until you cancel it. Your purchase is sold through Stripe, which acts as the merchant of record for the sale: Stripe processes the payment, issues your receipts and invoices, and calculates and collects any applicable tax. Stripe's own terms apply to the payment itself.",
      "If we change the price, we will tell you by email at least 30 days before it applies to you, and the new price will apply from your next renewal after that notice. You can cancel before then if you do not want to continue.",
    ],
  },
  {
    heading: "4. Cancelling and refunds",
    paragraphs: [
      `You can cancel at any time yourself, from Settings → Subscription → Manage subscription in the app, or by contacting us at ${TERMS_CONTACT}. When you cancel, you keep access until the end of the period you have already paid for, and you will not be charged again.`,
      "Except where the law requires otherwise, payments are not refunded for partly used periods. Nothing in these terms limits any right to a refund, repair or replacement you have under the Australian Consumer Law — see clause 9.",
    ],
  },
  {
    heading: "5. What the data is, and what it is not",
    paragraphs: [
      "employsi shows labour-market information compiled from job advertisements published by employers and job boards, government job boards and official statistics. It reflects what was advertised, not every job that exists, and it may be incomplete, delayed or wrong.",
      "Figures are counts of advertisements. The same role advertised on several job boards can be counted once for each board, so totals can overstate the number of distinct jobs; comparisons between places or over time are usually more reliable than a single total. Salary figures are drawn from the advertisements that state one.",
      "The Service is general information only. It is not career, employment, recruitment, financial or legal advice, and you should not rely on it alone for decisions about hiring, pay, employment or your career.",
      "The analyst feature can answer questions in plain language. It is designed to use only figures that come from our data, but its explanations can still be incomplete or mistaken, so please check anything that matters.",
    ],
  },
  {
    heading: "6. How you may use the Service",
    paragraphs: [
      "You may use the Service for your own personal or internal business purposes. You may quote or share small extracts, such as a screenshot or a figure, if you say they came from employsi.",
      "You must not: copy, scrape, crawl or extract data from the Service by automated means; resell, republish or redistribute its data in bulk or build a competing product with it; get around the sign-in, the subscription or any security measure; interfere with or overload the Service; or use it for anything unlawful, misleading or harmful.",
    ],
  },
  {
    heading: "7. Intellectual property",
    paragraphs: [
      "We own, or are licensed to use, the Service, its software, design and compiled data. These terms give you a limited, non-exclusive, non-transferable right to use the Service while your subscription is active, and nothing more.",
      "Some content belongs to others and is used under their terms: occupation information from O*NET is used under the CC BY 4.0 licence, and maps are provided by Mapbox and OpenStreetMap contributors. Job advertisements remain the property of the employers and boards that published them.",
      "If you send us feedback or suggestions, we may use them to improve the Service without owing you anything for it.",
    ],
  },
  {
    heading: "8. Availability and changes to the Service",
    paragraphs: [
      "We work to keep the Service available and accurate, but we do not promise it will be uninterrupted or error-free. We may add, change or remove features and data sources as the product develops. If a change significantly reduces what you are paying for, we will tell you and you may cancel.",
    ],
  },
  {
    heading: "9. Your rights under the Australian Consumer Law, and our liability",
    paragraphs: [
      "Our services come with guarantees that cannot be excluded under the Australian Consumer Law. Nothing in these terms excludes, restricts or modifies any right or remedy you have under that law or any other law that cannot be excluded.",
      "To the extent the law allows: we are not liable for indirect or consequential loss, or for decisions you make based on the Service; and where our liability for failing to meet a consumer guarantee can be limited, it is limited, at our option, to supplying the services again or paying the cost of having them supplied again, and otherwise to the amount you paid us in the 12 months before the claim.",
    ],
  },
  {
    heading: "10. Suspension and closing your account",
    paragraphs: [
      "We may suspend or close an account that breaches these terms, after telling you where it is reasonable to do so. If we close your account without a breach on your part, we will refund any unused part of a period you have paid for.",
      `You can ask us to close your account and delete your personal information at any time by emailing ${TERMS_CONTACT}. Closing your account ends your subscription.`,
    ],
  },
  {
    heading: "11. Changes to these terms",
    paragraphs: [
      "We may update these terms. If a change is significant we will tell you by email or in the app before it takes effect, and if you do not agree you may cancel before then. Continuing to use the Service after a change takes effect means you accept it.",
    ],
  },
  {
    heading: "12. General",
    paragraphs: [
      "These terms are governed by the laws of Western Australia, and you and we submit to the courts of Western Australia. If any part of these terms is unenforceable, the rest continues to apply.",
      `Questions about these terms: ${TERMS_CONTACT}.`,
    ],
  },
];
