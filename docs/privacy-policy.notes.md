# Where the privacy policy's claims come from

Companion to `privacy-policy.md`, which is the short principles-style policy we
publish. A long-form version was drafted first and retired in favour of it; it is
in git history at `f620a7d` (`docs/privacy-policy.draft.md`) if the detail is ever
wanted for a due-diligence questionnaire or a DPA.

## Before publishing: the contact address must actually receive

The policy names **privacy@employsi.com.au**. Measured 2026-09-29, the domain has
**no MX records**, so that address bounces. Cloudflare Email Routing (free,
receive-only) is the chosen route and has to be enabled in the dashboard before
the policy goes live — a published policy naming a bouncing privacy address is
worse than one carrying a placeholder, because it is a promise that fails silently.

The domain's mail DNS is currently, and deliberately, locked against sending:

```
MX      (none)
TXT     v=spf1 -all                                  ← nobody may send as the domain
_dmarc  v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s
```

**Email Routing needs none of that changed.** Forwarding is a receiving function;
Cloudflare re-sends to the destination mailbox under its own domain, so `-all` and
`p=reject` stay intact and the domain stays unspoofable. Leave both alone. They
only come into play if outbound sending is ever added, and the strict alignment
(`adkim=s`) is stricter than most relays' defaults — see the option-3 notes in the
conversation, or re-derive before touching it.

Replies will come from whatever mailbox the address forwards to, not from
@employsi.com.au. That is cosmetic, not a compliance problem.

## Still to decide before publishing

- **Entity name, ABN, last-updated date** — the remaining `[CONFIRM]` markers.
- **Retention periods.** The policy says we keep information "only as long as
  necessary" and names the one limit that actually exists (30-day sessions). No
  retention or deletion job exists for anything else — see below.
- **Career-movement data (the pseudonymised career-flow records) needs legal
  advice.** Pseudonymised data derived from identifiable source records may still
  be personal information under the Privacy Act 1988 (Cth), and collecting it may
  engage APP 5 notification obligations that are impractical for people we never
  contact. The design reduces that risk — one-way key, no names, titles, links or
  free text — but does not remove it. This is the highest-risk part of the product
  from a privacy standpoint and the policy's wording on it should be reviewed
  rather than taken as settled.
- **Cookie consent banner** — our view is the sign-in cookie is strictly necessary
  and the local-storage items are not cross-site tracking, but take advice if you
  intend to market into the EU or UK.
- **Whether to name the third-party data provider** behind the career-movement
  collection. The short policy does not; a longer one would have to.

 Every factual claim in that document was
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

## The visitor-key weakness — found here, now fixed

**Was:** `visitorKey()` in `analystLlmFn.ts` digested `"employsi-llm|" + ip` with
bare SHA-256. The prefix is a fixed public constant, so the value concealed
nothing: the whole IPv4 space is 4.3 billion digests, minutes on a GPU, and anyone
holding the `llm_usage` table could recover every address in it. The function's own
comment already described the value as "salted", which it was not.

**Now:** HMAC-SHA-256 under a Worker secret, with the day inside the signed
message. Measured against the change:

| Attack | Old | New |
| --- | --- | --- |
| Scan a /24 with no secret | recovers the address | recovers nothing |
| 10,000 guessed salts | n/a | recovers nothing |
| Scan holding the real secret | recovers | **recovers** — inherent to a keyed hash |

That last row is worth stating rather than hiding: HMAC does not make an IP
unguessable to someone who holds the key, it makes the stored table useless on its
own. The fix removes "the table alone is enough", which was the actual exposure.

The day is in the signed message, not only in the table's primary key, so one
address keys differently each day and a stolen table cannot be used to follow a
visitor across dates even by a key holder.

**Secret:** `LLM_VISITOR_SALT`, preferred; `BETTER_AUTH_SECRET` is accepted as a
fallback because it is already set wherever the app runs. With neither, the
function returns a single shared bucket rather than a weak key — the per-visitor
cap degrades to a collective one and heavy use reaches the free rule-based router
sooner, which is this feature's designed way to fail. **The secret is not yet set
on any Worker**, so production is currently running on the `BETTER_AUTH_SECRET`
fallback. To set the dedicated one:

```bash
npx wrangler secret put LLM_VISITOR_SALT --name benridgwell-globe-gazer-hr
npx wrangler secret put LLM_VISITOR_SALT --name employsi-preview
```

and remember a secret is not live until its version is deployed (CLAUDE.md).

Guarded by `scripts/check-analyst-llm.ts`, which asserts the construction against
the source — HMAC present, no `crypto.subtle.digest`, the day inside the message,
and the shared-bucket fallback ahead of any signing. Both regressions were proved
to fail it.
