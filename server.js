#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { chromium } from 'playwright';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';

// --- Configuration ---
const HOME = os.homedir();
const GOLDEN_PROFILE = process.env.GOLDEN_PROFILE || path.join(HOME, '.playwright-pool', 'golden-profile');
const POOL_DIR = process.env.POOL_DIR || path.join(HOME, '.playwright-pool', 'pool-contexts');

// Unique session ID — ensures no conflicts between concurrent sessions
const SESSION_ID = crypto.randomUUID().slice(0, 8);

// --- State ---
const contexts = new Map(); // id -> { context, page, mode, label, contextDir }
let tabContext = null; // Shared context for tab mode (lazy-initialized)
let nextId = 1;

// --- Helpers ---
function log(msg) {
  process.stderr.write(`[pool:${SESSION_ID}] ${msg}\n`);
}

function ensurePoolDir() {
  if (!fs.existsSync(POOL_DIR)) {
    fs.mkdirSync(POOL_DIR, { recursive: true });
  }
}

// Auth files to overlay from golden profile into a fresh Chromium profile.
// Copying the ENTIRE golden profile causes crashes (cache/GPU data incompatible
// across Chromium builds). Instead: create a fresh profile, then overlay only
// the auth-critical files from the golden profile.
const AUTH_FILES = [
  'Default/Network/Cookies',
  'Default/Network/Cookies-journal',
  'Default/Login Data',
  'Default/Login Data-journal',
  'Default/Login Data For Account',
  'Default/Login Data For Account-journal',
  'Default/Local Storage',
  'Default/Session Storage',
  'Default/Web Data',
  'Default/Web Data-journal',
  'Default/Preferences',
  'Default/Secure Preferences',
  'Local State',
];

// Lock files that Chrome creates — must not be copied or Chromium thinks
// another instance owns the profile and refuses to start.
const LOCK_FILES = new Set([
  'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile', 'LOCK',
]);

// Template profile — created once per session, reused for every context
let templateDir = null;

async function ensureTemplate() {
  if (templateDir && fs.existsSync(templateDir)) return;

  if (!fs.existsSync(GOLDEN_PROFILE)) {
    throw new Error(
      `Golden profile not found at: ${GOLDEN_PROFILE}\n` +
      'Run with GOLDEN_PROFILE env var pointing to a Chromium user-data-dir ' +
      'that has your login sessions, or see README for setup instructions.'
    );
  }

  templateDir = path.join(POOL_DIR, `${SESSION_ID}-template`);
  ensurePoolDir();

  // Create a fresh Chromium profile once (the only headless launch per session)
  log('Creating template profile (one-time)...');
  const tempCtx = await chromium.launchPersistentContext(templateDir, { headless: true });
  await tempCtx.close();

  // Overlay auth files from golden profile
  for (const f of AUTH_FILES) {
    const src = path.join(GOLDEN_PROFILE, f);
    const dst = path.join(templateDir, f);
    if (fs.existsSync(src)) {
      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        fs.cpSync(src, dst, { recursive: true, force: true });
      } else {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      }
    }
  }
  log('Template ready.');
}

function createAuthProfile(destDir) {
  // Fast path: copy the pre-built template (no Chromium launch needed)
  log(`Copying template to ${path.basename(destDir)}...`);
  fs.cpSync(templateDir, destDir, {
    recursive: true,
    filter: (src) => !LOCK_FILES.has(path.basename(src)),
  });
  log('Profile ready.');
}

function getContext(id) {
  const ctx = contexts.get(id);
  if (!ctx) {
    throw new Error(
      `Context "${id}" not found. Active: ${[...contexts.keys()].join(', ') || 'none'}`
    );
  }
  return ctx;
}

async function getPageInfo(page) {
  try {
    return { url: page.url(), title: await page.title() };
  } catch {
    return { url: 'unknown', title: 'unknown' };
  }
}

async function cleanupContext(id) {
  const ctx = contexts.get(id);
  if (!ctx) return;

  if (ctx.mode === 'window') {
    await ctx.context.close().catch(() => {});
    if (ctx.contextDir && fs.existsSync(ctx.contextDir)) {
      try { fs.rmSync(ctx.contextDir, { recursive: true, force: true }); } catch {}
    }
  } else if (ctx.mode === 'tab') {
    await ctx.page.close().catch(() => {});
  }
  contexts.delete(id);
}

