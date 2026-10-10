/* AURORA — local.js
   Local audio files: import, ID3v2 metadata (title / artist / album / embedded artwork),
   object-URL lifecycle, and optional IndexedDB persistence. Files are never uploaded. */
(function (A) {
  'use strict';
  const EXT = ['mp3', 'wav', 'wave', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'weba', 'webm', 'mp4'];
  const files = new Map();      // key -> { key, url, artUrl, blob, track }

  /* ---------- ID3v2 ---------- */
  const synch = (b, o) => (b[o] & 127) << 21 | (b[o + 1] & 127) << 14 | (b[o + 2] & 127) << 7 | (b[o + 3] & 127);
  const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const ascii = (b, o, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i]); return s; };
  function decode(bytes, enc) {
    try {
      let label = 'windows-1252', d = bytes;
      if (enc === 1 || enc === 2) {
        label = enc === 2 ? 'utf-16be' : 'utf-16le';
        if (d.length >= 2 && d[0] === 0xFF && d[1] === 0xFE) { label = 'utf-16le'; d = d.subarray(2); }
        else if (d.length >= 2 && d[0] === 0xFE && d[1] === 0xFF) { label = 'utf-16be'; d = d.subarray(2); }
      } else if (enc === 3) label = 'utf-8';
      return new TextDecoder(label).decode(d).split('\0').map(s => s.trim()).filter(Boolean).join(', ');
    } catch (e) { return ''; }
  }
  function textFrame(fd) { return fd.length > 1 ? decode(fd.subarray(1), fd[0]) : ''; }
  function pictureFrame(fd, v2) {
    const enc = fd[0]; let i = 1, mime;
    if (v2) { mime = 'image/' + ascii(fd, 1, 3).toLowerCase().replace('jpg', 'jpeg'); i = 4; }
    else { let e = i; while (e < fd.length && fd[e] !== 0) e++; mime = ascii(fd, i, e - i).toLowerCase(); i = e + 1; }
    i += 1; // picture type
    if (enc === 1 || enc === 2) { while (i + 1 < fd.length && !(fd[i] === 0 && fd[i + 1] === 0)) i += 2; i += 2; }
    else { while (i < fd.length && fd[i] !== 0) i++; i += 1; }
    const data = fd.subarray(i); if (data.length < 16) return null;
    if (data[0] === 0xFF && data[1] === 0xD8) mime = 'image/jpeg';
    else if (data[0] === 0x89 && data[1] === 0x50) mime = 'image/png';
    else if (!/^image\/(jpeg|png|gif|webp)$/.test(mime)) return null;
    return new Blob([data], { type: mime });
  }
  async function readId3(file) {
    try {
      const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
      if (head.length < 10 || ascii(head, 0, 3) !== 'ID3') return null;
      const ver = head[3]; if (ver < 2 || ver > 4) return null;
      const size = synch(head, 6);
      const buf = new Uint8Array(await file.slice(10, 10 + Math.min(size, 12 * 1024 * 1024)).arrayBuffer());
      let p = 0; if ((head[5] & 0x40) && ver >= 3) p = ver === 4 ? synch(buf, 0) : be32(buf, 0) + 4;
      const idLen = ver === 2 ? 3 : 4, hdr = ver === 2 ? 6 : 10, out = {};
      while (p + hdr <= buf.length) {
        const id = ascii(buf, p, idLen); if (!/^[A-Z0-9]+$/.test(id)) break;
        const fs = ver === 2 ? (buf[p + 3] << 16 | buf[p + 4] << 8 | buf[p + 5]) : ver === 4 ? synch(buf, p + 4) : be32(buf, p + 4);
        const s = p + hdr, e = s + fs; if (fs <= 0 || e > buf.length) break;
        const fd = buf.subarray(s, e);
        if (id === 'TIT2' || id === 'TT2') out.title = textFrame(fd);
        else if (id === 'TPE1' || id === 'TP1') out.artist = textFrame(fd);
        else if (id === 'TALB' || id === 'TAL') out.album = textFrame(fd);
        else if ((id === 'APIC' || id === 'PIC') && !out.art) out.art = pictureFrame(fd, id === 'PIC');
        p = e;
      }
      return out;
    } catch (e) { return null; }
  }

  function fromName(name) {
    const base = name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_+/g, ' ').trim();
    const m = /^(.{1,80}?)\s+-\s+(.+)$/.exec(base);
    return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base || name };
  }
  const extOf = n => ((/\.([a-z0-9]{2,5})$/i.exec(n) || [])[1] || '').toLowerCase();
  const isAudio = f => (f.type && f.type.indexOf('audio/') === 0) || EXT.includes(extOf(f.name));

  /** Verify the browser can decode the file and learn its duration. Resolves {ok,duration}. */
  function probe(url) {
    return new Promise(function (res) {
      const a = new Audio(); let done = false;
      const end = r => { if (done) return; done = true; a.removeAttribute('src'); a.load(); res(r); };
      a.preload = 'metadata';
      a.onloadedmetadata = () => end({ ok: true, duration: isFinite(a.duration) ? a.duration : 0 });
      a.onerror = () => end({ ok: false, duration: 0 });
      setTimeout(() => end({ ok: true, duration: 0 }), 6000);   // slow disk: keep the file, duration unknown
      a.src = url;
    });
  }

  function register(key, blob, meta) {
    const url = URL.createObjectURL(blob);
    const artUrl = meta.art ? URL.createObjectURL(meta.art) : null;
    const track = { id: A.uid(), kind: 'audio', source: 'local', fileKey: key, url, title: A.clip(meta.title, 200), artist: A.clip(meta.artist, 200), album: A.clip(meta.album, 200), artwork: artUrl, duration: meta.duration || 0 };
    files.set(key, { key, url, artUrl, blob, art: meta.art || null, track });
    return track;
  }

  A.local = {
    all: () => Array.from(files.values()).map(f => f.track),
    has: key => files.has(key),
    trackFor: key => (files.get(key) || {}).track || null,

    /** @returns {Promise<{added:Track[], duplicates:number, rejected:string[]}>} */
    async import(fileList) {
      const added = [], rejected = []; let duplicates = 0;
      for (const f of Array.from(fileList)) {
        if (!isAudio(f)) { rejected.push(f.name + ' (not an audio file)'); continue; }
        const key = `local:${f.name}:${f.size}:${f.lastModified}`;
        if (files.has(key)) { duplicates++; continue; }
        const url = URL.createObjectURL(f);
        const pr = await probe(url);
        URL.revokeObjectURL(url);
        if (!pr.ok) { rejected.push(f.name + ' (this browser can\'t decode it)'); continue; }
        const tags = (await readId3(f)) || {}, nm = fromName(f.name);
        const meta = { title: tags.title || nm.title, artist: tags.artist || nm.artist || 'Local file', album: tags.album || '', art: tags.art || null, duration: pr.duration };
        const track = register(key, f, meta);
        added.push(track);
        if (A.settings.get('rememberLocal')) A.local.persist(key).catch(() => {});
      }
      if (added.length || duplicates) A.emit('local');
      return { added, duplicates, rejected };
    },

    persist(key) {
      const f = files.get(key); if (!f) return Promise.resolve();
      const t = f.track;
      return A.idb.put({ key, blob: f.blob, art: f.art, title: t.title, artist: t.artist, album: t.album, duration: t.duration, name: key });
    },
    async persistAll() { for (const k of files.keys()) await A.local.persist(k); },

    /** Reload remembered files (only when the user opted in). */
    async restore() {
      if (!A.settings.get('rememberLocal')) return 0;
      try {
        const rows = await A.idb.all();
        rows.forEach(r => { if (r && r.key && r.blob && !files.has(r.key)) register(r.key, r.blob, r); });
        if (rows.length) A.emit('local');
        return rows.length;
      } catch (e) { return 0; }
    },

    remove(key) {
      const f = files.get(key); if (!f) return;
      URL.revokeObjectURL(f.url); if (f.artUrl) URL.revokeObjectURL(f.artUrl);
      files.delete(key);
      A.idb.del(key).catch(() => {});
      A.emit('local');
    },
    clear() {
      Array.from(files.keys()).forEach(k => { const f = files.get(k); URL.revokeObjectURL(f.url); if (f.artUrl) URL.revokeObjectURL(f.artUrl); });
      files.clear(); A.idb.clear().catch(() => {}); A.emit('local');
    },
    forgetStored() { return A.idb.clear().catch(() => {}); },
    revokeAll() { files.forEach(f => { URL.revokeObjectURL(f.url); if (f.artUrl) URL.revokeObjectURL(f.artUrl); }); }
  };
  window.addEventListener('pagehide', () => A.local.revokeAll());
})(window.Aurora);
