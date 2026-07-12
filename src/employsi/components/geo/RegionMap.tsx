import { GLOBAL_LAND_PATHS } from '../../data/geoPaths';
import { GLOBAL_HUB_XY, GLOBAL_HUB_LABEL, cityMatchesSectors } from '../../data/geo';
import type { HeatDisc } from '../../lib/color';
import type { SpikePoint } from '../../lib/heat';
import { SpikeField } from './SpikeField';
import { Plane } from './Plane';

const PLANE_DURS = ['19s', '23s', '27s', '21s'];
const PLANE_BEGINS = ['0s', '5s', '9s', '3s'];

// Decorative flight arcs linking a region's hubs, mirroring Australia's FIFO
// routes. Built from the already-projected hub positions so they sit on the
// map, arcing up between consecutive hubs (capped so busy regions don't clutter).
function planeRoutes(pts: [number, number][]): { dur: string; begin: string; path: string }[] {
  const routes: { dur: string; begin: string; path: string }[] = [];
  for (let i = 0; i + 1 < pts.length && i < 4; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const lift = Math.min(70, Math.hypot(bx - ax, by - ay) * 0.3) + 10;
    routes.push({
      dur: PLANE_DURS[i % PLANE_DURS.length],
      begin: PLANE_BEGINS[i % PLANE_BEGINS.length],
      path: `M${ax.toFixed(0)},${ay.toFixed(0)} Q${mx.toFixed(0)},${(my - lift).toFixed(0)} ${bx.toFixed(0)},${by.toFixed(0)}`,
    });
  }
  return routes;
}

// Generic regional domestic view: the world land paths zoomed into a region so
// its hubs are comfortably visible, mapped into the same 500x260 space as the
// global map so marker/heat sizes match. Water fills the whole screen and the
// coastlines use the same weight as the Australia view.

type Anchor = 'start' | 'middle' | 'end';
interface RegionCfg {
  hubs: string[];
  x0: number;
  y0: number;
  w: number; // source-box width (height derived from the 500:260 aspect)
  label: string;
  labelX: number;
  labelY: number;
  offsets: Record<string, { dx: number; dy: number; anchor: Anchor }>;
}

export const REGIONS: Record<string, RegionCfg> = {
  asia: {
    // Box widened + shifted west so every Asian global hub is in frame:
    // Dubai (far west) through Tokyo (far north-east), plus Hong Kong.
    hubs: ['dubai', 'ganzhou', 'hongkong', 'singapore', 'tokyo'],
    x0: 300,
    y0: 77,
    w: 210,
    label: 'ASIA',
    labelX: 70,
    labelY: 40,
    offsets: {
      dubai: { dx: 0, dy: 14, anchor: 'middle' },
      singapore: { dx: 0, dy: 16, anchor: 'middle' },
      ganzhou: { dx: 8, dy: 2, anchor: 'start' },
      hongkong: { dx: 8, dy: 2, anchor: 'start' },
      tokyo: { dx: 0, dy: -11, anchor: 'middle' },
    },
  },
  northamerica: {
    hubs: ['denver', 'toronto', 'houston', 'newyork', 'sanfrancisco', 'chicago'],
    x0: 20,
    y0: 66,
    w: 110,
    label: 'NORTH AMERICA',
    labelX: 250,
    labelY: 34,
    offsets: {
      denver: { dx: 0, dy: 16, anchor: 'middle' },
      toronto: { dx: 0, dy: -11, anchor: 'middle' },
      houston: { dx: -8, dy: 4, anchor: 'end' },
      newyork: { dx: 8, dy: 4, anchor: 'start' },
      sanfrancisco: { dx: 8, dy: 4, anchor: 'start' },
      chicago: { dx: -8, dy: 4, anchor: 'end' },
    },
  },
  africa: {
    hubs: ['lubumbashi', 'johannesburg'],
    x0: 220,
    y0: 150,
    w: 130,
    label: 'AFRICA',
    labelX: 250,
    labelY: 38,
    offsets: {
      lubumbashi: { dx: 0, dy: -11, anchor: 'middle' },
      johannesburg: { dx: 0, dy: -11, anchor: 'middle' },
    },
  },
  europe: {
    hubs: ['london', 'zurich', 'geneva'],
    x0: 190,
    y0: 35,
    w: 100,
    label: 'EUROPE',
    labelX: 250,
    labelY: 36,
    offsets: {
      london: { dx: -9, dy: 0, anchor: 'end' },
      zurich: { dx: 9, dy: -2, anchor: 'start' },
      geneva: { dx: 0, dy: 14, anchor: 'middle' },
    },
  },
  southamerica: {
    hubs: ['santiago'],
    x0: 55,
    y0: 165,
    w: 140,
    label: 'SOUTH AMERICA',
    labelX: 250,
    labelY: 34,
    offsets: {
      santiago: { dx: 0, dy: -12, anchor: 'middle' },
    },
  },
};

// Percentage position (within the shared 500x260 viewBox) of a hub once
// projected into its region's zoomed frame — used as the CSS transform-origin
// so the "zoom into this city" animation scales from the right spot.
export function regionHubOrigin(region: string, hubId: string): string {
  const cfg = REGIONS[region] || REGIONS.asia;
  const s = 500 / cfg.w;
  const [gx, gy] = GLOBAL_HUB_XY[hubId] || [cfg.x0, cfg.y0];
  const px = (gx - cfg.x0) * s;
  const py = (gy - cfg.y0) * s;
  return `${((px / 500) * 100).toFixed(1)}% ${((py / 260) * 100).toFixed(1)}%`;
}