async function cleanupAll() {
  log('Cleaning up all contexts...');
  for (const [, ctx] of contexts) {
    if (ctx.mode === 'window') {
      await ctx.context.close().catch(() => {});
      if (ctx.contextDir && fs.existsSync(ctx.contextDir)) {
        try { fs.rmSync(ctx.contextDir, { recursive: true, force: true }); } catch {}
      }
    } else if (ctx.mode === 'tab') {
      await ctx.page.close().catch(() => {});
    }
  }
  contexts.clear();
  if (tabContext) {
    await tabContext.close().catch(() => {});
    tabContext = null;
  }
  const tabDir = path.join(POOL_DIR, `${SESSION_ID}-tabs`);
  if (fs.existsSync(tabDir)) {
    try { fs.rmSync(tabDir, { recursive: true, force: true }); } catch {}
  }
  if (templateDir && fs.existsSync(templateDir)) {
    try { fs.rmSync(templateDir, { recursive: true, force: true }); } catch {}
  }
  log('Cleanup complete.');
}

// --- MCP Server ---
const server = new McpServer({
  name: 'playwright-pool',
  version: '2.0.0',
});

// --- Tool: pool_launch ---
server.tool(
  'pool_launch',
  'Launch a new browser. Mode "window" opens a separate browser window (isolated cookies). Mode "tab" opens a tab in a shared window (shared cookies). Returns a context ID.',
  {
    mode: z.enum(['window', 'tab']).default('window').describe('"window" = separate browser window (isolated), "tab" = new tab in shared window'),
    width: z.number().optional().describe('Viewport width (default: 1280)'),
    height: z.number().optional().describe('Viewport height (default: 800)'),
    label: z.string().optional().describe('Optional label (e.g., "stripe", "cloudflare")'),
  },
  async ({ mode, width, height, label }) => {
    const id = `${SESSION_ID}-${nextId++}`;
    const vw = width || 1280;
    const vh = height || 800;

    try {
      ensurePoolDir();
      await ensureTemplate();

      if (mode === 'tab') {
        if (!tabContext) {
          const tabDir = path.join(POOL_DIR, `${SESSION_ID}-tabs`);
          createAuthProfile(tabDir);
          tabContext = await chromium.launchPersistentContext(tabDir, {
            headless: false,
            viewport: null,
            args: ['--disable-blink-features=AutomationControlled'],
          });
          log('Tab context initialized.');
        }

        const page = await tabContext.newPage();
        await page.setViewportSize({ width: vw, height: vh });
        contexts.set(id, { context: tabContext, page, mode: 'tab', label: label || id });
        log(`Tab "${id}" created (${vw}x${vh})`);

        return {
          content: [{ type: 'text', text: `Created tab "${id}"${label ? ` [${label}]` : ''} — ${vw}x${vh}` }],
        };
      } else {
        const contextDir = path.join(POOL_DIR, id);
        createAuthProfile(contextDir);

        const context = await chromium.launchPersistentContext(contextDir, {
          headless: false,
          viewport: { width: vw, height: vh },
          args: ['--disable-blink-features=AutomationControlled'],
        });

        const page = context.pages()[0] || await context.newPage();
        contexts.set(id, { context, page, mode: 'window', label: label || id, contextDir });
        log(`Window "${id}" created (${vw}x${vh})`);

        return {
          content: [{ type: 'text', text: `Created window "${id}"${label ? ` [${label}]` : ''} — ${vw}x${vh}` }],
        };
      }
    } catch (err) {
      return { content: [{ type: 'text', text: `Error launching: ${err.message}` }], isError: true };
    }
  }
);

