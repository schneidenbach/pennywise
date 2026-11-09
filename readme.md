# Pennywise (macOS, 2026 refresh)

A small always-on-top browser for macOS. Browse normally, then flip any stream
into **Focus** to see just the video, with an optional **chat panel** for Twitch
and YouTube live streams.

Modernised fork of [kamranahmedse/pennywise](https://github.com/kamranahmedse/pennywise):
Electron 45 (Chromium 156), no React/CRA, macOS only.

## Features

- **Normal mode**: a regular browser with back/forward/reload and an address bar.
- **Focus mode** (`⇧⌘F`): just the stream, edge to edge.
  - Twitch channels and VODs switch to Twitch's own popout player.
  - YouTube watch and live pages keep the page and isolate the player (no reload).
  - Other sites: the largest video on the page fills the window.
  - The toolbar hides; move the pointer to the top edge to bring it back.
  - The player's own fullscreen button also enters Focus instead of a new macOS Space.
- **Chat panel** (`⇧⌘K`): Twitch chat or YouTube live chat beside the player.
  Resize it with `⌥⌘←` / `⌥⌘→`.
- **Stays signed in**: log in to Twitch and YouTube once, inside the app.
  Turbo, subscriptions and YouTube Premium apply as usual (no ads).
- **Ad blocking** (on by default; app menu → Block Ads): network and cosmetic
  filtering (uBlock/EasyList lists), plus a YouTube-specific defuser that
  strips pre-rolls and skips any that slip through.
- **Float on top** (`⇧⌘P`), optionally over full-screen apps.
- **Opacity** (`⇧⌘↑` / `⇧⌘↓`, or the toolbar slider).
- **Click-through mode** (`⇧⌘D`, works globally to turn it off again).
- Remembers window position, size, mode, opacity and the last page.

## Run / build

```bash
npm install
npm start          # run from source
npm test           # URL / site-detection tests
npm run dist       # dist/Pennywise-<ver>-arm64.dmg (+ .zip)
```

The build is ad-hoc signed (not notarised). On first launch, right-click →
Open, or run `xattr -dr com.apple.quarantine /Applications/Pennywise.app`.

## Opening links from elsewhere

```bash
open "pennywise://open?url=https://twitch.tv/somechannel&focus=1"
curl "http://127.0.0.1:6280/?url=https://youtu.be/VIDEO_ID&focus=1"
/Applications/Pennywise.app/Contents/MacOS/Pennywise --url https://twitch.tv/x --focus
```

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `⇧⌘F` | Toggle Focus / Browser mode |
| `⇧⌘K` | Show / hide chat |
| `⌥⌘←` `⌥⌘→` | Wider / narrower chat |
| `⌘L` | Address bar |
| `⌘[` `⌘]` | Back / forward |
| `⌘R` / `⇧⌘R` | Reload / hard reload |
| `⇧⌘P` | Float on top |
| `⇧⌘↑` `⇧⌘↓` | Opacity |
| `⇧⌘D` | Click-through mode |
| `⇧⌘H` | Start page |
| `⇧⌘O` | Open the page in your default browser |

## Notes

- Twitch inserts ads into the video stream server-side, so the ad blocker can't
  remove them. Being signed in with Turbo or a sub to the channel can.
- Sign-in popups (Google, Twitch, Apple…) open in a small window that shares
  the same profile. *Clear Browsing Data…* in the app menu signs you out everywhere.

## Layout

```
app/main.js          window, views, modes, chat, IPC, URL server
app/sites.js         URL normalising + Twitch/YouTube detection (pure, tested)
app/focus.js         CSS/JS that isolates the player in Focus mode
app/page-preload.js  YouTube ad defuser (document-start)
app/adblock.js       Ghostery adblock engine (cached in userData)
app/menu.js          menu bar
app/ui/              toolbar + start page (plain HTML/CSS/JS)
```

MIT. Original © Kamran Ahmed.
