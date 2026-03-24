// cli-commands/browser.js — 17 browser subcommands
// Persistent browser session: launch saves CDP endpoint, all others reconnect via it.

import { chromium } from 'playwright';
import {
  parseArgs,
  getViewport,
  saveState,
  loadState,
  clearState,
  connectToActiveBrowser,
  DEVICES,
} from './shared.js';

// ─── Entry Point ─────────────────────────────────────────────────

export async function handleBrowser(args) {
  const action = args[0];
  const rest = args.slice(1);
  switch (action) {
    case 'launch':   return browserLaunch(rest);
    case 'list':     return browserList(rest);
    case 'switch':   return browserSwitch(rest);
    case 'close':    return browserClose(rest);
    case 'navigate': return browserNavigate(rest);
    case 'back':     return browserBack(rest);
    case 'tabs':     return browserTabs(rest);
    case 'click':    return browserClick(rest);
    case 'hover':    return browserHover(rest);
    case 'type':     return browserType(rest);
    case 'key':      return browserKey(rest);
    case 'fill':     return browserFill(rest);
    case 'select':   return browserSelect(rest);
    case 'resize':   return browserResize(rest);
    case 'upload':   return browserUpload(rest);
    case 'dialog':   return browserDialog(rest);
    case 'drag':     return browserDrag(rest);
    default:
      console.error(`Unknown browser command: ${action}`);
      console.error('Run `playwright-pool browser --help` for available commands.');
      process.exit(1);
  }
}

// ─── launch ──────────────────────────────────────────────────────

async function browserLaunch(args) {
  const { flags } = parseArgs(args);
  const viewport = getViewport(flags);
  const mode = flags.mode || 'window';
  const label = flags.label || 'default';

  // Check if a browser is already running
  const existing = loadState();
  if (existing && existing.wsEndpoint) {
    try {
      const test = await chromium.connectOverCDP(existing.wsEndpoint);
      test.disconnect();
      console.error(`Browser already running [${existing.label || 'default'}].`);
      console.error('Close it first with: playwright-pool browser close all');
      process.exit(1);
    } catch {
      // Stale state — clear and continue
      clearState();
    }
  }

  // Launch browser with CDP enabled
  const browser = await chromium.launch({
    headless: false,
    args: ['--remote-debugging-port=0', '--disable-blink-features=AutomationControlled'],
  });

  // Get the CDP WebSocket endpoint for reconnection
  const wsEndpoint = browser.wsEndpoint();

  // Create context with requested viewport
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  // Navigate to about:blank to signal readiness
  await page.goto('about:blank');

  // Save state for other CLI commands to reconnect
  saveState({ wsEndpoint, label, mode, viewport });

  console.log(`Browser launched [${label}] (${viewport.width}x${viewport.height})`);
  console.log(`WebSocket: ${wsEndpoint}`);
  console.log('Browser is running. Use other commands to interact. Close with: playwright-pool browser close all');

  // Keep process alive until browser closes
  await new Promise((resolve) => browser.on('disconnected', resolve));
  clearState();
  console.log('Browser closed.');
}

// ─── list ────────────────────────────────────────────────────────

async function browserList(_args) {
  const state = loadState();
  if (!state || !state.wsEndpoint) {
    console.log('No active browser sessions.');
    return;
  }

  // Verify the browser is actually reachable
  try {
    const browser = await chromium.connectOverCDP(state.wsEndpoint);
    const contexts = browser.contexts();
    const totalPages = contexts.reduce((sum, ctx) => sum + ctx.pages().length, 0);
    console.log(`Active browser [${state.label || 'default'}]`);
    console.log(`  Viewport: ${state.viewport?.width || '?'}x${state.viewport?.height || '?'}`);
    console.log(`  Contexts: ${contexts.length}`);
    console.log(`  Pages:    ${totalPages}`);
    console.log(`  WS:       ${state.wsEndpoint}`);
    browser.disconnect();
  } catch {
    console.log('Browser session found but not reachable (stale).');
    clearState();
  }
}

