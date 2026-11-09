'use strict';

// Tiny JSON settings store in ~/Library/Application Support/Pennywise/settings.json

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  bounds: { width: 800, height: 480 },
  opacity: 1,
  pinned: true, // always on top
  overFullScreen: false, // float above other apps' full-screen spaces
  adblock: true,
  focus: false, // last used mode
  chatOpen: true,
  chatWidth: 340,
  lastUrl: '',
  recent: [],
};

const file = () => path.join(app.getPath('userData'), 'settings.json');
let data = null;
let timer = null;

function load() {
  try {
    data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    data = { ...DEFAULTS };
  }
  return data;
}

function get(key) {
  if (!data) load();
  return data[key];
}

function set(key, value) {
  if (!data) load();
  data[key] = value;
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}

function flush() {
  clearTimeout(timer);
  if (!data) return;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Could not save settings:', e.message);
  }
}

function addRecent(url) {
  if (!url || /^about:/.test(url)) return;
  const list = [url, ...get('recent').filter((u) => u !== url)].slice(0, 8);
  set('recent', list);
}

module.exports = { load, get, set, flush, addRecent };
