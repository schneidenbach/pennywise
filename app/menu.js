'use strict';

const { app, Menu, shell } = require('electron');

/** Builds the macOS menu bar from the current UI state. */
function buildMenu(s, a) {
  const hasPage = !!s.url;

  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Block Ads', type: 'checkbox', checked: s.adblock, click: a.toggleAdblock },
        { label: 'Clear Browsing Data…', click: a.clearBrowsingData },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'Open Location…', accelerator: 'Cmd+L', click: a.focusUrl },
        { label: 'Open File…', accelerator: 'Cmd+O', click: a.openFile },
        { label: 'Start Page', accelerator: 'Cmd+Shift+H', click: a.goHome },
        { type: 'separator' },
        { label: 'Open in Default Browser', accelerator: 'Cmd+Shift+O', enabled: hasPage, click: a.openInBrowser },
        { label: 'Copy Page Address', accelerator: 'Cmd+Shift+C', enabled: hasPage, click: a.copyUrl },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Focus Mode', type: 'checkbox', checked: s.focus, accelerator: 'Cmd+Shift+F', click: a.toggleFocus },
        {
          label: 'Show Chat',
          type: 'checkbox',
          checked: s.chatOpen,
          enabled: s.chatAvailable,
          accelerator: 'Cmd+Shift+K',
          click: a.toggleChat,
        },
        { label: 'Wider Chat', accelerator: 'Cmd+Alt+Left', enabled: s.chatAvailable && s.focus, click: a.chatWider },
        { label: 'Narrower Chat', accelerator: 'Cmd+Alt+Right', enabled: s.chatAvailable && s.focus, click: a.chatNarrower },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'Cmd+R', enabled: hasPage, click: a.reload },
        { label: 'Hard Reload', accelerator: 'Cmd+Shift+R', enabled: hasPage, click: a.hardReload },
        { label: 'Stop', accelerator: 'Cmd+.', enabled: s.loading, click: a.stop },
        { type: 'separator' },
        { label: 'Actual Size', accelerator: 'Cmd+0', click: () => a.zoom(0) },
        { label: 'Zoom In', accelerator: 'Cmd+=', click: () => a.zoom(0.5) },
        { label: 'Zoom Out', accelerator: 'Cmd+-', click: () => a.zoom(-0.5) },
        { type: 'separator' },
        {
          label: 'Developer',
          submenu: [
            { label: 'Page Developer Tools', accelerator: 'Cmd+Alt+I', click: a.pageDevTools },
            { label: 'Chat Developer Tools', click: a.chatDevTools },
            { label: 'Toolbar Developer Tools', click: a.barDevTools },
          ],
        },
      ],
    },
    {
      label: 'History',
      submenu: [
        { label: 'Back', accelerator: 'Cmd+[', enabled: s.canGoBack, click: a.back },
        { label: 'Forward', accelerator: 'Cmd+]', enabled: s.canGoForward, click: a.forward },
        { type: 'separator' },
        ...(s.recent.length
          ? s.recent.map((url) => ({ label: url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70), click: () => a.open(url) }))
          : [{ label: 'No Recent Pages', enabled: false }]),
      ],
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Float on Top', type: 'checkbox', checked: s.pinned, accelerator: 'Cmd+Shift+P', click: a.togglePin },
        {
          label: 'Float Over Full-Screen Apps (hides Dock icon)',
          type: 'checkbox',
          checked: s.overFullScreen,
          enabled: s.pinned,
          click: a.toggleOverFullScreen,
        },
        { label: 'Click-Through Mode', type: 'checkbox', checked: s.detached, accelerator: 'Cmd+Shift+D', click: a.toggleDetached },
        { type: 'separator' },
        { label: 'More Opaque', accelerator: 'Cmd+Shift+Up', click: () => a.opacityStep(0.1) },
        { label: 'More Transparent', accelerator: 'Cmd+Shift+Down', click: () => a.opacityStep(-0.1) },
        {
          label: 'Opacity',
          submenu: [100, 90, 80, 70, 60, 50, 40, 30].map((pct) => ({
            label: `${pct}%`,
            type: 'radio',
            checked: Math.round(s.opacity * 100) === pct,
            click: () => a.setOpacity(pct / 100),
          })),
        },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: 'Pennywise on GitHub', click: () => shell.openExternal('https://github.com/nilbuild/pennywise') },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
