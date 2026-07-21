import { create } from 'zustand';

// A lightweight, self-contained store for the feedback board. Like the auth
// store there's no backend: seeded requests live in code, and the visitor's own
// submissions + votes persist in localStorage so they survive a reload.

export type FbStatus = 'open' | 'under-review' | 'planned' | 'shipped';

export interface FeedbackItem {
  id: string;
  title: string;
  author: string;
  votes: number; // baseline score before the current visitor's own vote
  status: FbStatus;
  ts: number; // created (ms)
  mine?: boolean; // submitted by the current visitor
}

// Seeded community requests, so the board feels populated on first open.
const SEED: FeedbackItem[] = [
  { id: 's1', title: 'Add Brisbane and Adelaide employers to the local city map', author: 'Priya S.', votes: 128, status: 'planned', ts: Date.parse('2026-05-02') },
  { id: 's2', title: 'Export salary + headcount benchmarks to CSV', author: 'Marcus T.', votes: 94, status: 'under-review', ts: Date.parse('2026-05-19') },
  { id: 's3', title: 'Compare more than two companies side by side', author: 'Dana W.', votes: 76, status: 'open', ts: Date.parse('2026-06-01') },
  { id: 's4', title: 'Email alerts when a followed company opens new roles', author: 'Leah K.', votes: 61, status: 'planned', ts: Date.parse('2026-06-08') },
  { id: 's5', title: 'Filter companies by graduate-program intake', author: 'Sam O.', votes: 47, status: 'open', ts: Date.parse('2026-06-14') },
  { id: 's6', title: 'A full dark mode for the whole app, not just the map', author: 'Chris R.', votes: 39, status: 'under-review', ts: Date.parse('2026-06-21') },
  { id: 's7', title: 'Show visa-sponsorship availability on the company card', author: 'Nadia F.', votes: 33, status: 'open', ts: Date.parse('2026-06-27') },
  { id: 's8', title: 'Live share-price ticker across all listed companies', author: 'Employsi', votes: 58, status: 'shipped', ts: Date.parse('2026-04-11') },
];

const LS_KEY = 'employsi.feedback';
interface Persisted {
  submissions: FeedbackItem[];
  votes: Record<string, 1 | -1>;
}
function load(): Persisted {
  if (typeof localStorage === 'undefined') return { submissions: [], votes: {} };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { submissions: [], votes: {} };
    const p = JSON.parse(raw) as Partial<Persisted>;
    return {
      submissions: Array.isArray(p.submissions) ? p.submissions : [],
      votes: p.votes && typeof p.votes === 'object' ? p.votes : {},
    };
  } catch {
    return { submissions: [], votes: {} };
  }
}
function save(p: Persisted): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* private-mode / quota — non-fatal */
  }
}

const loaded = load();

interface FeedbackState {
  items: FeedbackItem[];
  votes: Record<string, 1 | -1>;
  submit: (title: string) => void;
  // Clicking the same direction again clears the vote (toggle).
  vote: (id: string, dir: 1 | -1) => void;
}

// Displayed score = baseline + the visitor's own ±1 (if any).
export function scoreOf(item: FeedbackItem, votes: Record<string, 1 | -1>): number {
  return item.votes + (votes[item.id] ?? 0);
}

export const useFeedbackStore = create<FeedbackState>((set) => ({
  items: [...SEED, ...loaded.submissions],
  votes: loaded.votes,

  submit: (title) =>
    set((s) => {
      const t = title.trim();
      if (!t) return s;
      const item: FeedbackItem = {
        id: 'u' + Date.now().toString(36),
        title: t.slice(0, 140),
        author: 'You',
        votes: 1, // the author implicitly backs their own request
        status: 'open',
        ts: Date.now(),
        mine: true,
      };
      const submissions = [...loaded.submissions, item];
      const votes = { ...s.votes, [item.id]: 1 as const };
      save({ submissions, votes });
      loaded.submissions = submissions;
      return { items: [...s.items, item], votes };
    }),

  vote: (id, dir) =>
    set((s) => {
      const cur = s.votes[id];
      const votes = { ...s.votes };
      if (cur === dir) delete votes[id]; // toggle off
      else votes[id] = dir;
      save({ submissions: loaded.submissions, votes });
      return { votes };
    }),
}));
