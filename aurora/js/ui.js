/* AURORA — ui.js
   Core utilities, event bus and reusable UI components (toasts, dialogs, menus, track lists).
   Everything user-supplied is inserted with textContent / setAttribute — never innerHTML. */
(function (w) {
  'use strict';
  const A = (w.Aurora = w.Aurora || {});
  const NS = 'http://www.w3.org/2000/svg';

  /* ---------- tiny event bus ---------- */
  const bus = Object.create(null);
  A.on = function (evt, fn) { (bus[evt] = bus[evt] || []).push(fn); return () => A.off(evt, fn); };
  A.off = function (evt, fn) { const l = bus[evt]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } };
  A.emit = function (evt, a, b) {
    const l = bus[evt]; if (!l) return;
    for (const fn of l.slice()) { try { fn(a, b); } catch (e) { console.error('[Aurora] handler for', evt, 'failed:', e); } }
  };

  /* ---------- helpers ---------- */
  A.$ = (s, r) => (r || document).querySelector(s);
  A.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  A.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  A.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  A.debounce = function (fn, ms) { let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; };
  A.clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');

  A.el = function (tag, props) {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(e.dataset, v);
        else e.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  };

  A.icon = function (name, cls) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
    s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(NS, 'use');
    u.setAttribute('href', '#i-' + name);
    s.appendChild(u);
    return s;
  };

  A.fmtTime = function (s) {
    if (!isFinite(s) || s < 0) return '–:––';
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  };

  /** Returns a normalized http(s) URL string, or null for anything else (javascript:, data:, file: …). */
  A.safeHttpUrl = function (str, maxLen) {
    if (typeof str !== 'string' || str.length > (maxLen || 2048)) return null;
    try { const u = new URL(str.trim()); return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null; } catch (e) { return null; }
  };

  A.setRangeFill = function (input) {
    const min = +input.min || 0, max = +input.max || 100;
    input.style.setProperty('--pct', ((input.value - min) / (max - min || 1) * 100) + '%');
  };

  /** Stable identity for a track (used for dedupe, favorites, highlighting). */
  A.trackKey = function (t) {
    if (!t) return '';
    if (t.kind === 'youtube') return 'yt:' + (t.ytList ? 'list:' + t.ytList : t.ytId);
    if (t.kind === 'spotify') return 'sp:' + t.spType + ':' + t.spId;
    if (t.source === 'local') return t.fileKey || ('local:' + t.title);
    return 'url:' + (t.url || t.title);
  };

  A.sourceLabel = function (t) {
    return t.source === 'youtube' ? 'YouTube' : t.source === 'spotify' ? 'Spotify' : t.source === 'local' ? 'Local' : 'Direct URL';
  };

  /* ---------- generative artwork ---------- */
  const artCache = new Map();
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  A.genArt = function (seed, size) {
    size = size || 256; seed = String(seed || 'aurora');
    const key = seed + '|' + size;
    if (artCache.has(key)) return artCache.get(key);
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); const r = rng(hash(seed));
    const h1 = r() * 360, h2 = (h1 + 50 + r() * 110) % 360;
    const bg = g.createLinearGradient(0, 0, size, size);
    bg.addColorStop(0, `hsl(${h1} 55% 20%)`); bg.addColorStop(1, `hsl(${h2} 60% 9%)`);
    g.fillStyle = bg; g.fillRect(0, 0, size, size);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const x = r() * size, y = r() * size, rad = size * (.28 + r() * .42), h = i % 2 ? h1 : h2;
      const rg = g.createRadialGradient(x, y, 0, x, y, rad);
      rg.addColorStop(0, `hsla(${(h + r() * 40) % 360} 85% 58% / .50)`); rg.addColorStop(1, `hsla(${h} 85% 50% / 0)`);
      g.fillStyle = rg; g.fillRect(0, 0, size, size);
    }
    g.globalCompositeOperation = 'source-over';
    const cx = size * (.25 + r() * .5), cy = size * (.25 + r() * .5);
    g.lineWidth = Math.max(1, size / 220);
    for (let i = 1; i <= 6; i++) { g.strokeStyle = `rgba(255,255,255,${.12 - i * .014})`; g.beginPath(); g.arc(cx, cy, size * .08 * i, 0, 6.283); g.stroke(); }
    const url = c.toDataURL('image/jpeg', .86);
    if (artCache.size > 200) artCache.delete(artCache.keys().next().value);
    artCache.set(key, url);
    return url;
  };
  A.artFor = function (t, size) { return (t && t.artwork) || A.genArt(t ? A.trackKey(t) + (t.title || '') : 'none', size || 256); };

  /* ---------- toasts ---------- */
  A.ui = A.ui || {};
  A.ui.toast = function (msg, type, ms) {
    const box = A.$('#toasts'); if (!box) return;
    type = type || 'info';
    const icon = type === 'success' ? 'check' : type === 'error' || type === 'warn' ? 'alert' : 'info';
    const t = A.el('div', { class: 'toast ' + type, role: type === 'error' ? 'alert' : 'status' }, A.icon(icon), A.el('span', { text: msg }));
    box.append(t);
    while (box.children.length > 4) box.firstChild.remove();
    const life = ms || (type === 'error' ? 7000 : 4000);
    const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 260); };
    const timer = setTimeout(kill, life);
    t.addEventListener('click', () => { clearTimeout(timer); kill(); });
  };

  /* ---------- modal dialogs (native <dialog>: focus trap + Esc + restore focus) ---------- */
  function modal(build) {
    return new Promise(function (resolve) {
      const dlg = A.$('#dlg'), form = A.$('#dlgForm');
      const opener = document.activeElement;
      let done = false;
      form.replaceChildren();
      const finish = function (v) {
        if (done) return; done = true;
        dlg.removeEventListener('close', onClose);
        if (dlg.open) dlg.close();
        if (opener && opener.focus && document.contains(opener)) opener.focus();
        resolve(v);
      };
      const onClose = () => finish(null);
      dlg.addEventListener('close', onClose);
      build(form, finish);
      dlg.showModal();
    });
  }
  const btn = (label, cls, onClick, type) => A.el('button', { type: type || 'button', class: 'btn ' + (cls || ''), onclick: onClick, text: label });

  A.ui.confirm = function (o) {
    return modal(function (form, finish) {
      form.append(A.el('h2', { id: 'dlgTitle', text: o.title || 'Are you sure?' }), A.el('p', { text: o.message || '' }));
      const ok = btn(o.confirmText || 'Confirm', o.danger ? 'danger solid' : 'primary', () => finish(true));
      form.append(A.el('div', { class: 'actions' }, btn('Cancel', 'ghost', () => finish(false)), ok));
      setTimeout(() => (o.danger ? form.querySelector('.ghost') : ok).focus(), 30);
    }).then(v => v === true);
  };

  A.ui.prompt = function (o) {
    return modal(function (form, finish) {
      const input = A.el('input', { type: 'text', id: 'dlgInput', maxlength: o.maxLength || 80, autocomplete: 'off', value: o.value || '', 'aria-describedby': 'dlgErr' });
      const err = A.el('div', { class: 'err', id: 'dlgErr', role: 'alert' });
      form.append(A.el('h2', { id: 'dlgTitle', text: o.title }), o.message ? A.el('p', { text: o.message }) : null,
        A.el('label', { for: 'dlgInput', class: 'muted', text: o.label || '' }), input, err,
        A.el('div', { class: 'actions' }, btn('Cancel', 'ghost', () => finish(null)), btn(o.confirmText || 'Save', 'primary', null, 'submit')));
      form.onsubmit = function (e) {
        e.preventDefault();
        const v = input.value.trim();
        const msg = o.validate ? o.validate(v) : (v ? '' : 'Please enter a value.');
        if (msg) { err.textContent = msg; input.focus(); return; }
        finish(v);
      };
      setTimeout(() => { input.focus(); input.select(); }, 30);
    });
  };

  /** options: [{value,label,detail}] → resolves with the chosen value, '__new__' (if o.newLabel) or null */
  A.ui.choose = function (o) {
    return modal(function (form, finish) {
      form.append(A.el('h2', { id: 'dlgTitle', text: o.title }), o.message ? A.el('p', { text: o.message }) : null);
      const list = A.el('div', { class: 'choices' });
      o.options.forEach(function (op) {
        list.append(A.el('button', { type: 'button', class: 'choice', onclick: () => finish(op.value) }, A.el('span', { text: op.label }), op.detail ? A.el('small', { text: op.detail }) : null));
      });
      if (!o.options.length) list.append(A.el('p', { text: o.emptyText || 'Nothing to choose from yet.' }));
      form.append(list);
      const acts = A.el('div', { class: 'actions' });
      if (o.newLabel) acts.append(btn(o.newLabel, '', () => finish('__new__')));
      acts.append(btn('Cancel', 'ghost', () => finish(null)));
      form.append(acts);
      setTimeout(() => { const f = form.querySelector('.choice') || form.querySelector('button'); f && f.focus(); }, 30);
    });
  };

  /* ---------- drawers / bottom sheets ---------- */
  A.ui.openDrawer = function (dlg) {
    if (dlg.open) return;
    dlg.classList.remove('closing'); dlg.showModal();
    dlg.dispatchEvent(new CustomEvent('drawer-open'));
  };
  A.ui.closeDrawer = function (dlg) {
    if (!dlg.open || dlg.classList.contains('closing')) return;
    dlg.classList.add('closing');
    let done = false;
    const end = function () { if (done) return; done = true; dlg.classList.remove('closing'); dlg.close(); };
    dlg.addEventListener('animationend', end, { once: true });
    setTimeout(end, 320);
  };
  A.ui.initDrawer = function (dlg) {
    dlg.addEventListener('cancel', e => { e.preventDefault(); A.ui.closeDrawer(dlg); });
    dlg.addEventListener('click', e => { if (e.target === dlg) A.ui.closeDrawer(dlg); });
    A.$$('[data-close]', dlg).forEach(b => b.addEventListener('click', () => A.ui.closeDrawer(dlg)));
  };

  /* ---------- context menu ---------- */
  let openMenu = null;
  function closeMenu(restore) {
    if (!openMenu) return;
    const m = openMenu; openMenu = null;
    m.el.remove(); document.removeEventListener('pointerdown', m.out, true); document.removeEventListener('keydown', m.key, true);
    if (restore && m.anchor && document.contains(m.anchor)) m.anchor.focus();
  }
  A.ui.closeMenu = closeMenu;
  A.ui.menu = function (anchor, items) {
    closeMenu();
    const m = A.el('div', { class: 'menu', role: 'menu' });
    items.forEach(function (it) {
      if (it.separator) { m.append(A.el('hr')); return; }
      const b = A.el('button', { type: 'button', role: 'menuitem', class: it.danger ? 'danger' : '' }, it.icon ? A.icon(it.icon) : null, A.el('span', { text: it.label }));
      if (it.disabled) { b.disabled = true; if (it.reason) b.title = it.reason; }
      b.addEventListener('click', function () { closeMenu(true); if (it.onSelect) it.onSelect(); });
      m.append(b);
    });
    (anchor.closest('dialog[open]') || document.body).append(m);
    const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
    let left = A.clamp(r.right - mw, 8, innerWidth - mw - 8);
    let top = r.bottom + 6; if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    m.style.left = left + 'px'; m.style.top = top + 'px';
    const btns = () => Array.from(m.querySelectorAll('button:not(:disabled)'));
    const key = function (e) {
      const b = btns(), i = b.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); b[(i + 1) % b.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); b[(i - 1 + b.length) % b.length].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
      else if (e.key === 'Tab') closeMenu(false);
    };
    const out = e => { if (!m.contains(e.target)) closeMenu(false); };
    document.addEventListener('keydown', key, true); document.addEventListener('pointerdown', out, true);
    openMenu = { el: m, anchor, key, out };
    const first = btns()[0]; if (first) first.focus();
  };

  /* ---------- track list ---------- */
  /**
   * opts: { current:key, empty:{icon,title,text,action:{label,onClick}}, onPlay(track,i),
   *         actions:(track,i)=>[{icon,label,onClick,hideMobile}], onReorder(from,to), showDuration:true }
   */
  A.ui.trackList = function (container, tracks, opts) {
    opts = opts || {};
    if (!tracks.length) {
      const e = opts.empty || {};
      container.replaceChildren(A.el('div', { class: 'empty' }, A.icon(e.icon || 'music', 'xl'), A.el('strong', { text: e.title || 'Nothing here yet' }), A.el('p', { text: e.text || '' }),
        e.action ? A.el('button', { type: 'button', class: 'btn primary', onclick: e.action.onClick, text: e.action.label }) : null));
      return;
    }
    const ul = A.el('ul', { class: 'tracks' });
    let dragFrom = -1;
    tracks.forEach(function (t, i) {
      const key = A.trackKey(t);
      const img = A.el('img', { alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false' });
      img.src = A.artFor(t, 96);
      img.addEventListener('error', function () { img.onerror = null; img.src = A.genArt(key, 96); }, { once: true });
      const thumb = A.el('span', { class: 'track-thumb' }, img, A.el('span', { class: 'eq' }, A.el('i'), A.el('i'), A.el('i')));
      const sub = A.el('span', { class: 'track-sub' }, A.el('span', { text: t.artist || '' }), A.el('span', { class: 'badge sm ' + (t.source === 'youtube' ? 'yt' : t.source === 'spotify' ? 'sp' : ''), text: A.sourceLabel(t) }));
      const main = A.el('button', { type: 'button', class: 'track-main', 'aria-label': 'Play ' + (t.title || 'track') }, thumb, A.el('span', { class: 'track-text' }, A.el('span', { class: 'track-title', text: t.title || 'Untitled' }), sub));
      if (opts.onPlay) main.addEventListener('click', () => opts.onPlay(t, i));
      const acts = A.el('div', { class: 'track-actions' });
      if (opts.showDuration !== false && t.duration > 0) acts.append(A.el('span', { class: 'track-dur', text: A.fmtTime(t.duration) }));
      const list = (opts.actions ? opts.actions(t, i) : []).slice();
      if (opts.onReorder) {
        list.unshift({ icon: 'up', label: 'Move up', onClick: () => i > 0 && opts.onReorder(i, i - 1, true) },
          { icon: 'down', label: 'Move down', onClick: () => i < tracks.length - 1 && opts.onReorder(i, i + 1, true) });
      }
      list.forEach(a => acts.append(A.el('button', { type: 'button', class: 'icon-btn' + (a.hideMobile ? ' hide-m' : ''), 'aria-label': a.label + ': ' + (t.title || 'track'), title: a.label, onclick: e => { e.stopPropagation(); a.onClick(t, i, e.currentTarget); } }, A.icon(a.icon))));
      const li = A.el('li', { class: 'track' + (opts.current && opts.current === key ? ' current' : ''), dataset: { key } }, main, acts);
      if (opts.onReorder) {
        li.draggable = true;
        li.addEventListener('dragstart', e => { dragFrom = i; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(i)); } catch (x) { /* ignore */ } });
        li.addEventListener('dragend', () => { li.classList.remove('dragging'); ul.querySelectorAll('.drop-before,.drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after')); dragFrom = -1; });
        li.addEventListener('dragover', e => {
          if (dragFrom < 0) return; e.preventDefault();
          const after = e.clientY > li.getBoundingClientRect().top + li.offsetHeight / 2;
          ul.querySelectorAll('.drop-before,.drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));
          li.classList.add(after ? 'drop-after' : 'drop-before');
        });
        li.addEventListener('drop', e => {
          if (dragFrom < 0) return; e.preventDefault();
          const after = e.clientY > li.getBoundingClientRect().top + li.offsetHeight / 2;
          let to = i + (after ? 1 : 0); if (dragFrom < to) to--;
          const from = dragFrom; dragFrom = -1;
          if (to !== from) opts.onReorder(from, to, false);
        });
      }
      ul.append(li);
    });
    container.replaceChildren(ul);
  };
})(window);
