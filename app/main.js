'use strict';

const {
  app, BaseWindow, WebContentsView, Menu, session, ipcMain, shell, screen,
  globalShortcut, dialog, clipboard,
} = require('electron');
const path = require('path');
const http = require('http');

const sites = require('./sites');
const store = require('./store');
const adblock = require('./adblock');
const { FOCUS_CSS, FOCUS_SCRIPT, YT_LIVE_ID_SCRIPT } = require('./focus');
const { buildMenu } = require('./menu');

// One persistent browser profile: sign in to Twitch/YouTube once, stay signed in.
const PARTITION = 'persist:pennywise';
const BAR_H = 40; // toolbar height in normal mode
const FOCUS_BAR_H = 38; // hover overlay height in focus mode
const HOVER_ZONE = 44; // px from the top edge that reveals the overlay
const SERVER_PORT = 6280;

// Present as plain desktop Chrome. The default Electron UA gets you
// "browser not supported" / sign-in blocks on Google and Twitch.
const CHROME_MAJOR = process.versions.chrome.split('.')[0];
const USER_AGENT = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;
const SEC_CH_UA = `"Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}", "Not_A Brand";v="99"`;

// The ad blocker makes Electron log every blocked request and fires scriptlets
// without awaiting them; keep the console readable.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (/ERR_BLOCKED_BY_CLIENT|ERR_ABORTED|MaxListeners/.test(w.message)) return;
  console.warn(w.name, w.message);
});
process.on('unhandledRejection', (err) => {
  if (/Script failed to execute|ERR_ABORTED|ERR_BLOCKED_BY_CLIENT/.test(String(err && err.message))) return;
  console.error('Unhandled rejection:', err);
});

app.setName('Pennywise');
app.userAgentFallback = USER_AGENT;
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

let win = null; // BaseWindow
let bar = null; // toolbar / start page (our UI)
let page = null; // the website
let chat = null; // stream chat side panel (focus mode)

const ui = {
  url: '', // what the user is looking at (address bar)
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  focus: false,
  chatOpen: true,
  chatAvailable: false,
  barVisible: true,
  detached: false,
};

let chatTarget = null; // chat URL for the current stream (null = none)
let chatLoaded = null; // chat URL currently loaded in the chat view
let barInteracting = false; // typing in the URL field / popover open
let liveCheckSeq = 0;
let pendingArgs = null;
let barReady = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isHttp = (u) => /^https?:\/\//i.test(u || '');

// ---------------------------------------------------------------------------
// Session

function setupSession() {
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(USER_AGENT);

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'sec-ch-ua') headers[key] = SEC_CH_UA;
    }
    callback({ requestHeaders: headers });
  });

  // Electron grants every permission by default; a video window needs few.
  const allowed = new Set([
    'fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock',
    'speaker-selection', 'storage-access', 'top-level-storage-access',
  ]);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  // YouTube ad defuser (document-start); see page-preload.js.
  ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'page-preload.js') });
  adblock.setEnabled(ses, store.get('adblock'));
  return ses;
}

// ---------------------------------------------------------------------------
// Window + views

function savedBounds() {
  const b = store.get('bounds') || {};
  const out = { width: b.width || 800, height: b.height || 480 };
  if (Number.isFinite(b.x) && Number.isFinite(b.y)) {
    const area = screen.getDisplayMatching({ x: b.x, y: b.y, width: out.width, height: out.height }).workArea;
    const visible = b.x < area.x + area.width - 50 && b.x + out.width > area.x + 50
      && b.y >= area.y - 10 && b.y < area.y + area.height - 50;
    if (visible) Object.assign(out, { x: b.x, y: b.y });
  }
  return out;
}

