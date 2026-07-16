import { useMemo, useState } from 'react';
import { useFeedbackStore, scoreOf, type FeedbackItem, type FbStatus } from '../state/feedbackStore';
import { useAppStore } from '../state/store';

// The feedback board: a votable list of feature requests (seeded + the
// visitor's own submissions), plus a box to add a new one. Requests sort by
// score, so the most-wanted rise to the top.

const STATUS_LABEL: Record<FbStatus, string> = {
  open: 'Open',
  'under-review': 'Under review',
  planned: 'Planned',
  shipped: 'Shipped',
};

function Arrow({ up }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      {up ? <path d="M12 5v14M6 11l6-6 6 6" /> : <path d="M12 19V5M6 13l6 6 6-6" />}
    </svg>
  );
}

function Row({ item }: { item: FeedbackItem }) {
  const votes = useFeedbackStore((s) => s.votes);
  const vote = useFeedbackStore((s) => s.vote);
  const mine = votes[item.id];
  const score = scoreOf(item, votes);
  return (
    <div className="fbrow">
      <div className={`fbvote ${mine === 1 ? 'up' : mine === -1 ? 'down' : ''}`}>
        <button className="fbarrow" aria-label="Upvote" aria-pressed={mine === 1} onClick={() => vote(item.id, 1)}>
          <Arrow up />
        </button>
        <span className="fbscore">{score}</span>
        <button className="fbarrow" aria-label="Downvote" aria-pressed={mine === -1} onClick={() => vote(item.id, -1)}>
          <Arrow />
        </button>
      </div>
      <div className="fbrowbody">
        <div className="fbrowtitle">{item.title}</div>
        <div className="fbrowmeta">
          <span className={`fbtag fbtag-${item.status}`}>{STATUS_LABEL[item.status]}</span>
        </div>
      </div>
    </div>
  );
}

export function FeedbackBoard({ onClose }: { onClose: () => void }) {
  const items = useFeedbackStore((s) => s.items);
  const votes = useFeedbackStore((s) => s.votes);
  const submit = useFeedbackStore((s) => s.submit);
  const account = useAppStore((s) => s.account);
  const openAuth = useAppStore((s) => s.openAuth);
  const [draft, setDraft] = useState('');
  const [justSent, setJustSent] = useState(false);

  const ranked = useMemo(
    () => [...items].sort((a, b) => scoreOf(b, votes) - scoreOf(a, votes) || b.ts - a.ts),
    [items, votes],
  );

  const send = () => {
    if (!account || !draft.trim()) return;
    submit(draft);
    setDraft('');
    setJustSent(true);
    setTimeout(() => setJustSent(false), 2200);
  };

  return (
    <div className="fbboard">
      <div className="helphd">
        <div>
          <div className="helptitle">Feedback board</div>
          <div className="helpsub">Suggest an idea, or vote on what others want</div>
        </div>
        <button className="helpx" onClick={onClose} aria-label="Close">✕</button>
      </div>

      {account ? (
        <div className="fbcompose">
          <textarea
            className="fbtext"
            placeholder="Suggest a feature or improvement…"
            value={draft}
            maxLength={140}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
            }}
          />
          <div className="fbcomposerow">
            <span className={`fbsent ${justSent ? 'show' : ''}`}>✓ Added — thanks!</span>
            <button className="fbsend" disabled={!draft.trim()} onClick={send}>Post request</button>
          </div>
        </div>
      ) : (
        // Submitting a request requires an account; voting stays open to all.
        <button className="fbsignin" onClick={() => { onClose(); openAuth(); }}>
          Sign in to post a request
        </button>
      )}

      <div className="fblist">
        {ranked.map((item) => (
          <Row key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
