import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

// Standalone utility page (not part of the Employsi app itself): frames the
// live app inside a fixed-pixel iframe so a PC browser renders it at a true
// phone viewport width. Plain window resizing doesn't reliably do this —
// the browser's own devtools zoom/scrollbars can skew the effective CSS
// width — an iframe gets its own independent viewport, so @media queries
// inside it evaluate against exactly the iframe's box, not the outer window.
export const Route = createFileRoute("/mobile-frame")({
  head: () => ({
    meta: [{ title: "Mobile preview — Employsi" }],
  }),
  component: MobileFramePage,
});

const PRESETS = [
  { label: "iPhone SE", width: 375, height: 667 },
  { label: "iPhone 13/14", width: 390, height: 844 },
  { label: "iPhone Pro Max", width: 430, height: 932 },
];

function MobileFramePage() {
  const [preset, setPreset] = useState(PRESETS[1]);
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
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {PRESETS.map((p) => (
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
          borderRadius: 36,
          background: "#000",
          padding: 8,
          boxShadow: "0 30px 80px -20px rgba(0,0,0,0.7)",
        }}
      >
        <iframe
          key={reloadKey}
          src="/"
          title="Mobile preview"
          style={{
            width: preset.width,
            height: preset.height,
            border: "none",
            borderRadius: 28,
            background: "#fff",
            display: "block",
          }}
        />
      </div>
      <span style={{ color: "#6c6c72", fontSize: 11.5 }}>
        {preset.width} × {preset.height} CSS px — matches the app's max-width: 680px breakpoint
      </span>
    </div>
  );
}