// ─── switch ──────────────────────────────────────────────────────

async function browserSwitch(args) {
  const { positional } = parseArgs(args);
  const target = positional[0];
  if (!target) {
    console.error('Usage: playwright-pool browser switch <tab-index | url-substring>');
    process.exit(1);
  }

  const { browser, context } = await connectToActiveBrowser();
  const pages = context.pages();

  let page;
  const idx = parseInt(target, 10);
  if (!isNaN(idx) && idx >= 0 && idx < pages.length) {
    // Switch by tab index
    page = pages[idx];
  } else {
    // Switch by URL substring match
    page = pages.find((p) => p.url().includes(target));
  }

  if (!page) {
    console.error(`No tab matching "${target}". Use \`browser tabs\` to see open tabs.`);
    browser.disconnect();
    process.exit(1);
  }

  await page.bringToFront();
  console.log(`Switched to: ${page.url()} — ${await page.title()}`);
  browser.disconnect();
}

// ─── close ───────────────────────────────────────────────────────

async function browserClose(args) {
  const { positional } = parseArgs(args);
  const target = positional[0] || 'all';

  const state = loadState();
  if (!state || !state.wsEndpoint) {
    console.log('No active browser to close.');
    return;
  }

  try {
    const browser = await chromium.connectOverCDP(state.wsEndpoint);

    if (target === 'all') {
      // Close the entire browser
      await browser.close();
      clearState();
      console.log('Browser closed.');
    } else {
      // Close a specific tab by index or URL substring
      const contexts = browser.contexts();
      const allPages = contexts.flatMap((ctx) => ctx.pages());
      const idx = parseInt(target, 10);
      let page;
      if (!isNaN(idx) && idx >= 0 && idx < allPages.length) {
        page = allPages[idx];
      } else {
        page = allPages.find((p) => p.url().includes(target));
      }

      if (page) {
        const url = page.url();
        await page.close();
        console.log(`Closed tab: ${url}`);
      } else {
        console.error(`No tab matching "${target}".`);
      }
      browser.disconnect();
    }
  } catch {
    console.log('Browser not reachable. Clearing stale state.');
    clearState();
  }
}

// ─── navigate ────────────────────────────────────────────────────

async function browserNavigate(args) {
  const { flags, positional } = parseArgs(args);
  const url = positional[0];
  if (!url) {
    console.error('Usage: playwright-pool browser navigate <url>');
    process.exit(1);
  }

  const { browser, page } = await connectToActiveBrowser();

  const waitUntil = flags.wait || 'domcontentloaded';
  const newTab = flags['new-tab'];

  let targetPage = page;
  if (newTab) {
    const context = page.context();
    targetPage = await context.newPage();
  }

  await targetPage.goto(url, { waitUntil });
  const title = await targetPage.title();
  console.log(`Navigated: ${targetPage.url()}`);
  console.log(`Title: ${title}`);
  browser.disconnect();
}

// ─── back ────────────────────────────────────────────────────────

async function browserBack(_args) {
  const { browser, page } = await connectToActiveBrowser();
  await page.goBack({ waitUntil: 'domcontentloaded' });
  console.log(`Navigated back: ${page.url()}`);
  console.log(`Title: ${await page.title()}`);
  browser.disconnect();
}

// ─── tabs ────────────────────────────────────────────────────────

async function browserTabs(_args) {
  const { browser, context } = await connectToActiveBrowser();
  const pages = context.pages();
  if (pages.length === 0) {
    console.log('No open tabs.');
  } else {
    console.log(`${pages.length} open tab${pages.length === 1 ? '' : 's'}:`);
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const title = await p.title();
      console.log(`  [${i}] ${p.url()} — ${title}`);
    }
  }
  browser.disconnect();
}

// ─── click ───────────────────────────────────────────────────────