function createWindow() {
  win = new BaseWindow({
    ...savedBounds(),
    minWidth: 320,
    minHeight: 180,
    title: 'Pennywise',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: '#0e0e11',
    fullscreenable: false,
    show: false,
  });

  const webPrefs = {
    partition: PARTITION,
    sandbox: true,
    contextIsolation: true,
    backgroundThrottling: false, // keep playing while the window isn't focused
  };

  page = new WebContentsView({ webPreferences: webPrefs });
  chat = new WebContentsView({ webPreferences: webPrefs });
  bar = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
    },
  });
  page.setBackgroundColor('#000000');
  chat.setBackgroundColor('#18181b');
  bar.setBackgroundColor('#00000000');

  // Order matters: later children draw on top.
  win.contentView.addChildView(page);
  win.contentView.addChildView(chat);
  win.contentView.addChildView(bar);

  bar.webContents.loadFile(path.join(__dirname, 'ui', 'index.html'));
  bar.webContents.once('did-finish-load', () => {
    layout();
    win.show();
    applyWindowPrefs();
    barReady = true;
    const args = pendingArgs;
    pendingArgs = null;
    if (args && args.url) handleArgs(args);
    else if (store.get('lastUrl')) open(store.get('lastUrl'));
  });

  bindPage();
  bindChat();

  win.on('resize', () => {
    layout();
    store.set('bounds', win.getBounds());
  });
  win.on('move', () => store.set('bounds', win.getBounds()));
  win.on('focus', () => ui.detached && setDetached(false));
  win.on('closed', () => {
    win = bar = page = chat = null;
  });

  ui.focus = !!store.get('focus');
  ui.chatOpen = store.get('chatOpen') !== false;
  startHoverWatch();
}

function applyWindowPrefs() {
  if (!win) return;
  const pinned = !!store.get('pinned');
  const overFull = pinned && !!store.get('overFullScreen');
  win.setOpacity(store.get('opacity') || 1);
  win.setAlwaysOnTop(pinned, overFull ? 'screen-saver' : 'floating');
  win.setVisibleOnAllWorkspaces(pinned, {
    visibleOnFullScreen: overFull,
    // Floating over full-screen apps needs the app to become an "accessory"
    // (no Dock icon). Only do that when asked to.
    skipTransformProcessType: !overFull,
  });
  if (!overFull && app.dock && !app.dock.isVisible()) app.dock.show();
}

function chatWidth(totalWidth) {
  const want = store.get('chatWidth') || 340;
  const w = Math.round(Math.min(Math.max(want, 220), totalWidth - 240));
  return w >= 220 ? w : 0;
}

function layout() {
  if (!win) return;
  const { width: w, height: h } = win.getContentBounds();
  const hasPage = !!ui.url;

  const wantChat = hasPage && ui.focus && ui.chatOpen && !!chatTarget;
  const cw = wantChat ? chatWidth(w) : 0;
  if (cw) ensureChatLoaded();

  page.setVisible(hasPage);
  chat.setVisible(cw > 0);

  if (!hasPage) {
    bar.setBounds({ x: 0, y: 0, width: w, height: h });
    bar.setVisible(true);
    win.setWindowButtonVisibility(true);
    return;
  }

  if (!ui.focus) {
    bar.setBounds({ x: 0, y: 0, width: w, height: BAR_H });
    page.setBounds({ x: 0, y: BAR_H, width: w, height: Math.max(0, h - BAR_H) });
    bar.setVisible(true);
    win.setWindowButtonVisibility(true);
    return;
  }

  page.setBounds({ x: 0, y: 0, width: w - cw, height: h });
  if (cw) chat.setBounds({ x: w - cw, y: 0, width: cw, height: h });
  bar.setBounds({ x: 0, y: 0, width: w - cw, height: FOCUS_BAR_H });
  bar.setVisible(ui.barVisible && !ui.detached);
  win.setWindowButtonVisibility(ui.barVisible && !ui.detached);
}

