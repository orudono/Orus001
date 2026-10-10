/* AURORA — visualizer.js
   Canvas 2D visualizer with seven modes.
   • Real data  : AnalyserNode (only when player.js has a CORS-clean / local audio signal).
   • Ambient    : a clearly-labelled synthetic animation for YouTube / Spotify / blocked sources.
   The HUD label always says which one is on screen. */
(function (A) {
  'use strict';
  const V = A.settings.data.viz;
  const MODES = [
    { id: 'bars', name: 'Spectrum Bars' }, { id: 'wave', name: 'Waveform' }, { id: 'circle', name: 'Circular Spectrum' },
    { id: 'aurora', name: 'Aurora Waves' }, { id: 'particles', name: 'Particle Field' }, { id: 'pulse', name: 'Minimal Pulse' }, { id: 'art', name: 'Album Art Reactive' }
  ];
  const TAU = Math.PI * 2;

  let stage, canvas, g, bgEl, ro = null;
  let W = 0, H = 0, dpr = 1, quality = 1;
  let raf = 0, last = 0, T = 0, running = false;
  let view = 'home';

  /* ---------- data buffers (allocated once) ---------- */
  const MAXB = 96;
  const freq = new Uint8Array(1024), wave = new Uint8Array(2048);
  const raw = new Float32Array(MAXB), bands = new Float32Array(MAXB), edges = new Int32Array(MAXB + 1);
  let nBands = 48, edgeSR = 0, edgeN = 0;
  let bass = 0, mid = 0, treb = 0, level = 0, bassAvg = 0, beat = false, lastBeat = 0;
  let isLive = false;

  /* ---------- colours ---------- */
  let colA = [143, 107, 255], colB = [59, 130, 246];
  const pal = new Array(16).fill('rgb(143,107,255)');
  let gBars = null, gH = null, gRefl = null, gAur = [];
  const rgb = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  function tint(c) { const k = V.color; return k >= 1 ? A.color.mix(c, [255, 255, 255], (k - 1) * .5) : A.color.mix(c, [24, 24, 34], (1 - k) * .85); }
  function buildColors() {
    const t = A.themes.colors(); colA = tint(t.a); colB = tint(t.b);
    for (let i = 0; i < 16; i++) pal[i] = rgb(A.color.mix(colA, colB, i / 15));
    buildGradients();
  }
  function buildGradients() {
    if (!g || !W) return;
    const base = H * .74, mh = H * .58;
    gBars = g.createLinearGradient(0, base - mh, 0, base); gBars.addColorStop(0, rgb(colB)); gBars.addColorStop(1, rgb(colA));
    gRefl = g.createLinearGradient(0, base, 0, base + mh * .35); gRefl.addColorStop(0, rgb(colA)); gRefl.addColorStop(1, 'rgba(0,0,0,0)');
    gH = g.createLinearGradient(0, 0, W, 0); gH.addColorStop(0, rgb(colA)); gH.addColorStop(1, rgb(colB));
    gAur = [];
    for (let L = 0; L < 5; L++) {
      const by = H * (.5 + (L - 2) * .07), gr = g.createLinearGradient(0, by - H * .25, 0, H);
      const c = A.color.mix(colA, colB, L / 4);
      gr.addColorStop(0, rgb(c)); gr.addColorStop(.6, rgb(A.color.mix(c, [10, 10, 20], .6))); gr.addColorStop(1, 'rgba(0,0,0,0)');
      gAur.push(gr);
    }
  }

  /* ---------- artwork ---------- */
  let artImg = null, artUrl = '';
  function setArtwork(url, seed) {
    const u = url || A.genArt(seed || 'aurora', 512);
    if (u === artUrl) return; artUrl = u;
    const im = new Image(); im.decoding = 'async';
    im.onload = () => { if (artUrl === u) artImg = im; };
    im.src = u;
    if (bgEl) {
      if (V.bgArt) { bgEl.classList.remove('no-art'); bgEl.style.backgroundImage = 'url(' + JSON.stringify(u) + ')'; }
      else { bgEl.classList.add('no-art'); bgEl.style.backgroundImage = ''; }
    }
  }
  function refreshBg() {
    if (!bgEl) return;
    bgEl.style.setProperty('--vbright', String(V.bright * .9));
    if (V.bgArt && artUrl) { bgEl.classList.remove('no-art'); bgEl.style.backgroundImage = 'url(' + JSON.stringify(artUrl) + ')'; }
    else { bgEl.classList.add('no-art'); bgEl.style.backgroundImage = ''; }
  }

  /* ---------- helpers ---------- */
  const reduce = () => V.reduce || A.reducedMotion();
  function rr(x, y, w, h, r) {
    if (w <= 0 || h <= 0) return;
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (g.roundRect) { g.roundRect(x, y, w, h, r); return; }
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function computeEdges(sr) {
    if (sr === edgeSR && nBands === edgeN) return;
    edgeSR = sr; edgeN = nBands;
    const nyq = sr / 2, f0 = 45, f1 = Math.min(16000, nyq * .95), binHz = nyq / 1024;
    let prev = Math.max(1, Math.round(f0 / binHz));
    edges[0] = prev;
    for (let i = 1; i <= nBands; i++) {
      let e = Math.round(f0 * Math.pow(f1 / f0, i / nBands) / binHz);
      e = Math.max(e, prev + 1); edges[i] = Math.min(e, 1024); prev = edges[i];
    }
  }
  function resolveNBands() {
    const n = W < 420 ? 24 : W < 700 ? 36 : W < 1000 ? 48 : 64;
    nBands = Math.max(16, Math.round(n * (quality < .8 ? .7 : 1)));
  }

  /* ---------- data acquisition ---------- */
  function acquire(dt) {
    const an = A.player.analyser();
    const playing = A.player.S.playing;
    isLive = !!an && playing;
    const sens = V.sensitivity;
    if (an) {
      const sc = Math.min(.6, V.smoothing * .5);
      if (an.smoothingTimeConstant !== sc) an.smoothingTimeConstant = sc;
      an.getByteFrequencyData(freq); an.getByteTimeDomainData(wave);
      const sr = (A.player.audioContext() || {}).sampleRate || 44100; computeEdges(sr);
      for (let i = 0; i < nBands; i++) {
        let mx = 0, sum = 0; const a = edges[i], b = Math.max(a + 1, edges[i + 1]);
        for (let k = a; k < b; k++) { const v = freq[k]; if (v > mx) mx = v; sum += v; }
        const v = (.6 * mx + .4 * sum / (b - a)) / 255;
        raw[i] = Math.min(1, Math.pow(v, 1.25) * sens * (1 + i / nBands * .55));
      }
    } else {
      // Ambient (synthetic) — slow breathing, calm when paused. NOT derived from the music.
      const act = playing ? 1 : .22, k = reduce() ? .4 : 1;
      for (let i = 0; i < nBands; i++) {
        const u = i / nBands;
        raw[i] = act * (.14 + .16 * (.5 + .5 * Math.sin(T * .8 * k + i * .33)) + .12 * (.5 + .5 * Math.sin(T * .37 * k - i * .12 + 1.7))) * (1 - .45 * u);
      }
      for (let k2 = 0; k2 < 2048; k2 += 1) wave[k2] = 128 + act * 34 * (Math.sin(k2 * .02 + T * 1.3 * k) * .6 + Math.sin(k2 * .051 - T * .9 * k) * .4);
    }
    // temporal smoothing (fast attack, slower release); stronger when reduce-motion is on
    const sm = reduce() ? Math.max(V.smoothing, .85) : V.smoothing;
    const atk = 1 - sm * .55, rel = 1 - sm;
    for (let i = 0; i < nBands; i++) { const d = raw[i] - bands[i]; bands[i] += d * (d > 0 ? atk : rel); }
    let b = 0, m = 0, t = 0, nb = Math.max(1, nBands * .12 | 0), nm = nBands * .5 | 0;
    for (let i = 0; i < nBands; i++) { if (i < nb) b += bands[i]; else if (i < nm) m += bands[i]; else t += bands[i]; }
    const tb = b / nb, tm = m / Math.max(1, nm - nb), tt = t / Math.max(1, nBands - nm);
    bass += (tb - bass) * .4; mid += (tm - mid) * .3; treb += (tt - treb) * .3;
    level += ((bass + mid + treb) / 3 - level) * .25;
    beat = false; bassAvg = bassAvg * .95 + tb * .05;
    if (isLive && tb > bassAvg * 1.35 + .05 && tb > .3 && T - lastBeat > .18) { beat = true; lastBeat = T; }
    else if (!isLive && !reduce() && T - lastBeat > 2.4 && playing) { beat = true; lastBeat = T; } // slow ambient "breath"
  }

  /* ---------- modes ---------- */
  let ga = 1;                                // mode crossfade multiplier
  const al = v => { g.globalAlpha = v * ga; };

  function drawBars() {
    const padX = W * .07, availW = W - padX * 2, gap = Math.max(2, availW / nBands * .3), bw = Math.max(1, (availW - gap * (nBands - 1)) / nBands);
    const base = H * .74, maxH = H * .58;
    al(1); g.fillStyle = gBars; g.beginPath();
    for (let i = 0; i < nBands; i++) { const h = Math.max(bw, bands[i] * maxH); rr(padX + i * (bw + gap), base - h, bw, h, bw / 2); }
    g.fill();
    al(.16); g.fillStyle = gRefl; g.beginPath();
    for (let i = 0; i < nBands; i++) { const h = bands[i] * maxH * .35; rr(padX + i * (bw + gap), base + 5, bw, Math.max(bw, h), bw / 2); }
    g.fill();
    if (V.labels) {
      al(.7); g.fillStyle = '#c9c8d8'; g.font = '11px system-ui, sans-serif'; g.textAlign = 'center';
      const sr = (A.player.audioContext() || {}).sampleRate || 44100, f0 = 45, f1 = Math.min(16000, sr / 2 * .95);
      [60, 150, 400, 1000, 2500, 6000, 12000].forEach(f => {
        if (f > f1) return;
        const u = Math.log(f / f0) / Math.log(f1 / f0);
        g.fillText(f >= 1000 ? (f / 1000) + ' kHz' : f + ' Hz', padX + u * availW, base + maxH * .35 + 26);
      });
      if (!isLive) { al(.55); g.fillText('ambient — not the real spectrum', W / 2, base + maxH * .35 + 46); }
    }
  }

  function drawWave() {
    const M = W < 600 ? 120 : 220, stride = 2048 / M, cy = H * .5, amp = H * .32 * Math.min(2, V.sensitivity * .75);
    const ys = drawWave.ys || (drawWave.ys = new Float32Array(260));
    for (let i = 0; i < M; i++) { const k = (i * stride) | 0; ys[i] = (wave[k] - 128) / 128; }
    g.lineJoin = g.lineCap = 'round';
    const path = (sign, abs) => {
      g.beginPath();
      for (let i = 0; i < M; i++) {
        const x = i / (M - 1) * W, v = abs ? Math.abs(ys[i]) : ys[i], y = cy + sign * v * amp;
        if (i === 0) g.moveTo(x, y);
        else { const px = (i - 1) / (M - 1) * W, pv = abs ? Math.abs(ys[i - 1]) : ys[i - 1], py = cy + sign * pv * amp; g.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2); }
      }
    };
    if (quality > .6) { g.shadowColor = pal[8]; g.shadowBlur = 16; }
    g.strokeStyle = gH; g.lineWidth = Math.max(2, W / 320);
    if (V.mirror) {
      path(-1, true); al(1); g.stroke();
      path(1, true); al(1); g.stroke();
      g.shadowBlur = 0;
      al(.16); g.fillStyle = gH; g.beginPath();
      for (let i = 0; i < M; i++) { const x = i / (M - 1) * W, y = cy - Math.abs(ys[i]) * amp; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      for (let i = M - 1; i >= 0; i--) g.lineTo(i / (M - 1) * W, cy + Math.abs(ys[i]) * amp);
      g.closePath(); g.fill();
    } else {
      path(1, false); al(1); g.stroke(); g.shadowBlur = 0;
      al(.12); g.lineWidth = 1; g.beginPath(); g.moveTo(0, cy); g.lineTo(W, cy); g.stroke();
    }
    g.shadowBlur = 0;
  }

  let rot = 0;
  function drawCircle() {
    const cx = W / 2, cy = H / 2, m = Math.min(W, H), R = m * .18 * (1 + bass * .22), maxLen = m * .27;
    if (!reduce()) rot += (.1 + level * .8) * lastDt;
    const M = nBands * 2, lw = Math.max(2, TAU * R / M * .55);
    const gl = g.createRadialGradient(cx, cy, R * .2, cx, cy, R * 1.6);
    gl.addColorStop(0, rgb(colA)); gl.addColorStop(1, 'rgba(0,0,0,0)'); al(.14 + bass * .3); g.fillStyle = gl; g.beginPath(); g.arc(cx, cy, R * 1.6, 0, TAU); g.fill();
    g.lineCap = 'round'; g.lineWidth = lw;
    for (let bkt = 0; bkt < 8; bkt++) {
      g.strokeStyle = pal[(bkt * 15 / 7) | 0]; al(.95); g.beginPath();
      for (let j = 0; j < M; j++) {
        const i = j < nBands ? j : M - 1 - j;
        if (((i / nBands * 8) | 0) !== bkt) continue;
        const a = rot + j / M * TAU - Math.PI / 2, len = 3 + bands[i] * maxLen, c = Math.cos(a), s = Math.sin(a);
        g.moveTo(cx + c * R, cy + s * R); g.lineTo(cx + c * (R + len), cy + s * (R + len));
      }
      g.stroke();
    }
    al(.5); g.lineWidth = 1.5; g.strokeStyle = pal[4]; g.beginPath(); g.arc(cx, cy, R * .92, 0, TAU); g.stroke();
  }

  let tw = 0;
  function drawAurora() {
    const step = W < 600 ? 14 : 8, k = reduce() ? .3 : 1;
    tw += lastDt * (.2 + level * 1.8) * k;
    g.globalCompositeOperation = 'lighter';
    for (let L = 0; L < 5; L++) {
      const by = H * (.5 + (L - 2) * .07), amp = H * (.045 + .13 * Math.min(1, level * 1.4)) * (1 - L * .1);
      g.beginPath();
      for (let x = 0; x <= W + step; x += step) {
        const u = Math.min(1, x / W), bi = (u * (nBands - 1)) | 0;
        const y = by + Math.sin(u * 5 + tw * (1 + L * .2) + L) * amp + Math.sin(u * 11 - tw * 1.3 + L * 2) * amp * .45 - bands[bi] * H * .14;
        x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.strokeStyle = pal[(L * 15 / 4) | 0]; g.lineWidth = 2; al(.65); g.stroke();
      g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fillStyle = gAur[L]; al(.2 + level * .25); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }

  /* particle pool */
  const PMAX = 320;
  const px = new Float32Array(PMAX), py = new Float32Array(PMAX), pvx = new Float32Array(PMAX), pvy = new Float32Array(PMAX);
  const pl = new Float32Array(PMAX), pm = new Float32Array(PMAX), ps = new Float32Array(PMAX), pc = new Uint8Array(PMAX);
  let spawnAcc = 0;
  function spawn(n, cx, cy, spd) {
    for (let i = 0; i < PMAX && n > 0; i++) {
      if (pl[i] > 0) continue;
      const a = Math.random() * TAU, r0 = Math.min(W, H) * (.08 + Math.random() * .08), v = spd * (.4 + Math.random() * .8);
      px[i] = cx + Math.cos(a) * r0; py[i] = cy + Math.sin(a) * r0; pvx[i] = Math.cos(a) * v; pvy[i] = Math.sin(a) * v;
      pm[i] = pl[i] = 1.6 + Math.random() * 2; ps[i] = 1.1 + Math.random() * 2.4; pc[i] = (Math.random() * 16) | 0; n--;
    }
  }
  function drawParticles() {
    const cx = W / 2, cy = H / 2, d = V.density / 100, slow = reduce() ? .3 : 1;
    const cap = Math.round((90 + d * 230) * (W < 600 ? .6 : 1) * (quality < .8 ? .7 : 1));
    let alive = 0; for (let i = 0; i < PMAX; i++) if (pl[i] > 0) alive++;
    spawnAcc += d * (.5 + level * 6) * lastDt * 60 * slow * .5;
    if (alive < cap && spawnAcc >= 1) { const n = Math.min(spawnAcc | 0, cap - alive); spawn(n, cx, cy, (30 + bass * 230) * slow); spawnAcc -= n; }
    if (beat && alive < cap) spawn(Math.min(cap - alive, (8 + d * 22) | 0), cx, cy, (140 + bass * 260) * slow);
    g.globalCompositeOperation = 'lighter';
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) * .3);
    glow.addColorStop(0, rgb(colA)); glow.addColorStop(1, 'rgba(0,0,0,0)'); al(.1 + bass * .25); g.fillStyle = glow; g.fillRect(0, 0, W, H);
    for (let i = 0; i < PMAX; i++) {
      if (pl[i] <= 0) continue;
      pl[i] -= lastDt;
      const dx = px[i] - cx, dy = py[i] - cy; // gentle swirl
      pvx[i] += -dy * .06 * lastDt * slow; pvy[i] += dx * .06 * lastDt * slow;
      px[i] += pvx[i] * lastDt; py[i] += pvy[i] * lastDt;
      if (px[i] < -20 || px[i] > W + 20 || py[i] < -20 || py[i] > H + 20) { pl[i] = 0; continue; }
      const t = pl[i] / pm[i], a = Math.sin(Math.min(1, t) * Math.PI) * .9;
      g.globalAlpha = a * ga; g.fillStyle = pal[pc[i]];
      g.beginPath(); g.arc(px[i], py[i], ps[i] * (1 + treb * 1.5), 0, TAU); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }

  const ringR = new Float32Array(6), ringA = new Float32Array(6);
  function drawPulse() {
    const cx = W / 2, cy = H / 2, m = Math.min(W, H), r = m * .13 * (1 + bass * 1.0);
    if (beat) for (let i = 0; i < 6; i++) if (ringA[i] <= 0) { ringR[i] = r; ringA[i] = .7; break; }
    for (let i = 0; i < 6; i++) {
      if (ringA[i] <= 0) continue;
      ringR[i] += lastDt * (50 + level * 260) * (reduce() ? .4 : 1); ringA[i] -= lastDt * .55;
      if (ringA[i] > 0) { al(ringA[i]); g.strokeStyle = pal[(i * 3) % 16]; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, ringR[i], 0, TAU); g.stroke(); }
    }
    const glow = g.createRadialGradient(cx, cy, r * .3, cx, cy, r * (2.2 + level * 1.5));
    glow.addColorStop(0, rgb(colA)); glow.addColorStop(.5, rgb(A.color.mix(colB, [10, 10, 20], .5))); glow.addColorStop(1, 'rgba(0,0,0,0)');
    al(.35 + level * .4); g.fillStyle = glow; g.beginPath(); g.arc(cx, cy, r * (2.4 + level * 1.5), 0, TAU); g.fill();
    const orb = g.createRadialGradient(cx - r * .3, cy - r * .35, r * .1, cx, cy, r);
    orb.addColorStop(0, rgb(A.color.mix(colA, [255, 255, 255], .55))); orb.addColorStop(.6, rgb(colA)); orb.addColorStop(1, rgb(colB));
    al(1); g.fillStyle = orb; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    al(.45); g.strokeStyle = pal[10]; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, r * (1.45 + mid * .5), 0, TAU); g.stroke();
  }

  function drawArt() {
    const cx = W / 2, cy = H / 2, size = Math.min(W, H) * .44 * (1 + bass * .09), x = cx - size / 2, y = cy - size / 2;
    for (let i = 0; i < 3; i++) {
      const rr2 = size * (.62 + i * .14 + bass * .06 * (i + 1));
      al(.22 - i * .06); g.strokeStyle = pal[i * 6]; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, rr2, 0, TAU); g.stroke();
    }
    al(1);
    if (quality > .6) { g.shadowColor = pal[3]; g.shadowBlur = 36 + bass * 70; }
    g.fillStyle = '#111'; g.beginPath(); rr(x, y, size, size, size * .06); g.fill(); g.shadowBlur = 0;
    if (artImg) { g.save(); g.beginPath(); rr(x, y, size, size, size * .06); g.clip(); g.drawImage(artImg, x, y, size, size); g.restore(); }
    if (bgEl) { bgEl.style.setProperty('--vscale', (1.1 + bass * .14).toFixed(3)); bgEl.style.setProperty('--vblur', (56 - bass * 26).toFixed(1) + 'px'); }
  }

  const DRAW = { bars: drawBars, wave: drawWave, circle: drawCircle, aurora: drawAurora, particles: drawParticles, pulse: drawPulse, art: drawArt };

  /* ---------- frame loop ---------- */
  let lastDt = .016, prevMode = null, fade = 0, slowFrames = 0, frames = 0, acc = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    let dt = (now - last) / 1000; last = now; if (dt > .1) dt = .016; lastDt = dt; T += dt;
    const onViz = view === 'visualizer';
    const need = onViz && !V.paused;
    acquire(dt);
    // Home glow reacts only to a real signal
    if (!onViz && stage) {
      const e = isLive && !reduce() ? Math.min(1, level * 1.3) : 0;
      document.documentElement.style.setProperty('--energy', e.toFixed(3));
    }
    if (!need) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over'; g.lineCap = 'butt';
    if (prevMode && fade > 0) {
      fade = Math.max(0, fade - dt / .45); ga = fade; DRAW[prevMode](); ga = 1 - fade;
      g.globalCompositeOperation = 'source-over'; g.shadowBlur = 0;
      if (fade === 0) prevMode = null;
    } else ga = 1;
    DRAW[V.mode]();
    g.globalAlpha = 1; g.shadowBlur = 0; ga = 1;
    // adaptive quality
    acc += dt; frames++;
    if (frames >= 90) { if (acc / frames > .03 && quality > .55) { quality *= .78; resize(true); } frames = 0; acc = 0; }
  }

  function wanted() { return !document.hidden && (view === 'visualizer' || (view === 'home' && A.player.S.playing && !!A.player.analyser() && !reduce())); }
  function sync() {
    if (!canvas) return;
    const w = wanted();
    if (w && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
    else if (!w && running) { running = false; cancelAnimationFrame(raf); if (view !== 'visualizer') document.documentElement.style.setProperty('--energy', '0'); }
  }

  function resize(force) {
    if (!stage) return;
    const r = stage.getBoundingClientRect(); if (!r.width || !r.height) return;
    const cap = r.width < 700 ? 1.5 : 2;
    const nd = Math.max(1, Math.min(window.devicePixelRatio || 1, cap)) * quality;
    if (!force && Math.abs(r.width - W) < 1 && Math.abs(r.height - H) < 1 && nd === dpr) return;
    W = r.width; H = r.height; dpr = nd;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    resolveNBands(); buildGradients();
  }

  /* ---------- public API ---------- */
  A.viz = {
    MODES,
    init() {
      stage = A.$('#vizStage'); canvas = A.$('#vizCanvas'); bgEl = A.$('#vizBg');
      g = canvas.getContext('2d', { alpha: true });
      if (window.ResizeObserver) { ro = new ResizeObserver(A.debounce(() => resize(), 30)); ro.observe(stage); }
      else window.addEventListener('resize', A.debounce(resize, 80));
      document.addEventListener('visibilitychange', sync);
      document.addEventListener('fullscreenchange', () => { resize(true); const full = !!document.fullscreenElement; A.$('#vizFull').setAttribute('aria-label', full ? 'Exit fullscreen' : 'Fullscreen visualizer'); });
      A.on('theme', buildColors); A.on('state', sync); A.on('motion', () => {});
      A.on('viz-status', renderStatus);
      A.on('track', t => { setArtwork(t && t.artwork, t ? A.trackKey(t) + t.title : 'aurora'); renderHud(t); });
      A.on('trackupdate', t => { if (t === A.player.track) { renderHud(t); if (t.artwork) setArtwork(t.artwork); } });
      buildColors(); refreshBg(); setArtwork(null, 'aurora'); renderStatus(A.player.vizStatus());
      bindControls();
      const full = A.$('#vizFull');
      if (!(stage.requestFullscreen || stage.webkitRequestFullscreen)) { full.disabled = true; full.dataset.tip = 'Fullscreen isn\'t supported for this element in your browser'; }
    },
    setView(v) {
      view = v; sync();
      if (v === 'visualizer') requestAnimationFrame(() => { resize(true); buildColors(); });
    },
    setMode(id) {
      if (!DRAW[id] || id === V.mode) return;
      if (!reduce()) { prevMode = V.mode; fade = 1; }
      A.settings.setViz('mode', id); syncControls(); refreshBg();
      if (bgEl && id !== 'art') { bgEl.style.setProperty('--vscale', '1.1'); bgEl.style.setProperty('--vblur', '60px'); }
    },
    toggleFullscreen() {
      if (!stage) return;
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      const fn = stage.requestFullscreen || stage.webkitRequestFullscreen;
      if (fn) { try { const p = fn.call(stage); p && p.catch && p.catch(() => A.ui.toast('Fullscreen was blocked by the browser.', 'warn')); } catch (e) { A.ui.toast('Fullscreen isn\'t available here.', 'warn'); } }
      else A.ui.toast('Fullscreen isn\'t supported in this browser.', 'warn');
    },
    reset() {
      const d = A.settings.defaults().viz; Object.assign(V, d); A.settings.save();
      buildColors(); refreshBg(); syncControls(); A.ui.toast('Visualizer settings reset.', 'success');
    },
    sync
  };

  /* ---------- HUD + controls ---------- */
  function renderStatus(s) {
    const box = A.$('#vizStatus'); if (!box) return;
    box.dataset.state = s.state; A.$('#vizStatusText').textContent = s.text;
    const note = A.$('#vizNote'); note.textContent = s.detail || ''; note.hidden = !s.detail;
    box.title = s.detail || 'Analysing the audio signal in real time.';
  }
  function renderHud(t) {
    A.$('#vizTitle').textContent = t ? t.title : 'Nothing playing';
    A.$('#vizArtist').textContent = t ? (t.artist || '') : '';
  }

  const SL = [['vzSens', 'sensitivity', v => v.toFixed(2) + '×'], ['vzSmooth', 'smoothing', v => Math.round(v * 100) + '%'],
    ['vzDensity', 'density', v => Math.round(v) + '%'], ['vzColor', 'color', v => Math.round(v * 100) + '%'], ['vzBright', 'bright', v => Math.round(v * 100) + '%']];
  const TG = [['vzBgArt', 'bgArt'], ['vzLabels', 'labels'], ['vzMirror', 'mirror'], ['vzReduce', 'reduce']];
  function syncControls() {
    SL.forEach(([id, key, fmt]) => { const el = A.$('#' + id); el.value = V[key]; A.setRangeFill(el); el.parentNode.querySelector('output').textContent = fmt(+V[key]); });
    TG.forEach(([id, key]) => { A.$('#' + id).checked = !!V[key]; });
    A.$$('.mode-tab').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === V.mode)));
    const p = A.$('#vizPause'); p.setAttribute('aria-pressed', String(!!V.paused));
    p.setAttribute('aria-label', V.paused ? 'Resume visual animation' : 'Pause visual animation'); p.dataset.tip = V.paused ? 'Resume visual animation' : 'Pause visual animation';
    p.firstChild.firstChild.setAttribute('href', V.paused ? '#i-play' : '#i-pause');
    // controls that don't apply to the current mode are dimmed, not hidden
    A.$('#vzDensity').closest('.ctrl').style.opacity = V.mode === 'particles' ? 1 : .5;
    A.$('#vzMirror').closest('.switch').style.opacity = V.mode === 'wave' ? 1 : .55;
    A.$('#vzLabels').closest('.switch').style.opacity = V.mode === 'bars' ? 1 : .55;
  }
  function bindControls() {
    const tabs = A.$('#vizModes');
    MODES.forEach(m => tabs.append(A.el('button', { type: 'button', class: 'mode-tab', role: 'radio', 'aria-checked': 'false', dataset: { mode: m.id }, text: m.name, onclick: () => A.viz.setMode(m.id) })));
    tabs.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = MODES.findIndex(m => m.id === V.mode), n = (i + (e.key === 'ArrowRight' ? 1 : -1) + MODES.length) % MODES.length;
      A.viz.setMode(MODES[n].id); A.$$('.mode-tab')[n].focus(); e.preventDefault();
    });
    SL.forEach(([id, key]) => A.$('#' + id).addEventListener('input', e => {
      V[key] = +e.target.value; A.settings.save(); syncControls();
      if (key === 'color') buildColors(); if (key === 'bright') refreshBg();
    }));
    TG.forEach(([id, key]) => A.$('#' + id).addEventListener('change', e => { V[key] = e.target.checked; A.settings.save(); if (key === 'bgArt') refreshBg(); }));
    A.$('#vzReset').addEventListener('click', () => A.viz.reset());
    A.$('#vizPause').addEventListener('click', () => { V.paused = !V.paused; A.settings.save(); syncControls(); });
    A.$('#vizFull').addEventListener('click', () => A.viz.toggleFullscreen());
    syncControls();
  }
})(window.Aurora);
