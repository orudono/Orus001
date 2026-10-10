/* AURORA — storage.js
   localStorage wrapper, validated settings, favourites / recents, IndexedDB for local files,
   and JSON export / import with strict validation. No auth tokens are ever stored. */
(function (A) {
  'use strict';
  const PREFIX = 'aurora.v1.';

  /* ---------- localStorage (never throws) ---------- */
  A.store = {
    get(key, fallback) { try { const v = localStorage.getItem(PREFIX + key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(key, val) { try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); return true; } catch (e) { return false; } },
    remove(key) { try { localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ } },
    clearAll() {
      try { Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
    }
  };

  /* ---------- settings ---------- */
  A.defaultShortcuts = { playPause: ' ', seekBack: 'ArrowLeft', seekFwd: 'ArrowRight', volUp: 'ArrowUp', volDown: 'ArrowDown', mute: 'm', fullscreen: 'f', next: 'n', prev: 'p' };
  const DEFAULTS = {
    theme: 'violet', customA: '#ff6bd6', customB: '#6b8bff', intensity: 70, autoAccent: false,
    artMotion: 40, artStyle: 'float', reduceMotion: 'system',
    sidebarCollapsed: false, shortcutsEnabled: true, shortcuts: Object.assign({}, A.defaultShortcuts),
    rememberLocal: false, volume: 0.8, muted: false, rate: 1,
    viz: { mode: 'bars', sensitivity: 1.3, smoothing: 0.72, density: 60, color: 1, bright: 0.55, bgArt: true, labels: false, mirror: true, paused: false, reduce: false }
  };
  const RANGE = {
    intensity: [0, 100], artMotion: [0, 100], volume: [0, 1], rate: [0.25, 3],
    sensitivity: [0.4, 3], smoothing: [0, 0.95], density: [20, 100], color: [0.3, 1.5], bright: [0, 1]
  };
  const ENUM = {
    theme: ['violet', 'ocean', 'sunset', 'forest', 'rose', 'mono', 'custom'],
    artStyle: ['float', 'spin'], reduceMotion: ['system', 'on', 'off'],
    mode: ['bars', 'wave', 'circle', 'aurora', 'particles', 'pulse', 'art']
  };
  const HEX = /^#[0-9a-f]{6}$/i;

  function clean(src, def, key) {
    if (def && typeof def === 'object' && !Array.isArray(def)) {
      const out = {};
      for (const k in def) {
        if (k === 'shortcuts') {
          out[k] = {};
          const s = (src && typeof src[k] === 'object' && src[k]) || {};
          for (const a in def[k]) out[k][a] = (typeof s[a] === 'string' && s[a].length >= 1 && s[a].length <= 12) ? s[a] : def[k][a];
        } else out[k] = clean(src && src[k], def[k], k);
      }
      return out;
    }
    if (typeof def === 'number') {
      const n = typeof src === 'number' && isFinite(src) ? src : def, r = RANGE[key];
      return r ? A.clamp(n, r[0], r[1]) : n;
    }
    if (typeof def === 'boolean') return typeof src === 'boolean' ? src : def;
    if (typeof def === 'string') {
      if (key === 'customA' || key === 'customB') return typeof src === 'string' && HEX.test(src) ? src : def;
      if (ENUM[key]) return ENUM[key].includes(src) ? src : def;
      return typeof src === 'string' ? src : def;
    }
    return def;
  }

  const S = A.settings = {
    data: clean(A.store.get('settings', {}), DEFAULTS),
    defaults: () => clean({}, DEFAULTS),
    sanitize: obj => clean(obj, DEFAULTS),
    get(k) { return S.data[k]; },
    set(k, v) { S.data[k] = v; S.save(); },
    setViz(k, v) { S.data.viz[k] = v; S.save(); },
    save: A.debounce(function () { A.store.set('settings', S.data); }, 150),
    replace(obj) { S.data = clean(obj, DEFAULTS); A.store.set('settings', S.data); }
  };
  window.addEventListener('pagehide', () => A.store.set('settings', S.data));

  /* ---------- track sanitizing (used for persistence + imports) ---------- */
  const SP_TYPES = ['track', 'album', 'playlist', 'artist', 'episode', 'show'];
  A.sanitizeTrack = function (t) {
    if (!t || typeof t !== 'object') return null;
    const kind = t.kind;
    if (kind !== 'audio' && kind !== 'youtube' && kind !== 'spotify') return null;
    const o = {
      id: A.clip(String(t.id || ''), 48) || A.uid(), kind,
      title: A.clip(t.title, 200) || 'Untitled', artist: A.clip(t.artist, 200), album: A.clip(t.album, 200),
      duration: typeof t.duration === 'number' && isFinite(t.duration) && t.duration > 0 ? t.duration : 0,
      artwork: A.safeHttpUrl(t.artwork || '') || null
    };
    if (kind === 'youtube') {
      o.source = 'youtube';
      o.ytId = typeof t.ytId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(t.ytId) ? t.ytId : null;
      o.ytList = typeof t.ytList === 'string' && /^[A-Za-z0-9_-]{10,80}$/.test(t.ytList) ? t.ytList : null;
      o.url = A.safeHttpUrl(t.url || '') || null;
      if (!o.ytId && !o.ytList) return null;
    } else if (kind === 'spotify') {
      o.source = 'spotify';
      if (!SP_TYPES.includes(t.spType) || typeof t.spId !== 'string' || !/^[A-Za-z0-9]{10,32}$/.test(t.spId)) return null;
      o.spType = t.spType; o.spId = t.spId; o.url = A.safeHttpUrl(t.url || '') || null;
    } else if (t.source === 'local') {
      o.source = 'local'; o.fileKey = A.clip(t.fileKey, 300); o.url = null;
      if (!o.fileKey) return null;
    } else {
      o.source = 'direct'; o.url = A.safeHttpUrl(t.url || '');
      if (!o.url) return null;
    }
    return o;
  };
  /** Clone for persistence: drops runtime-only data (blob: URLs, data: artwork). */
  A.persistable = function (t) { return A.sanitizeTrack(t); };

  /* ---------- favourites / recents / imported links ---------- */
  const L = A.lib = {
    favorites: (A.store.get('favorites', []) || []).map(A.sanitizeTrack).filter(Boolean).slice(0, 500),
    recents: (A.store.get('recents', []) || []).map(A.sanitizeTrack).filter(Boolean).slice(0, 60),
    imports: (A.store.get('imports', []) || []).filter(s => typeof s === 'string' && s.length < 2048 && A.safeHttpUrl(s)).slice(0, 12),
    isFav(t) { const k = A.trackKey(t); return L.favorites.some(f => A.trackKey(f) === k); },
    toggleFav(t) {
      const k = A.trackKey(t), i = L.favorites.findIndex(f => A.trackKey(f) === k);
      if (i >= 0) L.favorites.splice(i, 1);
      else { const c = A.persistable(t); if (!c) return false; L.favorites.unshift(c); }
      A.store.set('favorites', L.favorites); A.emit('lib'); return i < 0;
    },
    addRecent(t) {
      const c = A.persistable(t); if (!c) return;
      const k = A.trackKey(c);
      L.recents = [c].concat(L.recents.filter(r => A.trackKey(r) !== k)).slice(0, 60);
      A.store.set('recents', L.recents); A.emit('lib');
    },
    clearRecents() { L.recents = []; A.store.set('recents', L.recents); A.emit('lib'); },
    addImport(url) {
      L.imports = [url].concat(L.imports.filter(u => u !== url)).slice(0, 12);
      A.store.set('imports', L.imports); A.emit('lib');
    },
    clearImports() { L.imports = []; A.store.set('imports', L.imports); A.emit('lib'); },
    /** Keep stored metadata fresh (e.g. real title learned after playback starts). */
    refresh(t) {
      const k = A.trackKey(t); let hit = false;
      [L.favorites, L.recents].forEach(list => list.forEach((x, i) => {
        if (A.trackKey(x) === k) { const c = A.persistable(t); if (c) { list[i] = c; hit = true; } }
      }));
      if (hit) { A.store.set('favorites', L.favorites); A.store.set('recents', L.recents); }
    }
  };

  /* ---------- IndexedDB (optional local-file persistence) ---------- */
  let dbp = null;
  function openDb() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('IndexedDB unavailable'));
      const r = indexedDB.open('aurora', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'key' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }
  function run(mode, fn) {
    return openDb().then(db => new Promise(function (res, rej) {
      const tx = db.transaction('files', mode), st = tx.objectStore('files');
      const rq = fn(st);
      tx.oncomplete = () => res(rq && rq.result);
      tx.onerror = tx.onabort = () => rej(tx.error);
    }));
  }
  A.idb = {
    put: rec => run('readwrite', s => s.put(rec)),
    all: () => run('readonly', s => s.getAll()),
    del: key => run('readwrite', s => s.delete(key)),
    clear: () => run('readwrite', s => s.clear())
  };

  /* ---------- export / import ---------- */
  A.data = {
    exportObject() {
      return {
        app: 'aurora', version: 1, exportedAt: new Date().toISOString(),
        settings: S.data, favorites: L.favorites, recents: L.recents, importedLinks: L.imports,
        playlists: A.playlists ? A.playlists.exportData() : []
      };
    },
    /** Throws Error with a human-readable message when invalid. Returns a summary string. */
    importObject(o) {
      if (!o || typeof o !== 'object' || o.app !== 'aurora') throw new Error('This file is not an AURORA export.');
      if (o.version !== 1) throw new Error('Unsupported export version: ' + String(o.version).slice(0, 10) + '.');
      const favs = Array.isArray(o.favorites) ? o.favorites.map(A.sanitizeTrack).filter(Boolean).slice(0, 500) : [];
      const recs = Array.isArray(o.recents) ? o.recents.map(A.sanitizeTrack).filter(Boolean).slice(0, 60) : [];
      const links = Array.isArray(o.importedLinks) ? o.importedLinks.filter(u => typeof u === 'string' && A.safeHttpUrl(u)).slice(0, 12) : [];
      const pls = A.playlists ? A.playlists.validate(o.playlists) : [];
      const settings = o.settings && typeof o.settings === 'object' ? S.sanitize(o.settings) : null;
      L.favorites = favs; L.recents = recs; L.imports = links;
      A.store.set('favorites', favs); A.store.set('recents', recs); A.store.set('imports', links);
      if (A.playlists) A.playlists.replaceAll(pls);
      if (settings) S.replace(settings);
      A.emit('lib');
      return `${pls.length} playlist${pls.length === 1 ? '' : 's'}, ${favs.length} favorite${favs.length === 1 ? '' : 's'}${settings ? ', settings' : ''}`;
    },
    async resetAll() {
      A.store.clearAll();
      try { await A.idb.clear(); } catch (e) { /* ignore */ }
    }
  };
})(window.Aurora);