// In focus mode the toolbar is an overlay that appears when the pointer nears
// the top edge. The pointer is over the page view (a different web contents),
// so poll the cursor position instead of relying on DOM hover events.
let hideTimer = null;
function startHoverWatch() {
  setInterval(() => {
    if (!win || !ui.focus || !ui.url || ui.detached || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getContentBounds();
    const cw = ui.chatOpen && chatTarget ? chatWidth(b.width) : 0;
    const near = p.x >= b.x && p.x < b.x + b.width - cw && p.y >= b.y - 4 && p.y < b.y + HOVER_ZONE;

    if (near || barInteracting) {
      clearTimeout(hideTimer);
      hideTimer = null;
      if (!ui.barVisible) setBarVisible(true);
    } else if (ui.barVisible && !hideTimer) {
      hideTimer = setTimeout(() => {
        hideTimer = null;
        if (!barInteracting) setBarVisible(false);
      }, 800);
    }
  }, 100);
}

function setBarVisible(v) {
  ui.barVisible = v;
  layout();
  push();
}

// ---------------------------------------------------------------------------
// Navigation

function open(input) {
  const url = sites.normalizeInput(input);
  if (!url) return goHome();
  if (!page) return;

  let target = url;
  if (ui.focus) {
    const plan = sites.focusPlan(url);
    if (plan.kind === 'navigate') target = plan.url;
  }
  ui.url = url;
  page.webContents.loadURL(target).catch(() => {}); // errors surface via did-fail-load
  layout();
  push();
}

function goHome() {
  ui.url = '';
  ui.title = '';
  store.set('lastUrl', '');
  page.webContents.loadURL('about:blank').catch(() => {});
  setChatTarget(null);
  layout();
  push();
}

function bindPage() {
  const wc = page.webContents;

  wc.on('did-start-loading', () => {
    ui.loading = true;
    push();
  });
  wc.on('did-stop-loading', () => {
    ui.loading = false;
    applyFocusDom();
    push();
  });
  wc.on('dom-ready', async () => {
    if (!isHttp(wc.getURL()) && !/^file:/.test(wc.getURL())) return;
    try {
      await wc.insertCSS(FOCUS_CSS);
      await wc.executeJavaScript(FOCUS_SCRIPT);
    } catch {}
    applyFocusDom();
  });
  wc.on('did-navigate', (_e, url) => onPageUrl(url, true));
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => isMainFrame && onPageUrl(url, false));
  wc.on('page-title-updated', (_e, title) => {
    ui.title = title;
    push();
  });
  wc.on('media-started-playing', () => applyFocusDom());

  // Player "full screen" button → our focus mode instead of a macOS space.
  wc.on('enter-html-full-screen', () => !ui.focus && setFocus(true));
  wc.on('leave-html-full-screen', () => ui.focus && setFocus(false));

  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = aborted (normal on redirects)
    ui.loading = false;
    push();
    bar.webContents.send('toast', `Couldn't load ${sites.hostOf(url) || url}: ${desc}`);
  });

  wc.setWindowOpenHandler((details) => handleWindowOpen(details));
  wc.on('context-menu', (_e, params) => showContextMenu(wc, params));
}

function onPageUrl(url, fullNavigation) {
  if (!url || url === 'about:blank') return;
  // Show the normal page address even while we're on Twitch's player page.
  ui.url = sites.unfocusUrl(url) || url;
  ui.canGoBack = page.webContents.navigationHistory.canGoBack();
  ui.canGoForward = page.webContents.navigationHistory.canGoForward();
  store.set('lastUrl', ui.url);
  if (fullNavigation) store.addRecent(ui.url);
  if (!fullNavigation) applyFocusDom();
  refreshChat();
  push();
}

async function applyFocusDom() {
  if (!page) return;
  const wc = page.webContents;
  const url = wc.getURL();
  if (!isHttp(url) && !/^file:/.test(url)) return;
  const plan = sites.focusPlan(url);
  const target = plan.kind === 'css' ? plan.target : 'none';
  try {
    await wc.executeJavaScript(`window.__pwFocus && window.__pwFocus(${ui.focus}, ${JSON.stringify(target)})`);
  } catch {}
}

function setFocus(on) {
  ui.focus = !!on;
  store.set('focus', ui.focus);
  clearTimeout(hideTimer);
  hideTimer = null;
  ui.barVisible = true; // flash the overlay so it's discoverable; hover watch hides it

  if (page && ui.url) {
    const current = page.webContents.getURL();
    if (ui.focus) {
      const plan = sites.focusPlan(current);
      if (plan.kind === 'navigate') page.webContents.loadURL(plan.url).catch(() => {});
      else applyFocusDom();
    } else {
      const back = sites.unfocusUrl(current);
      if (back) page.webContents.loadURL(back).catch(() => {});
      else applyFocusDom();
      if (page.webContents.isFullScreen?.()) page.webContents.executeJavaScript('document.fullscreenElement && document.exitFullscreen()').catch(() => {});
    }
  }
  layout();
  push();
}

