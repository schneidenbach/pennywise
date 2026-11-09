'use strict';

const $ = (id) => document.getElementById(id);
const body = document.body;
const address = $('address');
let state = null;
let editing = false;

const prettyUrl = (u) => (u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const siteOf = (u) => (/twitch\.tv/.test(u) ? 'twitch' : /youtube\.com|youtu\.be/.test(u) ? 'youtube' : '');

function render(s) {
  state = s;
  body.dataset.mode = !s.url ? 'start' : s.focus ? 'focus' : 'normal';
  body.dataset.site = s.site;
  body.classList.toggle('loading', s.loading);
  body.classList.toggle('chat-available', s.chatAvailable);

  if (!editing) address.value = s.url ? prettyUrl(s.url) : '';
  $('title').textContent = s.title || prettyUrl(s.url);
  $('back').disabled = !s.canGoBack;
  $('forward').disabled = !s.canGoForward;
  $('pin').classList.toggle('on', s.pinned);
  $('pin').title = s.pinned ? 'Floating on top (⇧⌘P)' : 'Float on top (⇧⌘P)';
  $('chat').classList.toggle('on', s.chatOpen && s.focus);

  const pct = Math.round(s.opacity * 100);
  if (document.activeElement !== $('opacity')) $('opacity').value = pct;
  $('opacity-val').textContent = `${pct}%`;

  const recent = $('recent');
  recent.replaceChildren(...s.recent.slice(0, 5).map((url) => {
    const b = document.createElement('button');
    const dot = document.createElement('span');
    dot.className = `dot ${siteOf(url)}`;
    const label = document.createElement('span');
    label.className = 'u';
    label.textContent = prettyUrl(url);
    b.append(dot, label);
    b.onclick = () => window.pw.cmd('open', url);
    return b;
  }));
}

// ---- address bar
address.addEventListener('focus', () => {
  editing = true;
  window.pw.cmd('interacting', true);
  address.value = state && state.url ? state.url : '';
  requestAnimationFrame(() => address.select());
});
address.addEventListener('blur', () => {
  editing = false;
  body.classList.remove('addr-open');
  window.pw.cmd('interacting', false);
  if (state) render(state);
});
address.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') address.blur();
});
$('address-form').addEventListener('submit', (e) => {
  e.preventDefault();
  window.pw.cmd('open', address.value);
  address.blur();
});

// ---- start page
$('start-form').addEventListener('submit', (e) => {
  e.preventDefault();
  window.pw.cmd('open', $('start-input').value);
  $('start-input').value = '';
});
for (const chip of document.querySelectorAll('.chip')) {
  chip.addEventListener('click', () => window.pw.cmd('open', chip.dataset.url));
}

// ---- buttons
$('back').onclick = () => window.pw.cmd('back');
$('forward').onclick = () => window.pw.cmd('forward');
$('reload').onclick = () => window.pw.cmd(state && state.loading ? 'stop' : 'reload');
$('focus').onclick = () => window.pw.cmd('toggleFocus');
$('chat').onclick = () => window.pw.cmd('toggleChat');
$('pin').onclick = () => window.pw.cmd('togglePin');

// ---- opacity
function setOpacityOpen(open) {
  body.classList.toggle('opacity-open', open);
  $('opacity-btn').classList.toggle('on', open);
  window.pw.cmd('interacting', open);
}
$('opacity-btn').onclick = () => setOpacityOpen(!body.classList.contains('opacity-open'));
$('opacity').addEventListener('input', (e) => {
  $('opacity-val').textContent = `${e.target.value}%`;
  window.pw.cmd('setOpacity', Number(e.target.value) / 100);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && body.classList.contains('opacity-open')) setOpacityOpen(false);
});
document.addEventListener('mousedown', (e) => {
  if (body.classList.contains('opacity-open') && !e.target.closest('.opacity-inline, #opacity-btn')) setOpacityOpen(false);
});

// ---- toast
let toastTimer;
window.pw.onToast((msg) => {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
});

window.pw.onFocusUrl(() => {
  if (body.dataset.mode === 'start') return $('start-input').focus();
  body.classList.add('addr-open');
  address.focus();
});
window.pw.onState(render);
window.pw.state().then((s) => {
  render(s);
  if (!s.url) $('start-input').focus();
});
