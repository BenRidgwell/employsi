import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getFeedback,
  postFeedback,
  voteFeedback,
  setFeedbackStatus,
  deleteFeedback,
  type FeedbackItem,
  type FbStatus,
} from "../lib/feedbackFn";
import { useAppStore } from "../state/store";
import { EmploysiMark } from "../../components/EmploysiLogo";

// The feedback board: real requests from real people, stored in D1 and shared
// across everyone who opens the app. It starts EMPTY — there are no seeded
// requests with invented authors and vote counts.
//
// Posting and voting both require an account, and that is a real gate: the
// author of a post and the owner of a vote come from the session cookie, so the
// client never supplies an identity and cannot act as anyone else.
//
// Laid out to the supplied Feedback Board Popout: a 412px card pinned
// bottom-right, with a header, a tab row, a scrolling list and a composer
// footer. The design's seeded ideas are NOT carried over — only its structure
// and styling are.

const STATUS_LABEL: Record<FbStatus, string> = {
  open: "Open",
  "under-review": "Under review",
  planned: "Planned",
  shipped: "Shipped",
};

type Tab = "top" | "new" | "planned";
const TABS: { key: Tab; label: string }[] = [
  { key: "top", label: "Top voted" },
  { key: "new", label: "New" },
  { key: "planned", label: "Planned" },
];

function Chevron({ up }: { up?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {up ? <path d="m18 15-6-6-6 6" /> : <path d="m6 9 6 6 6-6" />}
    </svg>
  );
}

/**
 * "3d" / "1w" rather than a date, as the design shows.
 *
 * The board is read as a stream, and "2d" answers "is this current" at a
 * glance where 2026-07-30 needs arithmetic. Past a year it falls back to the
 * date, because "70w" is not a unit anyone reads.
 */
function ago(created: string): string {
  const t = Date.parse(created + "T00:00:00Z");
  if (Number.isNaN(t)) return created;
  const days = Math.max(0, Math.round((Date.now() - t) / 86400000));
  if (days < 1) return "today";
  if (days < 7) return `${days}d`;
  if (days < 365) return `${Math.round(days / 7)}w`;
  return created;
}

