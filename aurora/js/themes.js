/* AURORA — themes.js
   Theme presets, custom colours, intensity, artwork-derived accent.
   Colours are CSS custom properties (registered with @property, so changes crossfade). */
(function (A) {
  'use strict';
  const PRESETS = {
    violet: { name: 'Aurora Violet', a: '#8f6bff', b: '#3b82f6' },
    ocean:  { name: 'Ocean',         a: '#22d3ee', b: '#2563eb' },
    sunset: { name: 'Sunset',        a: '#ff8a4c', b: '#e0409a' },
    forest: { name: 'Forest',        a: '#34d399', b: '#15803d' },
    rose:   { name: 'Rose',          a: '#fb6f92', b: '#a855f7' },
    mono:   { name: 'Monochrome',    a: '#d4d4d8', b: '#71717a' },
    custom: { name: 'Custom',        a: '#ff6bd6', b: '#6b8bff' }
  };
  const root = document.documentElement;

  /* ---------- colour maths ---------- */
  const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const rgbToHex = c => '#' + c.map(v => Math.round(A.clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  const mix = (c, t, p) => c.map((v, i) => v + (t[i] - v) * p);
  function lum(c) { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); }
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  function rgbToHsl(c) {
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
    if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    const f = (p, q, t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
  }
  A.color = { hexToRgb, rgbToHex, mix, rgbToHsl, hslToRgb };

  let applied = { a: hexToRgb(PRESETS.violet.a), b: hexToRgb(PRESETS.violet.b) };
  let artColor = null;

  function apply(aHex, bHex) {
    const a = hexToRgb(aHex), b = hexToRgb(bHex);
    const as = mix(a, [0, 0, 0], .30), bs = mix(b, [0, 0, 0], .30);
    // Pick text colour for filled buttons from whichever of white / near-black reads better on both ends.
    const white = [255, 255, 255], dark = [11, 11, 16];
    const worstW = Math.min(contrast(as, white), contrast(bs, white)), worstD = Math.min(contrast(as, dark), contrast(bs, dark));
    const st = root.style;
    st.setProperty('--accent', aHex); st.setProperty('--accent-2', bHex);
    st.setProperty('--accent-strong', rgbToHex(as)); st.setProperty('--accent-2-strong', rgbToHex(bs));
    st.setProperty('--on-accent', worstW >= worstD ? '#ffffff' : '#0b0b10');
    st.setProperty('--glow-a', aHex); st.setProperty('--glow-b', bHex);
    applied = { a, b };
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = '#0d0d12';
    A.emit('theme', applied);
  }

  /** Two harmonious, readable accent colours derived from one (artwork) colour. */
  function pairFrom(hex) {
    const hsl = rgbToHsl(hexToRgb(hex));
    const a = hslToRgb(hsl[0], A.clamp(hsl[1], .45, .9), A.clamp(hsl[2], .55, .7));
    const b = hslToRgb(hsl[0] + 38, A.clamp(hsl[1], .5, .85), A.clamp(hsl[2] - .08, .45, .6));
    return [rgbToHex(a), rgbToHex(b)];
  }

  function resolve() {
    const s = A.settings.data;
    if (s.autoAccent && artColor) return pairFrom(artColor);
    if (s.theme === 'custom') return [s.customA, s.customB];
    const p = PRESETS[s.theme] || PRESETS.violet;
    return [p.a, p.b];
  }

  function refresh() {
    const s = A.settings.data, c = resolve();
    root.setAttribute('data-theme', s.theme);
    root.style.setProperty('--intensity', (s.intensity / 100).toFixed(2));
    apply(c[0], c[1]);
  }

  function applyMotion() {
    const s = A.settings.data;
    const reduce = s.reduceMotion === 'on' || (s.reduceMotion === 'system' && window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    root.setAttribute('data-reduce-motion', reduce ? 'true' : s.reduceMotion === 'off' ? 'false' : 'system');
    root.style.setProperty('--art-amp', (s.artMotion / 100 * 14).toFixed(1) + 'px');
    root.style.setProperty('--art-speed', (11 - s.artMotion / 100 * 6).toFixed(1) + 's');
    A.emit('motion', reduce);
  }
  A.reducedMotion = () => root.getAttribute('data-reduce-motion') === 'true';

  A.themes = {
    presets: PRESETS,
    pairFrom,
    init() {
      refresh(); applyMotion();
      if (window.matchMedia) {
        const mq = matchMedia('(prefers-reduced-motion: reduce)');
        (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(applyMotion);
      }
    },
    colors: () => applied,
    set(id) { if (!PRESETS[id]) return; A.settings.set('theme', id); refresh(); },
    setCustom(a, b) { if (a) A.settings.data.customA = a; if (b) A.settings.data.customB = b; A.settings.set('theme', 'custom'); refresh(); },
    setIntensity(v) { A.settings.set('intensity', v); root.style.setProperty('--intensity', (v / 100).toFixed(2)); },
    setAuto(on) { A.settings.set('autoAccent', !!on); refresh(); },
    setArtColor(hex) { artColor = hex; if (A.settings.data.autoAccent) refresh(); },
    applyMotion,

    /** Wire a swatch group + optional custom pickers + intensity slider; stays in sync via the 'theme' event. */
    bindPicker(swatchBox, customBox, inA, inB, intensity) {
      const build = () => {
        swatchBox.replaceChildren();
        Object.keys(PRESETS).forEach(id => {
          const p = id === 'custom' ? { name: 'Custom', a: A.settings.data.customA, b: A.settings.data.customB } : PRESETS[id];
          const chip = A.el('span', { class: 'chipc', style: `background:linear-gradient(135deg,${p.a},${p.b})` });
          swatchBox.append(A.el('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-checked': 'false', dataset: { theme: id }, onclick: () => A.themes.set(id) }, chip, A.el('span', { text: p.name })));
        });
      };
      const sync = () => {
        const s = A.settings.data;
        A.$$('.swatch', swatchBox).forEach(b => {
          const on = b.dataset.theme === s.theme; b.setAttribute('aria-checked', on);
          if (b.dataset.theme === 'custom') b.firstChild.style.background = `linear-gradient(135deg,${s.customA},${s.customB})`;
        });
        customBox.hidden = s.theme !== 'custom';
        inA.value = s.customA; inB.value = s.customB;
        intensity.value = s.intensity; A.setRangeFill(intensity); intensity.parentNode.querySelector('output').textContent = s.intensity + '%';
      };
      build(); sync();
      const onCustom = () => A.themes.setCustom(inA.value, inB.value);
      inA.addEventListener('input', onCustom); inB.addEventListener('input', onCustom);
      intensity.addEventListener('input', () => { A.themes.setIntensity(+intensity.value); sync(); });
      A.on('theme', sync);
    },

    /** Average the most vivid pixels of an image. Resolves null when pixels aren't readable (CORS). */
    colorFromImage(url) {
      return new Promise(function (resolve) {
        if (!url) return resolve(null);
        const img = new Image();
        img.crossOrigin = 'anonymous'; img.decoding = 'async';
        img.onload = function () {
          try {
            const c = document.createElement('canvas'); c.width = c.height = 24;
            const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 24, 24);
            const d = g.getImageData(0, 0, 24, 24).data; let r = 0, gg = 0, b = 0, wt = 0;
            for (let i = 0; i < d.length; i += 4) {
              const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
              const w = (mx - mn) / 255 * (mx / 255) + .001;      // saturated + bright pixels count more
              r += d[i] * w; gg += d[i + 1] * w; b += d[i + 2] * w; wt += w;
            }
            resolve(rgbToHex([r / wt, gg / wt, b / wt]));
          } catch (e) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });
    }
  };
})(window.Aurora);
