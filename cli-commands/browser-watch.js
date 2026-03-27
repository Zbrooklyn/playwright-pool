// browser-watch.js — Monitor browser state changes in real-time
// Reports: new tabs, closed tabs, URL changes, title changes
// Usage: node cli-commands/browser-watch.js [--interval 2000]

import { chromium } from 'playwright';
import { loadState } from './shared.js';

const POLL_INTERVAL = parseInt(process.argv.find(a => a.startsWith('--interval='))?.split('=')[1] || '2000');

async function watch() {
  const state = loadState();
  if (!state?.wsEndpoint) {
    console.error('No active browser. Run `playwright-pool browser launch` first.');
    process.exit(1);
  }

  console.log(`Watching browser at ${state.wsEndpoint} (poll every ${POLL_INTERVAL}ms)`);
  console.log('Press Ctrl+C to stop.\n');

  let lastSnapshot = new Map(); // id -> { url, title }

  const poll = async () => {
    try {
      // Use CDP HTTP API for lightweight polling (no WebSocket overhead)
      const resp = await fetch(`${state.wsEndpoint}/json/list`);
      const tabs = await resp.json();

      // Filter to pages only (skip iframes, service workers, etc.)
      const pages = tabs.filter(t => t.type === 'page');
      const currentSnapshot = new Map();

      for (const page of pages) {
        currentSnapshot.set(page.id, { url: page.url, title: page.title });

        const prev = lastSnapshot.get(page.id);
        if (!prev) {
          // New tab
          const ts = new Date().toISOString().slice(11, 19);
          console.log(`[${ts}] + TAB OPENED: "${page.title}" — ${page.url.slice(0, 80)}`);
        } else if (prev.url !== page.url) {
          // URL changed (navigation)
          const ts = new Date().toISOString().slice(11, 19);
          console.log(`[${ts}] → NAVIGATED: "${page.title}" — ${page.url.slice(0, 80)}`);
        } else if (prev.title !== page.title) {
          // Title changed (page loaded)
          const ts = new Date().toISOString().slice(11, 19);
          console.log(`[${ts}] ~ TITLE: "${page.title}" — ${page.url.slice(0, 80)}`);
        }
      }

      // Check for closed tabs
      for (const [id, prev] of lastSnapshot) {
        if (!currentSnapshot.has(id)) {
          const ts = new Date().toISOString().slice(11, 19);
          console.log(`[${ts}] - TAB CLOSED: "${prev.title}" — ${prev.url.slice(0, 80)}`);
        }
      }

      lastSnapshot = currentSnapshot;
    } catch (err) {
      console.error(`[watch] Connection lost: ${err.message}`);
      process.exit(1);
    }
  };

  // Initial snapshot
  await poll();
  console.log(`Monitoring ${lastSnapshot.size} tab(s)...\n`);

  // Poll loop
  setInterval(poll, POLL_INTERVAL);
}

watch().catch(err => {
  console.error(err.message);
  process.exit(1);
});