function Row({
  item,
  canVote,
  onVote,
  isAdmin,
  onStatus,
  onDelete,
}: {
  item: FeedbackItem;
  canVote: boolean;
  onVote: (id: string, dir: 1 | -1) => void;
  isAdmin: boolean;
  onStatus: (id: string, status: FbStatus) => void;
  onDelete: (id: string) => void;
}) {
  const mine = item.mine;
  return (
    <div className="fbrow">
      <div className="fbvote">
        <button
          type="button"
          className={`fbarrow up${mine === 1 ? " on" : ""}`}
          aria-label="Upvote"
          aria-pressed={mine === 1}
          disabled={!canVote}
          title={canVote ? "Upvote" : "Log in to vote"}
          onClick={() => onVote(item.id, 1)}
        >
          <Chevron up />
        </button>
        <span className={`fbscore${mine ? " on" : ""}`}>{item.score}</span>
        <button
          type="button"
          className={`fbarrow down${mine === -1 ? " on" : ""}`}
          aria-label="Downvote"
          aria-pressed={mine === -1}
          disabled={!canVote}
          title={canVote ? "Downvote" : "Log in to vote"}
          onClick={() => onVote(item.id, -1)}
        >
          <Chevron />
        </button>
      </div>

      <div className="fbrowbody">
        <span className="fbrowtitle">{item.title}</span>
        {/* Only when there is one. A request posted before the description
            field existed has a title and nothing else, and an empty grey line
            under it would read as detail that failed to load. */}
        {item.body && <span className="fbrowdesc">{item.body}</span>}
        <div className="fbrowmeta">
          <span className={`fbtag fbtag-${item.status}`}>{STATUS_LABEL[item.status]}</span>
          <span className="fbrowby">
            {item.own ? "You" : item.author} · {ago(item.created)}
          </span>
        </div>

        {/* Moderation. Hidden from end users, but hiding is only tidiness —
            setFeedbackStatus and deleteFeedback both re-check the role against
            the session cookie, so a crafted request is refused regardless of
            what the browser was showing. */}
        {isAdmin && (
          <div className="fbmod">
            <label className="fbmodlbl" htmlFor={`fbst-${item.id}`}>
              Status
            </label>
            <select
              id={`fbst-${item.id}`}
              className="fbmodsel"
              value={item.status}
              onChange={(e) => onStatus(item.id, e.target.value as FbStatus)}
            >
              {(Object.keys(STATUS_LABEL) as FbStatus[]).map((st) => (
                <option key={st} value={st}>
                  {STATUS_LABEL[st]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="fbmoddel"
              title="Remove this request and its votes"
              onClick={() => {
                // Deleting takes the votes with it and cannot be undone, so it
                // asks first — the control sits inches from a status dropdown
                // that is entirely reversible.
                if (confirm(`Remove "${item.title}"? This also deletes its votes.`))
                  onDelete(item.id);
              }}
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function FeedbackBoard({ onClose }: { onClose: () => void }) {
  const account = useAppStore((s) => s.account);
  const isAdmin = useAppStore((s) => s.role) === "admin";
  const openAuth = useAppStore((s) => s.openAuth);
  const [draft, setDraft] = useState("");
  const [detail, setDetail] = useState("");
  const [tab, setTab] = useState<Tab>("top");
  const [justSent, setJustSent] = useState(false);
  const [error, setError] = useState("");
  const qc = useQueryClient();

  // Keyed on the account, so signing in or out re-reads the board with (or
  // without) that account's own votes marked.
  const key = ["feedback", account?.id ?? ""];
  const { data: items, isPending } = useQuery({
    queryKey: key,
    queryFn: () => getFeedback(),
    staleTime: 30 * 1000,
    retry: false,
  });

  const post = useMutation({
    mutationFn: () => postFeedback({ data: { title: draft, body: detail } }),
    onSuccess: (r) => {
      if (!r.ok) {
        setError(r.error || "Couldn't post that.");
        return;
      }
      setError("");
      setDraft("");
      setDetail("");
      setJustSent(true);
      setTimeout(() => setJustSent(false), 2200);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: () => setError("Couldn't reach the board — try again."),
  });

  const cast = useMutation({
    mutationFn: (v: { id: string; dir: 1 | -1 }) =>
      voteFeedback({ data: { id: v.id, dir: v.dir } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });

  // Both refuse on the server for a non-admin; the UI only decides whether to
  // offer them. onError surfaces that refusal rather than silently no-op-ing,
  // so a stale browser that still thinks it is admin says so out loud.
  const moderate = useMutation({
    mutationFn: (v: { id: string; status: FbStatus }) =>
      setFeedbackStatus({ data: { id: v.id, status: v.status } }),
    onSuccess: (r) => {
      if (r?.ok) void qc.invalidateQueries({ queryKey: key });
      else setError(r?.error || "Couldn't update that.");
    },
    onError: () => setError("Couldn't update that."),
  });
  const remove = useMutation({
    mutationFn: (v: { id: string }) => deleteFeedback({ data: { id: v.id } }),
    onSuccess: (r) => {
      if (r?.ok) void qc.invalidateQueries({ queryKey: key });
      else setError(r?.error || "Couldn't remove that.");
    },
    onError: () => setError("Couldn't remove that."),
  });

  const list = useMemo(() => {
    const all = items ?? [];
    // "Top voted" and "New" SORT; "Planned" filters. An empty Planned tab is a
    // real answer — nothing has been picked up yet — and worth being able to
    // see rather than hiding the tab.
    if (tab === "top") return [...all].sort((a, b) => b.score - a.score);
    if (tab === "new")
      return [...all].sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0));
    return all.filter((i) => i.status === "planned" || i.status === "shipped");
  }, [items, tab]);

  const canPost = !!draft.trim() && !post.isPending;
  const initial = (account?.name || account?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="fbboard" role="dialog" aria-label="Feedback board">
      <div className="fbhd">
        <div className="fbhdleft">
          <EmploysiMark size={20} />
          <span className="fbhdtitle">Feedback board</span>
        </div>
        <button className="fbhdx" onClick={onClose} aria-label="Close">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      <div className="fbtabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`fbtab${tab === t.key ? " on" : ""}`}
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="fblist">
        {isPending ? (
          <div className="fbempty">
            <span className="fbemptytitle">Loading the board…</span>
          </div>
        ) : list.length ? (
          list.map((item) => (
            <Row
              key={item.id}
              item={item}
              canVote={!!account && !cast.isPending}
              onVote={(id, dir) => cast.mutate({ id, dir })}
              isAdmin={isAdmin}
              onStatus={(id, status) => moderate.mutate({ id, status })}
              onDelete={(id) => remove.mutate({ id })}
            />
          ))
        ) : (
          // A real empty state rather than invented requests. The wording is
          // per-tab, because "nothing is planned yet" and "nobody has posted
          // yet" are different facts, and one blank panel would state the wrong
          // one on two of the three tabs.
          <div className="fbempty">
            <span className="fbemptyicon" aria-hidden>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <span className="fbemptytitle">
              {tab === "planned" ? "Nothing planned yet" : "No ideas on the board yet"}
            </span>
            <span className="fbemptysub">
              {tab === "planned"
                ? "Requests move here once they are picked up."
                : account
                  ? "Post the first one — every request here is read."
                  : "Log in to post the first one."}
            </span>
          </div>
        )}
      </div>

      {account ? (
        <div className="fbcompose">
          <div className="fbcomposetop">
            <span className="fbavatar" aria-hidden>
              {initial}
            </span>
            <input
              className="fbtitleinput"
              placeholder="Idea title"
              value={draft}
              maxLength={140}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canPost) post.mutate();
              }}
            />
          </div>
          <textarea
            className="fbdetail"
            rows={2}
            maxLength={400}
            placeholder="Describe the problem it solves — one or two lines is plenty."
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
          <div className="fbcomposerow">
            {error ? (
              <span className="fbsent show fberr">{error}</span>
            ) : (
              <span className={`fbsent ${justSent ? "show" : ""}`}>✓ Posted — thanks!</span>
            )}
            <button className="fbsend" disabled={!canPost} onClick={() => post.mutate()}>
              {post.isPending ? "Posting…" : "Post idea"}
            </button>
          </div>
        </div>
      ) : (
        // Posting AND voting need an account, because both write to a shared
        // board — an anonymous vote on a durable score is just a click counter.
        <div className="fbsignedout">
          <div className="fbsignedouttext">
            <span className="fbsignedouttitle">Have a say in what gets built</span>
            <span className="fbsignedoutsub">Log in to vote and post ideas.</span>
          </div>
          <button
            className="fbsend"
            onClick={() => {
              onClose();
              openAuth();
            }}
          >
            Log in
          </button>
        </div>
      )}
    </div>
  );
}
