import type mapboxgl from "mapbox-gl";

/**
 * Talent-flow arcs on the LOCAL Mapbox layer (PerthMapbox).
 *
 * The "Talent Flows 3D" design draws its arcs over a Leaflet mock-up of a CBD
 * with generated buildings. The app's local layer is Mapbox's Standard style
 * with the real 3D city, and the arcs here are drawn on that. They run between
 * the SAME company coordinates the app's pins stand on (CITY_COMPANIES), so
 * an arc lands exactly on the pin a user can click.
 *
 * Each flow is one LineString lifted off the ground with `line-z-offset`, a
 * sine of `line-progress`: 0 at both pins and the apex at the middle, high
 * enough to clear the CBD's towers (Perth's tallest is ~250 m). Beneath it a
 * flat ground trace, sized by the flow, gives the arc a footprint so its ends
 * read against the streets at any pitch. A light runs along each arc, source
 * to destination, which is how the direction is told apart. Colours are the
 * card's low / moderate / high bands, so a row and its arc always match.
 */

export const TF_SOURCE = "tf-arcs";
const TF_SHADOW = "tf-shadow";
const TF_GLOW = "tf-arc-glow";
const TF_ARC = "tf-arc";
const TF_COMET = "tf-comet";
const LAYERS = [TF_SHADOW, TF_GLOW, TF_ARC, TF_COMET];

export interface FlowArc {
  id: string; // the peer company id
  from: [number, number];
  to: [number, number];
  color: string;
  t: number; // |n| / max, 0..1
}

function metres(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR;
  const dLng = (b[0] - a[0]) * toR;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Apex height in metres: clear of the towers, taller for longer arcs. */
export function arcHeight(a: [number, number], b: [number, number]): number {
  return Math.max(280, Math.min(1400, metres(a, b) * 0.55));
}

/** The arcs as GeoJSON: each densified so the lift is a smooth curve. */
export function arcsGeoJSON(arcs: FlowArc[], steps = 64): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: arcs.map((a) => {
      const coords: [number, number][] = [];
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        coords.push([a.from[0] + (a.to[0] - a.from[0]) * u, a.from[1] + (a.to[1] - a.from[1]) * u]);
      }
      return {
        type: "Feature",
        properties: { id: a.id, color: a.color, t: a.t, h: arcHeight(a.from, a.to) },
        geometry: { type: "LineString", coordinates: coords },
      };
    }),
  };
}

const LIFT: mapboxgl.Expression = [
  "*",
  ["sin", ["*", ["line-progress"], Math.PI]],
  ["get", "h"],
] as unknown as mapboxgl.Expression;

/** Add the source and layers once; later calls only update data. */
export function ensureFlowLayers(map: mapboxgl.Map): void {
  if (!map.getSource(TF_SOURCE)) {
    map.addSource(TF_SOURCE, {
      type: "geojson",
      lineMetrics: true, // line-progress, for the lift and the travelling light
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getLayer(TF_SHADOW)) {
    map.addLayer({
      id: TF_SHADOW,
      type: "line",
      source: TF_SOURCE,
      layout: { "line-cap": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["interpolate", ["linear"], ["get", "t"], 0, 1.5, 1, 9],
        "line-opacity": 0.28,
        "line-blur": 2,
      },
    });
  }
  if (!map.getLayer(TF_GLOW)) {
    map.addLayer({
      id: TF_GLOW,
      type: "line",
      source: TF_SOURCE,
      layout: {
        "line-cap": "round",
        "line-z-offset": LIFT,
        "line-elevation-reference": "ground",
      },
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 6, 17, 14],
        "line-opacity": 0.18,
        "line-blur": 6,
      },
    });
  }
  if (!map.getLayer(TF_ARC)) {
    map.addLayer({
      id: TF_ARC,
      type: "line",
      source: TF_SOURCE,
      layout: {
        "line-cap": "round",
        "line-z-offset": LIFT,
        "line-elevation-reference": "ground",
      },
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2.2, 17, 5],
        "line-opacity": 0.92,
        "line-emissive-strength": 1,
      },
    });
  }
  if (!map.getLayer(TF_COMET)) {
    map.addLayer({
      id: TF_COMET,
      type: "line",
      source: TF_SOURCE,
      layout: {
        "line-cap": "round",
        "line-z-offset": LIFT,
        "line-elevation-reference": "ground",
      },
      paint: {
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3, 17, 7],
        "line-gradient": cometGradient(0.5),
        "line-emissive-strength": 1,
      },
    });
  }
}

/** The travelling light at progress p (0..1): transparent everywhere but a
 *  short bright head with a fading tail. Stops must ascend strictly. */
export function cometGradient(p: number): mapboxgl.Expression {
  const head = Math.min(0.995, Math.max(0.12, p));
  const tail = head - 0.11;
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
    Math.min(1, head + 0.004),
    "rgba(255,255,255,0)",
    ...(head + 0.004 < 1 ? [1, "rgba(255,255,255,0)"] : []),
  ] as unknown as mapboxgl.Expression;
}

export function setFlowArcs(map: mapboxgl.Map, arcs: FlowArc[]): void {
  ensureFlowLayers(map);
  (map.getSource(TF_SOURCE) as mapboxgl.GeoJSONSource).setData(arcsGeoJSON(arcs));
  LAYERS.forEach((id) => map.setLayoutProperty(id, "visibility", arcs.length ? "visible" : "none"));
}

export function clearFlowArcs(map: mapboxgl.Map): void {
  if (!map.getSource(TF_SOURCE)) return;
  (map.getSource(TF_SOURCE) as mapboxgl.GeoJSONSource).setData({
    type: "FeatureCollection",
    features: [],
  });
  LAYERS.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", "none"));
}

/** Hovering a row or pin brings its arc forward and sends the rest back. */
export function setFlowHover(map: mapboxgl.Map, hover: string | null): void {
  if (!map.getLayer(TF_ARC)) return;
  const dim = (on: number, off: number) =>
    (hover
      ? ["case", ["==", ["get", "id"], hover], on, off]
      : on) as unknown as mapboxgl.Expression;
  map.setPaintProperty(TF_ARC, "line-opacity", dim(0.92, 0.12));
  map.setPaintProperty(TF_GLOW, "line-opacity", dim(0.18, 0.03));
  map.setPaintProperty(TF_SHADOW, "line-opacity", dim(0.28, 0.06));
}

export function setCometProgress(map: mapboxgl.Map, p: number): void {
  if (map.getLayer(TF_COMET)) map.setPaintProperty(TF_COMET, "line-gradient", cometGradient(p));
}
