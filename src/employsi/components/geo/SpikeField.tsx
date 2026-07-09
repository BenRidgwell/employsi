import type { CSSProperties } from 'react';
import type { SpikePoint } from '../../lib/heat';

// Soft, breathing radial "heat" blobs — sized by demand magnitude (heightPx)
// and coloured by the red→amber→green ramp. Hubs read as bright cores, the
// ambient scatter fills the space between them so the field looks like a
// continuous density heat map rather than discrete markers.
function blobStyle(sp: SpikePoint, size: number, i: number, peak: number): CSSProperties {
  const c = sp.color;
  return {
    left: `${sp.leftPct}%`,
    top: `${sp.topPct}%`,
    width: `${size}px`,
    height: `${size}px`,
    background: `radial-gradient(circle at center, rgba(${c},${peak}) 0%, rgba(${c},${(peak * 0.55).toFixed(2)}) 40%, rgba(${c},0) 72%)`,
    animationDuration: `${(2.8 + (i % 5) * 0.45).toFixed(2)}s`,
    animationDelay: `${((i % 7) * 0.31).toFixed(2)}s`,
  };
}

export function SpikeField({ ambient, hubs }: { ambient: SpikePoint[]; hubs: SpikePoint[] }) {
  return (
    <div className="auspikes">
      {ambient.map((ap, i) => (
        <div key={`amb-${i}`} className="heatblob" style={blobStyle(ap, 18 + ap.heightPx * 1.8, i, 0.4)} />
      ))}
      {hubs.map((sp, i) => (
        <div
          key={sp.id}
          className="heatblob heatblobhub"
          style={blobStyle(sp, 36 + sp.heightPx * 1.05, i, 0.62)}
          title={sp.tooltip}
        />
      ))}
    </div>
  );
}
