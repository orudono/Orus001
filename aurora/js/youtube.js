/* AURORA — youtube.js
   Thin adapter around the official YouTube IFrame Player API.
   The visible, official player is always shown; nothing is downloaded or extracted. */
(function (A) {
  'use strict';
  const ERR = {
    2: 'YouTube rejected this video ID. Check that the link is complete.',
    5: 'The YouTube player hit an HTML5 playback error. Try again, or reload the page.',
    100: 'This video was removed or is private, so it can\'t be played.',
    101: 'The video owner doesn\'t allow playback in embedded players. Open it on YouTube instead.',
    150: 'The video owner doesn\'t allow playback in embedded players. Open it on YouTube instead.',
    153: 'YouTube couldn\'t verify where this player is running (error 153). Serve AURORA from http://localhost (see the README) instead of opening the file directly.'
  };
  let apiPromise = null, player = null, hooks = {}, poll = 0, loadCtl = null, vol = 0.8, muted = false, rate = 1, curTrack = null, lastState = -2;

  function loadApi() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise(function (resolve, reject) {
      const prev = window.onYouTubeIframeAPIReady;
      const timer = setTimeout(() => fail('timeout'), 12000);
      const fail = why => { clearTimeout(timer); apiPromise = null; reject(new Error('Couldn\'t load the YouTube player' + (why === 'timeout' ? ' (timed out)' : '') + '. Check your connection, or whether an ad-blocker / firewall blocks youtube.com.')); };
      window.onYouTubeIframeAPIReady = function () { clearTimeout(timer); if (typeof prev === 'function') prev(); resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api'; s.async = true; s.onerror = () => fail();
      document.head.appendChild(s);
    });
    return apiPromise;
  }

  const call = (fn, d) => { try { return player && typeof player[fn] === 'function' ? player[fn]() : d; } catch (e) { return d; } };

  function readMeta() {
    if (!player || !curTrack) return;
    const d = call('getVideoData', null) || {}, meta = {};
    if (d.title) meta.title = d.title;
    if (d.author) meta.artist = d.author;
    const dur = call('getDuration', 0); if (dur > 0) meta.duration = dur;
    if (curTrack.ytList) {
      const list = call('getPlaylist', null), idx = call('getPlaylistIndex', -1);
      if (list && list.length && idx >= 0) meta.album = `Playlist · video ${idx + 1} of ${list.length}`;
    }
    if (d.video_id && !curTrack.ytList) meta.ytId = d.video_id;
    hooks.onMeta && hooks.onMeta(meta);
  }

  function settle(ok, err) {
    if (!loadCtl) return;
    const c = loadCtl; loadCtl = null; clearTimeout(c.timer);
    ok ? c.resolve(err || {}) : c.reject(err);
  }

  function onState(e) {
    const st = e.data; lastState = st;
    if (st === 1) hooks.onState && hooks.onState('playing');
    else if (st === 2 || st === 5 || st === -1) hooks.onState && hooks.onState('paused');
    else if (st === 3) hooks.onState && hooks.onState('buffering');
    else if (st === 0) { hooks.onState && hooks.onState('paused'); hooks.onEnded && hooks.onEnded(); }
    if (st === 1 || st === 2 || st === 3 || st === 5) { readMeta(); settle(true); }
  }
  function onError(e) {
    const msg = ERR[e.data] || ('YouTube reported an error (code ' + e.data + ').');
    if (loadCtl) settle(false, new Error(msg));
    else hooks.onError && hooks.onError(msg);
  }

  A.youtube = {
    init(h) { hooks = h; },
    caps: () => ({ play: true, seek: true, volume: true, rate: true, rates: call('getAvailablePlaybackRates', [0.5, 1, 1.5, 2]) || [1], analysis: false }),

    load(track, autoplay, mount, v, m, r) {
      curTrack = track; vol = v; muted = m; rate = r;
      return loadApi().then(YT => new Promise(function (resolve, reject) {
        settle(false, new Error('Superseded'));
        loadCtl = { resolve, reject, timer: 0 };
        // If YouTube neither errors nor reports a state (autoplay blocked), still hand control to the visible player.
        const armGrace = () => { loadCtl && (loadCtl.timer = setTimeout(() => settle(true, { blocked: true }), 4500)); };
        const isList = !track.ytId && track.ytList;
        if (!player) {
          const holder = document.createElement('div'); mount.replaceChildren(holder);
          const vars = { autoplay: autoplay ? 1 : 0, playsinline: 1, rel: 0, enablejsapi: 1 };
          if (/^https?:$/.test(location.protocol)) vars.origin = location.origin;
          if (isList) { vars.listType = 'playlist'; vars.list = track.ytList; }
          player = new YT.Player(holder, {
            width: '100%', height: '100%', videoId: isList ? undefined : track.ytId, playerVars: vars,
            events: {
              onReady() { try { player.getIframe().referrerPolicy = 'strict-origin-when-cross-origin'; } catch (e) { /* ignore */ } applyAudio(); armGrace(); clearInterval(poll); poll = setInterval(() => { hooks.onTick && hooks.onTick(); }, 500); },
              onStateChange: onState, onError,
              onPlaybackRateChange(e) { rate = e.data; hooks.onRate && hooks.onRate(e.data); }
            }
          });
        } else {
          armGrace();
          if (isList) { const o = { listType: 'playlist', list: track.ytList, index: 0 }; autoplay ? player.loadPlaylist(o) : player.cuePlaylist(o); }
          else autoplay ? player.loadVideoById(track.ytId) : player.cueVideoById(track.ytId);
          applyAudio();
        }
      }));
    },
    stop() { settle(false, new Error('Superseded')); call('stopVideo'); },
    play() { call('playVideo'); },
    pause() { call('pauseVideo'); },
    seek(t) { try { player.seekTo(t, true); } catch (e) { /* not ready */ } },
    time: () => call('getCurrentTime', 0) || 0,
    duration: () => call('getDuration', 0) || 0,
    setVolume(v) { vol = v; applyAudio(); },
    setMuted(m) { muted = m; applyAudio(); },
    setRate(r) { rate = r; try { player.setPlaybackRate(r); } catch (e) { /* ignore */ } },
    /** Step inside a YouTube playlist. Returns true when handled here. */
    step(dir) {
      if (!player || !curTrack || !curTrack.ytList) return false;
      const list = call('getPlaylist', null), idx = call('getPlaylistIndex', -1);
      if (!list || idx < 0) return false;
      if (dir > 0 && idx < list.length - 1) { player.nextVideo(); return true; }
      if (dir < 0 && idx > 0) { player.previousVideo(); return true; }
      return false;
    },
    hasLive: () => !!player
  };

  function applyAudio() {
    try { if (!player || !player.setVolume) return; player.setVolume(Math.round(vol * 100)); muted ? player.mute() : player.unMute(); if (rate !== 1) player.setPlaybackRate(rate); } catch (e) { /* ignore */ }
  }
})(window.Aurora);
