'use strict';

// Network + cosmetic ad blocking via Ghostery's engine (uBlock Origin / EasyList
// compatible). The compiled engine is cached on disk so start-up stays fast.

const fs = require('fs/promises');
const path = require('path');
const { app } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');

const CACHE_MAX_AGE = 3 * 24 * 60 * 60 * 1000; // refresh lists every 3 days

let blocker = null;
let loading = null;
const enabledIn = new Set();

async function getBlocker() {
  if (blocker) return blocker;
  if (loading) return loading;

  const cache = path.join(app.getPath('userData'), 'adblock-engine.bin');
  loading = (async () => {
    try {
      const stat = await fs.stat(cache);
      if (Date.now() - stat.mtimeMs > CACHE_MAX_AGE) await fs.rm(cache, { force: true });
    } catch {}
    blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: cache,
      read: fs.readFile,
      write: fs.writeFile,
    });
    return blocker;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

async function setEnabled(session, enabled) {
  try {
    const b = await getBlocker();
    if (enabled && !enabledIn.has(session)) {
      b.enableBlockingInSession(session);
      enabledIn.add(session);
    } else if (!enabled && enabledIn.has(session)) {
      b.disableBlockingInSession(session);
      enabledIn.delete(session);
    }
  } catch (e) {
    console.error('Ad blocker unavailable:', e.message);
  }
}

module.exports = { setEnabled };