async function browserClick(args) {
  const { flags, positional } = parseArgs(args);
  const ref = positional[0];
  if (!ref) {
    console.error('Usage: playwright-pool browser click <selector>');
    console.error('  Selector: CSS selector, text="..." , or role selector');
    process.exit(1);
  }

  const { browser, page } = await connectToActiveBrowser();

  await page.click(ref, {
    button: flags.button || 'left',
    modifiers: flags.modifiers ? flags.modifiers.split(',') : undefined,
    timeout: flags.timeout ? Number(flags.timeout) : 30000,
  });

  console.log(`Clicked "${ref}" — ${page.url()}`);
  browser.disconnect();
}

// ─── hover ───────────────────────────────────────────────────────

async function browserHover(args) {
  const { flags, positional } = parseArgs(args);
  const ref = positional[0];
  if (!ref) {
    console.error('Usage: playwright-pool browser hover <selector>');
    process.exit(1);
  }

  const { browser, page } = await connectToActiveBrowser();
  await page.hover(ref, {
    timeout: flags.timeout ? Number(flags.timeout) : 30000,
  });

  console.log(`Hovered "${ref}" — ${page.url()}`);
  browser.disconnect();
}

// ─── type ────────────────────────────────────────────────────────

async function browserType(args) {
  const { flags, positional } = parseArgs(args);
  const selector = positional[0];
  const text = positional[1];

  if (!selector || !text) {
    console.error('Usage: playwright-pool browser type <selector> <text> [--slowly]');
    process.exit(1);
  }

  const { browser, page } = await connectToActiveBrowser();

  if (flags.slowly) {
    // Character-by-character typing with delay
    await page.click(selector);
    await page.type(selector, text, { delay: 50 });
  } else {
    // Instant fill
    await page.fill(selector, text);
  }

  console.log(`Typed "${text}" into ${selector}`);
  browser.disconnect();
}

// ─── key ─────────────────────────────────────────────────────────

async function browserKey(args) {
  const { flags, positional } = parseArgs(args);
  const key = positional[0];
  if (!key) {
    console.error('Usage: playwright-pool browser key <key>');
    console.error('  Examples: Enter, Tab, Escape, Control+a, Meta+c');
    process.exit(1);
  }

  const { browser, page } = await connectToActiveBrowser();

  // If a selector is provided via --target, focus it first
  if (flags.target) {
    await page.click(flags.target);
  }

  await page.keyboard.press(key);
  console.log(`Pressed "${key}" — ${page.url()}`);
  browser.disconnect();
}

// ─── fill ────────────────────────────────────────────────────────

async function browserFill(args) {
  const { flags, positional } = parseArgs(args);
  const selector = positional[0];
  const value = positional[1];

  if (!selector || value === undefined) {
    console.error('Usage: playwright-pool browser fill <selector> <value>');
    process.exit(1);
  }

  const { browser, page } = await connectToActiveBrowser();
  await page.fill(selector, value, {
    timeout: flags.timeout ? Number(flags.timeout) : 30000,
  });

  console.log(`Filled "${selector}" with "${value}"`);
  browser.disconnect();
}

// ─── select ──────────────────────────────────────────────────────

async function browserSelect(args) {
  const { flags, positional } = parseArgs(args);
  const selector = positional[0];
  const values = positional.slice(1);

  if (!selector || values.length === 0) {
    console.error('Usage: playwright-pool browser select <selector> <value> [value2 ...]');
    process.exit(1);
  }

  const { browser, page } = await connectToActiveBrowser();

  // Support selecting by value, label, or index
  const selectBy = flags.by || 'value'; // --by value|label|index
  let options;
  if (selectBy === 'label') {
    options = values.map((v) => ({ label: v }));
  } else if (selectBy === 'index') {
    options = values.map((v) => ({ index: parseInt(v, 10) }));
  } else {
    options = values; // plain string values
  }

  const selected = await page.selectOption(selector, options);
  console.log(`Selected ${JSON.stringify(selected)} in "${selector}"`);
  browser.disconnect();
}

