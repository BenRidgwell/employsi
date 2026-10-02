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
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.6-3.6" />
        </svg>
        {n} {n === 1 ? "role" : "roles"}
      </button>

      {open && (
        <div className="srpoplist" role="dialog" aria-label={`${skill} roles at ${companyName}`}>
          <div className="srpophd">
            <span className="srpoptitle">{skill}</span>
            <span className="srpopsub">
              {n} {n === 1 ? "ad" : "ads"} at {companyName} · {when}
            </span>
          </div>
          <div className="srpoprows">
            {roles.map((r, i) => {
              const inner = (
                <>
                  <span className="srpoprole">{r.title}</span>
                  <span className="srpopmeta">
                    {[r.location, r.salary].filter(Boolean).join(" · ") || r.source}
                  </span>
                </>
              );
              // A LINK ONLY WHERE THERE IS ONE. Several feeds give no url, and
              // an anchor with nowhere to go is a control that does nothing —
              // so those rows are plain text rather than dead links.
              return r.url ? (
                <a
                  key={`${r.title}-${i}`}
                  className="srpoprow"
                  href={r.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {inner}
                  <svg
                    className="srpopgo"
                    viewBox="0 0 24 24"
                    width="13"
                    height="13"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    aria-hidden
                  >
                    <path d="M7 17L17 7M9 7h8v8" />
                  </svg>
                </a>
              ) : (
                <span key={`${r.title}-${i}`} className="srpoprow">
                  {inner}
                </span>
              );
            })}
          </div>
          {/* The limit of what a list of ADS can say, on the surface that
              shows them rather than in a methodology note nobody opens. */}
          <p className="srpopfoot">
            Advertisements, not hires. One role carried on two boards is two rows — the same count
            the card shows.
          </p>
        </div>
      )}
    </div>
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
