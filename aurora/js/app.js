/* AURORA — app.js
   Wires the UI to the modules: navigation, stage, input panel, playback bar, queue, lists, settings. */
(function (A) {
  'use strict';
  const $ = A.$, $$ = A.$$, el = A.el;
  const P = A.player, S = P.S, settings = A.settings.data;
  const VIEWS = { home: 'Home', recent: 'Recently Played', favorites: 'Favorites', playlists: 'Playlists', library: 'Local Library', visualizer: 'Audio Visualizer', settings: 'Appearance' };
  let view = 'home', prevView = 'home', selPl = null;

  /* ====================================================== navigation */
  function showView(id, o) {
    if (!VIEWS[id]) id = 'home';
    o = o || {};
    if (id !== view) prevView = view;
    view = id;
    $$('.view').forEach(v => { v.hidden = v.dataset.view !== id; });
    $$('.nav-item[data-view]').forEach(b => { if (b.dataset.view === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $('#pageTitle').textContent = VIEWS[id];
    $('#pbViz').setAttribute('aria-pressed', String(id === 'visualizer'));
    if (o.hash !== false) { try { history.replaceState(null, '', '#' + id); } catch (e) { /* file:// quirks */ } }
    renderView(id);
    A.viz.setView(id);
    $('#main').scrollTop = 0;
    requestAnimationFrame(layoutEmbed);
    if (o.focus) $('#main').focus({ preventScroll: true });
  }
  function renderView(id) {
    ({ home: renderHome, recent: renderRecent, favorites: renderFavs, playlists: renderPlaylists, library: renderLibrary, settings: () => {} }[id] || (() => {}))();
  }

  $$('.nav-item[data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view, { focus: true })));
  $('#navMore').addEventListener('click', e => A.ui.menu(e.currentTarget, [
    { label: 'Recently Played', icon: 'clock', onSelect: () => showView('recent') },
    { label: 'Favorites', icon: 'heart', onSelect: () => showView('favorites') },
    { label: 'Appearance', icon: 'sliders', onSelect: () => showView('settings') }]));
  $('#collapseBtn').addEventListener('click', () => {
    const c = !$('#app').classList.contains('collapsed'); $('#app').classList.toggle('collapsed', c);
    $('#collapseBtn').setAttribute('aria-pressed', String(c)); $('#collapseBtn').setAttribute('aria-label', c ? 'Expand sidebar' : 'Collapse sidebar'); $('#collapseBtn').dataset.tip = c ? 'Expand sidebar' : 'Collapse sidebar';
    A.settings.set('sidebarCollapsed', c); setTimeout(() => { layoutEmbed(); }, 320);
  });
  $('#themeBtn').addEventListener('click', () => A.ui.openDrawer($('#themeDrawer')));
  $('#embedShow').addEventListener('click', () => showView('home', { focus: true }));

  A.app = {
    showView,
    openVisualizer(full) { showView('visualizer'); if (full) A.viz.toggleFullscreen(); },
    get view() { return view; }
  };

  /* ====================================================== common actions */
  function toggleFav(t, btn) {
    const on = A.lib.toggleFav(t);
    A.ui.toast(on ? 'Added to favorites' : 'Removed from favorites', 'success', 2200);
    if (btn) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
  }
  async function addToPlaylist(t) {
    if (!t) return;
    const lists = A.playlists.all();
    const choice = await A.ui.choose({ title: 'Add to playlist', message: t.source === 'local' ? 'Local files are saved as references; you\'ll need to re-add the file in a new session to play it.' : '', options: lists.map(p => ({ value: p.id, label: p.name, detail: p.tracks.length + ' tracks' })), newLabel: 'New playlist…', emptyText: 'You have no playlists yet.' });
    if (!choice) return;
    let id = choice;
    if (choice === '__new__') { const p = await newPlaylist(); if (!p) return; id = p.id; }
    const ok = A.playlists.addTrack(id, t);
    A.ui.toast(ok ? 'Added to “' + A.playlists.get(id).name + '”' : 'It\'s already in that playlist.', ok ? 'success' : 'info');
  }
  async function newPlaylist() {
    const name = await A.ui.prompt({ title: 'New playlist', label: 'Name', confirmText: 'Create', maxLength: 60, validate: v => !v ? 'Give your playlist a name.' : A.playlists.nameTaken(v) ? 'You already have a playlist with that name.' : '' });
    if (!name) return null;
    const p = A.playlists.create(name); selPl = p.id; return p;
  }
  function rowActions(t) {
    return [
      { icon: 'heart', label: A.lib.isFav(t) ? 'Remove from favorites' : 'Add to favorites', onClick: (tr, i, b) => toggleFav(tr, b) },
      { icon: 'queue', label: 'Add to queue', hideMobile: true, onClick: tr => { const r = A.queue.add(resolveLocal(tr)); A.ui.toast(r.added ? 'Added to queue' : 'Already in the queue', r.added ? 'success' : 'info', 2200); } },
      { icon: 'library', label: 'Add to playlist', hideMobile: true, onClick: tr => addToPlaylist(tr) }
    ];
  }
  function resolveLocal(t) { return t.source === 'local' ? (A.local.trackFor(t.fileKey) || t) : t; }
  const curKey = () => (S.track ? A.trackKey(S.track) : '');
  function playFromList(t) { P.play(t).then(ok => { if (!ok && S.error && t.source !== 'local') A.ui.toast(S.error, 'error'); }); }
  async function playAll(list, shuffle) {
    const live = list.map(resolveLocal).filter(t => t.source !== 'local' || t.url);
    if (!live.length) { A.ui.toast('Nothing playable in this list right now.', 'warn'); return; }
    if (live.length < list.length) A.ui.toast((list.length - live.length) + ' local file(s) skipped — they aren\'t loaded this session.', 'warn');
    A.queue.setShuffle(!!shuffle);
    A.queue.replace(live, 0);
    const start = shuffle ? Math.floor(Math.random() * live.length) : 0;
    P.playIndex(start);
  }

  /* ====================================================== stage (home) */
  let lastArt = '', lastArtKey = '';
  function renderStage() {
    const t = S.track;
    const slot = $('#mediaSlot');
    slot.dataset.kind = t ? t.kind : 'audio';
    slot.dataset.big = t && t.kind === 'spotify' && t.spType !== 'track' && t.spType !== 'episode' ? '1' : '0';
    const frame = $('#artFrame');
    frame.classList.toggle('loading', S.status === 'loading');
    frame.classList.toggle('playing', S.playing);
    frame.dataset.motion = settings.artMotion > 0 ? settings.artStyle : 'off';

    const badge = $('#npBadge');
    badge.hidden = !t;
    if (t) { badge.textContent = A.sourceLabel(t); badge.className = 'badge' + (t.source === 'youtube' ? ' yt' : t.source === 'spotify' ? ' sp' : ''); }

    $('#npTitle').textContent = t ? t.title : 'Nothing playing';
    $('#npArtist').textContent = t ? (t.artist || (t.source === 'local' ? 'Local file' : '')) : 'Paste a link or add local files to begin.';
    $('#npAlbum').textContent = t ? (t.album || '') : '';

    let status = '';
    if (S.status === 'loading') status = 'Loading…';
    else if (S.buffering) status = 'Buffering…';
    else if (t && t.kind === 'spotify' && S.status === 'ready') status = S.caps.play ? 'Spotify embed · full tracks need a Spotify login in the player, otherwise you\'ll hear a preview' : 'Spotify embed · use the player\'s own controls';
    else if (t && t.kind === 'youtube' && S.status === 'ready') status = 'Official YouTube player';
    $('#npStatus').textContent = status;

    const err = $('#npError');
    if (S.status === 'error' || (S.error && S.status !== 'loading')) {
      err.hidden = false; err.replaceChildren(el('strong', { text: 'Couldn\'t play this' }), el('span', { text: S.error || 'Unknown error.' }));
      const acts = el('div', { class: 'btn-row', style: 'margin-top:10px' });
      if (t) acts.append(el('button', { type: 'button', class: 'btn sm', text: 'Try again', onclick: () => P.load(t) }));
      const href = t && t.source !== 'local' ? A.safeHttpUrl(t.url || '') : null;
      if (href) acts.append(el('a', { class: 'btn sm ghost', href, target: '_blank', rel: 'noopener noreferrer', text: 'Open original link' }));
      err.append(acts);
    } else err.hidden = true;

    // artwork
    const key = t ? A.trackKey(t) : '';
    const art = t ? A.artFor(t, 640) : A.genArt('aurora-idle', 640);
    if (art !== lastArt) {
      lastArt = art; const img = $('#artImg'); img.classList.remove('ready');
      img.onload = () => img.classList.add('ready');
      img.onerror = () => { img.onerror = null; img.src = A.genArt(key || 'aurora-idle', 640); };
      img.referrerPolicy = 'no-referrer'; img.src = art;
    }
    if (key !== lastArtKey) { lastArtKey = key; updateGlow(t); }

    const fav = t ? A.lib.isFav(t) : false;
    ['npFav', 'pbFav'].forEach(id => {
      const b = $('#' + id); b.disabled = !t; b.classList.add('is-fav'); b.setAttribute('aria-pressed', String(fav));
      b.dataset.tip = fav ? 'Remove from favorites' : 'Add to favorites'; b.setAttribute('aria-label', b.dataset.tip);
    });
    $('#npAddPl').disabled = !t; $('#npMore').disabled = !t;
  }
  function updateGlow(t) {
    const stage = $('#stage');
    if (!t || !t.artwork) { stage.style.removeProperty('--glow-a'); stage.style.removeProperty('--glow-b'); A.themes.setArtColor(null); return; }
    const key = A.trackKey(t);
    A.themes.colorFromImage(t.artwork).then(hex => {
      if (key !== curKey()) return;
      A.themes.setArtColor(hex);
      if (!hex) { stage.style.removeProperty('--glow-a'); stage.style.removeProperty('--glow-b'); return; }
      const pair = A.themes.pairFrom(hex); stage.style.setProperty('--glow-a', pair[0]); stage.style.setProperty('--glow-b', pair[1]);
    });
  }
  $('#npFav').addEventListener('click', e => S.track && toggleFav(S.track, e.currentTarget));
  $('#pbFav').addEventListener('click', e => S.track && toggleFav(S.track, e.currentTarget));
  $('#npAddPl').addEventListener('click', () => addToPlaylist(S.track));
  $('#npMore').addEventListener('click', e => {
    const t = S.track, href = t && t.source !== 'local' ? A.safeHttpUrl(t.url || '') : null;
    A.ui.menu(e.currentTarget, [
      { label: 'Play next', icon: 'queue', onSelect: () => { A.queue.add(t, { next: true }); A.ui.toast('Will play next', 'success', 2000); }, disabled: !t },
      { label: 'Add to playlist…', icon: 'plus', onSelect: () => addToPlaylist(t) },
      { label: 'Playback speed…', icon: 'gauge', onSelect: chooseSpeed, disabled: (S.caps.rates || []).length < 2, reason: 'Speed control isn\'t available for this source.' },
      { separator: true },
      { label: 'Open original link', icon: 'external', onSelect: () => window.open(href, '_blank', 'noopener,noreferrer'), disabled: !href },
      { label: 'Copy link', icon: 'link', onSelect: () => copyText(href), disabled: !href }
    ]);
  });
  function copyText(s) {
    (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(s) : Promise.reject()).then(
      () => A.ui.toast('Link copied', 'success', 2000), () => A.ui.toast('Couldn\'t copy automatically — select the link and copy it manually.', 'warn'));
  }
  async function chooseSpeed() {
    const v = await A.ui.choose({ title: 'Playback speed', options: (S.caps.rates || [1]).map(r => ({ value: String(r), label: r + '×', detail: Math.abs(r - S.rate) < .01 ? 'current' : '' })) });
    if (v) P.setRate(+v);
  }

  /* ====================================================== embed host positioning */
  function layoutEmbed() {
    const host = $('#embedHost'), t = S.track;
    if (!t || t.kind === 'audio') { host.hidden = true; return; }
    host.hidden = false;
    $('#embedLabel').textContent = t.kind === 'youtube' ? 'YouTube' : 'Spotify';
    host.classList.toggle('sp', t.kind === 'spotify');
    if (view !== 'home') { host.classList.add('docked'); host.style.cssText = ''; return; }
    host.classList.remove('docked');
    const r = $('#mediaSlot').getBoundingClientRect(), pr = $('#mainInner').getBoundingClientRect();
    if (!r.width) return;
    host.style.cssText = `left:${r.left - pr.left}px;top:${r.top - pr.top}px;width:${r.width}px;height:${r.height}px`;
  }
  window.addEventListener('resize', A.debounce(layoutEmbed, 60));
  if (window.ResizeObserver) new ResizeObserver(() => layoutEmbed()).observe($('#mediaSlot'));

  /* ====================================================== input panel */
  const input = $('#urlInput'), urlErr = $('#urlError'), hint = $('#urlHint');
  function showFieldError(msg) { urlErr.textContent = msg || ''; urlErr.hidden = !msg; $('#inputRow').classList.toggle('invalid', !!msg); }
  function onInput() {
    showFieldError('');
    $('#urlClear').hidden = !input.value;
    const p = A.providers.parse(input.value), d = A.providers.describe(p);
    hint.textContent = d.text + (p.note ? ' — ' + p.note : ''); hint.className = 'detect ' + d.level;
  }
  input.addEventListener('input', onInput);
  input.addEventListener('paste', () => setTimeout(onInput, 0));
  $('#urlClear').addEventListener('click', () => { input.value = ''; onInput(); input.focus(); });
  function setBusy(b) { ['loadBtn', 'queueBtn'].forEach(id => { $('#' + id).classList.toggle('busy', b && id === 'loadBtn'); $('#' + id).disabled = b; }); input.readOnly = b; }

  async function submitUrl(playNow, text) {
    if (text != null) { input.value = text; onInput(); }
    const p = A.providers.parse(input.value);
    if (p.type === 'empty') { showFieldError('Paste a YouTube, Spotify or audio link first.'); input.focus(); return; }
    if (p.type === 'invalid' || p.type === 'unsupported') { showFieldError(p.reason); input.focus(); return; }
    showFieldError(''); setBusy(true);
    try {
      const t = await A.providers.resolve(p);
      if (playNow) {
        const existed = A.queue.indexOf(t) >= 0;
        const ok = await P.play(t);
        if (ok) { A.lib.addImport(p.url); A.ui.toast('Loaded “' + (S.track ? S.track.title : t.title) + '”', 'success', 2600); input.value = ''; onInput(); if (p.note) A.ui.toast(p.note, 'info', 6000); }
        else {
          if (!existed) { const qi = A.queue.indexOf(t); if (qi >= 0) A.queue.remove(qi); }
          if (S.error) showFieldError(S.error);
        }
      } else {
        const r = A.queue.add(t); A.lib.addImport(p.url);
        A.ui.toast(r.added ? 'Added to queue (not yet verified — it will be checked when it plays)' : 'That\'s already in your queue.', r.added ? 'success' : 'info', 3500);
        input.value = ''; onInput();
      }
    } catch (e) { showFieldError(e.message || 'Couldn\'t load that link.'); }
    finally { setBusy(false); }
  }
  $('#loadForm').addEventListener('submit', e => { e.preventDefault(); submitUrl(true); });
  $('#queueBtn').addEventListener('click', () => submitUrl(false));
  $('#browseBtn').addEventListener('click', () => { fileMode = { play: true }; $('#fileInput').click(); });
  if (/^https?:$/.test(location.protocol)) {
    $('#demoLi').hidden = false;
    $('#demoBtn').addEventListener('click', () => submitUrl(true, new URL('assets/demo-tone.wav', location.href).href));
  }
  $('#clearImports').addEventListener('click', () => A.lib.clearImports());
  function renderImports() {
    const list = A.lib.imports, box = $('#recentLinks');
    $('#recentLinksWrap').hidden = !list.length;
    box.replaceChildren(...list.map(u => {
      let label = u; try { const x = new URL(u); label = x.hostname.replace(/^www\./, '') + (x.pathname.length > 1 ? x.pathname : '') + (x.searchParams.get('v') ? '?v=' + x.searchParams.get('v') : ''); } catch (e) { /* keep */ }
      return el('li', {}, el('button', { type: 'button', class: 'chip', title: u, onclick: () => submitUrl(true, u) }, A.icon('play', 'fill'), el('span', { text: label })));
    }));
  }

  /* ====================================================== local files */
  let fileMode = { play: true };
  $('#fileInput').addEventListener('change', e => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) importFiles(f, fileMode.play); });
  async function importFiles(files, play) {
    const busyToast = files.length > 3 ? (A.ui.toast('Reading ' + files.length + ' files…', 'info', 2500), true) : false; void busyToast;
    const r = await A.local.import(files);
    if (r.added.length) {
      A.queue.addMany(r.added);
      A.ui.toast(r.added.length === 1 ? 'Added “' + r.added[0].title + '”' : r.added.length + ' files added to your library and queue', 'success');
      if (play || !S.track) P.play(r.added[0]);
    } else if (r.duplicates && !r.rejected.length) {
      A.ui.toast('Those files are already in your library.', 'info');
      if (play && files[0]) { const t = A.local.all().find(x => x.title && files[0].name.indexOf(x.title) >= 0); if (t) P.play(t); }
    }
    if (r.rejected.length) A.ui.toast('Skipped: ' + r.rejected.slice(0, 3).join('; ') + (r.rejected.length > 3 ? ` (+${r.rejected.length - 3} more)` : ''), 'warn', 7000);
  }
  // drag & drop anywhere
  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; dragDepth++; $('#dropOverlay').classList.add('show'); });
  window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropOverlay').classList.remove('show'); });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; $('#dropOverlay').classList.remove('show');
    importFiles(e.dataTransfer.files, view !== 'library');
  });
  const dz = $('#dropzone');
  dz.addEventListener('click', () => { fileMode = { play: false }; $('#fileInput').click(); });
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dz.click(); } });
  $('#libBrowse').addEventListener('click', () => { fileMode = { play: false }; $('#fileInput').click(); });
  $('#libClear').addEventListener('click', async () => {
    if (!A.local.all().length) return A.ui.toast('The library is already empty.', 'info');
    if (await A.ui.confirm({ title: 'Clear local library?', message: 'This removes the imported files from AURORA (not from your computer) and from the queue.', confirmText: 'Clear library', danger: true })) {
      A.local.clear(); A.queue.hydrate(); A.ui.toast('Library cleared', 'success');
    }
  });

  /* ====================================================== lists */
  function renderHome() { renderImports(); renderUpNext(); renderStage(); renderBar(); requestAnimationFrame(layoutEmbed); }
  function renderUpNext() {
    const items = A.queue.items(), cur = A.queue.indexOf(S.track), start = cur >= 0 ? cur + 1 : 0;
    const next = items.slice(start, start + 4);
    A.ui.trackList($('#upNext'), next, {
      current: curKey(), showDuration: false,
      empty: items.length ? { icon: 'queue', title: 'Nothing queued after this', text: 'Add more tracks, or turn on repeat to loop the queue.' } : { icon: 'queue', title: 'Queue is empty', text: 'Tracks you load or add will line up here.' },
      onPlay: t => P.playIndex(A.queue.indexOf(t))
    });
  }
  $('#openQueue2').addEventListener('click', openQueue);

  function renderRecent() {
    A.ui.trackList($('#recentList'), A.lib.recents, { current: curKey(), onPlay: playFromList, actions: rowActions, empty: { icon: 'clock', title: 'Nothing played yet', text: 'Tracks that load successfully show up here so you can jump back in.', action: { label: 'Go to Home', onClick: () => showView('home') } } });
  }
  $('#clearRecent').addEventListener('click', async () => {
    if (!A.lib.recents.length) return;
    if (await A.ui.confirm({ title: 'Clear history?', message: 'This clears the Recently Played list. Favorites and playlists are not affected.', confirmText: 'Clear history', danger: true })) { A.lib.clearRecents(); A.ui.toast('History cleared', 'success'); }
  });
  function renderFavs() {
    A.ui.trackList($('#favList'), A.lib.favorites, { current: curKey(), onPlay: playFromList, actions: rowActions, empty: { icon: 'heart', title: 'No favorites yet', text: 'Tap the heart on any track to keep a reference to it here.' } });
    $('#playAllFav').disabled = !A.lib.favorites.length;
  }
  $('#playAllFav').addEventListener('click', () => playAll(A.lib.favorites));
  function renderLibrary() {
    const list = A.local.all();
    A.ui.trackList($('#libList'), list, {
      current: curKey(), onPlay: playFromList,
      actions: t => [
        { icon: 'queue', label: 'Add to queue', onClick: tr => { const r = A.queue.add(tr); A.ui.toast(r.added ? 'Added to queue' : 'Already in the queue', 'info', 2000); } },
        { icon: 'heart', label: 'Toggle favorite', onClick: (tr, i, b) => toggleFav(tr, b) },
        { icon: 'trash', label: 'Remove from library', onClick: tr => { const qi = A.queue.indexOf(tr); A.local.remove(tr.fileKey); if (qi >= 0) A.queue.remove(qi); } }
      ],
      empty: { icon: 'folder', title: 'Your library is empty', text: 'Add MP3, WAV, OGG, AAC/M4A, FLAC or Opus files. They play locally and are never uploaded.', action: { label: 'Add files', onClick: () => $('#libBrowse').click() } }
    });
    $('#libClear').disabled = !list.length;
  }

  function renderPlaylists() {
    const lists = A.playlists.all(), box = $('#plList'), det = $('#plDetail');
    if (!lists.some(p => p.id === selPl)) selPl = lists.length ? lists[0].id : null;
    box.replaceChildren(...lists.map(p => el('button', { type: 'button', class: 'pl-item', 'aria-current': String(p.id === selPl), onclick: () => { selPl = p.id; renderPlaylists(); } }, el('strong', { text: p.name }), el('small', { text: p.tracks.length + (p.tracks.length === 1 ? ' track' : ' tracks') }))));
    if (!lists.length) {
      box.replaceChildren();
      det.replaceChildren(el('div', { class: 'empty' }, A.icon('library', 'xl'), el('strong', { text: 'No playlists yet' }), el('p', { text: 'Create a playlist, then use the + button on any track to collect it here.' }), el('button', { type: 'button', class: 'btn primary', onclick: newPlaylistAndRender, text: 'Create your first playlist' })));
      return;
    }
    const p = A.playlists.get(selPl);
    const head = el('div', { class: 'pl-detail-head' }, el('h3', { text: p.name }),
      el('button', { type: 'button', class: 'btn primary', disabled: !p.tracks.length, onclick: () => playAll(p.tracks) }, A.icon('play', 'fill'), 'Play'),
      el('button', { type: 'button', class: 'btn', disabled: !p.tracks.length, onclick: () => playAll(p.tracks, true) }, A.icon('shuffle'), 'Shuffle'),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Rename playlist', title: 'Rename', onclick: async () => {
        const n = await A.ui.prompt({ title: 'Rename playlist', label: 'Name', value: p.name, maxLength: 60, validate: v => !v ? 'Name can\'t be empty.' : A.playlists.nameTaken(v, p.id) ? 'You already have a playlist with that name.' : '' });
        if (n) { A.playlists.rename(p.id, n); A.ui.toast('Renamed', 'success', 2000); }
      } }, A.icon('pencil')),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete playlist', title: 'Delete', onclick: async () => {
        if (await A.ui.confirm({ title: 'Delete “' + p.name + '”?', message: 'The playlist (' + p.tracks.length + ' tracks) will be removed from this device. The music itself isn\'t affected.', confirmText: 'Delete playlist', danger: true })) { A.playlists.remove(p.id); A.ui.toast('Playlist deleted', 'success'); }
      } }, A.icon('trash')));
    const list = el('div');
    det.replaceChildren(head, list);
    A.ui.trackList(list, p.tracks, {
      current: curKey(), onPlay: (t, i) => { A.queue.replace(p.tracks.map(resolveLocal).filter(x => x.source !== 'local' || x.url), 0); const ix = A.queue.indexOf(resolveLocal(t)); if (ix >= 0) P.playIndex(ix); else playFromList(t); },
      actions: t => [
        { icon: 'heart', label: 'Toggle favorite', onClick: (tr, i, b) => toggleFav(tr, b) },
        { icon: 'trash', label: 'Remove from playlist', onClick: (tr, i) => A.playlists.removeTrack(p.id, i) }
      ],
      onReorder: (from, to) => A.playlists.moveTrack(p.id, from, to),
      empty: { icon: 'music', title: 'This playlist is empty', text: 'Use the + button on the Home screen, or on any track in Favorites or Recently Played.' }
    });
  }
  async function newPlaylistAndRender() { const p = await newPlaylist(); if (p) renderPlaylists(); }
  $('#newPlaylist').addEventListener('click', newPlaylistAndRender);

  /* ====================================================== queue drawer */
  const qd = $('#queueDrawer');
  A.ui.initDrawer(qd); A.ui.initDrawer($('#themeDrawer'));
  function openQueue() { renderQueue(); A.ui.openDrawer(qd); }
  function renderQueue() {
    const items = A.queue.items();
    $('#queueCount').textContent = items.length ? items.length + (items.length === 1 ? ' track' : ' tracks') : '';
    $('#queueClear').disabled = !items.length;
    const body = $('#queueBody'); const list = el('div');
    body.replaceChildren(el('button', { type: 'button', class: 'btn sm', disabled: !items.length, onclick: saveQueueAsPlaylist }, A.icon('library'), 'Save as playlist'), list);
    A.ui.trackList(list, items, {
      current: curKey(), showDuration: true,
      onPlay: (t, i) => P.playIndex(i),
      actions: t => [{ icon: 'x', label: 'Remove from queue', onClick: (tr, i) => A.queue.remove(i) }],
      onReorder: (from, to) => A.queue.move(from, to),
      empty: { icon: 'queue', title: 'The queue is empty', text: 'Paste a link, drop files, or press “Add to queue” on any track. Spotify and YouTube entries are references to external content.' }
    });
  }
  async function saveQueueAsPlaylist() {
    const name = await A.ui.prompt({ title: 'Save queue as playlist', label: 'Name', confirmText: 'Save', maxLength: 60, validate: v => !v ? 'Give your playlist a name.' : A.playlists.nameTaken(v) ? 'You already have a playlist with that name.' : '' });
    if (!name) return;
    const p = A.playlists.create(name); let n = 0; A.queue.items().forEach(t => { if (A.playlists.addTrack(p.id, t)) n++; });
    A.ui.toast(`Saved ${n} track${n === 1 ? '' : 's'} to “${name}”`, 'success');
  }
  $('#queueClear').addEventListener('click', async () => {
    if (await A.ui.confirm({ title: 'Clear the queue?', message: 'The current track keeps playing; everything else is removed.', confirmText: 'Clear queue', danger: true })) A.queue.clear();
  });
  ['pbQueue', 'pbQueueM'].forEach(id => $('#' + id).addEventListener('click', openQueue));

  /* ====================================================== playback bar */
  const seek = $('#pbSeek'), vol = $('#pbVol');
  let dragging = false, raf = 0;
  function renderBar() {
    const t = S.track, caps = S.caps;
    $('#pbTitle').textContent = t ? t.title : 'Nothing playing';
    $('#pbArtist').textContent = t ? (t.artist || (t.source === 'local' ? 'Local file' : '')) : '—';
    const pa = $('#pbArt'); const art = t ? A.artFor(t, 128) : A.genArt('aurora-idle', 128);
    if (pa.dataset.src !== art) { pa.dataset.src = art; pa.referrerPolicy = 'no-referrer'; pa.onerror = () => { pa.onerror = null; pa.src = A.genArt(A.trackKey(t) || 'x', 128); }; pa.src = art; }

    const pb = $('#pbPlay'), ready = t && S.status === 'ready';
    pb.classList.toggle('is-playing', S.playing);
    pb.classList.toggle('loading', S.status === 'loading' || (S.buffering && S.playing));
    const canResume = !t && A.queue.length() > 0;
    pb.disabled = !(ready && caps.play) && !canResume;
    const lbl = !t ? 'Play' : S.status === 'loading' ? 'Loading…' : S.playing ? 'Pause' : 'Play';
    pb.setAttribute('aria-label', lbl);
    pb.dataset.tip = !t ? (canResume ? 'Play the queue (Space)' : 'Load a track to play') : S.status === 'error' ? 'This source failed to load' : S.status === 'loading' ? 'Loading…' : (t.kind === 'spotify' && !caps.play) ? 'Spotify embed: use the play button inside the player' : lbl + ' (Space)';
    document.body.classList.toggle('playing', S.playing);

    $('#pbNext').disabled = !t; $('#pbPrev').disabled = !t;
    seek.disabled = !(ready && caps.seek);
    seek.title = !t ? '' : (!caps.seek ? (t.kind === 'spotify' ? 'Seeking isn\'t available for this Spotify embed' : 'This source doesn\'t report a seekable duration') : '');
    const d = P.getDuration();
    $('#pbDur').textContent = caps.seek && d ? A.fmtTime(d) : (t && ready && t.kind === 'spotify' ? '' : '–:––');

    // volume
    const vOk = !!caps.volume && !!t || !t;
    vol.disabled = !vOk; $('#pbMute').disabled = !vOk;
    vol.value = Math.round((S.muted ? 0 : S.volume) * 100); A.setRangeFill(vol);
    vol.title = t && t.kind === 'spotify' ? 'Volume is controlled inside the Spotify player / your device' : '';
    const mi = S.muted || S.volume === 0 ? 'volume-x' : S.volume < .45 ? 'volume-low' : 'volume';
    $('#pbMute').firstChild.firstChild.setAttribute('href', '#i-' + mi);
    $('#pbMute').setAttribute('aria-label', S.muted ? 'Unmute' : 'Mute'); $('#pbMute').dataset.tip = (S.muted ? 'Unmute' : 'Mute') + ' (M)';

    // speed
    const sp = $('#pbSpeed'), rates = caps.rates || [1];
    sp.disabled = !(ready && rates.length > 1); sp.textContent = (+S.rate.toFixed(2)) + '×';
    sp.setAttribute('aria-label', 'Playback speed: ' + S.rate + '×');
    sp.dataset.tip = sp.disabled && t ? 'Speed control isn\'t available for this source' : 'Playback speed';

    // shuffle / repeat
    const sh = $('#pbShuffle'); sh.setAttribute('aria-pressed', String(A.queue.shuffle)); sh.dataset.tip = 'Shuffle: ' + (A.queue.shuffle ? 'on' : 'off'); sh.setAttribute('aria-label', sh.dataset.tip);
    const rp = $('#pbRepeat'), rm = A.queue.repeat;
    rp.setAttribute('aria-pressed', String(rm !== 'off')); rp.dataset.tip = 'Repeat: ' + rm; rp.setAttribute('aria-label', 'Repeat: ' + rm);
    rp.firstChild.firstChild.setAttribute('href', rm === 'one' ? '#i-repeat-1' : '#i-repeat');

    document.title = t && S.playing ? `${t.title} — AURORA` : 'AURORA — Music Player';
    updateProgress(true);
    if (S.playing && !raf) raf = requestAnimationFrame(progressLoop);
  }
  function updateProgress(force) {
    if (dragging && !force) return;
    const d = P.getDuration(), c = P.getTime();
    if (!dragging) {
      $('#pbCur').textContent = S.track && S.status === 'ready' ? A.fmtTime(c) : '0:00';
      seek.value = d > 0 && !seek.disabled ? Math.round(c / d * 1000) : 0; A.setRangeFill(seek);
    }
  }
  function progressLoop() { raf = 0; if (!S.playing || document.hidden) return; updateProgress(); raf = requestAnimationFrame(progressLoop); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateProgress(); if (S.playing && !raf) raf = requestAnimationFrame(progressLoop); } });

  $('#pbPlay').addEventListener('click', () => P.toggle());
  $('#pbNext').addEventListener('click', () => P.next(false));
  $('#pbPrev').addEventListener('click', () => P.prev());
  $('#pbShuffle').addEventListener('click', () => { A.queue.setShuffle(!A.queue.shuffle); renderBar(); });
  $('#pbRepeat').addEventListener('click', () => { A.queue.cycleRepeat(); renderBar(); });
  $('#pbMute').addEventListener('click', () => P.toggleMute());
  vol.addEventListener('input', () => P.setVolume(vol.value / 100));
  $('#pbSpeed').addEventListener('click', e => A.ui.menu(e.currentTarget, (S.caps.rates || [1]).map(r => ({ label: r + '×' + (Math.abs(r - S.rate) < .01 ? '  ✓' : ''), onSelect: () => P.setRate(r) }))));
  $('#pbViz').addEventListener('click', () => showView(view === 'visualizer' ? (prevView === 'visualizer' ? 'home' : prevView) : 'visualizer'));
  $('#pbFull').addEventListener('click', () => A.app.openVisualizer(true));

  seek.addEventListener('pointerdown', () => { dragging = true; });
  seek.addEventListener('input', () => { dragging = true; A.setRangeFill(seek); $('#pbCur').textContent = A.fmtTime(seek.value / 1000 * P.getDuration()); });
  seek.addEventListener('change', () => { P.seek(seek.value / 1000 * P.getDuration()); dragging = false; updateProgress(true); });
  window.addEventListener('pointerup', () => { if (dragging) setTimeout(() => { dragging = false; }, 50); });
  const wrap = $('#seekWrap');
  wrap.addEventListener('pointermove', e => {
    if (seek.disabled) return;
    const r = seek.getBoundingClientRect(), f = A.clamp((e.clientX - r.left) / r.width, 0, 1);
    $('#seekTip').textContent = A.fmtTime(f * P.getDuration()); $('#seekTip').style.left = (f * r.width) + 'px'; wrap.classList.add('hover');
  });
  wrap.addEventListener('pointerleave', () => wrap.classList.remove('hover'));

  /* ====================================================== settings view */
  function bindSettings() {
    A.themes.bindPicker($('#themeSwatches'), $('#customColors'), $('#customA'), $('#customB'), $('#stIntensity'));
    A.themes.bindPicker($('#themeSwatches2'), $('#customColors2'), $('#customA2'), $('#customB2'), $('#stIntensity2'));
    const auto = $('#stAuto'); auto.checked = settings.autoAccent;
    auto.addEventListener('change', () => { A.themes.setAuto(auto.checked); if (auto.checked) updateGlow(S.track); });
    const mot = $('#stArtMotion'); mot.value = settings.artMotion; A.setRangeFill(mot); mot.parentNode.querySelector('output').textContent = settings.artMotion + '%';
    mot.addEventListener('input', () => { A.settings.set('artMotion', +mot.value); A.setRangeFill(mot); mot.parentNode.querySelector('output').textContent = mot.value + '%'; A.themes.applyMotion(); renderStage(); });
    const seg = $('#stArtStyle');
    const syncSeg = () => $$('button', seg).forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === settings.artStyle)));
    $$('button', seg).forEach(b => b.addEventListener('click', () => { A.settings.set('artStyle', b.dataset.v); syncSeg(); renderStage(); })); syncSeg();
    const rm = $('#stReduce'); rm.value = settings.reduceMotion; rm.addEventListener('change', () => { A.settings.set('reduceMotion', rm.value); A.themes.applyMotion(); A.viz.sync(); });
    const rem = $('#stRemember'); rem.checked = settings.rememberLocal;
    rem.addEventListener('change', async () => {
      A.settings.set('rememberLocal', rem.checked);
      if (rem.checked) { try { await A.local.persistAll(); A.ui.toast('Imported files will be remembered on this device.', 'success'); } catch (e) { A.ui.toast('Your browser wouldn\'t allow local storage of files.', 'error'); rem.checked = false; A.settings.set('rememberLocal', false); } }
      else { await A.local.forgetStored(); A.ui.toast('Stored files removed from this browser. Files stay available until you close the tab.', 'info'); }
    });
    const keys = $('#stKeys'); keys.checked = settings.shortcutsEnabled; keys.addEventListener('change', () => A.settings.set('shortcutsEnabled', keys.checked));
    A.keyboard.render($('#keyList'));
    $('#keysReset').addEventListener('click', () => { settings.shortcuts = Object.assign({}, A.defaultShortcuts); A.settings.save(); A.keyboard.render($('#keyList')); A.ui.toast('Shortcuts restored', 'success', 2000); });

    $('#exportBtn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(A.data.exportObject(), null, 2)], { type: 'application/json' });
      const u = URL.createObjectURL(blob), a = el('a', { href: u, download: 'aurora-backup-' + new Date().toISOString().slice(0, 10) + '.json' });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000);
      A.ui.toast('Exported settings, favorites and playlists', 'success');
    });
    $('#importBtn').addEventListener('click', () => $('#jsonInput').click());
    $('#jsonInput').addEventListener('change', async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try {
        if (f.size > 8 * 1024 * 1024) throw new Error('That file is too large to be an AURORA export.');
        let obj; try { obj = JSON.parse(await f.text()); } catch (x) { throw new Error('That file isn\'t valid JSON.'); }
        if (!obj || obj.app !== 'aurora') throw new Error('This file is not an AURORA export.');
        if (!await A.ui.confirm({ title: 'Import this backup?', message: 'This replaces your current settings, favorites, recents and playlists with the contents of “' + A.clip(f.name, 60) + '”.', confirmText: 'Import' })) return;
        const summary = A.data.importObject(obj);
        A.ui.toast('Imported ' + summary + '. Reloading…', 'success'); setTimeout(() => location.reload(), 900);
      } catch (err) { A.ui.toast(err.message || 'Import failed.', 'error'); }
    });
    $('#resetBtn').addEventListener('click', async () => {
      if (await A.ui.confirm({ title: 'Reset AURORA?', message: 'This erases settings, theme, favorites, recents, playlists, the queue and remembered files on this device. It can\'t be undone — export a backup first if unsure.', confirmText: 'Reset everything', danger: true })) {
        A.local.revokeAll(); await A.data.resetAll(); location.reload();
      }
    });
  }

  /* ====================================================== events */
  const refreshers = { home: renderHome, recent: renderRecent, favorites: renderFavs, playlists: renderPlaylists, library: renderLibrary };
  const renderCurrent = A.debounce(() => { (refreshers[view] || (() => {}))(); if (qd.open) renderQueue(); }, 16);
  A.on('queue', () => { renderCurrent(); renderBar(); });
  A.on('lib', () => { renderCurrent(); renderStage(); });
  A.on('playlists', renderCurrent);
  A.on('local', () => { renderCurrent(); });
  A.on('track', () => { renderStage(); renderBar(); layoutEmbed(); renderCurrent(); updateMediaSession(); A.viz.sync(); });
  A.on('trackupdate', () => { renderStage(); renderBar(); renderCurrent(); updateMediaSession(); });
  A.on('state', () => { renderStage(); renderBar(); if (mediaOK) navigator.mediaSession.playbackState = S.playing ? 'playing' : 'paused'; });
  A.on('caps', renderBar);
  A.on('error', () => { renderStage(); renderBar(); });
  A.on('loaded', o => {
    layoutEmbed(); renderCurrent();
    const r = o.res || {}, t = o.track;
    if (r.blocked) A.ui.toast(t.kind === 'youtube' ? 'Autoplay was blocked — press play in the YouTube player.' : 'Your browser blocked autoplay — press play to start.', 'info', 5000);
    if (r.corsFallback) A.ui.toast('Playing, but this server doesn\'t allow audio analysis (CORS). The visualizer will use an ambient animation.', 'info', 6000);
    if (t.kind === 'spotify' && r.controls === false) A.ui.toast('Spotify embed displayed. Use the play button inside it. If it looks blank, check your connection or any content blockers.', 'info', 7000);
  });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (VIEWS[h] && h !== view) showView(h, { hash: false }); });

  /* Media Session (hardware keys / lock screen) — only for audio we play ourselves */
  const mediaOK = 'mediaSession' in navigator && typeof window.MediaMetadata === 'function';
  function updateMediaSession() {
    if (!mediaOK) return; const t = S.track;
    if (!t || t.kind !== 'audio') { navigator.mediaSession.metadata = null; return; }
    const art = t.artwork && /^(https?:|blob:)/.test(t.artwork) ? [{ src: t.artwork }] : [];
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || '', album: t.album || '', artwork: art }); } catch (e) { /* ignore */ }
  }
  if (mediaOK) {
    const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { /* unsupported action */ } };
    set('play', () => P.toggle()); set('pause', () => P.pause()); set('previoustrack', () => P.prev()); set('nexttrack', () => P.next(false));
    set('seekto', d => d && d.seekTime != null && P.seek(d.seekTime)); set('seekbackward', () => P.seekBy(-10)); set('seekforward', () => P.seekBy(10));
  }

  /* ====================================================== boot */
  function boot() {
    A.themes.init();
    $('#app').classList.toggle('collapsed', !!settings.sidebarCollapsed);
    if (settings.sidebarCollapsed) { const b = $('#collapseBtn'); b.setAttribute('aria-pressed', 'true'); b.setAttribute('aria-label', 'Expand sidebar'); b.dataset.tip = 'Expand sidebar'; }
    bindSettings();
    A.viz.init();
    A.local.restore().then(() => { A.queue.hydrate(); renderCurrent(); });
    A.queue.hydrate();
    const h = location.hash.slice(1);
    showView(VIEWS[h] ? h : 'home', { hash: false });
    renderStage(); renderBar(); renderImports();
    onInput();
    if (location.protocol === 'file:') setTimeout(() => A.ui.toast('Tip: YouTube may refuse to play from a file:// page. Run a local server (see README).', 'info', 7000), 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.Aurora);
