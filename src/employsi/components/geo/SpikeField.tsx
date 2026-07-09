import type { CSSProperties } from 'react';
import type { SpikePoint } from '../../lib/heat';

// Soft, breathing radial "heat" blobs rendered inside the host map's SVG so
// they sit under the location dots, labels and hub markers. The whole field is
// blurred as one group, so overlapping blobs melt into a continuous density
// heat map. Ambient scatter fills the space between the brighter hub cores.
function pulse(i: number): CSSProperties {
  return {
    animationDuration: `${(2.8 + (i % 5) * 0.45).toFixed(2)}s`,
    animationDelay: `${((i % 7) * 0.31).toFixed(2)}s`,
  };
}

export function SpikeField({ ambient, hubs, blurId }: { ambient: SpikePoint[]; hubs: SpikePoint[]; blurId: string }) {
  if (!ambient.length && !hubs.length) return null;
  return (
    <g className="heatblobs" filter={`url(#${blurId})`}>
      {ambient.map((ap, i) => (
        <circle
          key={`amb-${i}`}
          className="heatblob"
          cx={ap.cx}
          cy={ap.cy}
          r={ap.r}
          style={{ fill: `rgba(${ap.color},0.45)`, ...pulse(i) }}
        />
      ))}
      {hubs.map((sp, i) => (
        <circle
          key={sp.id}
          className="heatblob heatblobhub"
          cx={sp.cx}
          cy={sp.cy}
          r={sp.r}
          style={{ fill: `rgba(${sp.color},0.66)`, ...pulse(i) }}
        >
          {sp.tooltip && <title>{sp.tooltip}</title>}
        </circle>
      ))}
    </g>
  );
}
