import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCompanySkillRoles } from "../../lib/jobHistoryFn";
import { activeSkill } from "../../lib/skillHeat";
import { useAppStore } from "../../state/store";
import { monthAt } from "../../lib/skillCard";

/**
 * "Show me the ads behind that number."
 *
 * Search a skill, open a company in a city, and the card tells you the
 * employer has N ads naming it. Until now that was the end of the road: the
 * figure was real and there was no way to see what it was made of. This is the
 * way in — a call-out beside the card that opens the actual titles.
 *
 * IT ONLY EXISTS WHEN A SKILL IS IN PLAY. With no skill searched there is no
 * number to explain, so the button is not rendered at all and the card is
 * exactly what it was before. The same goes for a company with no matching
 * ads: a button that opens an empty list is a worse answer than no button,
 * because it implies there is something to see.
 *
 * IT FOLLOWS THE SAME WINDOW THE PIN DOES. The count on the card comes from
 * demandByCompanyAt (skillHeat.ts), which reads the SCRUBBED MONTH when the
 * timeline is on a covered one and the live rows otherwise. Both branches are
 * passed through to the handler, so a list opened under a pin showing August
 * is August's ads. Getting this wrong would not look like a bug — it would
 * look like a list that quietly disagrees with the number above it, which is
 * the failure this whole card is built to avoid.
 *
 * WHAT IT DOES NOT CLAIM. These are advertisements, not headcount and not
 * hires: the same role carried on two boards is two rows in the archive (the
 * dedupe is per source — see jobArchive.ts), so the list can hold two lines
 * that are plainly the same job. That is said on the panel rather than quietly
 * de-duplicated here, because collapsing them would make this list disagree
 * with the count it exists to explain.
 */

export function SkillRolesPopout({
  companyId,
  companyName,
  city,
}: {
  companyId: string;
  companyName: string;
  city: string;
}) {
  const [open, setOpen] = useState(false);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const heatMonth = useAppStore((s) => s.heatMonth);
  const skillMonths = useAppStore((s) => s.skillMonths);
  const skill = activeSkill(searchQuery);

  // The same two branches demandByCompanyAt takes. `covered` is whether the
  // archive holds the scrubbed month at all; when it does not, the pin shows
  // live figures and so must this.
  const monthIso = monthAt(heatMonth);
  const covered = !!monthIso && !!skillMonths?.months.includes(monthIso);
  const month = covered ? monthIso : "";

  // A new company, city, skill or month is a new question. Collapsing first
  // stops the panel showing one company's roles under another's name for the
  // frame before the next answer lands.
  useEffect(() => setOpen(false), [companyId, city, skill, month]);

  const { data, isPending } = useQuery({
    queryKey: ["skill-roles", companyId, city, skill, month],
    queryFn: () => getCompanySkillRoles({ data: { companyId, hub: city, skill: skill!, month } }),
    enabled: !!skill && !!companyId && !!city,
    staleTime: 5 * 60 * 1000,
  });

  const roles = data?.roles ?? [];
  // Nothing is shown until the answer is in. A button that appears and then
  // vanishes once the count comes back as zero is worse than one that arrives
  // a moment late.
  if (!skill || isPending || !roles.length) return null;

  const n = roles.length;
  const when = data?.dated ? monthLabel(data.asOf) : "advertised now";

  return (
    <div className="srpop">
      <button
        type="button"
        className={`srpopbtn${open ? " on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {/* The design's two layers behind the pill: a ring that scales out and
            a glow that breathes. Both are absolutely positioned at z-index -1
            under `isolation: isolate`, so they cannot take layout space in a
            flex row that sits beside a card — a halo that occupied width would
            push the card sideways. */}
        <span className="srpopring" aria-hidden />
        <span className="srpopglow" aria-hidden />
        <IconSearch />
        {n} {n === 1 ? "role" : "roles"}
      </button>

      {open && (
        <div className="srpoplist" role="dialog" aria-label={`${skill} roles at ${companyName}`}>
          <div className="srpophd">
            <div className="srpophdmain">
              <span className="srpoptitle">{skill}</span>
              {/* The design's second line is the company. The WINDOW is added
                  to it because this list follows the timeline handle, and a
                  list of August ads under a card headed only by a company name
                  would not say which August it meant. */}
              <span className="srpopsub">
                {companyName} · {when}
              </span>
            </div>
            {/* ONE TONE, NOT A TRAFFIC LIGHT. The mock carries low/medium/high
                colour variants whose text is identical in all three — it is
                showing the component's swatches, not asserting a rule, and
                there is no banding of "ads at one employer" this product can
                back. Inventing thresholds to light it amber would be a
                judgement with no source, so it stays on the design's default.
                The word is the design's own and carries the caveat the list
                needs: these are ADVERTISEMENTS. */}
            <span
              className="srpopcount"
              title="Advertisements, not hires. One role carried on two boards is two rows — the same count the card shows."
            >
              <span className="srpopdot" aria-hidden />
              {n} {n === 1 ? "Advertisement" : "Advertisements"}
            </span>
          </div>
          <div className="srpoprows">
            {roles.map((r, i) => {
              const chips = (
                <span className="srpopchips">
                  {!!r.location && (
                    <span className="srpopchip">
                      <IconPin />
                      {r.location}
                    </span>
                  )}
                  {!!r.salary && <span className="srpopchip">{r.salary}</span>}
                  {/* Where neither was collected the source is still something
                      true to say, rather than an empty row of chips. */}
                  {!r.location && !r.salary && !!r.source && (
                    <span className="srpopchip">{r.source}</span>
                  )}
                </span>
              );
              const body = (
                <>
                  <span className="srpoprowtop">
                    <span className="srpoprole">{r.title}</span>
                    {!!r.url && <IconGo />}
                  </span>
                  {chips}
                </>
              );
              // A LINK ONLY WHERE THERE IS ONE. Several feeds give no url, and
              // an anchor with nowhere to go is a control that does nothing —
              // so those rows are plain, and keep the arrow off too.
              return r.url ? (
                <a
                  key={`${r.title}-${i}`}
                  className="srpoprow"
                  href={r.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {body}
                </a>
              ) : (
                <span key={`${r.title}-${i}`} className="srpoprow">
                  {body}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** lucide `search`, at the design's 17px. */
function IconSearch() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

/** lucide `arrow-up-right`, at the design's 18px. */
function IconGo() {
  return (
    <svg
      className="srpopgo"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M7 7h10v10M7 17 17 7" />
    </svg>
  );
}

/** lucide `map-pin`, at the design's 12px. */
function IconPin() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

/** "2026-08" → "August 2026". The panel says which month it is showing, and a
 *  raw "2026-08" beside a company name reads as an id rather than a date. */
function monthLabel(iso: string): string {
  const [y, m] = iso.split("-");
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const name = names[Number(m) - 1];
  return name ? `${name} ${y}` : iso;
}
