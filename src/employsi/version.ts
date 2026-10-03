/**
 * The shipped version, in one place.
 *
 * It is rendered in Settings' footer, printed by the production deploy
 * workflow, and tagged in git when a significant release goes out — all from
 * this constant, so the number a user reads and the number the release history
 * records cannot drift apart.
 *
 * ── WHEN TO BUMP ──────────────────────────────────────────────────────────
 * A machine cannot decide this. "Significant" is a judgement about whether the
 * product changed for the person using it, and only a person can make it, so
 * this is a rule to follow rather than something that can be automated.
 *
 * BUMP for a significant release:
 *   • a new surface, panel or map layer
 *   • a new market, data source or feed family going live
 *   • a change to what a figure MEANS, or to how one is measured
 *   • anything a user would notice and might ask about
 *
 * DO NOT BUMP for:
 *   • hotfixes and regressions — a fix restores the version that was claimed,
 *     it does not advance it
 *   • copy, spacing, colour and other finishing
 *   • refactors, comments, CI and tooling
 *   • roster and taxonomy maintenance that does not change a definition
 *
 * The test, when it is unclear: would you write a line about it in release
 * notes a user reads? If not, it is not a bump.
 *
 * ── HOW IT IS ENFORCED ────────────────────────────────────────────────────
 * .github/workflows/deploy-production.yml takes a `release` input —
 * `significant` or `maintenance` — and for a significant one refuses to deploy
 * if a `v<APP_VERSION>` tag already exists, which is exactly the
 * forgot-to-bump case: the number was already shipped under a previous
 * release. On success it tags the commit, so the tags are the release history
 * from here on. A maintenance deploy is expected to reuse the version and is
 * not checked.
 *
 * Pre-1.0 and honest about it: "1.0.0-beta.1" rather than the design mock's
 * invented "v2.4.1", for a product that has not had a 1.0.
 */
export const APP_VERSION = "1.0.0-beta.3";

/**
 * The day APP_VERSION was released, ISO.
 *
 * Not rendered today — Settings shows the number alone. It is here because a
 * version with no date cannot answer "is what I am looking at current?", and
 * the deploy workflow prints both.
 */
export const RELEASED = "2026-10-03";
