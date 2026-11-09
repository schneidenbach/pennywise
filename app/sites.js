'use strict';

// Pure URL helpers: turning typed input into a URL, recognising Twitch/YouTube
// pages, and working out what "focus" and "chat" mean for a given page.
// No Electron imports here so it can be unit-tested with plain Node.

// Twitch paths that are not channel names.
const TWITCH_RESERVED = new Set([
  'directory', 'videos', 'settings', 'subscriptions', 'inventory', 'wallet', 'drops',
  'search', 'downloads', 'jobs', 'p', 'turbo', 'prime', 'friends', 'following', 'store',
  'login', 'signup', 'logout', 'messages', 'payments', 'u', 'team', 'moderator', 'popout',
  'embed', 'broadcast', 'creatorcamp', 'bits', 'clips', 'privacy', 'legal', 'security',
  'help', 'activate', 'collections', 'event', 'products', 'redeem', 'lounge',
]);

/**
 * Turns whatever was typed into the address bar into a loadable URL.
 * Plain words become a Google search.
 */
function normalizeInput(input) {
  const text = String(input || '').trim();
  if (!text) return '';

  if (/^(https?|file|about|pennywise):/i.test(text)) return text;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(text)) return `http://${text}`;

  // Looks like a hostname (has a dot, no spaces) → treat as a URL.
  if (!/\s/.test(text) && /^[^/?#]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text)) {
    return `https://${text}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

function parse(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function hostOf(url) {
  const u = parse(url);
  return u ? u.hostname.replace(/^www\.|^m\./, '') : '';
}

/** Rough "same site" check (example.com vs player.example.com). */
function sameSite(a, b) {
  const base = (h) => h.split('.').slice(-2).join('.');
  const ha = hostOf(a);
  const hb = hostOf(b);
  return !!ha && !!hb && base(ha) === base(hb);
}

/**
 * Identifies Twitch/YouTube pages.
 * @returns {{site:'youtube', videoId:string|null, watch:boolean}
 *         | {site:'twitch', channel:string|null, vod:string|null, player:boolean}
 *         | {site:'other'}}
 */
function detect(url) {
  const u = parse(url);
  if (!u) return { site: 'other' };
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const segs = u.pathname.split('/').filter(Boolean);

  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    let videoId = null;
    if (host === 'youtu.be') videoId = segs[0] || null;
    else if (segs[0] === 'watch') videoId = u.searchParams.get('v');
    else if (['live', 'shorts', 'embed'].includes(segs[0])) videoId = segs[1] || null;
    if (videoId && !/^[\w-]{6,}$/.test(videoId)) videoId = null;
    const watch = !!videoId && (segs[0] === 'watch' || segs[0] === 'live');
    return { site: 'youtube', videoId, watch };
  }

  if (host === 'twitch.tv' || host === 'player.twitch.tv') {
    if (host === 'player.twitch.tv') {
      const channel = u.searchParams.get('channel');
      const video = u.searchParams.get('video');
      return {
        site: 'twitch',
        channel: channel ? channel.toLowerCase() : null,
        vod: video ? video.replace(/^v/, '') : null,
        player: true,
      };
    }
    if (segs[0] === 'videos' && /^\d+$/.test(segs[1] || '')) {
      return { site: 'twitch', channel: null, vod: segs[1], player: false };
    }
    if (segs[0] === 'popout' && segs[1]) {
      return { site: 'twitch', channel: segs[1].toLowerCase(), vod: null, player: false, popout: true };
    }
    const first = (segs[0] || '').toLowerCase();
    if (segs.length === 1 && /^\w{2,25}$/.test(first) && !TWITCH_RESERVED.has(first)) {
      return { site: 'twitch', channel: first, vod: null, player: false };
    }
    return { site: 'twitch', channel: null, vod: null, player: false };
  }

  return { site: 'other' };
}

function twitchPlayerUrl({ channel, vod }) {
  const q = new URLSearchParams({ parent: 'twitch.tv', player: 'popout', muted: 'false' });
  if (vod) q.set('video', `v${vod}`);
  else q.set('channel', channel);
  return `https://player.twitch.tv/?${q}`;
}

function twitchPageUrl({ channel, vod }) {
  return vod ? `https://www.twitch.tv/videos/${vod}` : `https://www.twitch.tv/${channel}`;
}

/**
 * What to show in focus mode for a URL.
 *  - {kind:'navigate', url}  load a dedicated player page (Twitch)
 *  - {kind:'css', target}    keep the page, isolate its player with CSS
 *                            target: 'youtube' | 'video' (largest <video>) | 'none'
 */
function focusPlan(url) {
  const d = detect(url);
  if (d.site === 'twitch') {
    if (d.player) return { kind: 'css', target: 'none' };
    if (d.channel && !d.popout) return { kind: 'navigate', url: twitchPlayerUrl(d) };
    if (d.vod) return { kind: 'navigate', url: twitchPlayerUrl(d) };
    return { kind: 'css', target: 'video' };
  }
  if (d.site === 'youtube') {
    // The page script checks the DOM for an active watch page, which also
    // covers URLs like /@channel/live that don't carry a video id.
    return { kind: 'css', target: 'youtube' };
  }
  return { kind: 'css', target: 'video' };
}

/** Where to go when leaving focus mode (undo the Twitch player redirect). */
function unfocusUrl(url) {
  const d = detect(url);
  if (d.site === 'twitch' && d.player && (d.channel || d.vod)) return twitchPageUrl(d);
  return null;
}

/** Twitch chat popout for a channel page / player, or null. */
function chatUrl(url) {
  const d = detect(url);
  if (d.site === 'twitch' && d.channel) {
    return `https://www.twitch.tv/popout/${d.channel}/chat?popout=&darkpopout=`;
  }
  return null;
}

/** YouTube live chat popout. The video id comes from the player (see main.js). */
function youtubeChatUrl(videoId) {
  if (!/^[\w-]{6,}$/.test(videoId || '')) return null;
  return `https://www.youtube.com/live_chat?is_popout=1&dark_theme=1&v=${videoId}`;
}

module.exports = {
  normalizeInput,
  parse,
  hostOf,
  sameSite,
  detect,
  focusPlan,
  unfocusUrl,
  chatUrl,
  youtubeChatUrl,
  twitchPlayerUrl,
  twitchPageUrl,
};
