import { useEffect, useRef, useState } from 'react';
import { TICKER_BASE, type TickerItem } from '../data/companies';

function cloneBase(): TickerItem[] {
  return TICKER_BASE.map((d) => ({ ...d }));
}

export function Ticker({ hidden }: { hidden: boolean }) {
  const [items, setItems] = useState<TickerItem[]>(cloneBase);
  const dataRef = useRef<TickerItem[]>(items);

  useEffect(() => {
    const id = setInterval(() => {
      dataRef.current = dataRef.current.map((d) => {
        let v = d.v + (Math.random() - 0.5) * 0.7;
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
