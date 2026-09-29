# Where the privacy policy's claims come from

Companion to `privacy-policy.draft.md`. Every factual claim in that document was
read out of this repository on 2026-09-29 rather than assumed, and this file says
where from — so that a change which falsifies one can be found, and so the next
person to touch the policy does not have to re-derive it.

**A privacy policy is a factual claim about a codebase.** If one of these files
changes, the policy may become untrue, which is a worse failure than the policy
being vague.

| Policy claim | Read from |
| --- | --- |
| Waitlist page has no form fields | `src/routes/index.tsx` — zero `<input>` elements |
| Sign-in is Google/LinkedIn only; no password storage | `src/employsi/lib/auth.ts` — `emailAndPassword: { enabled: false }` |
| Account fields: name, email, emailVerified, image, timestamps | `migrations/0001_auth.sql`, `CREATE TABLE "user"` |
| Session record holds IP address and user-agent | `migrations/0001_auth.sql`, `CREATE TABLE "session"` — `ipAddress`, `userAgent` |
| Access and refresh tokens stored | `migrations/0001_auth.sql`, `CREATE TABLE "account"` |
| Session cookie: HTTP-only, Secure, SameSite=Lax, 30 days | `src/employsi/lib/auth.ts` — `defaultCookieAttributes`, `session.expiresIn` |
| Account linking across the two providers | `src/employsi/lib/auth.ts` — `account.accountLinking` |
| Product events store no IP, user-agent, URL or free text | `migrations/0005_app_event.sql` header, and `src/employsi/lib/analytics.ts` |
| Search **text** is never stored | `src/employsi/lib/analytics.ts` — "WHAT IS NOT SENT" |
| `anon_key` is a random per-browser id in local storage | `src/employsi/lib/analytics.ts` — `ANON_KEY = "employsi.anon"` |
| `user_key` is the lower-cased account email, shared across tables | `migrations/0005_app_event.sql` header |
| View counts feed the public leaderboard | `src/employsi/hooks/useViewTracking.ts`, `src/employsi/lib/viewsFn.ts` |
| Analyst questions go to Anthropic | `src/employsi/lib/analystLlmFn.ts` |
| Analyst rate limiting uses a hash of the IP, not the IP | `src/employsi/lib/analystLlmFn.ts` — `visitorKey()`; `llm_usage` stores `who` |
| Job archive holds no ad body text and no contact names | `workers/jobs-cron/migrations/0001_jobs_archive.sql` — the `jobs` columns |
| Career-movement data is pseudonymised to an HMAC | `scripts/brightdata-talent-flows.py` — `people.person_key`, "HMAC of the profile id; nothing else about the person" |
| No titles kept for career moves, only matched skills | same file — `skill_moves`, "No title: the matcher's answer is kept, the text is not" |
| Hosting is Cloudflare Workers + D1 + KV | `wrangler.jsonc`, `CLAUDE.md` |
| Mapbox serves map tiles from the browser | `src/employsi/components/WorldMapbox.tsx`, `VITE_MAPBOX_TOKEN` |

## Things the code does NOT currently support, which the policy therefore cannot claim

- **No retention or deletion job exists.** Nothing expires `app_event`, `llm_usage`,
  `views`, `jobs`, or the talent-flow tables. Section 8 of the draft lists these as
  decisions to make rather than describing a policy that is already enforced.
- **No account-deletion path exists in the app.** Section 10 promises deletion on
  request, which currently means a manual D1 operation. If you want to promise it,
  it should be built, or the wording should say it is handled manually.
- **No data-export path exists** for an access request. Same caveat.

## One weakness worth fixing, separate from the policy

`visitorKey()` in `analystLlmFn.ts` hashes `"employsi-llm|" + ip` with SHA-256 and
truncates to 12 bytes. The prefix is a fixed constant, not a secret, so the hash is
**brute-forceable**: the whole IPv4 space is 4.3 billion SHA-256 operations, which
is minutes on a GPU. Anyone who obtained the `llm_usage` table could recover the IP
addresses in it.

It is a small exposure — the table holds only a day and a count — but the fix is
cheap: hash with a secret salt held as a Worker secret (an HMAC, the same
construction `brightdata-talent-flows.py` already uses for `person_key`) instead of
a bare digest of a public prefix. That would make the claim in section 3.4 hold
against an attacker rather than only against a casual reader.