// ---------------------------------------------------------------------------
// Chat panel

function bindChat() {
  const wc = chat.webContents;
  // Links clicked in chat (channel names, YouTube links) open in the main view
  // or the default browser; the chat panel itself stays on the chat.
  wc.on('will-navigate', (e, url) => {
    if (/\/(popout\/[^/]+\/chat|live_chat)/.test(url) || /accounts\.google|id\.twitch|\/login/.test(url)) return;
    e.preventDefault();
    if (sites.sameSite(url, page.webContents.getURL())) open(url);
    else if (isHttp(url)) shell.openExternal(url);
  });
  wc.setWindowOpenHandler((details) => handleWindowOpen(details));
  wc.on('context-menu', (_e, params) => showContextMenu(wc, params));
}

async function refreshChat() {
  const url = page.webContents.getURL();
  const seq = ++liveCheckSeq;

  if (sites.detect(url).site !== 'youtube') {
    setChatTarget(sites.chatUrl(url));
    return;
  }

  // YouTube: only live streams / premieres have chat, and the player needs a
  // moment after (SPA) navigation before it knows what it's playing.
  for (const delay of [300, 1500, 4000]) {
    await sleep(delay);
    if (seq !== liveCheckSeq || !page) return;
    const id = await page.webContents.executeJavaScript(YT_LIVE_ID_SCRIPT).catch(() => null);
    if (id) return setChatTarget(sites.youtubeChatUrl(id));
  }
  if (seq === liveCheckSeq) setChatTarget(null);
}

function setChatTarget(target) {
  if (target === chatTarget) return;
  chatTarget = target;
  ui.chatAvailable = !!target;
  if (!target && chatLoaded) {
    chat.webContents.loadURL('about:blank').catch(() => {});
    chatLoaded = null;
  }
  layout();
  push();
}

function ensureChatLoaded() {
  if (chatTarget && chatTarget !== chatLoaded) {
    chatLoaded = chatTarget;
    chat.webContents.loadURL(chatTarget).catch(() => {});
  }
}

function setChatOpen(open) {
  ui.chatOpen = !!open;
  store.set('chatOpen', ui.chatOpen);
  if (ui.chatOpen && !ui.focus && chatTarget) return setFocus(true);
  layout();
  push();
}

function resizeChat(delta) {
  const { width } = win.getContentBounds();
  const next = Math.min(Math.max((store.get('chatWidth') || 340) + delta, 220), Math.max(220, width - 240));
  store.set('chatWidth', next);
  layout();
}

// ---------------------------------------------------------------------------
// Popups, links, context menu

// Sign-in popups we let through as real windows (same profile).
const AUTH_POPUP = /^https:\/\/([\w-]+\.)*(accounts\.google\.com|accounts\.youtube\.com|id\.twitch\.tv|appleid\.apple\.com|login\.live\.com|login\.microsoftonline\.com|discord\.com|github\.com|www\.facebook\.com|api\.twitter\.com|x\.com)\//i;

function handleWindowOpen({ url, disposition }) {
  if (AUTH_POPUP.test(url)) {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 500,
        height: 700,
        alwaysOnTop: true,
        autoHideMenuBar: true,
        webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true },
      },
    };
  }
  if (!isHttp(url)) return { action: 'deny' };

  if (sites.sameSite(url, page.webContents.getURL())) {
    open(url);
  } else if (disposition === 'foreground-tab' || disposition === 'background-tab') {
    // A link meant for a new tab → your normal browser. Scripted popups
    // ('new-window' without a click) are ads 99% of the time and are dropped.
    shell.openExternal(url);
  }
  return { action: 'deny' };
}

