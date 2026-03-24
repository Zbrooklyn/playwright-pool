// cli-commands/shared.js
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';

const HOME = os.homedir();
export const POOL_BASE = path.join(HOME, '.playwright-pool');
export const GOLDEN_PROFILE = path.join(POOL_BASE, 'golden-profile');
export const POOL_CONTEXTS = path.join(POOL_BASE, 'pool-contexts');
export const STATE_FILE = path.join(POOL_BASE, 'cli-state.json');

// Device presets
export const DEVICES = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
};

// Parse flags from args array
// Returns { flags: { key: value }, positional: string[] }
export function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const shortMap = { V: 'version', q: 'quiet', v: 'verbose' };
      flags[shortMap[arg[1]] || arg[1]] = true;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

// Get viewport from flags (--mobile, --tablet, or --desktop default)
export function getViewport(flags) {
  if (flags.mobile) return DEVICES.mobile;
  if (flags.tablet) return DEVICES.tablet;
  return DEVICES.desktop;
}

// Generate timestamped filename
export function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// Ensure output directory exists, return resolved path
export function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// --- CDP State (persistent browser reconnection) ---

export function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function loadState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function clearState() {
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
}

// Connect to an existing browser via CDP
export async function connectToActiveBrowser() {
  const state = loadState();
  if (!state || !state.wsEndpoint) {
    console.error('No active browser. Run `playwright-pool browser launch` first.');
    process.exit(1);
  }
  try {
    const browser = await chromium.connectOverCDP(state.wsEndpoint);
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      console.error('Browser has no contexts. Run `playwright-pool browser launch` first.');
      process.exit(1);
    }
    const context = contexts[0];
    const pages = context.pages();
    const page = pages[pages.length - 1] || await context.newPage();
    return { browser, context, page };
  } catch (err) {
    console.error(`Cannot connect to browser: ${err.message}`);
    console.error('The browser may have been closed. Run `playwright-pool browser launch` again.');
    clearState();
    process.exit(1);
  }
}

// Launch a standalone browser (for quick ops — self-contained lifecycle)
export async function launchStandalone(flags = {}) {
  const viewport = getViewport(flags);
  const headless = !flags.headed;
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  return { browser, context, page };
}
