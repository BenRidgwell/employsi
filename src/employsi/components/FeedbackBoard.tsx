import { useState } from "react";
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

// The feedback board: real requests from real people, stored in D1 and shared
// across everyone who opens the app. It starts EMPTY — the eight seeded
// requests with invented authors and vote counts are gone, along with the
// localStorage-only store that meant a visitor's own post was visible to nobody
// but themselves.
//
// Posting and voting both require an account, and that is now a real gate: the
// author of a post and the owner of a vote come from the session cookie, so the
// client never supplies an identity and cannot act as anyone else.

const STATUS_LABEL: Record<FbStatus, string> = {
  open: "Open",
  "under-review": "Under review",
  planned: "Planned",
  shipped: "Shipped",
};

function Arrow({ up }: { up?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {up ? <path d="M12 5v14M6 11l6-6 6 6" /> : <path d="M12 19V5M6 13l6 6 6-6" />}
    </svg>
  );
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
      <div className={`fbvote ${mine === 1 ? "up" : mine === -1 ? "down" : ""}`}>
        <button
          className="fbarrow"
          aria-label="Upvote"
          aria-pressed={mine === 1}
          disabled={!canVote}
          title={canVote ? "Upvote" : "Sign in to vote"}
          onClick={() => onVote(item.id, 1)}
        >
          <Arrow up />
        </button>
        <span className="fbscore">{item.score}</span>
        <button
          className="fbarrow"
          aria-label="Downvote"
          aria-pressed={mine === -1}
          disabled={!canVote}
          title={canVote ? "Downvote" : "Sign in to vote"}
          onClick={() => onVote(item.id, -1)}
        >
          <Arrow />
        </button>
      </div>
      <div className="fbrowbody">
        <div className="fbrowtitle">{item.title}</div>
        <div className="fbrowmeta">
          <span className={`fbtag fbtag-${item.status}`}>{STATUS_LABEL[item.status]}</span>
          <span className="fbrowby">
            {item.own ? "You" : item.author}
            {item.created ? ` · ${item.created}` : ""}
          </span>
        </div>
        {/* Moderation. Hidden from end users, but hiding is only tidiness —
            setFeedbackStatus and deleteFeedback both re-check the role against
            the session cookie, so a crafted request gets refused regardless of
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
    mutationFn: () => postFeedback({ data: { title: draft } }),
    onSuccess: (r) => {
      if (!r.ok) {
        setError(r.error || "Couldn't post that.");
        return;
      }
      setError("");
      setDraft("");
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

  const list = items ?? [];

  return (
    <div className="fbboard">
      <div className="helphd">
        <div>
          <div className="helptitle">Feedback board</div>
          <div className="helpsub">Suggest an idea, or vote on what others want</div>
        </div>
        <button className="helpx" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {account ? (
        <div className="fbcompose">
          <textarea
            className="fbtext"
            placeholder="Suggest a feature or improvement…"
            value={draft}
            maxLength={140}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim()) post.mutate();
            }}
          />
          <div className="fbcomposerow">
            {error ? (
              <span className="fbsent show fberr">{error}</span>
            ) : (
              <span className={`fbsent ${justSent ? "show" : ""}`}>✓ Posted — thanks!</span>
            )}
            <button
              className="fbsend"
              disabled={!draft.trim() || post.isPending}
              onClick={() => post.mutate()}
            >
              {post.isPending ? "Posting…" : "Post request"}
            </button>
          </div>
        </div>
      ) : (
        // Posting AND voting need an account now that both write to a shared
        // board — an anonymous vote on a durable score is just a click counter.
        <button
          className="fbsignin"
          onClick={() => {
            onClose();
            openAuth();
          }}
        >
          Sign in to post or vote
        </button>
      )}

      <div className="fblist">
        {isPending ? (
          <div className="fbempty">Loading the board…</div>
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
          // A real empty state rather than invented requests: nobody has asked
          // for anything yet, and saying so is the honest version.
          <div className="fbempty">
            No requests yet — {account ? "yours would be the first." : "sign in to post the first."}
          </div>
        )}
      </div>
    </div>
  );
}
