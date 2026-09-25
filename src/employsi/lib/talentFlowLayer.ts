import type mapboxgl from "mapbox-gl";

/**
 * Talent-flow illustration on the LOCAL Mapbox layer (PerthMapbox).
 *
 * A radial diagram laid flat on the city: the focus company is the hub, and
 * every peer it trades people with is joined to it by a straight spoke. The
 * spokes run between the SAME coordinates the app's pins stand on
 * (CITY_COMPANIES), so each one ends exactly on a pin a user can click.
 *
 * Around the hub, three faint rings (a third, two thirds and all of the way
 * to the farthest drawn peer) give the spokes a frame to read against; they
 * are a scale for the eye and carry no number. The hub itself pulses.
 *
 * A spoke's width is its flow against the largest drawn flow, and its colour
 * is the card's low / moderate / high band, so a row and its spoke always
 * match. Direction is told by bold arrowheads in the same colour, travelling
 * each spoke from source to destination — into the hub for hires, out of it
 * for leavers — on the same beat as the hub's pulse: one phase drives both
 * (setFlowPhase), so every arrow sets off as a pulse leaves the hub.
 *
 * The layers are added without a `slot`, so on the Standard style they draw
 * above the 3D buildings: the diagram sits over the city like an overlay
 * rather than being cut up by the towers it crosses.
 */

const SPOKES = "tf-spokes";
const RINGS = "tf-rings";
const HUB = "tf-hub";
const ARROWS = "tf-arrows";
const L_RING = "tf-ring";
const L_GLOW = "tf-spoke-glow";
const L_SPOKE = "tf-spoke";
const L_HALO = "tf-hub-halo";
const L_HUB = "tf-hub-dot";
const L_ARROW = "tf-arrow";
const LAYERS = [L_RING, L_GLOW, L_SPOKE, L_HALO, L_HUB, L_ARROW];

// Arrowheads per spoke, evenly spaced, and so how often one arrives.
const ARROWS_PER_SPOKE = 2;