function showContextMenu(wc, params) {
  const items = [];
  if (params.linkURL) {
    items.push(
      { label: 'Open Link Here', click: () => open(params.linkURL) },
      { label: 'Open Link in Default Browser', click: () => shell.openExternal(params.linkURL) },
      { label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) },
      { type: 'separator' },
    );
  }
  if (params.isEditable) {
    items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' });
  } else if (params.selectionText) {
    items.push({ role: 'copy' }, { type: 'separator' });
  }
  if (wc === page.webContents) {
    items.push(
      { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: 'Reload', click: () => wc.reload() },
      { type: 'separator' },
      { label: ui.focus ? 'Exit Focus Mode' : 'Focus Mode', click: () => setFocus(!ui.focus) },
      { label: 'Open Page in Default Browser', click: () => isHttp(ui.url) && shell.openExternal(ui.url) },
      { type: 'separator' },
    );
  } else {
    items.push({ label: 'Reload Chat', click: () => wc.reload() }, { type: 'separator' });
  }
  items.push({ label: 'Inspect Element', click: () => wc.inspectElement(params.x, params.y) });
  Menu.buildFromTemplate(items).popup();
}

// ---------------------------------------------------------------------------
// Window behaviour toggles

function setPinned(pinned) {
  store.set('pinned', !!pinned);
  applyWindowPrefs();
  push();
}

function setOverFullScreen(on) {
  store.set('overFullScreen', !!on);
  applyWindowPrefs();
  push();
}

function setOpacity(value) {
  const v = Math.min(1, Math.max(0.2, Number(value) || 1));
  store.set('opacity', v);
  win && win.setOpacity(v);
  push();
}

// Click-through: the window ignores the mouse so you can work "under" it.
function setDetached(on) {
  if (!win) return;
  ui.detached = !!on;
  win.setIgnoreMouseEvents(ui.detached);
  if (ui.detached) {
    globalShortcut.register('CommandOrControl+Shift+D', () => setDetached(false));
    app.dock && app.dock.setBadge('●');
  } else {
    globalShortcut.unregister('CommandOrControl+Shift+D');
    app.dock && app.dock.setBadge('');
  }
  layout();
  push();
}

async function setAdblock(on) {
  store.set('adblock', !!on);
  await adblock.setEnabled(session.fromPartition(PARTITION), !!on);
  page && ui.url && page.webContents.reload();
  push();
}

async function clearBrowsingData() {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Clear Data', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Clear all browsing data?',
    detail: 'This signs you out of every site in Pennywise (Twitch, YouTube, …) and clears cookies, cache and site storage. It can’t be undone.',
  });
  if (response !== 0) return;
  const ses = session.fromPartition(PARTITION);
  await ses.clearStorageData();
  await ses.clearCache();
  store.set('recent', []);
  if (ui.url) page.webContents.reload();
  push();
}

async function openFile() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'] });
  if (!canceled && filePaths[0]) open(`file://${filePaths[0]}`);
}

// ---------------------------------------------------------------------------
// UI state → toolbar + menu

function snapshot() {
  return {
    ...ui,
    pinned: !!store.get('pinned'),
    overFullScreen: !!store.get('overFullScreen'),
    opacity: store.get('opacity') || 1,
    adblock: !!store.get('adblock'),
    recent: store.get('recent') || [],
    site: sites.detect(ui.url).site,
  };
}

let menuTimer = null;
function push() {
  if (!win) return;
  const s = snapshot();
  if (bar && !bar.webContents.isDestroyed()) bar.webContents.send('state', s);
  win.setTitle(ui.title || 'Pennywise');
  // Menus are cheap but not free; coalesce rapid state changes.
  clearTimeout(menuTimer);
  menuTimer = setTimeout(() => Menu.setApplicationMenu(buildMenu(s, actions)), 30);
}

