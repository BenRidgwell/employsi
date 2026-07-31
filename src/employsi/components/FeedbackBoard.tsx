import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getFeedback,
  postFeedback,
  voteFeedback,
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
// Posting and voting both require an account. That gate is enforced in the UI
// and the handlers refuse a request with no email, but the app has no real
// authentication yet (see the note in lib/feedbackFn.ts) — so it shapes the
// flow rather than securing it.

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
}: {
  item: FeedbackItem;
  canVote: boolean;
  onVote: (id: string, dir: 1 | -1) => void;
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
      </div>
    </div>
  );
}

export function FeedbackBoard({ onClose }: { onClose: () => void }) {
  const account = useAppStore((s) => s.account);
  const openAuth = useAppStore((s) => s.openAuth);
  const [draft, setDraft] = useState("");
  const [justSent, setJustSent] = useState(false);
  const [error, setError] = useState("");
  const qc = useQueryClient();
  const email = account?.email;

  // Keyed on the account, so signing in or out re-reads the board with (or
  // without) that account's own votes marked.
  const key = ["feedback", email ?? ""];
  const { data: items, isPending } = useQuery({
    queryKey: key,
    queryFn: () => getFeedback({ data: { email } }),
    staleTime: 30 * 1000,
    retry: false,
  });

  const post = useMutation({
    mutationFn: () => postFeedback({ data: { title: draft, name: account?.name, email } }),
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
      voteFeedback({ data: { id: v.id, dir: v.dir, email } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
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
