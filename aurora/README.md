# AURORA — Music Player

A premium, immersive music player built with plain **HTML, CSS and JavaScript** — no framework, no build step, no dependencies.

* Plays **YouTube** (official IFrame Player API), **Spotify** (official embed + iFrame API), **direct audio URLs** (MP3, WAV, OGG, AAC/M4A, FLAC, Opus…) and **local files**.
* Seven audio-reactive visualizer modes on Canvas 2D, fed by a real Web Audio `AnalyserNode` whenever the browser is allowed to read the audio — and clearly labelled ambient animation when it isn't.
* Queue, playlists, favorites, history, themes (incl. custom colours and artwork-derived accent), keyboard shortcuts, JSON export/import, responsive layout from 320 px to ultrawide.

AURORA never downloads, proxies, decrypts or extracts YouTube/Spotify audio. See [Honest limits](#honest-limits).

---

## 1. Run it on Windows

AURORA is static files. Any of these works — **option A is the easiest**.

### A. `start-aurora.bat` (recommended)
1. Unzip the folder anywhere (e.g. `C:\aurora`).
2. Double-click **`start-aurora.bat`**. It starts a tiny local server on port 8080 and opens `http://localhost:8080/index.html`.
   * Needs **Python 3** ([python.org](https://www.python.org/downloads/), tick *Add python.exe to PATH*) **or** **Node.js** ([nodejs.org](https://nodejs.org/)). Windows 10/11 usually offers Python through `py`.
3. Close the black console window to stop the server.

### B. PowerShell / Command Prompt
```powershell
cd C:\aurora
py -m http.server 8080          # or: python -m http.server 8080
# then open http://localhost:8080
```
With Node instead: `npx serve -l 8080 .`

### C. VS Code
Install the **Live Server** extension, right-click `index.html` → *Open with Live Server*.

### D. Double-click `index.html` (limited)
It works for local files and most direct URLs (the app deliberately uses classic `<script>` tags, not ES modules, so it isn't blocked by `file://` rules). **But YouTube often refuses to play from `file://` pages (error 153)** and `fetch` metadata lookups can fail. Use A–C for the full experience.

> Use a current Chrome, Edge, Firefox or Safari. Everything is plain web-platform code (CSS `@property`, `color-mix`, `<dialog>`, Web Audio).

---

## 2. Using it

| Source | How |
|---|---|
| **Direct audio URL** | Paste a link to an audio file, e.g. `https://example.com/song.mp3`, press **Play** (or Enter). Use **Add to queue** to queue without playing. |
| **YouTube** | Paste a `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, `music.youtube.com` or `/playlist?list=` link. The official player appears on Home (it docks to the corner while you browse other pages). |
| **Spotify** | Paste an `open.spotify.com` track / album / playlist / artist / episode / show link (or a `spotify:track:…` URI). The official embed appears on Home. |
| **Local files** | **Local files** button, drag & drop anywhere, or *Local Library → Add files*. Multiple files are fine. Title / artist / album / cover art are read from ID3v2 tags (MP3) when present; other formats fall back to the filename. |
| **Demo** | Home → *How playback works* → **Play the built-in demo tone** (served from `assets/demo-tone.wav`). |

Smart detection runs as you type and tells you what it recognised. Nothing is reported as "loaded" until the source actually loaded; failures show a specific message and aren't added to the queue or history.

### Keyboard shortcuts (rebindable in *Appearance → Keyboard shortcuts*, or switch off)
`Space` play/pause · `←` `→` seek 5 s · `↑` `↓` volume · `M` mute · `F` fullscreen visualizer · `N` next · `P` previous.
Shortcuts never fire while you type in a field, when a dialog is open, with Ctrl/Alt/⌘, or for actions the current source can't do.

### Visualizer
*Audio Visualizer* page: Spectrum Bars, Waveform (centered or symmetrical), Circular Spectrum, Aurora Waves, Particle Field, Minimal Pulse, Album Art Reactive. Controls: sensitivity, smoothing, particle density, colour intensity, background brightness, background artwork, frequency labels, reduce motion, pause animation, fullscreen, reset. A status chip always says which of these you're seeing:

* **LIVE AUDIO ANALYSIS** — real FFT of the audio signal (local files; direct URLs whose server allows CORS).
* **AMBIENT VISUAL MODE** — a synthetic, slowly-breathing animation. Used for YouTube and Spotify because their audio is not exposed to web pages. It does **not** represent the music.
* **AUDIO ANALYSIS UNAVAILABLE** — nothing loaded, or the source blocks reading its audio (CORS) / the browser is holding the audio engine. Playback still works; visuals are ambient and the HUD explains why.

---

## 3. What works without any API credentials

Everything. AURORA needs **no API keys, no OAuth, no backend**:

* Direct URL and local-file playback, queue, playlists, favorites, themes, visualizer, import/export.
* YouTube playback via the public IFrame Player API (title/channel via YouTube's public oEmbed endpoint).
* Spotify playback via the public embed / iFrame API (title/cover via Spotify's public oEmbed endpoint).

## 4. What would need external developer configuration (not implemented)

* **Spotify Web API** (read your library, playlists, full track metadata, artist names, Web Playback SDK): requires registering an app in the Spotify Developer Dashboard and the **Authorization Code with PKCE** flow (a redirect URI you control; Premium for the Web Playback SDK). No client secret may ever be placed in frontend code. AURORA doesn't implement it; the embed covers playback.
* **YouTube Data API v3** (search, richer metadata): needs a Google Cloud API key. Not used; the IFrame API + oEmbed are enough for playback.
* **Server-side features** (accounts, syncing playlists between devices, proxying audio that lacks CORS headers): need a backend. AURORA is frontend-only by design and does not ship a proxy for circumventing restrictions.

---

## 4b. Honest limits

* **Spotify**: playback is Spotify's own embed. Without a Spotify login in that embed you typically get ~30-second previews; full tracks need an account logged in to that browser. Availability depends on Spotify's current policies and your region. When the iFrame API loads, AURORA can play/pause/seek and show progress; **volume and speed can't be controlled** (those controls are disabled with an explanation). If the API script is blocked, a plain embed is shown and you use its own buttons. Spotify's audio cannot be analysed.
* **YouTube**: some videos forbid embedding (you'll get a clear message and an *Open original link* button). The visible official player is never hidden. Audio can't be analysed. Autoplay may be blocked by the browser — press play.
* **Remote audio URLs**: playback works for almost any public file, but real-time analysis needs the server to send `Access-Control-Allow-Origin`. AURORA first tries with CORS (analysis on); if that fails it retries without (playback only) and tells you. An `https://` page can't load `http://` audio (mixed content).
* **Seeking** needs a known duration; live streams aren't seekable. Previous-track behaves like most players (restarts the track if >3 s in).
* **Local files** are held as browser `blob:` URLs for the session. If you enable *Remember imported files on this device* they're stored in this browser's IndexedDB (never uploaded; clear them any time). Without it, playlist entries for local files stay as references and you re-add the files in a new session.
* ID3 tag reading is implemented for MP3 (ID3v2.2/2.3/2.4). Tags in FLAC/OGG/M4A aren't read yet — the filename is used.
* Fullscreen isn't available for non-video elements on iPhone Safari (the button disables itself).

---

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| YouTube says *error 153* / won't play | You opened `index.html` from disk. Use `start-aurora.bat` or any `http://localhost` server. |
| "Couldn't load the YouTube/Spotify player" | No internet, or a firewall/ad-blocker blocks `youtube.com` / `open.spotify.com`. Allow them for this page. |
| YouTube "owner disabled embedded playback" | That video can't be embedded. Open it on YouTube or choose another. |
| Spotify embed is blank or only plays 30 s | Log in to Spotify in the same browser (a Premium account for full tracks). Check blockers. |
| Direct link: *"Couldn't play this source"* | The URL may not be an audio file, may need a login, may 404, or the codec isn't supported (try MP3/AAC/OGG). Use *Open original link* to check it in a tab. |
| Visualizer says AUDIO ANALYSIS UNAVAILABLE | The audio host doesn't send CORS headers, or the browser is waiting for a click. Press play once; for CORS, host the file yourself or use a local copy. |
| No sound / nothing happens on first play | Browsers block autoplay until you interact. Click play. |
| `start-aurora.bat` closes immediately | Install Python 3 (tick *Add to PATH*) or Node.js, then rerun. |
| Layout/settings look wrong after an update | *Appearance → Your data → Reset everything*, or clear this site's data. |

---

## 6. Project layout

```
aurora/
├── index.html            markup + inline SVG icon sprite
├── start-aurora.bat      Windows launcher (local server)
├── css/
│   ├── themes.css        design tokens, @property colours (smooth theme crossfade)
│   ├── main.css          reset, layout shell, home/stage
│   ├── components.css    buttons, inputs, lists, playbar, dialogs, toasts, visualizer UI
│   └── responsive.css    tablet / mobile (bottom nav, bottom sheets)
├── js/                   classic scripts sharing one `Aurora` namespace (works on file://)
│   ├── ui.js             helpers, event bus, toasts, dialogs, menus, track list, generative artwork
│   ├── storage.js        localStorage, validated settings, favorites/recents, IndexedDB, export/import
│   ├── themes.js         presets, custom colours, intensity, artwork-derived accent
│   ├── providers.js      URL detection + oEmbed metadata (YouTube, Spotify, direct)
│   ├── local.js          local files, ID3v2 parser, object-URL lifecycle
│   ├── queue.js          queue, shuffle, repeat, history
│   ├── playlists.js      playlist CRUD + persistence
│   ├── youtube.js        YouTube IFrame API adapter
│   ├── spotify.js        Spotify embed / iFrame API adapter
│   ├── player.js         unified playback controller + Web Audio analyser
│   ├── visualizer.js     Canvas 2D engine, 7 modes, controls
│   ├── keyboard.js       shortcuts + rebinding UI
│   └── app.js            wiring: views, stage, input panel, playbar, lists, settings
└── assets/               icon, demo-tone.wav
```

Security notes: user/provider text is only ever inserted with `textContent`/attributes (no `innerHTML`, no `eval`); only `http:`/`https:` URLs are accepted (`javascript:`, `data:`, `file:` are rejected); imported JSON is schema-validated and clamped; no secrets or tokens are stored; external links use `rel="noopener noreferrer"`.

Persistence (localStorage, prefix `aurora.v1.`): theme & custom colours, intensity, motion prefs, visualizer settings, volume/mute/speed, shortcuts, favorites, recents, imported links, playlists, queue. Export/import covers settings, favorites, recents, imported links and playlists (never audio files).

---

## 7. Feature checklist

**Fully implemented**
- Direct-URL and local-file playback: play/pause, seek, volume, mute, speed, duration, repeat, shuffle, queue, prev/next, error classification (network / decode / unsupported / CORS / mixed content / timeout).
- YouTube video, Shorts, music.youtube.com and playlist links via the official player; synced play/pause/seek/volume/speed/progress; auto-advance; meaningful error messages.
- Spotify track/album/playlist/artist/episode/show embeds with official attribution.
- Queue (add, play-next, remove, drag or button reorder, clear with confirmation, dedupe, save as playlist, persisted).
- Playlists (create, rename, delete with confirmation, add/remove/reorder, play, shuffle-play, persisted).
- Favorites, recently played, recently imported links.
- 7 themes incl. custom colours, visual-intensity slider, artwork-derived accent (when the image is CORS-readable), smooth theme crossfade, artwork float/rotation with adjustable intensity.
- 7 visualizer modes with all requested controls; honest status label; page-hidden suspension; adaptive quality; ResizeObserver.
- Keyboard shortcuts (configurable/disable-able), tooltips, accessible dialogs (`<dialog>`), toasts, skeleton artwork, empty states, reduced-motion support, Media Session (hardware keys) for audio.
- JSON export/import with validation; reset with confirmation.
- Responsive 320 px → ultrawide; bottom navigation + bottom sheets on mobile.

**Partially supported (platform-limited)**
- Spotify: play/pause/seek/progress only through Spotify's iFrame API; no volume/speed; previews without login; no analysis.
- YouTube: only embeddable videos; no analysis; autoplay may need a click.
- Real-time analysis for direct URLs: only when the server allows CORS.
- Metadata: ID3v2 for MP3 only; Spotify shows title/cover but not artist (oEmbed doesn't provide it).
- Seek preview shows the time under the pointer (no thumbnail).

**Externally dependent / not implemented**
- Spotify Web API / Web Playback SDK (needs a Developer app + PKCE), YouTube Data API (needs a key), cross-device sync (needs a backend).

---

## 8. Testing performed

Automated checks were run in headless Chromium (Playwright) against a local server:
no uncaught JavaScript errors; URL detection for 25 YouTube/Spotify/direct/invalid inputs; direct-URL playback with live analysis (a generated WAV); local import (3 files), filename and ID3 parsing, queue operations, playlists, favorites, themes/custom colours, persistence across reload, JSON export/import incl. a hostile import file, reset, keyboard shortcuts (including not firing while typing and rebinding), reduced-motion, all 7 visualizer modes, layouts at 320/375/768/1100/1920/2560 px with no horizontal overflow.

**Not verified against the live services:** the sandbox had no outbound access to youtube.com or spotify.com, so YouTube and Spotify integration was exercised with *mocked* versions of their official APIs (to test AURORA's own state sync, docking, error handling and queue advance) plus the offline-failure path. Please try a real YouTube and Spotify link on your machine and report anything unexpected. Real-device testing (iOS/Android, screen readers) was not done.