function HubHeat({ cx, cy, heat, dim }: { cx: number; cy: number; heat: HeatDisc; dim: string }) {
  return (
    <>
      <circle className={`auhalo ${dim}`} filter="url(#globeblur)" cx={cx} cy={cy} r={heat.haloR} style={{ fill: heat.color }} />
      <circle className={`aucore ${dim}`} filter="url(#globecore)" cx={cx} cy={cy} r={heat.r} style={{ fill: heat.color }} />
    </>
  );
}

export function RegionMap({
  region,
  hubHeat,
  heatDim,
  onZoomInCity,
  hubSpikes,
  ambientSpikes,
  activeSectors,
  zoomOrigin,
}: {
  region: string;
  hubHeat: Record<string, HeatDisc>;
  heatDim: string;
  onZoomInCity: (city: string) => void;
  hubSpikes: SpikePoint[];
  ambientSpikes: SpikePoint[];
  activeSectors: string[];
  zoomOrigin: string;
}) {
  const cfgRaw = REGIONS[region] || REGIONS.asia;
  // Only show hubs carrying a selected sector (all of them when no filter).
  const cfg = { ...cfgRaw, hubs: cfgRaw.hubs.filter((id) => cityMatchesSectors(id, activeSectors)) };
  const s = 500 / cfg.w;
  const proj = (x: number, y: number): [number, number] => [(x - cfg.x0) * s, (y - cfg.y0) * s];
  const landT = `scale(${s.toFixed(4)}) translate(${-cfg.x0} ${-cfg.y0})`;
  const routes = planeRoutes(cfg.hubs.map((id) => proj(...GLOBAL_HUB_XY[id])));
  // Project the global-coordinate skill spikes into this region's view.
  const projSpike = (sp: SpikePoint): SpikePoint => ({ ...sp, cx: (sp.cx - cfg.x0) * s, cy: (sp.cy - cfg.y0) * s });

  return (
    <svg className="regionmap" viewBox="0 0 500 260" style={{ transformOrigin: zoomOrigin }}>
      <defs>
        <pattern id="regionOceanWave" width="18" height="11" patternUnits="userSpaceOnUse">
          <rect width="18" height="11" fill="#e2e5e9" />
          <path d="M0,6 Q4.5,2 9,6 T18,6" fill="none" stroke="#d3d7dc" strokeWidth="1.1" />
          <path d="M0,10 Q4.5,7 9,10 T18,10" fill="none" stroke="#d3d7dc" strokeWidth="0.8" />
          <path d="M0,3 Q4.5,1 9,3 T18,3" fill="none" stroke="#dde0e5" strokeWidth="0.55" />
          <animateTransform attributeName="patternTransform" type="translate" from="0 0" to="-18 4" dur="7s" repeatCount="indefinite" />
        </pattern>
        <pattern id="regionOceanSwell" width="52" height="31" patternUnits="userSpaceOnUse">
          <path d="M0,16 Q13,6 26,16 T52,16" fill="none" stroke="#cfd3d9" strokeWidth="1.3" />
          <path d="M0,26 Q13,19 26,26 T52,26" fill="none" stroke="#d6d9de" strokeWidth="0.9" />
          <animateTransform attributeName="patternTransform" type="translate" from="0 0" to="52 -9" dur="16s" repeatCount="indefinite" />
        </pattern>
        <filter id="regionCoastGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.3" />
        </filter>
      </defs>
      {/* Oversized ocean so the water animation fills the whole screen. */}
      <rect x="-1000" y="-800" width="2500" height="1860" fill="url(#regionOceanWave)" />
      <rect className="auoceanswell" x="-1000" y="-800" width="2500" height="1860" fill="url(#regionOceanSwell)" />
      {/* Soft shallow-water halo hugging the coastline, matching the domestic
          Australia view's treatment. */}
      <g className="coastglow" filter="url(#regionCoastGlow)" transform={landT}>
        {GLOBAL_LAND_PATHS.map((d, i) => (
          <path key={i} d={d} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      <g transform={landT}>
        {GLOBAL_LAND_PATHS.map((d, i) => (
          <path key={i} className="regionland" d={d} vectorEffect="non-scaling-stroke" />
        ))}
      </g>

      <SpikeField ambient={ambientSpikes.map(projSpike)} hubs={hubSpikes.map(projSpike)} blurId="globeheatblur" />

      {routes.map((r, i) => (
        <Plane key={i} {...r} scale={1.8} />
      ))}

      <text className="aucountry" x={cfg.labelX} y={cfg.labelY} textAnchor="middle">{cfg.label}</text>

      {cfg.hubs.map((id) => {
        const [cx, cy] = proj(...GLOBAL_HUB_XY[id]);
        return <HubHeat key={id} cx={cx} cy={cy} heat={hubHeat[id]} dim={heatDim} />;
      })}
      {cfg.hubs.map((id) => {
        const [cx, cy] = proj(...GLOBAL_HUB_XY[id]);
        const off = cfg.offsets[id] || { dx: 0, dy: -11, anchor: 'middle' as const };
        return (
          <g className="aucity hub" key={id} data-city={id} onClick={() => onZoomInCity(id)}>
            {/* Generous invisible hit target, matching the global map's hubs. */}
            <circle className="hubhit" cx={cx} cy={cy} r="14" fill="transparent" pointerEvents="all" />
            <circle className="auring" cx={cx} cy={cy} r="8" />
            <circle className="audot audothub" cx={cx} cy={cy} r="4.4" />
            <text className="aulabel" x={cx + off.dx} y={cy + off.dy} textAnchor={off.anchor}>
              {GLOBAL_HUB_LABEL[id]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
