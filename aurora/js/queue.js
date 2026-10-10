/* AURORA — queue.js
   The play queue: add / remove / reorder / clear, shuffle, repeat, history for "previous". */
(function (A) {
  'use strict';
  const saved = A.store.get('queue', {}) || {};
  let items = (Array.isArray(saved.items) ? saved.items : []).map(A.sanitizeTrack).filter(Boolean).slice(0, 500);
  let index = Number.isInteger(saved.index) && saved.index >= 0 && saved.index < items.length ? saved.index : -1;
  let shuffle = !!saved.shuffle;
  let repeat = ['off', 'all', 'one'].includes(saved.repeat) ? saved.repeat : 'off';
  let history = [];            // indices visited (for Previous while shuffling)
  let played = new Set();      // keys already heard in the current shuffle cycle

  const save = A.debounce(() => A.store.set('queue', { items: items.map(A.persistable).filter(Boolean), index, shuffle, repeat }), 200);
  const changed = () => { save(); A.emit('queue'); };
  const keyAt = i => A.trackKey(items[i]);
  const find = t => { const k = A.trackKey(t); return items.findIndex(x => A.trackKey(x) === k); };

  A.queue = {
    items: () => items,
    get index() { return index; },
    get shuffle() { return shuffle; },
    get repeat() { return repeat; },
    current: () => items[index] || null,
    indexOf: find,
    length: () => items.length,

    /** Adds a track (deduplicated by identity). Returns its index. */
    add(t, o) {
      o = o || {};
      let i = find(t), isNew = false;
      if (i < 0) {
        isNew = true;
        const at = o.next ? Math.min(items.length, index + 1) : items.length;
        items.splice(at, 0, t);
        if (index >= at) index++;
        i = at;
      } else if (o.refresh) items[i] = Object.assign(items[i], t);
      changed();
      return { index: i, added: isNew };
    },
    addMany(list) {
      let n = 0; list.forEach(t => { if (find(t) < 0) { items.push(t); n++; } });
      if (n) changed(); return n;
    },
    replace(list, start) {
      items = list.slice(); index = A.clamp(start || 0, -1, items.length - 1); history = []; played = new Set();
      changed();
    },
    remove(i) {
      if (i < 0 || i >= items.length) return;
      items.splice(i, 1);
      if (i < index) index--; else if (i === index) index = i - 1;   // playback continues; "next" lands on the following item
      history = history.filter(h => h !== i).map(h => (h > i ? h - 1 : h));
      changed();
    },
    move(from, to) {
      if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
      const cur = items[index], [t] = items.splice(from, 1); items.splice(to, 0, t);
      index = cur ? items.indexOf(cur) : index; history = [];
      changed();
    },
    clear() { items = []; index = -1; history = []; played = new Set(); changed(); },

    /** Mark index as the active entry (called when playback of items[i] starts). */
    setIndex(i, fromNav) {
      if (i < 0 || i >= items.length) return;
      if (!fromNav && index >= 0 && index !== i) history.push(index);
      index = i; played.add(keyAt(i)); changed();
    },
    setShuffle(v) { shuffle = !!v; played = new Set(); if (index >= 0) played.add(keyAt(index)); changed(); },
    setRepeat(v) { repeat = v; changed(); },
    cycleRepeat() { repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'; changed(); return repeat; },

    /** @returns {number} index of the track to play next or -1. `auto` = natural end of a track. */
    nextIndex(auto) {
      const n = items.length; if (!n) return -1;
      if (auto && repeat === 'one' && index >= 0) return index;
      if (shuffle) {
        if (index >= 0) played.add(keyAt(index));
        let pool = []; for (let i = 0; i < n; i++) if (i !== index && !played.has(keyAt(i))) pool.push(i);
        if (!pool.length) {
          if (repeat !== 'all' && auto) return -1;
          played = new Set(index >= 0 ? [keyAt(index)] : []);
          for (let i = 0; i < n; i++) if (i !== index) pool.push(i);
          if (!pool.length) return repeat === 'all' && index >= 0 ? index : -1;
        }
        return pool[Math.floor(Math.random() * pool.length)];
      }
      if (index + 1 < n) return index + 1;
      return repeat === 'all' ? 0 : -1;
    },
    prevIndex() {
      if (!items.length) return -1;
      if (shuffle && history.length) { return history.pop(); }
      if (index > 0) return index - 1;
      return repeat === 'all' ? items.length - 1 : -1;
    },

    /** Re-link local-file entries to live object URLs; drop ones that are gone. */
    hydrate() {
      let touched = false;
      items = items.filter(function (t, i) {
        if (t.source !== 'local') return true;
        const live = A.local.trackFor(t.fileKey);
        if (live) { items[i] = live; return true; }
        touched = true; return false;
      });
      if (index >= items.length) index = items.length - 1;
      if (touched) changed();
    }
  };
})(window.Aurora);
