import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "../../state/store";
import { COMPANIES, type Company } from "../../data/companies";
import { getTalentFlowMonths, getTalentFlowSkills, getTalentFlowView } from "../../lib/flowsFn";
import { WINDOW_CAVEAT, viewForWindow } from "../../lib/flows";
import { FLOW_BANDS, flowRows } from "../../lib/flowRows";
import { CardLoader } from "./CardLoader";
import { IconClose } from "../ActionIcons";
import { logoFor } from "../../lib/companyLogo";

/**
 * The talent-flow card: the right-hand panel of the "Talent Flows 3D" design,
 * kept as the design drew it. Layout, type, colours and spacing are copied
 * from the design's markup; only where each value comes from has changed.
 *
 * What each part shows, and why it is not the mock-up's number:
 *
 *   heading       per mode, as designed
 *   skill search  real skills only (getTalentFlowSkills: skills with a peer
 *                 at the 10-move floor); a name with no match changes nothing
 *   timeline      behaves as the skill card's (GlobalSearch): one handle,
 *                 starting at the latest month, a native range input over the
 *                 track, the fill running from the start to the handle, the
 *                 handle's month on the right, ticks darkening as it passes
 *                 them and the event card following it. It spans the
 *                 delivery's measured period (not the design's 2006–2026), and
 *                 what the fill shows is what is counted: every move from the
 *                 period's first month to the handle's, rebuilt from
 *                 flow_months by viewForWindow — never scaled. At the latest
 *                 month that is the whole period. Earlier months read lower
 *                 because the sample is today's employees (rule 11); the
 *                 footnote says so whenever the handle is not at the end. The
 *                 event card is an annotation and changes nothing.
 *   big number    moves, not "people": sampled moves, and says so
 *   rows          on-map companies at or over the floor, plus one "Other
 *                 companies" row holding everything else, so shares add up
 *                 to the total rather than to the part that is itemised
 *   outflow, net  only to/against companies whose own staff were sampled;
 *                 the footnote says so
 *
 * The map half of the design (its Leaflet mock-up) is not here: the arcs are
 * drawn on the app's own local Mapbox layer (PerthMapbox), from the same
 * FlowView, which this card puts in the store.
 */

const COMPANY_BY_ID: Record<string, Company> = Object.fromEntries(COMPANIES.map((c) => [c.id, c]));
const { LOW, MOD, HIGH } = FLOW_BANDS;

// The design's event cards, as dated annotations. They do not scale anything.
// Only the ones inside the measured window can be shown against it.
const EVENTS: [number, number, string, string][] = [
  [2020, 11, "Local rebound", "Pent-up demand drives rapid internal moves."],
  [2022, 3, "Labour shortage", "Record vacancies; offers and counter-offers escalate."],
  [2024, 6, "Energy transition", "Critical minerals and decarbonisation reshape hiring."],
];

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthOf = (iso: string) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)) });
const label = (y: number, m: number) => `${MON[m - 1]} ${y}`;

// What this card's fetch is actually doing: reading the collected career
// moves, resolving the employers in them to map companies, then totting up.
const LOAD_STAGES = [
  "Reading career moves",
  "Matching employers to the map",
  "Counting flows",
  "Almost there",
] as const;

/**
 * A row's badge: the company's logo, from the one place the app resolves
 * logos (lib/companyLogo.ts), in the design's 28px ring. Falls back to the
 * ticker — or the name's initials where there is none — if the image fails,
 * as the company card's badge does: initials beat a broken image.
 */
function RowLogo({ id, code, name }: { id: string | null; code: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const c = id ? COMPANY_BY_ID[id] : undefined;
  const text =
    code ||
    name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 3)
      .toUpperCase();
  return (
    <span
      style={{
        width: 28,
        height: 28,
        borderRadius: 999,
        border: "1px solid var(--border-subtle,#e5e5ea)",
        background: "#fff",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: "700 8.5px/1 'Mona Sans Variable','Mona Sans',system-ui,sans-serif",
      }}
    >
      {c && !failed ? (
        <img
          src={logoFor(c.id, c.domain, 64)}
          alt={c.name}
          loading="lazy"
          onError={() => setFailed(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            padding: 4,
            boxSizing: "border-box",
          }}
        />
      ) : (
        text
      )}
    </span>
  );
}

