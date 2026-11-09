'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../app/sites');

test('normalizeInput', () => {
  assert.equal(s.normalizeInput(''), '');
  assert.equal(s.normalizeInput('twitch.tv/shroud'), 'https://twitch.tv/shroud');
  assert.equal(s.normalizeInput('https://youtube.com'), 'https://youtube.com');
  assert.equal(s.normalizeInput('localhost:3000'), 'http://localhost:3000');
  assert.equal(s.normalizeInput('lofi hip hop'), 'https://www.google.com/search?q=lofi%20hip%20hop');
  assert.equal(s.normalizeInput('c++ & rust'), 'https://www.google.com/search?q=c%2B%2B%20%26%20rust');
});

test('detect youtube', () => {
  assert.deepEqual(s.detect('https://www.youtube.com/watch?v=jfKfPfyJRdk'), { site: 'youtube', videoId: 'jfKfPfyJRdk', watch: true });
  assert.deepEqual(s.detect('https://youtu.be/jfKfPfyJRdk'), { site: 'youtube', videoId: 'jfKfPfyJRdk', watch: false });
  assert.deepEqual(s.detect('https://www.youtube.com/live/jfKfPfyJRdk?si=x'), { site: 'youtube', videoId: 'jfKfPfyJRdk', watch: true });
  assert.deepEqual(s.detect('https://www.youtube.com/'), { site: 'youtube', videoId: null, watch: false });
});

test('detect twitch', () => {
  assert.equal(s.detect('https://www.twitch.tv/Shroud').channel, 'shroud');
  assert.equal(s.detect('https://www.twitch.tv/directory').channel, null);
  assert.equal(s.detect('https://www.twitch.tv/videos/123456').vod, '123456');
  const p = s.detect('https://player.twitch.tv/?channel=shroud&parent=twitch.tv');
  assert.equal(p.player, true);
  assert.equal(p.channel, 'shroud');
});

test('focus plan / unfocus round trip for twitch', () => {
  const plan = s.focusPlan('https://www.twitch.tv/shroud');
  assert.equal(plan.kind, 'navigate');
  assert.match(plan.url, /^https:\/\/player\.twitch\.tv\/\?.*channel=shroud/);
  assert.equal(s.unfocusUrl(plan.url), 'https://www.twitch.tv/shroud');

  const vod = s.focusPlan('https://www.twitch.tv/videos/42');
  assert.match(vod.url, /video=v42/);
  assert.equal(s.unfocusUrl(vod.url), 'https://www.twitch.tv/videos/42');
});

test('focus plan for youtube', () => {
  assert.deepEqual(s.focusPlan('https://www.youtube.com/watch?v=jfKfPfyJRdk'), { kind: 'css', target: 'youtube' });
  assert.deepEqual(s.focusPlan('https://www.youtube.com/@LofiGirl/live'), { kind: 'css', target: 'youtube' });
  assert.deepEqual(s.focusPlan('https://vimeo.com/1'), { kind: 'css', target: 'video' });
});

test('chat urls', () => {
  assert.match(s.chatUrl('https://www.twitch.tv/shroud'), /popout\/shroud\/chat/);
  assert.match(s.chatUrl('https://player.twitch.tv/?channel=shroud'), /popout\/shroud\/chat/);
  assert.equal(s.chatUrl('https://www.youtube.com/watch?v=jfKfPfyJRdk'), null);
  assert.match(s.youtubeChatUrl('jfKfPfyJRdk'), /live_chat\?.*v=jfKfPfyJRdk/);
  assert.equal(s.youtubeChatUrl('bad id!'), null);
  assert.equal(s.chatUrl('https://www.twitch.tv/videos/42'), null);
  assert.equal(s.chatUrl('https://example.com'), null);
});

test('sameSite', () => {
  assert.equal(s.sameSite('https://www.twitch.tv/a', 'https://player.twitch.tv/'), true);
  assert.equal(s.sameSite('https://twitch.tv', 'https://ads.example.com'), false);
});
