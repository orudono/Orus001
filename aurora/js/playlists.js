/* AURORA — playlists.js
   User playlists, persisted in localStorage. Entries are references (links / file keys), not media. */
(function (A) {
  'use strict';
  function validate(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 200).map(function (p) {
      if (!p || typeof p !== 'object') return null;
      const name = A.clip(String(p.name || ''), 80).trim(); if (!name) return null;
      const tracks = (Array.isArray(p.tracks) ? p.tracks : []).map(A.sanitizeTrack).filter(Boolean).slice(0, 1000);
      return { id: A.clip(String(p.id || ''), 40) || A.uid(), name, created: Number.isFinite(p.created) ? p.created : Date.now(), tracks };
    }).filter(Boolean);
  }
  let lists = validate(A.store.get('playlists', []));
  const save = () => { A.store.set('playlists', lists); A.emit('playlists'); };
  const get = id => lists.find(p => p.id === id);

  A.playlists = {
    all: () => lists,
    get,
    validate,
    exportData: () => lists,
    replaceAll(l) { lists = l; save(); },
    create(name) { const p = { id: A.uid(), name: A.clip(name, 80).trim(), created: Date.now(), tracks: [] }; lists.push(p); save(); return p; },
    rename(id, name) { const p = get(id); if (p) { p.name = A.clip(name, 80).trim(); save(); } },
    remove(id) { lists = lists.filter(p => p.id !== id); save(); },
    nameTaken(name, exceptId) { const n = name.trim().toLowerCase(); return lists.some(p => p.id !== exceptId && p.name.toLowerCase() === n); },
    /** @returns {boolean} false when it was already in the playlist or can't be stored */
    addTrack(id, t) {
      const p = get(id), c = A.persistable(t); if (!p || !c) return false;
      const k = A.trackKey(c); if (p.tracks.some(x => A.trackKey(x) === k)) return false;
      p.tracks.push(c); save(); return true;
    },
    removeTrack(id, i) { const p = get(id); if (p && i >= 0 && i < p.tracks.length) { p.tracks.splice(i, 1); save(); } },
    moveTrack(id, from, to) { const p = get(id); if (!p) return; const [t] = p.tracks.splice(from, 1); p.tracks.splice(to, 0, t); save(); },
    /** Keep stored titles up to date once a provider reveals the real metadata. */
    refresh(t) {
      const k = A.trackKey(t); let hit = false;
      lists.forEach(p => p.tracks.forEach((x, i) => { if (A.trackKey(x) === k) { const c = A.persistable(t); if (c) { p.tracks[i] = c; hit = true; } } }));
      if (hit) A.store.set('playlists', lists);
    }
  };
})(window.Aurora);
