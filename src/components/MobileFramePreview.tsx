import { useState } from "react";

// Frames the live app inside a fixed-pixel iframe so a desktop browser renders
// it at a true phone viewport width. Plain window resizing doesn't reliably do
// this — devtools zoom/scrollbars skew the effective CSS width — whereas an
// iframe gets its own independent viewport, so @media queries inside it
// evaluate against exactly the iframe's box.
//
// The iframe loads "/?app=1": the app-forcing flag the index route reads to
// render the raw app rather than this frame, which prevents the frame from
// recursively embedding itself when it's served as the mobile Worker's root.

export const PHONE_PRESETS = [
  { label: "iPhone SE", width: 375, height: 667 },
  { label: "iPhone 13/14", width: 390, height: 844 },
  { label: "iPhone Pro Max", width: 430, height: 932 },
];

export function MobileFramePreview() {
  const [preset, setPreset] = useState(PHONE_PRESETS[1]);
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        background: "#1c1c1e",
        fontFamily: "system-ui, sans-serif",
        padding: "24px 0",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        {PHONE_PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => setPreset(p)}
            style={{
              padding: "7px 14px",
              borderRadius: 999,
              border: "1px solid #3a3a3d",
              background: p.width === preset.width ? "#fff" : "transparent",
              color: p.width === preset.width ? "#1c1c1e" : "#fff",
              fontWeight: 700,
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            {p.label} · {p.width}px
          </button>
        ))}
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          style={{
            padding: "7px 14px",
            borderRadius: 999,
            border: "1px solid #3a3a3d",
            background: "transparent",
            color: "#9a9aa0",
            fontWeight: 700,
            fontSize: 12.5,
            cursor: "pointer",
          }}
        >
          ↻ Reload
        </button>
      </div>
      <div
        style={{
          width: preset.width + 16,
          height: preset.height + 16,
          borderRadius: 44,
          background: "#000",
          padding: 8,
          boxShadow: "0 30px 80px -20px rgba(0,0,0,0.7)",
        }}
      >
        <iframe
          key={reloadKey}
          src="/?app=1"
          title="Mobile preview"
          style={{
            width: preset.width,
            height: preset.height,
            border: "none",
            borderRadius: 36,
            background: "#fff",
            display: "block",
          }}
        />
      </div>
      <span style={{ color: "#6c6c72", fontSize: 11.5 }}>
        {preset.width} × {preset.height} CSS px — the app's mobile layout (≤ 680px breakpoint)
      </span>
    </div>
  );
}
