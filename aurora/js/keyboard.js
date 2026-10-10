/* AURORA — keyboard.js
   Global shortcuts. Never active while typing, never when disabled, never with modifier keys.
   Bindings are user-configurable in Settings. */
(function (A) {
  'use strict';
  const ACTIONS = [
    ['playPause', 'Play / pause'], ['seekBack', 'Seek back 5 s'], ['seekFwd', 'Seek forward 5 s'],
    ['volUp', 'Volume up'], ['volDown', 'Volume down'], ['mute', 'Mute'],
    ['fullscreen', 'Fullscreen visualizer'], ['next', 'Next track'], ['prev', 'Previous track']
  ];
  const norm = k => (k.length === 1 ? k.toLowerCase() : k);
  const pretty = k => k === ' ' ? 'Space' : k.startsWith('Arrow') ? { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' }[k] : k.length === 1 ? k.toUpperCase() : k;
  A.keyLabel = pretty;

  function typing(t) {
    if (!t || !t.tagName) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  const run = {
    playPause() { A.player.toggle(); },
    seekBack() { A.player.seekBy(-5); },
    seekFwd() { A.player.seekBy(5); },
    volUp() { if (A.player.S.caps.volume) A.player.setVolume(A.player.S.volume + .05); },
    volDown() { if (A.player.S.caps.volume) A.player.setVolume(A.player.S.volume - .05); },
    mute() { if (A.player.S.caps.volume) A.player.toggleMute(); },
    fullscreen() { A.app.openVisualizer(true); },
    next() { A.player.next(false); },
    prev() { A.player.prev(); }
  };
  const needsCap = { seekBack: 'seek', seekFwd: 'seek', volUp: 'volume', volDown: 'volume', mute: 'volume', playPause: 'play' };

  function onKey(e) {
    const s = A.settings.data;
    if (!s.shortcutsEnabled || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if (typing(e.target) || document.querySelector('dialog[open]')) return;
    const t = e.target;
    // Space / Enter on a focused button or link must keep their native meaning.
    if ((e.key === ' ' || e.key === 'Enter') && t && (t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'SUMMARY' || t.getAttribute && t.getAttribute('role') === 'radio')) return;
    const key = norm(e.key);
    for (const [action] of ACTIONS) {
      if (norm(s.shortcuts[action]) !== key) continue;
      if (needsCap[action] && !A.player.S.caps[needsCap[action]] && !(action === 'playPause' && !A.player.S.track && A.queue.length())) return;   // unsupported → leave the key alone
      e.preventDefault(); run[action](); return;
    }
  }
  document.addEventListener('keydown', onKey);

  /* ---------- settings UI ---------- */
  A.keyboard = {
    ACTIONS,
    render(box) {
      const s = A.settings.data;
      box.replaceChildren();
      ACTIONS.forEach(([id, label]) => {
        const b = A.el('button', { type: 'button', class: 'kbd', 'aria-label': `${label}: ${pretty(s.shortcuts[id])}. Press to change.`, text: pretty(s.shortcuts[id]) });
        b.addEventListener('click', () => capture(b, id, label, box));
        box.append(A.el('div', { class: 'key-row' }, A.el('span', { text: label }), b));
      });
    }
  };

  function capture(btn, id, label, box) {
    btn.classList.add('capturing'); btn.textContent = 'Press a key…';
    const done = () => { document.removeEventListener('keydown', h, true); btn.removeEventListener('blur', cancel); };
    const cancel = () => { done(); A.keyboard.render(box); };
    const h = function (e) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') return cancel();
      if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = norm(e.key), sc = A.settings.data.shortcuts;
      const clash = Object.keys(sc).find(k => k !== id && norm(sc[k]) === key);
      if (clash) { const lbl = ACTIONS.find(a => a[0] === clash)[1]; A.ui.toast(`“${pretty(key)}” is already used for “${lbl}”.`, 'warn'); return cancel(); }
      sc[id] = key; A.settings.save(); done(); A.keyboard.render(box);
      A.ui.toast(`${label}: ${pretty(key)}`, 'success', 2000);
    };
    document.addEventListener('keydown', h, true); btn.addEventListener('blur', cancel);
  }
})(window.Aurora);