// ─── resize ──────────────────────────────────────────────────────

async function browserResize(args) {
  const { flags, positional } = parseArgs(args);

  let width, height;

  // Support named presets: --mobile, --tablet, --desktop
  if (flags.mobile || flags.tablet || flags.desktop) {
    const vp = getViewport(flags);
    width = vp.width;
    height = vp.height;
  } else if (positional.length >= 2) {
    width = parseInt(positional[0], 10);
    height = parseInt(positional[1], 10);
  } else if (positional.length === 1 && positional[0].includes('x')) {
    // Support "1280x800" format
    const parts = positional[0].split('x');
    width = parseInt(parts[0], 10);
    height = parseInt(parts[1], 10);
  } else {
    console.error('Usage: playwright-pool browser resize <width> <height>');
    console.error('  Or:  playwright-pool browser resize 1280x800');
    console.error('  Or:  playwright-pool browser resize --mobile | --tablet | --desktop');
    process.exit(1);
  }

  if (isNaN(width) || isNaN(height)) {
    console.error('Invalid dimensions. Width and height must be numbers.');
    process.exit(1);
  }

  const { browser, page } = await connectToActiveBrowser();
  await page.setViewportSize({ width, height });
  console.log(`Viewport resized to ${width}x${height}`);
  browser.disconnect();
}

// ─── upload ──────────────────────────────────────────────────────

async function browserUpload(args) {
  const { flags, positional } = parseArgs(args);
  const selector = positional[0];
  const filePaths = positional.slice(1);

  if (!selector || filePaths.length === 0) {
    console.error('Usage: playwright-pool browser upload <selector> <file1> [file2 ...]');
    process.exit(1);
  }

  const { browser, page } = await connectToActiveBrowser();

  const fileInput = page.locator(selector);
  if (filePaths.length === 1) {
    await fileInput.setInputFiles(filePaths[0]);
  } else {
    await fileInput.setInputFiles(filePaths);
  }

  console.log(`Uploaded ${filePaths.length} file${filePaths.length === 1 ? '' : 's'} to "${selector}"`);
  browser.disconnect();
}

// ─── dialog ──────────────────────────────────────────────────────

async function browserDialog(args) {
  const { flags, positional } = parseArgs(args);
  const action = positional[0] || 'accept';
  const promptText = positional[1] || flags.text || '';

  const { browser, page } = await connectToActiveBrowser();

  // Register handler for the next dialog
  page.once('dialog', async (dialog) => {
    console.log(`Dialog type: ${dialog.type()}`);
    console.log(`Dialog message: ${dialog.message()}`);

    if (action === 'dismiss') {
      await dialog.dismiss();
      console.log('Dialog dismissed.');
    } else {
      await dialog.accept(promptText || undefined);
      console.log(`Dialog accepted${promptText ? ` with "${promptText}"` : ''}.`);
    }
  });

  console.log(`Waiting for dialog... (will ${action})`);
  console.log('Trigger the dialog in the browser, or press Ctrl+C to cancel.');

  // Wait up to 30 seconds for a dialog to appear
  const timeout = flags.timeout ? Number(flags.timeout) : 30000;
  try {
    await page.waitForEvent('dialog', { timeout });
  } catch {
    console.log('No dialog appeared within timeout.');
  }

  browser.disconnect();
}

// ─── drag ────────────────────────────────────────────────────────

async function browserDrag(args) {
  const { flags, positional } = parseArgs(args);
  const source = positional[0];
  const target = positional[1];

  if (!source || !target) {
    console.error('Usage: playwright-pool browser drag <source-selector> <target-selector>');
    process.exit(1);
  }

  const { browser, page } = await connectToActiveBrowser();
  await page.dragAndDrop(source, target, {
    timeout: flags.timeout ? Number(flags.timeout) : 30000,
  });

  console.log(`Dragged "${source}" to "${target}"`);
  browser.disconnect();
}
