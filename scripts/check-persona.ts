/**
 * The admin "view as user" switch cannot escalate.
 *
 * lib/persona.ts lets an administrator on a preview host ask to be served as
 * an end user, and the signal is an UNSIGNED cookie the browser sets for
 * itself. That is safe for exactly one reason: the switch can only ever
 * DOWNGRADE. `effectiveRole` takes the role the server already derived from
 * the provider-verified email and may narrow it; no value of the cookie, on
 * any host, turns a "user" into an "admin".
 *
 * That property is the whole security argument, it is one edited line away
 * from being false, and nothing in the app would look wrong if it broke — an
 * escalation is invisible until someone uses it. Hence a guard.
 *
 * It also pins the host allow-list, because "where does this work" is the
 * other half of the argument: production must never offer the switch.
 */
import {
  PERSONA_COOKIE,
  effectiveRole,
  personaCookieSet,
  personaHostAllowed,
} from "../src/employsi/lib/persona";
import type { Role } from "../src/employsi/lib/roles";

let failures = 0;
function fail(msg: string): void {
  failures++;
  console.error(`  ✗ ${msg}`);
}

/**
 * Print a section's summary ONLY if that section passed.
 *
 * The first cut printed "host allow-list: production excluded" unconditionally,
 * so a run that had just proved production WAS exposed still said it was not.
 * A reassuring line under a failure is worse than no line.
 */
let seen = 0;
function section(label: string): void {
  if (failures === seen) console.log(`· ${label}`);
  else console.error(`· ${label} — ${failures - seen} FAILED above`);
  seen = failures;
}

// ── 1. Exhaustive: no input widens the role ────────────────────────────────
const ROLES: Role[] = ["user", "admin"];
let combos = 0;
for (const trueRole of ROLES) {
  for (const viewAsUser of [true, false]) {
    for (const hostAllowed of [true, false]) {
      const out = effectiveRole(trueRole, viewAsUser, hostAllowed);
      combos++;
      if (out !== "user" && out !== "admin") {
        fail(`effectiveRole returned ${String(out)} — not a Role`);
      }
      // The ONLY escalation that could exist in a two-role system.
      if (trueRole === "user" && out === "admin") {
        fail(
          `ESCALATION: a "user" became "admin" ` +
            `(viewAsUser=${viewAsUser}, hostAllowed=${hostAllowed})`,
        );
      }
    }
  }
}
section(`effectiveRole: ${combos} combinations, no escalation`);

// ── 2. The downgrade happens where it should, and only there ───────────────
const CASES: [Role, boolean, boolean, Role, string][] = [
  ["admin", true, true, "user", "admin + switch + preview → user"],
  ["admin", false, true, "admin", "admin without the switch stays admin"],
  ["admin", true, false, "admin", "admin + switch on a non-preview host stays admin"],
  ["user", true, true, "user", "a user stays a user"],
  ["user", false, false, "user", "a user with nothing set stays a user"],
];
for (const [role, view, host, want, label] of CASES) {
  const got = effectiveRole(role, view, host);
  if (got !== want) fail(`${label}: got "${got}", want "${want}"`);
}
section(`effectiveRole: ${CASES.length} intended outcomes`);

// ── 3. The host allow-list ─────────────────────────────────────────────────
// PRODUCTION MUST BE FALSE. If one of these ever flips, the switch becomes
// reachable on the live site.
const HOSTS: [string, boolean][] = [
  ["employsi-preview.employsi.workers.dev", true],
  ["employsi-site-preview.employsi.workers.dev", true],
  ["localhost", true],
  ["localhost:3000", true],
  ["127.0.0.1:3000", true],
  // Production and its neighbours.
  ["employsi.com.au", false],
  ["www.employsi.com.au", false],
  ["benridgwell-globe-gazer-hr.employsi.workers.dev", false],
  ["benridgwell-globe-gazer-hr-mobile.employsi.workers.dev", false],
  ["employsi.employsi.workers.dev", false],
  // Shapes that a looser rule would have admitted.
  ["evil-preview.attacker.com", false],
  ["employsi-preview.attacker.com", false],
  ["employsi-preview.employsi.workers.dev.attacker.com", false],
  ["", false],
];
for (const [host, want] of HOSTS) {
  const got = personaHostAllowed(host);
  if (got !== want) fail(`personaHostAllowed("${host}"): got ${got}, want ${want}`);
}
section(`host allow-list: ${HOSTS.length} hosts, production excluded`);

// ── 4. Cookie parsing is exact ─────────────────────────────────────────────
const COOKIES: [string, boolean][] = [
  [`${PERSONA_COOKIE}=user`, true],
  [`a=1; ${PERSONA_COOKIE}=user; b=2`, true],
  [` ${PERSONA_COOKIE}=user `, true],
  [`${PERSONA_COOKIE}=admin`, false],
  [`${PERSONA_COOKIE}=`, false],
  [`not_${PERSONA_COOKIE}=user`, false],
  [`${PERSONA_COOKIE}x=user`, false],
  ["", false],
  ["garbage", false],
];
for (const [cookie, want] of COOKIES) {
  const got = personaCookieSet(cookie);
  if (got !== want) fail(`personaCookieSet("${cookie}"): got ${got}, want ${want}`);
}
section(`cookie parsing: ${COOKIES.length} cases`);

if (failures) {
  console.error(`\ncheck-persona: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-persona: the persona switch can only downgrade, and only on a preview host.");
