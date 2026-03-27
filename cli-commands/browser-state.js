#!/usr/bin/env node
// browser-state.js — Lightweight browser state check (no Playwright import)
// Uses CDP HTTP API only — runs in <100ms
// Output is designed to be injected into conversation context via hooks

import fs from 'fs';
import path from 'path';

const STATE_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.playwright-pool', 'cli-state.json');

async function checkState() {
  // Check if state file exists
  if (!fs.existsSync(STATE_FILE)) {
    console.log('BROWSER_STATE: NO_BROWSER');
    return;
  }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    console.log('BROWSER_STATE: NO_BROWSER (corrupt state file)');
    return;
  }

  if (!state?.wsEndpoint) {
    console.log('BROWSER_STATE: NO_BROWSER (no endpoint)');
    return;
  }

  // Ping CDP endpoint
  try {
    const resp = await fetch(`${state.wsEndpoint}/json/list`, { signal: AbortSignal.timeout(2000) });
    const tabs = await resp.json();
    const pages = tabs.filter(t => t.type === 'page');

    console.log(`BROWSER_STATE: ACTIVE`);
    console.log(`  CDP: ${state.wsEndpoint}`);
    console.log(`  Label: ${state.label || 'default'}`);
    console.log(`  Viewport: ${state.viewport?.width || '?'}x${state.viewport?.height || '?'}`);
    console.log(`  Tabs: ${pages.length}`);
    for (let i = 0; i < pages.length; i++) {
      const url = pages[i].url;
      const title = pages[i].title || '';
      console.log(`    [${i}] ${url.length > 70 ? url.slice(0, 67) + '...' : url}${title ? ' — ' + title : ''}`);
    }
  } catch {
    // CDP not responding — browser died but state file remains
    console.log('BROWSER_STATE: STALE (state file exists but browser not responding)');
    console.log(`  Stale endpoint: ${state.wsEndpoint}`);
    // Clean up stale state
    try { fs.unlinkSync(STATE_FILE); } catch {}
    console.log('  Cleaned up stale state file.');
  }
}

checkState();
