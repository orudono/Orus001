/* AURORA — spotify.js
   Official Spotify embed. Uses Spotify's iFrame API (play/pause/seek + playback updates) when it loads,
   and falls back to the plain embed iframe otherwise. Spotify audio is never exposed to this page. */
(function (A) {
  'use strict';
  let hooks = {}, apiPromise = null, controller = null, mountEl = null, controls = false;
  let pos = 0, anchor = 0, dur = 0, state = 'paused', cur = null, endedFired = false, pending = null;

  function loadApi() {
    if (apiPromise) return apiPromise;
    apiPromise = new Promise(function (resolve, reject) {
      const timer = setTimeout(() => { apiPromise = null; reject(new Error('timeout')); }, 8000);
      window.onSpotifyIframeApiReady = function (api) { clearTimeout(timer); resolve(api); };
      const s = document.createElement('script');
      s.src = 'https://open.spotify.com/embed/iframe-api/v1'; s.async = true;
      s.onerror = () => { clearTimeout(timer); apiPromise = null; reject(new Error('blocked')); };
      document.head.appendChild(s);
    });
    return apiPromise;
  }

  function onUpdate(e) {
    const d = (e && e.data) || {};
    pos = d.position || 0; anchor = performance.now();
    if (d.duration > 0) { const nd = d.duration / 1000; if (Math.abs(nd - dur) > .5) { dur = nd; hooks.onMeta && hooks.onMeta({ duration: dur }); } }
    const ns = d.isBuffering ? 'buffering' : d.isPaused ? 'paused' : 'playing';
    if (ns !== state) { state = ns; hooks.onState && hooks.onState(ns); }
    // Single items only: natural end = paused at the very end
    if (cur && (cur.spType === 'track' || cur.spType === 'episode') && !endedFired && dur > 0 && d.isPaused && pos >= d.duration - 800 && d.duration > 0) {
      endedFired = true; hooks.onEnded && hooks.onEnded();
    }
    if (!d.isPaused) endedFired = false;
    if (pending) { const p = pending; pending = null; p.resolve({ controls: true }); }
  }

  const uri = t => `spotify:${t.spType}:${t.spId}`;

  A.spotify = {
    init(h) { hooks = h; },
    caps: () => controls ? { play: true, seek: true, volume: false, rate: false, rates: [1], analysis: false } : { play: false, seek: false, volume: false, rate: false, rates: [1], analysis: false },

    load(track, autoplay, mount) {
      cur = track; mountEl = mount; pos = 0; dur = 0; state = 'paused'; endedFired = false;
      if (pending) { pending.reject(new Error('Superseded')); pending = null; }
      return loadApi().then(function (api) {
        return new Promise(function (resolve, reject) {
          pending = { resolve, reject };
          const timer = setTimeout(() => { if (pending && pending.resolve === resolve) { pending = null; resolve({ controls: !!controller, slow: true }); } }, 6000);
          const done = pending.resolve; pending.resolve = v => { clearTimeout(timer); done(v); };
          if (controller) {
            controller.loadUri(uri(track));
            if (autoplay) setTimeout(() => { try { controller.play(); } catch (e) { /* needs user gesture */ } }, 600);
            // loadUri doesn't always emit playback_update when paused; "ready" is enough to say the embed is up.
            setTimeout(() => { if (pending) { const p = pending; pending = null; p.resolve({ controls: true }); } }, 1800);
            controls = true; return;
          }
          const holder = document.createElement('div'); mount.replaceChildren(holder);
          api.createController(holder, { uri: uri(track), width: '100%', height: '100%' }, function (c) {
            controller = c; controls = true;
            c.addListener('ready', function () {
              if (autoplay) setTimeout(() => { try { c.play(); } catch (e) { /* needs user gesture */ } }, 400);
              if (pending) { const p = pending; pending = null; p.resolve({ controls: true }); }
            });
            c.addListener('playback_update', onUpdate);
          });
        });
      }).catch(function (e) {
        if (e && e.message === 'Superseded') throw e;
        return A.spotify.loadPlain(track, mount);
      });
    },

    /** Fallback: plain official embed iframe (user controls playback inside it). */
    loadPlain(track, mount) {
      controller = null; controls = false;
      return new Promise(function (resolve, reject) {
        const f = document.createElement('iframe');
        f.title = 'Spotify player'; f.loading = 'eager';
        f.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
        f.referrerPolicy = 'strict-origin-when-cross-origin';
        f.src = `https://open.spotify.com/embed/${track.spType}/${track.spId}?utm_source=generator&theme=0`;
        const t = setTimeout(() => reject(new Error('The Spotify embed didn\'t respond. Check your connection or whether open.spotify.com is blocked.')), 15000);
        f.onload = () => { clearTimeout(t); resolve({ controls: false }); };
        mount.replaceChildren(f);
      });
    },

    stop() {
      if (pending) { pending.reject(new Error('Superseded')); pending = null; }
      try { controller && controller.pause(); } catch (e) { /* ignore */ }
      if (!controller && mountEl) mountEl.replaceChildren();     // plain iframe: remove it to stop audio
      state = 'paused';
    },
    play() { try { controller && controller.resume(); } catch (e) { /* ignore */ } },
    pause() { try { controller && controller.pause(); } catch (e) { /* ignore */ } },
    seek(t) { try { controller && controller.seek(t); } catch (e) { /* ignore */ } },
    time() { return (pos + (state === 'playing' ? performance.now() - anchor : 0)) / 1000; },
    duration: () => dur,
    hasControls: () => controls
  };
})(window.Aurora);
