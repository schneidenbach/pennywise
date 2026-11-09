'use strict';

// Runs in every frame of the browsing session (page + chat) before the site's
// own scripts. Only does anything on YouTube with "Block Ads" on: the generic
// blocker (adblock.js) handles network requests, but YouTube serves its ads
// from the same endpoints as videos, so they must be removed from the player
// data before the player reads it, and anything that still slips through is
// skipped.

const { contextBridge, ipcRenderer } = require('electron');

function youtubeAdDefuser() {
  if (window.__pwYtDefuser) return;
  window.__pwYtDefuser = true;

  const AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];
  const prune = (o) => {
    if (!o || typeof o !== 'object') return o;
    for (const k of AD_KEYS) if (k in o) delete o[k];
    if (o.playerResponse && typeof o.playerResponse === 'object') prune(o.playerResponse);
    return o;
  };
  const looksLikePlayer = (o) =>
    o && typeof o === 'object' && (AD_KEYS.some((k) => k in o) || ('playerResponse' in o));

  // 1) Initial page load: inline <script> assigns ytInitialPlayerResponse.
  let initial;
  try {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get: () => initial,
      set: (v) => { initial = prune(v); },
    });
  } catch (e) {}

  // 2) SPA navigation: /youtubei/v1/player responses.
  const parse = JSON.parse;
  JSON.parse = function () {
    const out = parse.apply(this, arguments);
    try { if (looksLikePlayer(out)) prune(out); } catch (e) {}
    return out;
  };
  const json = Response.prototype.json;
  Response.prototype.json = function () {
    return json.call(this).then((out) => {
      try { if (/\/youtubei\/v1\/(player|next)/.test(this.url)) prune(out); } catch (e) {}
      return out;
    });
  };

  // 3) Fallback: if an ad still plays, mute it, fast-forward and hit Skip.
  let inAd = false;
  let wasMuted = false;
  setInterval(() => {
    const player = document.querySelector('#movie_player');
    const video = player && player.querySelector('video');
    if (!video) return;
    if (player.classList.contains('ad-showing')) {
      if (!inAd) { inAd = true; wasMuted = video.muted; }
      video.muted = true;
      video.playbackRate = 16;
      if (Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.max(video.currentTime, video.duration - 0.05);
      }
      const skip = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
      if (skip) skip.click();
    } else if (inAd) {
      inAd = false;
      video.muted = wasMuted;
      video.playbackRate = 1;
    }
  }, 200);
}

try {
  const host = location.hostname;
  if ((host === 'youtube.com' || host.endsWith('.youtube.com')) && ipcRenderer.sendSync('pw:adblock-enabled')) {
    contextBridge.executeInMainWorld({ func: youtubeAdDefuser });
  }
} catch (e) {
  // Never break the page over this.
}
