# Restore the landing page at "/"

## What happened

The git merge replaced the homepage. `src/routes/index.tsx` no longer renders the landing page —
it now renders the Employsi 3D map app instead. That app crashes in this preview with
"An API access token is required to use Mapbox GL", so the page appears blank/broken.

The landing page pieces themselves survived the merge: `src/components/Showcase.tsx`,
`src/components/Ticker.tsx` and `src/components/EmploysiLogo.tsx` are all still there — nothing
imports them any more. The landing page wrapper (header with the About popover, ticker mount,
footer) lived in `index.tsx` and was overwritten; the last version of it is still in git history
(commit `989f29a`).

## The fix

1. Restore the landing page wrapper into `src/routes/index.tsx` from the last good commit:
   ticker at the top, minimal header with the single "About" button and its photo popover
   (full-page blur overlay rendered at `document.body`), `<Showcase />` body, and the trimmed
   footer (© 2026 Employsi AB / "Exploring the world of work").
2. Move the map app to its own route: new `src/routes/app.tsx` holding the current
   client-only `lazy(() => import("@/employsi/App"))` + mobile-frame logic, at `/app`.
3. Give `/app` its own `head()` metadata so it doesn't reuse the landing page's title/description.
4. Leave the merged repo's map, workers, scrapers and data untouched.

## Note on the Mapbox error

The map route will still show the Mapbox token error in this preview unless the Mapbox token is
configured here. That's separate from the landing page being missing — the landing page itself
does not need Mapbox and will load fine once restored.

## Technical details

- No changes to `src/routeTree.gen.ts` (regenerated automatically from the route files).
- `src/components/Showcase.tsx`, `Ticker.tsx`, `EmploysiLogo.tsx` and `public/skyline-v4.html`
  are reused as-is; no rebuild of the carousel/skyline needed.
- Restoration is via `git show 989f29a:src/routes/index.tsx` as the source of truth, adapted only
  where the merged repo changed shared files.
