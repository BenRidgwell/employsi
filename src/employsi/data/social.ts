// Illustrative social engagement + sentiment summary per company (Reddit and
// X/Twitter mentions). Deterministic per company id so the numbers are stable
// across renders; not backed by a live feed.

export interface SocialSummary {
  redditMentions: number;
  redditDelta: number; // % change vs prior week
  xMentions: number;
  xDelta: number;
  positive: number; // percentages summing to 100
  neutral: number;
  negative: number;
  summary: string;
}

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}

function sentimentNote(positive: number, negative: number): string {
  if (positive - negative > 25) return 'Mostly positive chatter this week, led by hiring and expansion news.';
  if (negative - positive > 15) return 'Sentiment has cooled, with workplace and safety threads driving the negative share.';
  return 'Mixed, mostly neutral discussion — no single topic dominating the conversation.';
}

export function companySocial(id: string, growth: number): SocialSummary {
  const seed = seedOf(id);
  const r = (k: number) => ((seed + k * 7919) % 1000) / 1000;

  const redditMentions = 60 + Math.round(r(1) * 540);
  const xMentions = 200 + Math.round(r(2) * 2600);
  const redditDelta = +((r(3) - 0.5) * 30 + growth).toFixed(1);
  const xDelta = +((r(4) - 0.5) * 24 + growth * 0.6).toFixed(1);

  const positive = 28 + Math.round(r(5) * 34);
  const negative = 8 + Math.round(r(6) * 26);
  const neutral = Math.max(10, 100 - positive - negative);
  // Renormalise so the three shares sum to exactly 100.
  const total = positive + negative + neutral;
  const pos = Math.round((positive / total) * 100);
  const neg = Math.round((negative / total) * 100);
  const neu = 100 - pos - neg;

  return {
    redditMentions,
    redditDelta,
    xMentions,
    xDelta,
    positive: pos,
    neutral: neu,
    negative: neg,
    summary: sentimentNote(pos, neg),
  };
}
