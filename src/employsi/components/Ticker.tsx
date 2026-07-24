import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TICKER_BASE, type TickerItem } from '../data/companies';
import { getLiveSkillTrends } from '../lib/jobHistoryFn';

function cloneBase(): TickerItem[] {
  return TICKER_BASE.map((d) => ({ ...d }));
}

export function Ticker({ hidden }: { hidden: boolean }) {
  // Real, market-wide skill-demand movers from the D1 job archive. Refreshes
  // once a day (the archive only changes on the daily cron); falls back to the
  // static seed while loading or before the archive has enough history.
  const { data: live } = useQuery({
    queryKey: ['liveSkillTrends'],
    queryFn: () => getLiveSkillTrends(),
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
  });

  const [items, setItems] = useState<TickerItem[]>(cloneBase);
  const dataRef = useRef<TickerItem[]>(items);
  // Anchor values = the real demand deltas; the gentle per-tick drift animates
  // around them so the ticker feels live without inventing fake magnitudes.
  const anchorRef = useRef<TickerItem[]>(cloneBase());

  // When the real data arrives, adopt it as the new anchor + baseline display.
  useEffect(() => {
    if (live && live.length) {
      const real = live.map((d) => ({ name: d.name, tag: d.tag, v: d.v }));
      anchorRef.current = real.map((d) => ({ ...d }));
      dataRef.current = real.map((d) => ({ ...d }));
      setItems(dataRef.current);
    }
  }, [live]);

  useEffect(() => {
    const id = setInterval(() => {
      const anchors = anchorRef.current;
      dataRef.current = dataRef.current.map((d, i) => {
        const anchor = anchors[i]?.v ?? d.v;
        // Drift by a small amount but stay within ±1.2 of the real anchor value.
        let v = d.v + (Math.random() - 0.5) * 0.4;
        if (v > anchor + 1.2) v = anchor + 1.2;
        if (v < anchor - 1.2) v = anchor - 1.2;
        if (v > 24) v = 24;
        if (v < -16) v = -16;
        return { ...d, v };
      });
      setItems(dataRef.current);
    }, 2400);
    return () => clearInterval(id);
  }, []);

  const renderItem = (t: TickerItem, key: string) => {
    const up = t.v >= 0;
    return (
      <div className="titem" key={key}>
        <span className="tname">{t.name}</span>
        <span className="ttag">{t.tag}</span>
        <span className={`tdelta ${up ? 'up' : 'down'}`}>
          <span className="ar">{up ? '▲' : '▼'}</span>
          {(up ? '+' : '') + t.v.toFixed(1)}%
        </span>
      </div>
    );
  };

  return (
    <div className={`ticker ${hidden ? 'zoomhide' : ''}`}>
      <div className="tickerlbl">
        <i />
        Live trends
      </div>
      <div className="tickerwrap">
        <div className="tickertrack">
          {items.map((t, i) => renderItem(t, 'a' + i))}
          {items.map((t, i) => renderItem(t, 'b' + i))}
        </div>
      </div>
    </div>
  );
}
