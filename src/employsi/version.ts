/**
 * The shipped version, as Settings shows it.
 *
 * SET BY THE RELEASE, NOT BY HAND (since 2026-10-03). The production deploy
 * workflow works the number out from the git release tags and builds it in as
 * VITE_APP_VERSION, so the number a user reads in Settings and the tag the
 * release history records cannot drift apart — and nobody has to remember to
 * edit this file before a release:
 *
 *   significant release   the next number after the newest v* tag
 *                         (1.0.0-beta.3 -> 1.0.0-beta.4; after the betas,
 *                         1.0.0 -> 1.1.0), tagged once the deploy is verified
 *   maintenance release   the newest tag's number again — a hotfix restores
 *                         the version that was claimed, it does not advance it
 *   `version` input       an explicit number, for the steps a counter cannot
 *                         decide — dropping "beta" for 1.0.0 is one
 *
 * WHEN A RELEASE IS SIGNIFICANT is still a judgement, made when dispatching:
 * a new surface, panel or map layer; a new market, data source or feed family;
 * a change to what a figure MEANS or how it is measured; anything a user would
 * notice and ask about. Not hotfixes, copy and spacing, refactors, CI, or
 * roster and taxonomy upkeep. The test: would it get a line in release notes a
 * user reads?
 *
 * Previews are built with the newest release's number marked "(preview)", so
 * a reviewer can tell which release the preview is ahead of. A local or other
 * build with no number given says "dev" rather than claiming a release.
 */
export const APP_VERSION: string =
  (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || "dev";
