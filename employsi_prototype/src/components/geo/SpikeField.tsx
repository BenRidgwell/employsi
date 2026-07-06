import type { SpikePoint } from '../../lib/heat';

export function SpikeField({ ambient, hubs }: { ambient: SpikePoint[]; hubs: SpikePoint[] }) {
  return (
    <div className="auspikes">
      {ambient.map((ap, i) => (
        <div key={i} className="auspike3d auspikeamb" style={{ left: `${ap.leftPct}%`, top: `${ap.topPct}%` }}>
          <div className="auspikecone" style={{ height: `${ap.heightPx}px`, width: `${ap.widthPx}px`, background: ap.gradient }} />
        </div>
      ))}
      {hubs.map((sp) => (
        <div key={sp.id} className="auspike3d" style={{ left: `${sp.leftPct}%`, top: `${sp.topPct}%` }} title={sp.tooltip}>
          <div className="auspikecone" style={{ height: `${sp.heightPx}px`, width: `${sp.widthPx}px`, background: sp.gradient }} />
        </div>
      ))}
    </div>
  );
}
