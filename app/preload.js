'use strict';

// Bridge between the toolbar UI (app/ui) and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pw', {
  state: () => ipcRenderer.invoke('bar:state'),
  cmd: (name, arg) => ipcRenderer.send('bar:cmd', name, arg),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onFocusUrl: (cb) => ipcRenderer.on('focus-url', () => cb()),
  onToast: (cb) => ipcRenderer.on('toast', (_e, msg) => cb(msg)),
});
