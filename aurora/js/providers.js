/* AURORA — providers.js
   Smart URL detection + lightweight metadata lookups through the providers' own public oEmbed endpoints.
   Nothing here downloads or proxies media. */
(function (A) {
  'use strict';
  const YT_HOSTS = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'youtu.be'];
  const SP_HOSTS = ['open.spotify.com', 'play.spotify.com', 'embed.spotify.com'];
  const SP_SHORT = ['spotify.link', 'spoti.fi'];
  const SP_TYPES = ['track', 'album', 'playlist', 'artist', 'episode', 'show'];
  const AUDIO_EXT = ['mp3', 'wav', 'wave', 'ogg', 'oga', 'opus', 'aac', 'm4a', 'flac', 'weba', 'webm', 'mp4', 'm3u8'];
  const NOT_AUDIO_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'pdf', 'zip', 'rar', 'html', 'htm', 'js', 'css', 'json', 'txt', 'doc', 'docx', 'exe'];
  const OTHER_SERVICES = {
    'soundcloud.com': 'SoundCloud', 'music.apple.com': 'Apple Music', 'deezer.com': 'Deezer', 'tidal.com': 'Tidal',
    'bandcamp.com': 'Bandcamp', 'music.amazon.com': 'Amazon Music', 'pandora.com': 'Pandora', 'vimeo.com': 'Vimeo',
    'twitch.tv': 'Twitch', 'tiktok.com': 'TikTok', 'facebook.com': 'Facebook', 'instagram.com': 'Instagram'
  };
  const YT_ID = /^[A-Za-z0-9_-]{11}$/, YT_LIST = /^[A-Za-z0-9_-]{10,80}$/, SP_ID = /^[A-Za-z0-9]{10,32}$/;

  const bad = (type, reason) => ({ type, reason });
  const hostIs = (host, list) => list.some(h => host === h || host.endsWith('.' + h));

  function parse(input) {
    const raw = String(input == null ? '' : input).trim();
    if (!raw) return { type: 'empty' };
    if (raw.length > 2048) return bad('invalid', 'That link is too long (limit 2048 characters).');

    let m = /^spotify:(?:user:[^:]+:)?(track|album|playlist|artist|episode|show):([A-Za-z0-9]{10,32})$/i.exec(raw);
    if (m) return spotify(m[1].toLowerCase(), m[2]);

    let s = raw;
    if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?([\/?#]|$)/i.test(s)) s = 'http://' + s;
    else if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
      if (/^[\w-]+(\.[\w-]+)+(:\d+)?([\/?#]|$)/.test(s)) s = 'https://' + s;
      else return bad('invalid', 'That doesn\'t look like a link. Paste a full URL such as https://youtu.be/… or https://open.spotify.com/….');
    }
    let url;
    try { url = new URL(s); } catch (e) { return bad('invalid', 'That link is malformed. Check for typos or missing characters.'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return bad('invalid', 'Only http:// and https:// links are supported.');
    const host = url.hostname.toLowerCase().replace(/^www\./, '');

    /* ---- YouTube ---- */
    if (hostIs(host, YT_HOSTS)) return youtube(url, host);

    /* ---- Spotify ---- */
    if (SP_HOSTS.includes(host)) {
      const segs = url.pathname.split('/').filter(Boolean).filter(x => !/^intl-[a-z-]+$/i.test(x) && x !== 'embed');
      if (segs[0] === 'user' && segs[2] === 'playlist') segs.splice(0, 2);
      if (segs.length >= 2 && SP_TYPES.includes(segs[0])) {
        return SP_ID.test(segs[1]) ? spotify(segs[0], segs[1]) : bad('invalid', 'That Spotify ID looks incomplete. Copy the link again from Spotify (Share → Copy link).');
      }
      return bad('unsupported', 'AURORA can embed Spotify tracks, albums, playlists, artists, episodes and shows. This link points to something else.');
    }
    if (hostIs(host, SP_SHORT)) return bad('unsupported', 'Short Spotify links can\'t be resolved from the browser. Open it, then copy the open.spotify.com link.');

    /* ---- Other services we can't play ---- */
    for (const h in OTHER_SERVICES) {
      if (hostIs(host, [h])) return bad('unsupported', `${OTHER_SERVICES[h]} doesn't offer an embeddable player AURORA can use. Try YouTube, Spotify, a direct audio URL or a local file.`);
    }

    /* ---- Direct audio ---- */
    const last = decodeSafe(url.pathname.split('/').filter(Boolean).pop() || '');
    const ext = (/\.([a-z0-9]{2,5})$/i.exec(last) || [])[1];
    const e = ext && ext.toLowerCase();
    if (e && NOT_AUDIO_EXT.includes(e)) return bad('unsupported', `That link points to a .${e} file, not audio. Use a direct link to an MP3, WAV, OGG, AAC/M4A, FLAC or Opus file.`);
    return { type: 'audio', url: url.href, ext: e || null, guess: !(e && AUDIO_EXT.includes(e)), host: url.hostname, name: last };
  }

  function decodeSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  function spotify(type, id) {
    return { type: 'spotify', spType: type, spId: id, url: `https://open.spotify.com/${type}/${id}` };
  }

  function youtube(url, host) {
    const p = url.pathname.split('/').filter(Boolean), q = url.searchParams;
    let id = null, list = q.get('list'), sub = host === 'music.youtube.com' ? 'music' : 'video';
    if (host === 'youtu.be') id = p[0];
    else if (p[0] === 'watch') id = q.get('v');
    else if (p[0] === 'shorts') { id = p[1]; sub = 'short'; }
    else if (p[0] === 'embed' && p[1] === 'videoseries') id = null;
    else if (['embed', 'live', 'v'].includes(p[0])) id = p[1];
    else if (p[0] === 'playlist') id = null;
    else return bad('unsupported', 'This YouTube link isn\'t a video or playlist (channel and search pages can\'t be played). Paste a watch, youtu.be, Shorts or playlist link.');

    if (id) {
      if (!YT_ID.test(id)) return bad('invalid', 'That YouTube video ID looks incomplete. Copy the link again from the address bar or the Share button.');
      return { type: 'youtube', sub, id, list: list && YT_LIST.test(list) ? list : null, url: `https://www.youtube.com/watch?v=${id}`,
        note: list ? 'Only this video will play. Paste the /playlist link to load the whole playlist.' : '' };
    }
    if (!list || !YT_LIST.test(list)) return bad('invalid', 'This YouTube playlist link has no valid list ID.');
    return { type: 'youtube', sub: 'playlist', id: null, list, url: `https://www.youtube.com/playlist?list=${list}`,
      note: /^(RD|UU|OL|LL|WL)/.test(list) ? 'Auto-generated mixes and some system playlists can\'t be embedded; if it fails, try a normal playlist.' : '' };
  }

  /** Short label for the live "smart detection" chip under the input. */
  function describe(parsed) {
    switch (parsed.type) {
      case 'empty': return { text: 'Supports YouTube, Spotify and direct audio links.', level: '' };
      case 'youtube': return { text: parsed.sub === 'playlist' ? 'YouTube playlist detected' : parsed.sub === 'short' ? 'YouTube Short detected' : parsed.sub === 'music' ? 'YouTube Music video detected' : 'YouTube video detected', level: 'ok' };
      case 'spotify': return { text: `Spotify ${parsed.spType} detected`, level: 'ok' };
      case 'audio': return parsed.guess ? { text: 'Unrecognized link — AURORA will try to play it as audio', level: 'warn' } : { text: `Direct audio (.${parsed.ext}) detected`, level: 'ok' };
      default: return { text: parsed.reason, level: 'bad' };
    }
  }

  /* ---------- metadata ---------- */
  async function fetchJson(url, ms) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || 7000);
    try {
      const r = await fetch(url, { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return await r.json();
    } finally { clearTimeout(t); }
  }

  const SP_NICE = { track: 'Track', album: 'Album', playlist: 'Playlist', artist: 'Artist', episode: 'Episode', show: 'Show' };

  /** Builds a track from a parsed link. Rejects only for definitive "can't be played" answers. */
  async function resolve(p) {
    const base = { id: A.uid() };
    if (p.type === 'youtube') {
      const t = Object.assign(base, { kind: 'youtube', source: 'youtube', ytId: p.id, ytList: p.id ? null : p.list, url: p.url,
        title: p.sub === 'playlist' ? 'YouTube playlist' : 'YouTube video', artist: '', album: '', duration: 0,
        artwork: p.id ? `https://i.ytimg.com/vi/${p.id}/hqdefault.jpg` : null, metaOk: false });
      try {
        const j = await fetchJson('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(p.url));
        if (j.title) t.title = A.clip(j.title, 200);
        if (j.author_name) t.artist = A.clip(j.author_name, 200);
        const th = A.safeHttpUrl(j.thumbnail_url || ''); if (th) t.artwork = th;
        t.metaOk = true;
      } catch (e) {
        if (e.status === 401 || e.status === 403) throw new Error('The owner of this video has disabled embedded playback, so it can\'t be played here. Open it on YouTube instead.');
        if (e.status === 404 || e.status === 400) throw new Error('YouTube says this ' + (p.id ? 'video' : 'playlist') + ' isn\'t available — it may be private, deleted or region-locked.');
        /* offline / blocked: keep going, the player will report the real state */
      }
      return t;
    }
    if (p.type === 'spotify') {
      const t = Object.assign(base, { kind: 'spotify', source: 'spotify', spType: p.spType, spId: p.spId, url: p.url,
        title: 'Spotify ' + SP_NICE[p.spType].toLowerCase(), artist: 'Spotify · ' + SP_NICE[p.spType], album: '', duration: 0, artwork: null, metaOk: false });
      try {
        const j = await fetchJson('https://open.spotify.com/oembed?url=' + encodeURIComponent(p.url));
        if (j.title) t.title = A.clip(j.title, 200);
        const th = A.safeHttpUrl(j.thumbnail_url || ''); if (th) t.artwork = th;
        t.metaOk = true;
      } catch (e) {
        if (e.status === 404 || e.status === 400) throw new Error('Spotify couldn\'t find that ' + p.spType + '. Check the link or whether it was removed.');
      }
      return t;
    }
    if (p.type === 'audio') {
      const nice = (p.name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_+]+/g, ' ').trim();
      const split = /^(.{1,80}?)\s+-\s+(.+)$/.exec(nice);
      return Object.assign(base, { kind: 'audio', source: 'direct', url: p.url, title: A.clip(split ? split[2] : nice, 200) || p.host, artist: split ? A.clip(split[1], 200) : p.host, album: '', duration: 0, artwork: null });
    }
    throw new Error(p.reason || 'This link can\'t be played.');
  }

  A.providers = { parse, describe, resolve };
})(window.Aurora = window.Aurora || {});
