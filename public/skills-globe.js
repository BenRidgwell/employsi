// <skills-globe> — orthographic Earth from real Natural Earth geometry (d3-geo + world-atlas
// TopoJSON), with lat/lon-anchored country pins that stay locked to their landmass as it rotates.
(function () {
  const ATLAS = (window.__resources && window.__resources.worldAtlas) || 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';

  // faded demand heat over south-west Australia (Perth), projected so it tracks the rotation
  const HEAT = [
    { lon: 115.86, lat: -31.95, r: 0.20, rgb: '200,16,46' },
    { lon: 117.9, lat: -30.6, r: 0.13, rgb: '196,142,32' },
    { lon: 153.0, lat: -27.5, r: 0.15, rgb: '31,138,76' },
    { lon: 146.8, lat: -19.3, r: 0.11, rgb: '31,138,76' },
    { lon: 145.5, lat: -23.4, r: 0.09, rgb: '31,138,76' },
    { lon: 138.6, lat: -34.9, r: 0.13, rgb: '150,150,40' },
    { lon: 135.8, lat: -31.2, r: 0.10, rgb: '168,140,36' }
  ];

  const STORE = 'skills-globe-pins-v1';

  const PINS = [
    { code: 'PH', name: 'Philippines', lon: 121.8, lat: 12.9 },
    { code: 'MY', name: 'Malaysia',    lon: 101.9, lat: 4.2, dx: -46, dy: -26 },
    { code: 'SG', name: 'Singapore',   lon: 103.8, lat: 1.35, dx: 40, dy: 20 },
    { code: 'AU', name: 'Australia',   lon: 133.8, lat: -25.3, big: true },
    { code: 'NZ', name: 'New Zealand', lon: 174.9, lat: -41.0 }
  ];

  try {
    const saved = JSON.parse(window.localStorage.getItem(STORE) || 'null');
    if (saved) PINS.forEach(p => {
      const s = saved[p.code];
      if (s && isFinite(s.lon) && isFinite(s.lat)) { p.lon = s.lon; p.lat = s.lat; }
    });
  } catch (e) {}

  function persist() {
    const out = {};
    PINS.forEach(p => { out[p.code] = { lon: +p.lon.toFixed(3), lat: +p.lat.toFixed(3) }; });
    try { window.localStorage.setItem(STORE, JSON.stringify(out)); } catch (e) {}
    window.globePins = out;
    console.log('[skills-globe] pin coordinates', JSON.stringify(out));
  }

  let atlasPromise = null;
  function land() {
    if (!atlasPromise) {
      atlasPromise = fetch(ATLAS)
        .then(r => r.json())
        .then(topo => window.topojson.feature(topo, topo.objects.countries));
    }
    return atlasPromise;
  }

  function libsReady() {
    return new Promise(res => {
      const tick = () => (window.d3 && window.topojson ? res() : setTimeout(tick, 60));
      tick();
    });
  }

  class SkillsGlobe extends HTMLElement {
    static get observedAttributes() { return ['spin-seconds', 'spinseconds', 'paused']; }

    get spinSecs() {
      const v = parseFloat(this.getAttribute('spin-seconds') || this.getAttribute('spinseconds'));
      return v > 0 ? v : 84;
    }

    connectedCallback() {
      if (this._built) return;
      this._built = true;
      Object.assign(this.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });

      this.canvas = document.createElement('canvas');
      Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', borderRadius: '999px' });
      this.appendChild(this.canvas);

      this.overlay = document.createElement('div');
      Object.assign(this.overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
      this.appendChild(this.overlay);

      this.readout = document.createElement('div');
      this.readout.style.cssText = "position:absolute;left:50%;bottom:8px;transform:translateX(-50%);padding:4px 10px;border-radius:999px;background:rgba(28,28,30,.82);color:#fff;font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.04em;opacity:0;transition:opacity .2s ease;pointer-events:none";
      this.appendChild(this.readout);

      this.pinEls = PINS.map(p => {
        const el = document.createElement('div');
        const s = p.big ? 60 : 52;
        el.style.cssText = 'position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;transition:opacity .35s ease;will-change:transform';
        el.innerHTML =
          '<div style="width:' + s + 'px;height:' + s + 'px;border-radius:999px;background:#fff;box-shadow:0 8px 18px -6px rgba(10,26,50,.55);display:flex;align-items:center;justify-content:center;' +
          "font-family:'JetBrains Mono',monospace;font-size:" + (p.big ? 19 : 17) + 'px;font-weight:500;letter-spacing:.04em;color:#1c1c1e">' + p.code + '</div>' +
          '<div style="width:12px;height:12px;background:#fff;transform:rotate(45deg);margin-top:-6px;border-radius:2px"></div>' +
          '<div style="margin-top:8px;font-size:' + (p.big ? 22 : 20) + "px;font-weight:500;color:#3a3a3c;white-space:nowrap;text-shadow:0 1px 3px rgba(255,255,255,.85)\">" + p.name + '</div>' +
          (p.dx || p.dy
            ? '<div data-lead style="position:absolute;left:50%;bottom:' + (p.big ? 30 : 26) + 'px;height:1.5px;background:rgba(255,255,255,.85);transform-origin:0 50%;box-shadow:0 0 3px rgba(10,26,50,.4)"></div>'
            : '');
        this.overlay.appendChild(el);
        this.wireDrag(el, p);
        return el;
      });

      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this);

      libsReady()
        .then(() => land())
        .then(feat => { this.feat = feat; this.resize(); this.loop(); })
        .catch(() => {});
    }

    disconnectedCallback() { this.ro && this.ro.disconnect(); cancelAnimationFrame(this._raf); }

    resize() {
      if (!window.d3) return;
      const w = this.offsetWidth, h = this.offsetHeight;
      if (!w) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.w = w; this.h = h;
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      const ctx = this.canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx = ctx;
      this.projection = window.d3.geoOrthographic()
        .translate([this.w / 2, this.h / 2])
        .scale(this.w / 2 - 1)
        .clipAngle(90);
      this.path = window.d3.geoPath(this.projection, ctx);
      this.draw(this._lambda || 0);
    }

    wireDrag(el, pin) {
      el.style.pointerEvents = 'auto';
      el.style.cursor = 'grab';
      el.addEventListener('pointerdown', ev => {
        if (this.hasAttribute('lock-pins')) return;
        ev.preventDefault();
        el.setPointerCapture(ev.pointerId);
        el.style.cursor = 'grabbing';
        this._dragging = true;
        this.readout.style.opacity = '1';
      });
      el.addEventListener('pointermove', ev => {
        if (!this._dragging || !this.projection) return;
        const r = this.getBoundingClientRect();
        const k = r.width ? this.offsetWidth / r.width : 1;
        const pt = [(ev.clientX - r.left) * k, (ev.clientY - r.top) * k];
        const cx = this.w / 2, cy = this.h / 2, R = this.w / 2 - 1;
        const dx = pt[0] - cx, dy = pt[1] - cy;
        const d = Math.hypot(dx, dy);
        if (d > R) { pt[0] = cx + (dx / d) * (R - 1); pt[1] = cy + (dy / d) * (R - 1); }
        const ll = this.projection.invert(pt);
        if (!ll || !isFinite(ll[0]) || !isFinite(ll[1])) return;
        pin.lon = ll[0]; pin.lat = ll[1];
        this.readout.textContent = pin.code + '  ' + ll[1].toFixed(2) + ', ' + ll[0].toFixed(2);
        this.draw(this._lambda || 0);
      });
      const end = ev => {
        if (!this._dragging) return;
        this._dragging = false;
        el.style.cursor = 'grab';
        this.readout.style.opacity = '0';
        try { el.releasePointerCapture(ev.pointerId); } catch (e) {}
        persist();
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }

    loop() {
      const start = performance.now();
      const base = 132, sweep = 11;
      const step = now => {
        const secs = this.spinSecs;
        const paused = this.hasAttribute('paused') || this._dragging;
        if (!paused) this._t = (this._t || 0) + (now - (this._prev || now));
        this._prev = now;
        // oscillate around the Asia-Pacific hemisphere so pinned regions stay visible
        const lambda = base + Math.sin(((this._t || 0) / (secs * 1000)) * Math.PI * 2) * sweep;
        this.draw(lambda);
        this._raf = requestAnimationFrame(step);
      };
      this._prev = start;
      this._raf = requestAnimationFrame(step);
    }

    draw(lambda) {
      if (!this.ctx || !this.feat) return;
      this._lambda = lambda;
      const ctx = this.ctx, w = this.w, h = this.h;
      const rot = [-lambda, 14, 0];
      this.projection.rotate(rot);
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2, cy = h / 2, R = w / 2 - 1;
      const ocean = ctx.createRadialGradient(cx - R * 0.32, cy - R * 0.34, R * 0.1, cx, cy, R);
      ocean.addColorStop(0, '#eaf6fd');
      ocean.addColorStop(0.38, '#c3e6f8');
      ocean.addColorStop(0.72, '#93d2f0');
      ocean.addColorStop(1, '#5fb2de');
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = ocean; ctx.fill();

      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();

      ctx.beginPath(); this.path(this.feat);
      ctx.fillStyle = '#eef4e4'; ctx.fill();
      ctx.lineWidth = 0.7; ctx.strokeStyle = 'rgba(120,150,120,.45)'; ctx.stroke();

      HEAT.forEach(hp => {
        const d = window.d3.geoDistance([hp.lon, hp.lat], [lambda, -14]);
        if (d > Math.PI / 2) return;
        const pt = this.projection([hp.lon, hp.lat]);
        if (!pt) return;
        const rad = R * hp.r;
        const fade = Math.max(0, Math.min(1, (Math.PI / 2 - d) / 0.5));
        const g = ctx.createRadialGradient(pt[0], pt[1], 0, pt[0], pt[1], rad);
        g.addColorStop(0, 'rgba(' + hp.rgb + ',' + (0.46 * fade).toFixed(3) + ')');
        g.addColorStop(0.4, 'rgba(' + hp.rgb + ',' + (0.18 * fade).toFixed(3) + ')');
        g.addColorStop(0.72, 'rgba(' + hp.rgb + ',' + (0.05 * fade).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(' + hp.rgb + ',0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(pt[0], pt[1], rad, 0, Math.PI * 2); ctx.fill();
      });

      const shade = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.32, R * 0.15, cx + R * 0.16, cy + R * 0.2, R * 1.25);
      shade.addColorStop(0, 'rgba(255,255,255,.28)');
      shade.addColorStop(0.55, 'rgba(255,255,255,0)');
      shade.addColorStop(1, 'rgba(16,42,80,.42)');
      ctx.fillStyle = shade; ctx.fillRect(0, 0, w, h);
      ctx.restore();

      const center = [lambda, -14];
      this.pinEls.forEach((el, i) => {
        const p = PINS[i];
        const dist = window.d3.geoDistance([p.lon, p.lat], center);
        const pt = this.projection([p.lon, p.lat]);
        if (!pt || dist > Math.PI / 2 - 0.12) { el.style.opacity = '0'; return; }
        const fade = Math.min(1, (Math.PI / 2 - 0.12 - dist) / 0.35);
        el.style.opacity = String(fade);
        el.style.transform = 'translate(' + (pt[0] - (p.big ? 30 : 26) + (p.dx || 0)) + 'px,' + (pt[1] - (p.big ? 74 : 66) + (p.dy || 0)) + 'px)';
        if (p.dx || p.dy) {
          const lead = el.querySelector('[data-lead]');
          if (lead) {
            const len = Math.hypot(p.dx || 0, p.dy || 0);
            const ang = Math.atan2(-(p.dy || 0), -(p.dx || 0)) * 180 / Math.PI;
            lead.style.width = len + 'px';
            lead.style.transform = 'rotate(' + ang + 'deg)';
          }
        }
      });
    }
  }

  if (!window.customElements.get('skills-globe')) window.customElements.define('skills-globe', SkillsGlobe);
})();
