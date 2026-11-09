'use strict';

// CSS + page script used to show "just the video" without reloading the page.
// Everything is gated behind classes on <html>, so leaving focus mode is just
// removing the classes again.

const FOCUS_CSS = `
html.pw-focus, html.pw-focus body {
  overflow: hidden !important;
  background: #000 !important;
}

/* ---- YouTube watch page ---- */
html.pw-focus-yt #masthead-container,
html.pw-focus-yt ytd-masthead,
html.pw-focus-yt tp-yt-app-drawer,
html.pw-focus-yt ytd-mini-guide-renderer { display: none !important; }
html.pw-focus-yt #movie_player {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
  z-index: 2147483646 !important;
  background: #000 !important;
  border-radius: 0 !important;
}
html.pw-focus-yt #movie_player .html5-video-container,
html.pw-focus-yt #movie_player video.html5-main-video {
  width: 100% !important;
  height: 100% !important;
  left: 0 !important;
  top: 0 !important;
}
html.pw-focus-yt #movie_player video.html5-main-video { object-fit: contain !important; }

/* ---- Any other site: the largest <video> on the page ---- */
html.pw-focus .pw-focus-video {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  transform: none !important;
  z-index: 2147483646 !important;
  background: #000 !important;
  object-fit: contain !important;
}

/* Thin, unobtrusive scrollbars everywhere */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: rgba(127,127,127,.35); border-radius: 4px; }
::-webkit-scrollbar-track { background: transparent; }
`;

// Installed once per document; main.js calls window.__pwFocus(on, target).
const FOCUS_SCRIPT = `(() => {
  if (window.__pwFocus) return;
  const root = document.documentElement;

  const largestVideo = () => {
    let best = null, bestArea = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { bestArea = area; best = v; }
    }
    return bestArea > 20000 ? best : null;
  };

  // YouTube is a single-page app: only isolate the player while a watch page
  // (incl. /@channel/live) is actually showing.
  const ytWatching = () => !!document.querySelector('ytd-watch-flexy:not([hidden]) #movie_player');

  window.__pwFocus = (on, target) => {
    if (target === 'youtube' && !ytWatching()) target = 'none';
    root.classList.toggle('pw-focus', on && target !== 'none');
    root.classList.toggle('pw-focus-yt', on && target === 'youtube');

    for (const v of document.querySelectorAll('.pw-focus-video')) {
      v.classList.remove('pw-focus-video');
      if (v.dataset.pwControls) { v.controls = false; delete v.dataset.pwControls; }
    }
    let ok = target !== 'video';
    if (on && target === 'video') {
      const v = largestVideo();
      if (v) {
        ok = true;
        v.classList.add('pw-focus-video');
        if (!v.controls) { v.controls = true; v.dataset.pwControls = '1'; }
      } else {
        root.classList.remove('pw-focus');
      }
    }
    // Let players (YouTube especially) re-measure themselves.
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    setTimeout(() => window.dispatchEvent(new Event('resize')), 250);
    return ok;
  };
})();`;

// Returns the video id when the YouTube watch page shows a live stream (or an
// upcoming premiere), i.e. when it has a live chat worth showing; else null.
const YT_LIVE_ID_SCRIPT = `(() => {
  try {
    if (!document.querySelector('ytd-watch-flexy:not([hidden])')) return null;
    const p = document.querySelector('#movie_player');
    const r = p && p.getPlayerResponse && p.getPlayerResponse();
    const d = r && r.videoDetails;
    if (d && (d.isLive || d.isUpcoming)) return d.videoId;
  } catch (e) {}
  return null;
})()`;

module.exports = { FOCUS_CSS, FOCUS_SCRIPT, YT_LIVE_ID_SCRIPT };