export interface FlowArc {
  id: string; // the peer company id
  from: [number, number];
  to: [number, number];
  color: string;
  t: number; // |n| / max, 0..1
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// What is drawn on each map, for the per-frame arrow positions.
const drawn = new WeakMap<mapboxgl.Map, { arcs: FlowArc[]; hover: string | null }>();

function metres(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR;
  const dLng = (b[0] - a[0]) * toR;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Compass bearing from a to b, degrees clockwise from north. */
function bearing(a: [number, number], b: [number, number]): number {
  const east = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const north = b[1] - a[1];
  return (Math.atan2(east, north) * 180) / Math.PI;
}

function circle(c: [number, number], r: number, steps = 96): [number, number][] {
  const dLat = r / 111320;
  const dLng = r / (111320 * Math.cos((c[1] * Math.PI) / 180));
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    out.push([c[0] + dLng * Math.cos(a), c[1] + dLat * Math.sin(a)]);
  }
  return out;
}

/** The spokes as GeoJSON, each a straight line from source to destination. */
export function spokesGeoJSON(arcs: FlowArc[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: arcs.map((a) => ({
      type: "Feature",
      properties: { id: a.id, color: a.color, t: a.t },
      geometry: { type: "LineString", coordinates: [a.from, a.to] },
    })),
  };
}

/** Three rings at thirds of the distance to the farthest drawn peer. */
export function ringsGeoJSON(hub: [number, number], arcs: FlowArc[]): GeoJSON.FeatureCollection {
  const far = Math.max(0, ...arcs.map((a) => metres(a.from, a.to)));
  if (!far) return EMPTY;
  return {
    type: "FeatureCollection",
    features: [1, 2, 3].map((k) => ({
      type: "Feature",
      properties: { k },
      geometry: { type: "LineString", coordinates: circle(hub, (far * k) / 3) },
    })),
  };
}

/**
 * The arrowheads at phase p (0..1): ARROWS_PER_SPOKE per spoke, each at its
 * own progress along the spoke, pointing from source to destination. They
 * fade in leaving the source and out arriving, so none sits on a pin.
 */
export function arrowsGeoJSON(arcs: FlowArc[], p: number): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const a of arcs) {
    const rot = bearing(a.from, a.to);
    for (let k = 0; k < ARROWS_PER_SPOKE; k++) {
      const u = (p + k / ARROWS_PER_SPOKE) % 1;
      features.push({
        type: "Feature",
        properties: {
          id: a.id,
          img: arrowName(a.color),
          t: a.t,
          rot,
          o: Math.min(1, Math.sin(Math.PI * u) * 1.6),
        },
        geometry: {
          type: "Point",
          coordinates: [
            a.from[0] + (a.to[0] - a.from[0]) * u,
            a.from[1] + (a.to[1] - a.from[1]) * u,
          ],
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

const arrowName = (color: string) => `tf-arrow-${color.replace("#", "")}`;

/** A bold arrowhead in `color`, pointing north, outlined in white so it
 *  reads over its own spoke and over the city. Drawn at 2x. */
function ensureArrowImage(map: mapboxgl.Map, color: string): void {
  const name = arrowName(color);
  if (map.hasImage(name) || typeof document === "undefined") return;
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  if (!g) return;
  g.beginPath();
  g.moveTo(32, 7);
  g.lineTo(56, 53);
  g.lineTo(32, 41);
  g.lineTo(8, 53);
  g.closePath();
  g.lineJoin = "round";
  g.lineWidth = 7;
  g.strokeStyle = "#fff";
  g.stroke();
  g.fillStyle = color;
  g.fill();
  map.addImage(name, g.getImageData(0, 0, S, S), { pixelRatio: 2 });
}

function ensureFlowLayers(map: mapboxgl.Map): void {
  if (!map.getSource(SPOKES)) map.addSource(SPOKES, { type: "geojson", data: EMPTY });
  if (!map.getSource(RINGS)) map.addSource(RINGS, { type: "geojson", data: EMPTY });
  if (!map.getSource(HUB)) map.addSource(HUB, { type: "geojson", data: EMPTY });
  if (!map.getSource(ARROWS)) map.addSource(ARROWS, { type: "geojson", data: EMPTY });

  if (!map.getLayer(L_RING)) {
    map.addLayer({
      id: L_RING,
      type: "line",
      source: RINGS,
      paint: {
        "line-color": "#8e8e93",
        "line-width": 1.2,
        "line-dasharray": [2, 3],
        "line-opacity": ["interpolate", ["linear"], ["get", "k"], 1, 0.5, 3, 0.3],
        "line-emissive-strength": 1,
      },
    });
  }
  if (!map.getLayer(L_GLOW)) {
    map.addLayer({
      id: L_GLOW,
      type: "line",
      source: SPOKES,
      layout: { "line-cap": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["interpolate", ["linear"], ["get", "t"], 0, 6, 1, 20],
        "line-opacity": 0.2,
        "line-blur": 8,
        "line-emissive-strength": 1,
      },
    });
  }
  if (!map.getLayer(L_SPOKE)) {
    map.addLayer({
      id: L_SPOKE,
      type: "line",
      source: SPOKES,
      layout: { "line-cap": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["interpolate", ["linear"], ["get", "t"], 0, 1.6, 1, 7],
        "line-opacity": 0.75,
        "line-emissive-strength": 1,
      },
    });
  }
  if (!map.getLayer(L_HALO)) {
    map.addLayer({
      id: L_HALO,
      type: "circle",
      source: HUB,
      paint: {
        "circle-radius": 18,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": "#1c1c1e",
        "circle-stroke-width": 2,
        "circle-stroke-opacity": 0.4,
        "circle-pitch-alignment": "map",
        "circle-emissive-strength": 1,
      },
    });
  }
  if (!map.getLayer(L_HUB)) {
    map.addLayer({
      id: L_HUB,
      type: "circle",
      source: HUB,
      paint: {
        "circle-radius": 16,
        "circle-color": "#1c1c1e",
        "circle-opacity": 0.12,
        "circle-pitch-alignment": "map",
        "circle-emissive-strength": 1,
      },
    });
  }
  if (!map.getLayer(L_ARROW)) {
    map.addLayer({
      id: L_ARROW,
      type: "symbol",
      source: ARROWS,
      layout: {
        "icon-image": ["get", "img"],
        "icon-size": ["interpolate", ["linear"], ["get", "t"], 0, 0.7, 1, 1.15],
        "icon-rotate": ["get", "rot"],
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-opacity": ["get", "o"],
        "icon-emissive-strength": 1,
      },
    });
  }
}

/** Draw the diagram: `hub` is the focus pin, `arcs` its spokes. */
export function setFlowArcs(
  map: mapboxgl.Map,
  arcs: FlowArc[],
  hub: [number, number] | null,
): void {
  ensureFlowLayers(map);
  const on = !!hub && arcs.length > 0;
  const shown = on ? arcs : [];
  for (const color of new Set(shown.map((a) => a.color))) ensureArrowImage(map, color);
  drawn.set(map, { arcs: shown, hover: drawn.get(map)?.hover ?? null });
  (map.getSource(SPOKES) as mapboxgl.GeoJSONSource).setData(spokesGeoJSON(shown));
  (map.getSource(RINGS) as mapboxgl.GeoJSONSource).setData(on ? ringsGeoJSON(hub, arcs) : EMPTY);
  (map.getSource(HUB) as mapboxgl.GeoJSONSource).setData(
    on
      ? {
          type: "FeatureCollection",
          features: [
            { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: hub } },
          ],
        }
      : EMPTY,
  );
  (map.getSource(ARROWS) as mapboxgl.GeoJSONSource).setData(arrowsGeoJSON(shown, 0.5));
  LAYERS.forEach((id) => map.setLayoutProperty(id, "visibility", on ? "visible" : "none"));
}

export function clearFlowArcs(map: mapboxgl.Map): void {
  drawn.delete(map);
  for (const s of [SPOKES, RINGS, HUB, ARROWS]) {
    (map.getSource(s) as mapboxgl.GeoJSONSource | undefined)?.setData(EMPTY);
  }
  LAYERS.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", "none"));
}

/** Hovering a row or pin brings its spoke forward and sends the rest back. */
export function setFlowHover(map: mapboxgl.Map, hover: string | null): void {
  if (!map.getLayer(L_SPOKE)) return;
  const d = drawn.get(map);
  if (d) d.hover = hover;
  const dim = (on: number, off: number) =>
    (hover
      ? ["case", ["==", ["get", "id"], hover], on, off]
      : on) as unknown as mapboxgl.Expression;
  map.setPaintProperty(L_SPOKE, "line-opacity", dim(0.75, 0.12));
  map.setPaintProperty(L_GLOW, "line-opacity", dim(0.2, 0.03));
  map.setPaintProperty(L_ARROW, "icon-opacity", [
    "*",
    ["get", "o"],
    dim(1, 0.15),
  ] as unknown as mapboxgl.Expression);
}

/**
 * One animation step at phase p (0..1): the hub's pulse ring expanding and
 * fading, and every arrowhead a step further along its spoke. One phase for
 * both, so the arrows move in time with the pulse. Reduced motion holds the
 * phase still: the arrows still point, nothing moves.
 */
export function setFlowPhase(map: mapboxgl.Map, p: number): void {
  const d = drawn.get(map);
  if (d && map.getSource(ARROWS)) {
    for (const color of new Set(d.arcs.map((a) => a.color))) ensureArrowImage(map, color);
    (map.getSource(ARROWS) as mapboxgl.GeoJSONSource).setData(arrowsGeoJSON(d.arcs, p));
  }
  if (map.getLayer(L_HALO)) {
    map.setPaintProperty(L_HALO, "circle-radius", 16 + 34 * p);
    map.setPaintProperty(L_HALO, "circle-stroke-opacity", 0.45 * (1 - p));
  }
}