// --- Tool: pool_navigate ---
server.tool(
  'pool_navigate',
  'Navigate a browser context to a URL.',
  {
    id: z.string().describe('Context ID from pool_launch'),
    url: z.string().describe('URL to navigate to'),
  },
  async ({ id, url }) => {
    try {
      const ctx = getContext(id);
      await ctx.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const info = await getPageInfo(ctx.page);
      return {
        content: [{ type: 'text', text: `[${id}] → ${info.url}\nTitle: ${info.title}` }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error navigating "${id}": ${err.message}` }], isError: true };
    }
  }
);

// --- Tool: pool_screenshot ---
server.tool(
  'pool_screenshot',
  'Take a screenshot of a browser context.',
  {
    id: z.string().describe('Context ID from pool_launch'),
    savePath: z.string().optional().describe('File path to save screenshot (optional — omit to return inline)'),
    fullPage: z.boolean().default(false).describe('Capture full scrollable page'),
  },
  async ({ id, savePath, fullPage }) => {
    try {
      const ctx = getContext(id);
      const info = await getPageInfo(ctx.page);

      if (savePath) {
        await ctx.page.screenshot({ path: savePath, fullPage });
        return {
          content: [{ type: 'text', text: `Screenshot saved: ${savePath}\nPage: ${info.url}` }],
        };
      } else {
        const buffer = await ctx.page.screenshot({ fullPage });
        return {
          content: [
            { type: 'text', text: `Screenshot of [${id}] — ${info.url}` },
            { type: 'image', data: buffer.toString('base64'), mimeType: 'image/png' },
          ],
        };
      }
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// --- Tool: pool_snapshot ---
server.tool(
  'pool_snapshot',
  'Get the accessibility tree snapshot for element interaction.',
  {
    id: z.string().describe('Context ID from pool_launch'),
  },
  async ({ id }) => {
    try {
      const ctx = getContext(id);
      const info = await getPageInfo(ctx.page);
      const snapshot = await ctx.page.accessibility.snapshot();
      return {
        content: [{ type: 'text', text: `[${id}] ${info.url}\n\n${JSON.stringify(snapshot, null, 2)}` }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// --- Tool: pool_click ---
server.tool(
  'pool_click',
  'Click an element in a browser context.',
  {
    id: z.string().describe('Context ID from pool_launch'),
    selector: z.string().describe('CSS selector or text selector (e.g., "text=Sign in", "button.submit")'),
  },
  async ({ id, selector }) => {
    try {
      const ctx = getContext(id);
      await ctx.page.click(selector, { timeout: 10000 });
      const info = await getPageInfo(ctx.page);
      return {
        content: [{ type: 'text', text: `Clicked "${selector}" in [${id}]\nPage: ${info.url}` }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// --- Tool: pool_fill ---
server.tool(
  'pool_fill',
  'Fill a form field in a browser context.',
  {
    id: z.string().describe('Context ID from pool_launch'),
    selector: z.string().describe('CSS selector for the input field'),
    value: z.string().describe('Value to fill'),
  },
  async ({ id, selector, value }) => {
    try {
      const ctx = getContext(id);
      await ctx.page.fill(selector, value, { timeout: 10000 });
      return {
        content: [{ type: 'text', text: `Filled "${selector}" in [${id}]` }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// --- Tool: pool_evaluate ---
server.tool(
  'pool_evaluate',
  'Run JavaScript in a browser context and return the result.',
  {
    id: z.string().describe('Context ID from pool_launch'),
    script: z.string().describe('JavaScript to evaluate in the page context'),
  },
  async ({ id, script }) => {
    try {
      const ctx = getContext(id);
      const result = await ctx.page.evaluate(script);
      return {
        content: [{ type: 'text', text: `[${id}] result:\n${JSON.stringify(result, null, 2)}` }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// --- Tool: pool_resize ---
server.tool(
  'pool_resize',
  'Resize the viewport of a browser context.',
  {
    id: z.string().describe('Context ID from pool_launch'),
    width: z.number().describe('New viewport width'),
    height: z.number().describe('New viewport height'),
  },
  async ({ id, width, height }) => {
    try {
      const ctx = getContext(id);
      await ctx.page.setViewportSize({ width, height });
      return {
        content: [{ type: 'text', text: `Resized [${id}] to ${width}x${height}` }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// --- Tool: pool_list ---
server.tool(
  'pool_list',
  'List all active browser contexts in this session.',
  {},
  async () => {
    if (contexts.size === 0) {
      return {
        content: [{ type: 'text', text: `Session ${SESSION_ID}: No active contexts. Use pool_launch to create one.` }],
      };
    }

    const lines = [`Session ${SESSION_ID} — ${contexts.size} active context(s):`];
    for (const [id, ctx] of contexts) {
      const info = await getPageInfo(ctx.page);
      lines.push(`  ${id} (${ctx.mode}) [${ctx.label}] — ${info.url}`);
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// --- Tool: pool_close ---
server.tool(
  'pool_close',
  'Close a browser context, or "all" to close everything in this session.',
  {
    id: z.string().describe('Context ID to close, or "all"'),
  },
  async ({ id }) => {
    try {
      if (id === 'all') {
        const count = contexts.size;
        await cleanupAll();
        return { content: [{ type: 'text', text: `Closed ${count} context(s) in session ${SESSION_ID}.` }] };
      }
      await cleanupContext(id);
      return { content: [{ type: 'text', text: `Closed "${id}".` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// --- Cleanup on exit ---
async function shutdown() {
  log('Shutting down...');
  await cleanupAll();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => {
  // Sync cleanup for any remaining temp dirs (best effort)
  try {
    const entries = fs.readdirSync(POOL_DIR);
    for (const entry of entries) {
      if (entry.startsWith(SESSION_ID)) {
        fs.rmSync(path.join(POOL_DIR, entry), { recursive: true, force: true });
      }
    }
  } catch {}
});

// --- Start ---
log(`Starting (session: ${SESSION_ID}, golden: ${GOLDEN_PROFILE})`);
const transport = new StdioServerTransport();
await server.connect(transport);
log('Ready.');