const actions = {
  open,
  goHome,
  openFile,
  focusUrl: () => {
    if (ui.focus) setBarVisible(true);
    bar.webContents.focus();
    bar.webContents.send('focus-url');
  },
  back: () => page.webContents.navigationHistory.goBack(),
  forward: () => page.webContents.navigationHistory.goForward(),
  reload: () => (ui.url ? page.webContents.reload() : null),
  hardReload: () => (ui.url ? page.webContents.reloadIgnoringCache() : null),
  stop: () => page.webContents.stop(),
  toggleFocus: () => setFocus(!ui.focus),
  toggleChat: () => setChatOpen(!ui.chatOpen),
  chatWider: () => resizeChat(40),
  chatNarrower: () => resizeChat(-40),
  togglePin: () => setPinned(!store.get('pinned')),
  toggleOverFullScreen: () => setOverFullScreen(!store.get('overFullScreen')),
  setOpacity,
  opacityStep: (d) => setOpacity((store.get('opacity') || 1) + d),
  toggleDetached: () => setDetached(!ui.detached),
  toggleAdblock: () => setAdblock(!store.get('adblock')),
  clearBrowsingData,
  pageDevTools: () => page.webContents.openDevTools({ mode: 'detach' }),
  chatDevTools: () => chat.webContents.openDevTools({ mode: 'detach' }),
  barDevTools: () => bar.webContents.openDevTools({ mode: 'detach' }),
  openInBrowser: () => isHttp(ui.url) && shell.openExternal(ui.url),
  copyUrl: () => ui.url && clipboard.writeText(ui.url),
  zoom: (d) => {
    const wc = page.webContents;
    wc.setZoomLevel(d === 0 ? 0 : wc.getZoomLevel() + d);
  },
};

ipcMain.on('pw:adblock-enabled', (e) => {
  e.returnValue = !!store.get('adblock');
});

ipcMain.handle('bar:state', (e) => (bar && e.sender === bar.webContents ? snapshot() : null));
ipcMain.on('bar:cmd', (e, cmd, arg) => {
  if (!bar || e.sender !== bar.webContents) return;
  if (cmd === 'interacting') {
    barInteracting = !!arg;
    return;
  }
  const fn = actions[cmd];
  if (typeof fn === 'function') fn(arg);
});

// ---------------------------------------------------------------------------
// Ways to open a URL from outside: CLI args, pennywise:// links, local HTTP

function parseArgs(argv) {
  const out = { url: null, focus: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--url=')) out.url = a.slice(6);
    else if (a === '--url' && argv[i + 1]) out.url = argv[++i];
    else if (a === '--focus') out.focus = true;
    else if (a === '--normal') out.focus = false;
    else if (/^pennywise:\/\//i.test(a)) Object.assign(out, parseProtocolUrl(a));
  }
  return out;
}

// pennywise://open?url=https://twitch.tv/foo&focus=1
function parseProtocolUrl(link) {
  const u = sites.parse(link);
  if (!u) return {};
  const focus = u.searchParams.get('focus');
  return {
    url: u.searchParams.get('url'),
    focus: focus == null ? null : focus === '1' || focus === 'true',
  };
}

function handleArgs({ url, focus }) {
  if (!win || !barReady) {
    pendingArgs = { url, focus };
    return;
  }
  if (focus != null && focus !== ui.focus) {
    ui.focus = focus;
    store.set('focus', focus);
  }
  if (url) open(url);
  else layout();
  push();
}

function startServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${SERVER_PORT}`);
    const url = u.searchParams.get('url');
    if (url) {
      const focus = u.searchParams.get('focus');
      handleArgs({ url, focus: focus == null ? null : focus === '1' || focus === 'true' });
      win && win.showInactive();
    }
    res.writeHead(url ? 204 : 400);
    res.end();
  });
  server.on('error', (e) => console.warn(`URL server not started (${e.code}).`));
  server.listen(SERVER_PORT, '127.0.0.1');
}

app.on('second-instance', (_e, argv) => {
  handleArgs(parseArgs(argv));
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

app.on('open-url', (e, link) => {
  e.preventDefault();
  handleArgs(parseProtocolUrl(link));
});

app.on('open-file', (e, file) => {
  e.preventDefault();
  handleArgs({ url: `file://${file}`, focus: null });
});

// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  if (app.isPackaged) app.setAsDefaultProtocolClient('pennywise');
  setupSession();
  const args = parseArgs(process.argv.slice(1));
  if (args.url || args.focus != null) pendingArgs = args;
  if (pendingArgs && pendingArgs.focus != null) store.set('focus', pendingArgs.focus);
  createWindow();
  startServer();
  push();
});

app.on('activate', () => {
  if (!win) createWindow();
  else if (ui.detached) setDetached(false);
  else win.show();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  store.flush();
});
