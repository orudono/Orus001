/* AURORA — player.js
   One controller for three kinds of playback:
     audio    → HTMLAudioElement (+ Web Audio AnalyserNode when the browser allows reading the signal)
     youtube  → official YouTube IFrame Player API
     spotify  → official Spotify embed / iFrame API
   Capabilities are reported per source so the UI can disable what is not possible — never fake it. */
(function (A) {
  'use strict';
  const st = A.settings.data;
  const S = {
    track: null, status: 'idle',            // idle | loading | ready | error
    playing: false, buffering: false, error: null, token: 0,
    duration: 0, volume: st.volume, muted: st.muted, rate: st.rate,
    caps: { play: false, seek: false, volume: false, rate: false, rates: [1] },
    analysis: { connected: false, reason: '' }
  };
  const AUDIO_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  let audio = null, audioCtl = null, audioCors = false;
  let ctx = null, analyser = null, srcNode = null;
  let skips = 0;

  const emit = (e, a) => A.emit(e, a);
  const setState = () => { emit('state', S); emit('viz-status', vizStatus()); };

  /* ---------- Web Audio ---------- */
  function ensureCtx() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC({ latencyHint: 'playback' });
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048; analyser.smoothingTimeConstant = A.settings.data.viz.smoothing; analyser.minDecibels = -90; analyser.maxDecibels = -10;
      analyser.connect(ctx.destination);
      return true;
    } catch (e) { ctx = null; analyser = null; return false; }
  }
  async function tryConnectAnalysis() {
    if (!audio || S.analysis.connected) return S.analysis.connected;
    const local = S.track && S.track.source === 'local';
    if (!local && !audioCors) { S.analysis.reason = 'cors'; return false; }
    if (!ensureCtx()) { S.analysis.reason = 'nocontext'; return false; }
    if (ctx.state !== 'running') {
      await Promise.race([ctx.resume().catch(() => {}), new Promise(r => setTimeout(r, 700))]);
      // A suspended context would silence a MediaElementSource, so only connect when running.
      if (ctx.state !== 'running') { S.analysis.reason = 'suspended'; return false; }
    }
    try {
      srcNode = ctx.createMediaElementSource(audio);
      srcNode.connect(analyser);
      S.analysis.connected = true; S.analysis.reason = '';
      return true;
    } catch (e) { S.analysis.reason = 'nocontext'; return false; }
  }
  function disconnectAnalysis() {
    try { srcNode && srcNode.disconnect(); } catch (e) { /* ignore */ }
    srcNode = null; S.analysis.connected = false;
  }

  /* ---------- audio element engine ---------- */
  function teardownAudio() {
    if (audioCtl) audioCtl.abort(); audioCtl = null;
    disconnectAnalysis();
    if (audio) { try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) { /* ignore */ } }
    audio = null;
  }
  function mediaError(el, track) {
    const mixed = location.protocol === 'https:' && /^http:/i.test(track.url || '');
    if (mixed) return 'This page is served over HTTPS, so the browser blocks the plain-HTTP audio link (mixed content). Use an https:// link.';
    const c = el.error && el.error.code;
    if (c === 2) return 'A network error interrupted loading the audio. Check your connection and the link.';
    if (c === 3) return 'The browser couldn\'t decode this audio — the file may be corrupt or use an unsupported codec.';
    return 'Couldn\'t play this source. The link may not be an audio file, may need a login, may be missing (404), or the format isn\'t supported by this browser.';
  }

  function loadAudio(track, token, autoplay) {
    return new Promise(function (resolve, reject) {
      let settled = false;
      const timer = setTimeout(() => fail(new Error('Timed out while loading the audio. The server may be slow or unreachable.')), 20000);
      const ok = v => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
      const fail = e => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } };

      const attempt = function (cors) {
        teardownAudio();
        const ctl = new AbortController(); audioCtl = ctl;
        const el = new Audio(); audio = el; audioCors = cors;
        const on = (t, f) => el.addEventListener(t, f, { signal: ctl.signal });
        let ready = false;
        el.preload = 'auto';
        if (cors) el.crossOrigin = 'anonymous';
        el.volume = S.volume; el.muted = S.muted; el.defaultPlaybackRate = S.rate; el.playbackRate = S.rate;

        const syncDuration = function () {
          const d = el.duration;
          S.duration = isFinite(d) && d > 0 ? d : 0;
          S.caps = audioCaps();
          if (S.duration && track.duration !== S.duration) { track.duration = S.duration; emit('trackupdate', track); }
          emit('caps', S.caps); setState();
        };
        on('loadedmetadata', syncDuration); on('durationchange', syncDuration);
        on('play', () => { S.playing = true; S.buffering = false; setState(); });
        on('playing', () => { S.playing = true; S.buffering = false; setState(); });
        on('pause', () => { S.playing = false; setState(); });
        on('waiting', () => { S.buffering = true; setState(); });
        on('ratechange', () => { S.rate = el.playbackRate; setState(); });
        on('ended', () => { S.playing = false; setState(); A.player.next(true); });
        on('error', function () {
          if (!ready) {
            if (cors && !settled) { attempt(false); return; }        // retry without CORS: playback only, no analysis
            fail(new Error(mediaError(el, track)));
          } else { S.playing = false; S.error = mediaError(el, track); emit('error', S.error); setState(); }
        });
        on('canplay', async function () {
          if (ready) return; ready = true;
          if (token !== S.token) return;
          syncDuration();
          await tryConnectAnalysis();
          if (token !== S.token) return;
          let blocked = false;
          if (autoplay) {
            try { await el.play(); } catch (e) { blocked = e && e.name === 'NotAllowedError'; if (!blocked && e && e.name !== 'AbortError') return fail(new Error(mediaError(el, track))); }
          }
          ok({ blocked, corsFallback: !cors && track.source !== 'local' });
        });
        el.src = track.url;
      };
      attempt(track.source !== 'local');
    });
  }
  function audioCaps() {
    const seekable = audio && isFinite(audio.duration) && audio.duration > 0;
    return { play: true, seek: !!seekable, volume: true, rate: true, rates: AUDIO_RATES };
  }

  /* ---------- provider hooks ---------- */
  function mergeMeta(meta) {
    const t = S.track; if (!t || !meta) return;
    let changed = false;
    ['title', 'artist', 'album'].forEach(k => { if (meta[k] && meta[k] !== t[k]) { t[k] = A.clip(meta[k], 200); changed = true; } });
    if (meta.duration > 0) { S.duration = meta.duration; if (t.duration !== meta.duration && !t.ytList) { t.duration = meta.duration; changed = true; } }
    if (changed) { A.lib.refresh(t); A.playlists.refresh(t); emit('trackupdate', t); }
    emit('state', S);
  }
  function providerHooks() {
    return {
      onState(s) { S.playing = s === 'playing'; S.buffering = s === 'buffering'; setState(); },
      onMeta: mergeMeta,
      onEnded() { A.player.next(true); },
      onError(msg) { S.error = msg; S.playing = false; emit('error', msg); setState(); },
      onRate(r) { S.rate = r; setState(); }
    };
  }
  A.youtube.init(providerHooks());
  A.spotify.init(providerHooks());

  function stopEngines() {
    teardownAudio();
    A.youtube.stop(); A.spotify.stop();
  }

  /* ---------- status for the visualizer HUD ---------- */
  function vizStatus() {
    const t = S.track;
    if (!t) return { state: 'unavailable', text: 'AUDIO ANALYSIS UNAVAILABLE', detail: 'Load a track to begin. The animation below is idle ambience.' };
    if (t.kind === 'youtube') return { state: 'ambient', text: 'AMBIENT VISUAL MODE', detail: 'YouTube doesn\'t expose its audio to web pages, so this animation is ambient and does not represent the real frequencies.' };
    if (t.kind === 'spotify') return { state: 'ambient', text: 'AMBIENT VISUAL MODE', detail: 'Spotify embeds don\'t expose their audio to web pages, so this animation is ambient and does not represent the real frequencies.' };
    if (S.analysis.connected) return { state: 'live', text: 'LIVE AUDIO ANALYSIS', detail: '' };
    const why = { cors: 'This server doesn\'t allow reading its audio (no CORS headers). Playback works; visuals are ambient and don\'t reflect the music.',
      suspended: 'The browser is holding the audio engine until you interact with the page. Press play, then analysis starts.',
      nocontext: 'Web Audio isn\'t available in this browser.' }[S.analysis.reason] || 'Analysis isn\'t connected for this source.';
    return { state: 'unavailable', text: 'AUDIO ANALYSIS UNAVAILABLE', detail: why };
  }

  /* ---------- public API ---------- */
  A.player = {
    S,
    get track() { return S.track; },
    analyser: () => (S.analysis.connected ? analyser : null),
    ensureAnalyser: () => { ensureCtx(); return analyser; },
    vizStatus,
    audioContext: () => ctx,
    isActive: () => S.status === 'ready' || S.status === 'loading',

    /** Load (and by default start) a track. Resolves true only if the source actually loaded. */
    async load(track, o) {
      o = o || {};
      const autoplay = o.autoplay !== false;
      const token = ++S.token;
      stopEngines();
      S.track = track; S.status = 'loading'; S.error = null; S.playing = false; S.buffering = false;
      S.duration = track.duration || 0; S.analysis = { connected: false, reason: '' };
      S.caps = { play: false, seek: false, volume: track.kind !== 'spotify', rate: false, rates: [1] };
      A.$('#ytMount').hidden = track.kind !== 'youtube'; A.$('#spMount').hidden = track.kind !== 'spotify';
      emit('track', track); setState();
      try {
        let res;
        if (track.kind === 'audio') {
          if (!track.url) throw new Error('This local file isn\'t loaded in the library any more. Re-add it from Local Library.');
          res = await loadAudio(track, token, autoplay);
        } else if (track.kind === 'youtube') {
          res = await A.youtube.load(track, autoplay, A.$('#ytMount'), S.volume, S.muted, S.rate);
          if (token === S.token) S.caps = A.youtube.caps();
        } else {
          res = await A.spotify.load(track, autoplay, A.$('#spMount'));
          if (token === S.token) S.caps = A.spotify.caps();
        }
        if (token !== S.token) return false;
        S.status = 'ready'; skips = 0;
        if (track.kind === 'audio') S.caps = audioCaps();
        A.lib.addRecent(track);
        emit('caps', S.caps); emit('loaded', { track, res: res || {} }); setState();
        return true;
      } catch (err) {
        if (token !== S.token || (err && err.message === 'Superseded')) return false;
        S.status = 'error'; S.error = (err && err.message) || 'Couldn\'t load this source.'; S.playing = false;
        if (track.kind === 'audio') teardownAudio();
        emit('error', S.error); setState();
        return false;
      }
    },

    /** Put a track in the queue (deduplicated), mark it current and load it. */
    async play(track, o) {
      let t = track;
      if (t.source === 'local') {
        const live = A.local.trackFor(t.fileKey);
        if (!live) { A.ui.toast('That local file isn\'t available this session. Re-add it from Local Library.', 'warn'); return false; }
        t = live;
      }
      const r = A.queue.add(t);
      t = A.queue.items()[r.index];
      A.queue.setIndex(r.index);
      skips = 0;
      return A.player.load(t, o);
    },

    async playIndex(i, o) {
      const t = A.queue.items()[i]; if (!t) return false;
      let live = t;
      if (t.source === 'local') {
        live = A.local.trackFor(t.fileKey);
        if (!live) { A.ui.toast('That local file isn\'t available this session. Re-add it from Local Library.', 'warn'); return false; }
        A.queue.items()[i] = live;
      }
      A.queue.setIndex(i, o && o.fromNav);
      return A.player.load(live, o);
    },

    async next(auto) {
      const yt = S.track && S.track.kind === 'youtube';
      if (yt && !auto && A.youtube.step(1)) return;
      if (auto && A.queue.repeat === 'one' && S.track) { A.player.seek(0); A.player.play_(); return; }
      const i = A.queue.nextIndex(auto);
      if (i < 0) {
        if (auto) { S.playing = false; setState(); A.ui.toast('End of queue.', 'info'); } else A.ui.toast('You\'re at the end of the queue.', 'info');
        return;
      }
      const ok = await A.player.playIndex(i);
      if (!ok && auto && ++skips < A.queue.length()) { A.ui.toast('Skipped a track that couldn\'t be played.', 'warn'); A.player.next(true); }
    },

    async prev() {
      if (S.track && S.track.kind === 'youtube' && S.caps.seek && A.player.getTime() <= 3 && A.youtube.step(-1)) return;
      if (S.caps.seek && A.player.getTime() > 3) { A.player.seek(0); return; }
      const i = A.queue.prevIndex();
      if (i < 0) { if (S.caps.seek) A.player.seek(0); else A.ui.toast('This is the start of the queue.', 'info'); return; }
      A.player.playIndex(i, { fromNav: true });
    },

    /** Internal "play" that returns nothing — used by toggle / repeat-one. */
    play_() {
      if (!S.track || S.status !== 'ready') return;
      if (S.track.kind === 'audio' && audio) {
        tryConnectAnalysis().then(() => audio && audio.play()).catch(e => {
          if (e && e.name === 'NotAllowedError') A.ui.toast('The browser blocked playback — press play again.', 'warn');
          else if (e && e.name !== 'AbortError') A.ui.toast('Couldn\'t start playback.', 'error');
        });
      } else if (S.track.kind === 'youtube') A.youtube.play();
      else if (S.track.kind === 'spotify' && S.caps.play) A.spotify.play();
    },
    pause() {
      if (!S.track) return;
      if (S.track.kind === 'audio' && audio) audio.pause();
      else if (S.track.kind === 'youtube') A.youtube.pause();
      else if (S.track.kind === 'spotify' && S.caps.play) A.spotify.pause();
    },
    toggle() {
      if (!S.track) { if (A.queue.length()) A.player.playIndex(Math.max(0, A.queue.index)); return; }
      if (!S.caps.play) return;
      S.playing ? A.player.pause() : A.player.play_();
    },
    seek(t) {
      if (!S.track || !S.caps.seek) return;
      const d = A.player.getDuration(); t = A.clamp(t, 0, d > 0 ? d : t);
      if (S.track.kind === 'audio' && audio) audio.currentTime = t;
      else if (S.track.kind === 'youtube') A.youtube.seek(t);
      else if (S.track.kind === 'spotify') A.spotify.seek(t);
    },
    seekBy(d) { if (S.caps.seek) A.player.seek(A.player.getTime() + d); },
    getTime() {
      const t = S.track; if (!t || S.status !== 'ready') return 0;
      if (t.kind === 'audio') return audio ? audio.currentTime : 0;
      return t.kind === 'youtube' ? A.youtube.time() : A.spotify.time();
    },
    getDuration() {
      const t = S.track; if (!t) return 0;
      if (t.kind === 'audio') return audio && isFinite(audio.duration) ? audio.duration : S.duration;
      const d = t.kind === 'youtube' ? A.youtube.duration() : A.spotify.duration();
      return d || S.duration;
    },
    setVolume(v) {
      S.volume = A.clamp(v, 0, 1);
      if (S.volume > 0 && S.muted) S.muted = false;
      applyVolume(); A.settings.set('volume', S.volume); A.settings.set('muted', S.muted); setState();
    },
    toggleMute() { S.muted = !S.muted; applyVolume(); A.settings.set('muted', S.muted); setState(); },
    setRate(r) {
      S.rate = r; A.settings.set('rate', r);
      if (audio) { audio.defaultPlaybackRate = r; audio.playbackRate = r; }
      if (S.track && S.track.kind === 'youtube') A.youtube.setRate(r);
      setState();
    },
    cycleRate() {
      const rates = S.caps.rates || [1]; if (rates.length < 2) return;
      let i = rates.findIndex(x => Math.abs(x - S.rate) < .01); A.player.setRate(rates[(i + 1) % rates.length]);
    },
    stopAll() { S.token++; stopEngines(); S.track = null; S.status = 'idle'; S.playing = false; emit('track', null); setState(); }
  };

  function applyVolume() {
    if (audio) { audio.volume = S.volume; audio.muted = S.muted; }
    A.youtube.setVolume(S.volume); A.youtube.setMuted(S.muted);
  }
  window.addEventListener('pagehide', teardownAudio);
})(window.Aurora);
