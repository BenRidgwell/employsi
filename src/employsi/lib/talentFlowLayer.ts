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
 * match. A light runs along each spoke from source to destination — into the
 * hub for hires, out of it for leavers — which is how direction is told apart.
 *
 * The layers are added without a `slot`, so on the Standard style they draw
 * above the 3D buildings: the diagram sits over the city like an overlay
 * rather than being cut up by the towers it crosses.
 */

const SPOKES = "tf-spokes";
const RINGS = "tf-rings";
const HUB = "tf-hub";
const L_RING = "tf-ring";
const L_GLOW = "tf-spoke-glow";
const L_SPOKE = "tf-spoke";
const L_COMET = "tf-comet";
const L_HALO = "tf-hub-halo";
const L_HUB = "tf-hub-dot";
const LAYERS = [L_RING, L_GLOW, L_SPOKE, L_COMET, L_HALO, L_HUB];

export interface FlowArc {
  id: string; // the peer company id
  from: [number, number];
  to: [number, number];
  color: string;
  t: number; // |n| / max, 0..1
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function metres(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR;
  const dLng = (b[0] - a[0]) * toR;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
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

function ensureFlowLayers(map: mapboxgl.Map): void {
  if (!map.getSource(SPOKES)) {
    map.addSource(SPOKES, { type: "geojson", lineMetrics: true, data: EMPTY }); // line-progress
  }
  if (!map.getSource(RINGS)) map.addSource(RINGS, { type: "geojson", data: EMPTY });
  if (!map.getSource(HUB)) map.addSource(HUB, { type: "geojson", data: EMPTY });

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
        "line-opacity": 0.85,
        "line-emissive-strength": 1,
      },
    });
  }
  if (!map.getLayer(L_COMET)) {
    map.addLayer({
      id: L_COMET,
      type: "line",
      source: SPOKES,
      layout: { "line-cap": "round" },
      paint: {
        "line-width": ["interpolate", ["linear"], ["get", "t"], 0, 3, 1, 9],
        "line-gradient": cometGradient(0.5),
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
}

/** The travelling light at progress p (0..1): transparent everywhere but a
 *  short bright head with a fading tail. Stops must ascend strictly. */
export function cometGradient(p: number): mapboxgl.Expression {
  const head = Math.min(0.99, Math.max(0.2, p));
  const tail = head - 0.18;
  return [
    "interpolate",
    ["linear"],
    ["line-progress"],
    0,
    "rgba(255,255,255,0)",
    tail,
    "rgba(255,255,255,0)",
    head,
    "rgba(255,255,255,0.95)",
    Math.min(1, head + 0.008),
    "rgba(255,255,255,0)",
    ...(head + 0.008 < 1 ? [1, "rgba(255,255,255,0)"] : []),
  ] as unknown as mapboxgl.Expression;
}

/** Draw the diagram: `hub` is the focus pin, `arcs` its spokes. */
export function setFlowArcs(
  map: mapboxgl.Map,
  arcs: FlowArc[],
  hub: [number, number] | null,
): void {
  ensureFlowLayers(map);
  const on = !!hub && arcs.length > 0;
  (map.getSource(SPOKES) as mapboxgl.GeoJSONSource).setData(on ? spokesGeoJSON(arcs) : EMPTY);
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
  LAYERS.forEach((id) => map.setLayoutProperty(id, "visibility", on ? "visible" : "none"));
}

export function clearFlowArcs(map: mapboxgl.Map): void {
  for (const s of [SPOKES, RINGS, HUB]) {
    (map.getSource(s) as mapboxgl.GeoJSONSource | undefined)?.setData(EMPTY);
  }
  LAYERS.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", "none"));
}

/** Hovering a row or pin brings its spoke forward and sends the rest back. */
export function setFlowHover(map: mapboxgl.Map, hover: string | null): void {
  if (!map.getLayer(L_SPOKE)) return;
  const dim = (on: number, off: number) =>
    (hover
      ? ["case", ["==", ["get", "id"], hover], on, off]
      : on) as unknown as mapboxgl.Expression;
  map.setPaintProperty(L_SPOKE, "line-opacity", dim(0.85, 0.15));
  map.setPaintProperty(L_GLOW, "line-opacity", dim(0.2, 0.03));
  map.setPaintProperty(L_COMET, "line-opacity", dim(1, 0.2));
}

/** One animation step: the lights along the spokes, and the hub's pulse. */
export function setCometProgress(map: mapboxgl.Map, p: number): void {
  if (map.getLayer(L_COMET)) map.setPaintProperty(L_COMET, "line-gradient", cometGradient(p));
  if (map.getLayer(L_HALO)) {
    map.setPaintProperty(L_HALO, "circle-radius", 16 + 34 * p);
    map.setPaintProperty(L_HALO, "circle-stroke-opacity", 0.45 * (1 - p));
  }
}