export function TalentFlowPane() {
  const open = useAppStore((s) => s.flowsOpen);
  const focus = useAppStore((s) => s.flowFocus);
  const mode = useAppStore((s) => s.flowMode);
  const skill = useAppStore((s) => s.flowSkill);
  const hover = useAppStore((s) => s.flowHover);
  const setMode = useAppStore((s) => s.setFlowMode);
  const setSkill = useAppStore((s) => s.setFlowSkill);
  const setHover = useAppStore((s) => s.setFlowHover);
  const setFocus = useAppStore((s) => s.setFlowFocus);
  const setFlowView = useAppStore((s) => s.setFlowView);
  const close = useAppStore((s) => s.closeFlows);
  const [q, setQ] = useState("");
  // The handle's month index, or null for the latest (where it starts).
  const [tlIdx, setTlIdx] = useState<number | null>(null);

  // One fetch per focus and skill: every month of its moves. Each window is
  // then built here, so the scrubber never waits on the network.
  const { data: monthly, isFetching: monthsFetching } = useQuery({
    queryKey: ["talentFlowMonths", focus, skill],
    queryFn: () => getTalentFlowMonths({ data: { id: focus, skill } }),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });
  // An import without monthly rows: the whole period only, as before.
  const { data: wholeView, isFetching: wholeFetching } = useQuery({
    queryKey: ["talentFlowView", focus, skill],
    queryFn: () => getTalentFlowView({ data: { id: focus, skill } }),
    enabled: open && monthly === null,
    staleTime: 10 * 60 * 1000,
  });
  const isFetching = monthsFetching || wholeFetching;
  const months = monthly?.months ?? [];
  const lastIdx = Math.max(0, months.length - 1);
  const handle = tlIdx === null ? lastIdx : Math.min(tlIdx, lastIdx);
  const win = monthly && months.length ? { from: months[0], to: months[handle] } : null;
  const view = useMemo(
    () => (monthly && win ? viewForWindow(monthly, focus, win.from, win.to) : (wholeView ?? null)),
    [monthly, focus, win?.from, win?.to, wholeView], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const windowed = !!monthly && handle < lastIdx;
  const { data: skills } = useQuery({
    queryKey: ["talentFlowSkills", focus],
    queryFn: () => getTalentFlowSkills({ data: { id: focus } }),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });

  // The map draws from the store, so it and this card can never disagree.
  useEffect(() => {
    if (open) setFlowView(view ?? null);
  }, [open, view, setFlowView]);
  useEffect(() => {
    if (!open) {
      setFlowView(null);
      setTlIdx(null);
    }
  }, [open, setFlowView]);
  // A new focus starts at company level: its skill list is its own.
  useEffect(() => {
    setQ(skill ?? "");
  }, [skill]);

  const firstLoad = open && !view && isFetching;

  const rows = useMemo(() => (view ? flowRows(view, mode) : []), [view, mode]);

  if (!open) return null;

  const name = view?.focus.name
    ? (COMPANY_BY_ID[focus]?.name ?? view.focus.name)
    : (COMPANY_BY_ID[focus]?.name ?? focus);
  const heading =
    mode === "in"
      ? `Where ${name} hires from`
      : mode === "out"
        ? `Where ${name}’s people go`
        : `Talent balance for ${name}`;

  const pick = () => {
    const qq = q.trim().toLowerCase();
    if (!qq) {
      setSkill(null);
      return;
    }
    const hit = (skills ?? []).find((s) => s.skill.toLowerCase().includes(qq));
    if (hit) {
      setSkill(hit.skill);
      setQ(hit.skill);
    }
  };

  // Timeline: the track spans the delivery; the fill is the window drawn.
  const whole = months.length
    ? { start: `${months[0]}-01`, end: `${months[months.length - 1]}-01` }
    : view?.period;
  const ps = whole ? monthOf(whole.start) : null;
  const pe = whole ? monthOf(whole.end) : null;
  const span = ps && pe ? Math.max(1, pe.y * 12 + pe.m - (ps.y * 12 + ps.m)) : 1;
  const inWindow =
    ps && pe
      ? EVENTS.filter(([y, m]) => y * 12 + m >= ps.y * 12 + ps.m && y * 12 + m <= pe.y * 12 + pe.m)
      : [];
  const we = win ? monthOf(`${win.to}-01`) : pe;
  // The event card: the latest event at or before the handle, as on the skill card.
  const ev = we ? inWindow.filter(([y, m]) => y * 12 + m <= we.y * 12 + we.m).pop() : undefined;
  const pct = (p: { y: number; m: number } | null) =>
    p && ps ? `${((p.y * 12 + p.m - (ps.y * 12 + ps.m)) / span) * 100}%` : "100%";

  const listed = rows.filter((r) => r.id !== null);
  const total = !view
    ? 0
    : mode === "in"
      ? view.totals.in
      : mode === "out"
        ? view.totals.out
        : listed.reduce((a, r) => a + r.n, 0);
  const shareBase = rows.reduce((a, r) => a + Math.abs(r.n), 0) || 1;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.n)));
  const big =
    mode === "net"
      ? `${total > 0 ? "+" : total < 0 ? "−" : ""}${Math.abs(total).toLocaleString("en-AU")}`
      : total.toLocaleString("en-AU");
  const nCos = listed.length;
  const bigLabel =
    mode === "in"
      ? `moves into ${name} from ${nCos} companies${view?.other.in.companies ? ` and ${view.other.in.companies.toLocaleString("en-AU")} others` : ""}`
      : mode === "out"
        ? `moves out to ${nCos} sampled ${nCos === 1 ? "company" : "companies"}`
        : `net moves against ${nCos} sampled ${nCos === 1 ? "company" : "companies"}`;

  const modes: ["in" | "out" | "net", string][] = [
    ["in", "Inflow"],
    ["out", "Outflow"],
    ["net", "Net"],
  ];

  return (
    <>
      <div className="tfmodes">
        {modes.map(([id, lbl]) => {
          const on = mode === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              style={{
                all: "unset",
                cursor: "pointer",
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 32,
                padding: "0 14px 0 11px",
                borderRadius: 999,
                font: "600 13px/1 'Mona Sans Variable','Mona Sans',system-ui,sans-serif",
                background: on ? "#1c1c1e" : "#fff",
                color: on ? "#fff" : "var(--text-secondary,#636366)",
                boxShadow: "0 1px 2px rgba(28,28,30,.12), 0 4px 12px rgba(28,28,30,.1)",
                transition: "background 200ms,color 200ms",
              }}
            >
              {id === "in" && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flex: "none" }}
                >
                  <path d="M17 7 7 17" />
                  <path d="M16 17H7V8" />
                </svg>
              )}
              {id === "out" && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flex: "none" }}
                >
                  <path d="M7 17 17 7" />
                  <path d="M8 7h9v9" />
                </svg>
              )}
              {id === "net" && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flex: "none" }}
                >
                  <path d="M7 4v16" />
                  <path d="m3 8 4-4 4 4" />
                  <path d="M17 20V4" />
                  <path d="m13 16 4 4 4-4" />
                </svg>
              )}
              {lbl}
              <span
                style={{
                  position: "absolute",
                  right: -4,
                  top: "50%",
                  width: 9,
                  height: 9,
                  marginTop: -4.5,
                  transform: "rotate(45deg)",
                  borderRadius: 2,
                  background: on ? "#1c1c1e" : "#fff",
                  transition: "background 200ms",
                }}
              />
            </button>
          );
        })}
      </div>

      <aside className="tfcard" aria-label="Talent flows">
        {/* What's Trending's loader, used the same way: over the card while a
            company's flows are first arriving, not on a refetch of data the
            card is already showing. */}
        {firstLoad && <CardLoader stages={LOAD_STAGES} />}
        <div
          style={{
            flex: "none",
            padding: "20px 20px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            borderBottom: "1px solid var(--border-subtle,#e5e5ea)",
          }}
        >
          {/* Title and close, set as the Career pathways card's: the shared
              round .paneclose at the right of the title row. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span
              style={{
                font: "600 20px/1.25 'Mona Sans Variable','Mona Sans',system-ui,sans-serif",
                letterSpacing: "-0.02em",
                textWrap: "pretty",
              }}
            >
              {heading}
            </span>
            <button type="button" className="paneclose" onClick={close} aria-label="Close">
              <IconClose />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                height: 48,
                padding: "0 6px 0 16px",
                boxSizing: "border-box",
                borderRadius: 999,
                border: "1px solid var(--border-subtle,#e5e5ea)",
                background: "#fff",
                boxShadow: "0 1px 2px rgba(28,28,30,.04), 0 6px 16px -6px rgba(28,28,30,.12)",
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--text-tertiary,#8e8e93)", flex: "none" }}
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") pick();
                }}
                list="tf-skills"
                placeholder={
                  skills && skills.length
                    ? "Search a skill by name, or describe it in your own words"
                    : "Skill search fills in as skill data is collected"
                }
                style={{
                  all: "unset",
                  flex: 1,
                  minWidth: 0,
                  textOverflow: "ellipsis",
                  font: "400 15px/1 'Mona Sans Variable','Mona Sans',system-ui,sans-serif",
                  color: "var(--text-tertiary,#8e8e93)",
                  fontSize: 12,
                }}
              />
              <datalist id="tf-skills">
                {(skills ?? []).map((s) => (
                  <option key={s.skill} value={s.skill} />
                ))}
              </datalist>
              <button
                type="button"
                className="tfsearch"
                onClick={pick}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  flex: "none",
                  height: 36,
                  padding: "0 16px",
                  borderRadius: 999,
                  background: "#1c1c1e",
                  color: "#fff",
                  font: "500 14px/36px 'Mona Sans Variable','Mona Sans',system-ui,sans-serif",
                  transition: "background 160ms, transform 110ms",
                }}
              >
                Search
              </button>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              paddingTop: 14,
              borderTop: "1px solid var(--border-subtle,#e5e5ea)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  font: "400 10px/1 'Inter',system-ui,sans-serif",
                  letterSpacing: ".14em",
                  color: "var(--text-tertiary,#8e8e93)",
                  whiteSpace: "nowrap",
                }}
              >
                {ps && pe
                  ? `TIMELINE · ${label(ps.y, ps.m).toUpperCase()} – ${label(pe.y, pe.m).toUpperCase()}`
                  : "TIMELINE"}
              </span>
              <span
                style={{
                  font: "400 14px/1 'Inter',system-ui,sans-serif",
                  fontVariantNumeric: "tabular-nums",
                  color: "#1c1c1e",
                  whiteSpace: "nowrap",
                }}
              >
                {we ? label(we.y, we.m) : ""}
              </span>
            </div>
            {/* The skill card's control: a native range input laid invisibly
                over the drawn track (.gstimerange), so drag, click, touch and
                the keyboard behave exactly as they do there. */}
            <div className="tftrack" style={{ position: "relative", height: 28 }}>
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: "50%",
                  height: 7,
                  marginTop: -3.5,
                  borderRadius: 999,
                  background: "var(--neutral-200,#e5e5ea)",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  top: "50%",
                  height: 7,
                  marginTop: -3.5,
                  borderRadius: 999,
                  background: "#1c1c1e",
                  width: pct(we),
                }}
              />
              {ps &&
                inWindow.map(([y, m]) => {
                  const past = !!we && y * 12 + m <= we.y * 12 + we.m;
                  return (
                    <span
                      key={`${y}-${m}`}
                      style={{
                        position: "absolute",
                        left: `${((y * 12 + m - (ps.y * 12 + ps.m)) / span) * 100}%`,
                        top: "50%",
                        width: 1,
                        height: 16,
                        marginTop: -8,
                        background: past ? "rgba(28,28,30,.55)" : "var(--border-strong,#c7c7cc)",
                      }}
                    />
                  );
                })}
              {months.length > 1 && (
                <input
                  type="range"
                  className="gstimerange"
                  min={0}
                  max={lastIdx}
                  step={1}
                  value={handle}
                  onChange={(e) => {
                    const i = Number(e.target.value);
                    setTlIdx(i >= lastIdx ? null : i);
                  }}
                  aria-label="Timeline month"
                  aria-valuetext={we ? label(we.y, we.m) : undefined}
                />
              )}
              <span
                className="tfknob"
                style={{
                  position: "absolute",
                  left: pct(we),
                  top: "50%",
                  width: 18,
                  height: 18,
                  transform: "translate(-50%,-50%)",
                  boxSizing: "border-box",
                  borderRadius: 999,
                  background: "#fff",
                  border: "1.5px solid #1c1c1e",
                  pointerEvents: "none",
                }}
              />
            </div>
            {ev && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto minmax(0,1fr)",
                  gap: 12,
                  alignItems: "start",
                  padding: "14px 16px",
                  borderRadius: 14,
                  background: "#fafafa",
                  border: "1px solid var(--border-subtle,#e5e5ea)",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    height: 22,
                    padding: "0 10px",
                    borderRadius: 999,
                    background: "#1c1c1e",
                    color: "#fff",
                    font: "400 10px/1 'Inter',system-ui,sans-serif",
                    letterSpacing: ".12em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label(ev[0], ev[1]).toUpperCase()}
                </span>
                <span
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    minWidth: 0,
                    paddingTop: 2,
                  }}
                >
                  <span
                    style={{
                      font: "600 14px/1.2 'Inter',system-ui,sans-serif",
                      letterSpacing: "-0.01em",
                      color: "#1c1c1e",
                    }}
                  >
                    {ev[2]}
                  </span>
                  <span
                    style={{
                      font: "400 12.5px/1.55 'Inter',system-ui,sans-serif",
                      color: "#8e8e93",
                      textWrap: "pretty",
                    }}
                  >
                    {ev[3]}
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            flex: "none",
            padding: "16px 20px",
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            borderBottom: "1px solid var(--border-subtle,#e5e5ea)",
          }}
        >
          <span
            style={{
              font: "600 36px/1 'Inter',system-ui,sans-serif",
              letterSpacing: "-0.03em",
              fontVariantNumeric: "tabular-nums",
              color:
                mode === "net" && total < 0
                  ? "var(--status-danger-fg)"
                  : "var(--text-primary,#1c1c1e)",
            }}
          >
            {view ? big : isFetching ? "" : "—"}
          </span>
          <span style={{ fontSize: 14, lineHeight: 1.35, color: "var(--text-secondary,#636366)" }}>
            {view
              ? bigLabel
              : isFetching
                ? ""
                : monthly && windowed
                  ? "No measured moves in this window"
                  : `No talent-flow data for ${name} yet`}
          </span>
        </div>

        <div
          style={{
            flex: "none",
            padding: "12px 20px 14px",
            borderBottom: "1px solid var(--border-subtle,#e5e5ea)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden" }}>
            <span style={{ flex: 1, background: "#e6f2ec" }} />
            <span style={{ flex: 1, background: "#f6ece0" }} />
            <span style={{ flex: 1, background: "#f8e9e9" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            {(
              [
                ["LOW", LOW],
                ["MODERATE", MOD],
                ["HIGH", HIGH],
              ] as const
            ).map(([t, c]) => (
              <span
                key={t}
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: 24,
                  padding: "0 12px",
                  borderRadius: 999,
                  background: c,
                  color: "#fff",
                  font: "500 11px/1 'Mona Sans Variable','Mona Sans',system-ui,sans-serif",
                  letterSpacing: ".1em",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        <div style={{ flex: "none", padding: "8px 12px" }}>
          {rows.map((r) => {
            const lbl =
              mode === "net" && r.n > 0
                ? `+${r.n}`
                : mode === "net" && r.n < 0
                  ? `−${-r.n}`
                  : r.n.toLocaleString("en-AU");
            return (
              <div
                key={r.id ?? "other"}
                onMouseEnter={() => r.id && setHover(r.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => r.id && setFocus(r.id)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "28px minmax(0,1fr) 40px",
                  alignItems: "center",
                  gap: 10,
                  padding: 8,
                  borderRadius: 10,
                  cursor: r.id ? "pointer" : "default",
                  background:
                    hover && hover === r.id ? "var(--surface-subtle,#f4f4f5)" : "transparent",
                  transition: "background 150ms",
                }}
              >
                <RowLogo key={r.id ?? "other"} id={r.id} code={r.code} name={r.name} />
                <span style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                  <span
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      font: "500 14px/1 'Mona Sans Variable','Mona Sans',system-ui,sans-serif",
                    }}
                  >
                    <span
                      style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                    >
                      {r.name}
                    </span>
                    <span
                      style={{
                        font: "500 11px/1 'Inter',system-ui,sans-serif",
                        color: "var(--text-tertiary,#8e8e93)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >{`${Math.round((Math.abs(r.n) / shareBase) * 100)}%`}</span>
                  </span>
                  <span
                    style={{
                      height: 4,
                      borderRadius: 999,
                      background: "var(--neutral-200,#e5e5ea)",
                      overflow: "hidden",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        height: "100%",
                        borderRadius: 999,
                        background: r.color,
                        width: `${Math.round((Math.abs(r.n) / max) * 100)}%`,
                        transition: "width 400ms cubic-bezier(.2,0,0,1)",
                      }}
                    />
                  </span>
                </span>
                <span
                  style={{
                    textAlign: "right",
                    font: "600 14px/1 'Inter',system-ui,sans-serif",
                    fontVariantNumeric: "tabular-nums",
                    color: r.color,
                  }}
                >
                  {lbl}
                </span>
              </div>
            );
          })}
        </div>

        {view && (
          <p className="tfnote">
            {view.caption}
            {mode !== "in" ? " Net is inflow minus outflow, for those companies only." : ""}
            {windowed ? ` ${WINDOW_CAVEAT}` : ""}
          </p>
        )}
      </aside>
    </>
  );
}
