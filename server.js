#!/usr/bin/env node

// playwright-pool v3 — Pool management layer on top of @playwright/mcp
//
// Uses the official Playwright MCP server's internal modules (BrowserServerBackend,
// tools, config) to expose all 35 browser tools, while adding pool management
// (pool_launch, pool_close, pool_list) with golden profile auth overlay and
// UUID session isolation.

import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
import { createRequire } from 'module';

// --- Resolve internal Playwright MCP modules ---
// playwright/lib/mcp is not exported in package.json, so we resolve the
// physical path from the playwright package root.
const require_ = createRequire(import.meta.url);
const pwDir = path.dirname(require_.resolve('playwright'));
const mcpDir = path.join(pwDir, 'lib', 'mcp');

const { BrowserServerBackend } = require_(path.join(mcpDir, 'browser', 'browserServerBackend.js'));
const { resolveConfig } = require_(path.join(mcpDir, 'browser', 'config.js'));
const { filteredTools } = require_(path.join(mcpDir, 'browser', 'tools.js'));
const { toMcpTool } = require_(path.join(mcpDir, 'sdk', 'tool.js'));
const { createServer } = require_(path.join(mcpDir, 'sdk', 'server.js'));
const mcpBundle = require_('playwright-core/lib/mcpBundle');

// --- Configuration ---
const HOME = os.homedir();
const GOLDEN_PROFILE = process.env.GOLDEN_PROFILE || path.join(HOME, '.playwright-pool', 'golden-profile');
const POOL_DIR = process.env.POOL_DIR || path.join(HOME, '.playwright-pool', 'pool-contexts');

// Unique session ID — ensures no conflicts between concurrent sessions
const SESSION_ID = crypto.randomUUID().slice(0, 8);

// --- Logging ---
function log(msg) {
  process.stderr.write(`[pool:${SESSION_ID}] ${msg}\n`);
}

// --- Pool State ---
const poolEntries = new Map(); // id -> { backend, contextDir, mode, label, browserContext, tabIndex }
let activeId = null;
let tabContext = null; // Shared BrowserContext for tab mode
let tabContextDir = null;
let tabBackend = null; // Single backend for all tab-mode entries
let nextId = 1;

// --- Auth overlay constants ---
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

const LOCK_FILES = new Set([
  'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile', 'LOCK',
]);

// --- Template profile (created once per session) ---
let templateDir = null;

function ensurePoolDir() {
  if (!fs.existsSync(POOL_DIR)) {
    fs.mkdirSync(POOL_DIR, { recursive: true });
  }
}

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
  log(`Copying template to ${path.basename(destDir)}...`);
  fs.cpSync(templateDir, destDir, {
    recursive: true,
    filter: (src) => !LOCK_FILES.has(path.basename(src)),
  });
  log('Profile ready.');
}

// --- Find a free port for CDP ---
async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

// --- Create a BrowserServerBackend for a given BrowserContext ---
// The backend gets its own Context (Playwright MCP's internal Context class),
// which manages tabs, snapshots, etc. We provide a custom context factory
// that returns our pre-created, auth-overlaid BrowserContext.
async function createBackendForContext(browserContext) {
  const config = await resolveConfig({
    browser: {
      browserName: 'chromium',
      launchOptions: {
        headless: false,
      },
      contextOptions: {
        viewport: null,
      },
    },
    capabilities: ['vision', 'pdf', 'testing', 'tracing'],
    allowUnrestrictedFileAccess: true,
  });

  const factory = {
    name: 'pool',
    description: 'Pool-managed browser context',
    async createContext() {
      return {
        browserContext,
        close: async () => {
          // Pool manages lifecycle — don't close on backend disposal
        },
      };
    },
  };

  const backend = new BrowserServerBackend(config, factory);
  return backend;
}

// --- Pool management tool definitions ---
// These follow the same shape as official Playwright MCP tools so the
// composite backend can list them alongside browser tools.

const poolToolSchemas = [
  {
    name: 'pool_launch',
    title: 'Launch browser',
    description:
      'Launch a new authenticated browser context. Mode "window" opens a separate browser window (isolated cookies/sessions). Mode "tab" opens a tab in a shared window (shared cookies). Returns a context ID and automatically makes it the active context for all browser_* tools.',
    inputSchema: mcpBundle.z.object({
      mode: mcpBundle.z.enum(['window', 'tab']).default('window').describe('"window" = separate browser (isolated), "tab" = new tab in shared window'),
      width: mcpBundle.z.number().optional().describe('Viewport width (default: 1280)'),
      height: mcpBundle.z.number().optional().describe('Viewport height (default: 800)'),
      label: mcpBundle.z.string().optional().describe('Optional label (e.g., "stripe", "cloudflare")'),
    }),
    type: 'input',
  },
  {
    name: 'pool_close',
    title: 'Close browser',
    description: 'Close a browser context by ID, or pass "all" to close everything in this session.',
    inputSchema: mcpBundle.z.object({
      id: mcpBundle.z.string().describe('Context ID to close, or "all"'),
    }),
    type: 'input',
  },
  {
    name: 'pool_list',
    title: 'List browsers',
    description: 'List all active browser contexts in this session, showing which one is active.',
    inputSchema: mcpBundle.z.object({}),
    type: 'readOnly',
  },
  {
    name: 'pool_switch',
    title: 'Switch browser',
    description: 'Switch the active browser context. All browser_* tools will operate on this context. For switching between tabs in the same window, use browser_tabs instead.',
    inputSchema: mcpBundle.z.object({
      id: mcpBundle.z.string().describe('Context ID to make active'),
    }),
    type: 'input',
  },
];

// --- Pool tool handlers ---

async function handlePoolLaunch(params) {
  const mode = params.mode || 'window';
  const id = `${SESSION_ID}-${nextId++}`;
  const vw = params.width || 1280;
  const vh = params.height || 800;

  ensurePoolDir();
  await ensureTemplate();

  let browserContext;
  let contextDir = null;

  let backend;

  if (mode === 'tab') {
    // Shared context for all tabs — one browser, one backend, many pages
    if (!tabContext) {
      tabContextDir = path.join(POOL_DIR, `${SESSION_ID}-tabs`);
      createAuthProfile(tabContextDir);
      const cdpPort = await findFreePort();
      tabContext = await chromium.launchPersistentContext(tabContextDir, {
        headless: false,
        viewport: null,
        args: [
          '--disable-blink-features=AutomationControlled',
          `--remote-debugging-port=${cdpPort}`,
        ],
      });
      log('Tab context initialized.');

      // Create a single shared backend for all tab entries
      tabBackend = await createBackendForContext(tabContext);
    }

    // Create a new tab page. For the first tab launch, close the initial
    // about:blank page that Chromium opens automatically with persistent contexts.
    const existingPages = tabContext.pages();
    const page = await tabContext.newPage();
    await page.setViewportSize({ width: vw, height: vh });

    // Close the initial blank page if this is the first tab launch
    if (existingPages.length === 1 && existingPages[0].url() === 'about:blank') {
      await existingPages[0].close().catch(() => {});
    }

    browserContext = tabContext;
    backend = tabBackend;

    // Track which tab index this entry corresponds to
    const tabIndex = tabContext.pages().indexOf(page);

    poolEntries.set(id, {
      backend,
      contextDir: null,
      mode,
      label: params.label || id,
      browserContext,
      tabIndex,
    });
  } else {
    // Window mode — separate persistent context with its own backend
    contextDir = path.join(POOL_DIR, id);
    createAuthProfile(contextDir);
    const cdpPort = await findFreePort();
    browserContext = await chromium.launchPersistentContext(contextDir, {
      headless: false,
      viewport: { width: vw, height: vh },
      args: [
        '--disable-blink-features=AutomationControlled',
        `--remote-debugging-port=${cdpPort}`,
      ],
    });

    backend = await createBackendForContext(browserContext);

    poolEntries.set(id, {
      backend,
      contextDir,
      mode,
      label: params.label || id,
      browserContext,
    });
  }

  // Make this the active context
  activeId = id;

  log(`${mode === 'tab' ? 'Tab' : 'Window'} "${id}" created (${vw}x${vh})`);
  return {
    content: [{
      type: 'text',
      text: `Created ${mode} "${id}"${params.label ? ` [${params.label}]` : ''} (${vw}x${vh})\nThis is now the active context. All browser_* tools will operate on it.`,
    }],
  };
}

async function handlePoolClose(params) {
  const { id } = params;

  if (id === 'all') {
    const count = poolEntries.size;
    await cleanupAll();
    return { content: [{ type: 'text', text: `Closed ${count} context(s) in session ${SESSION_ID}.` }] };
  }

  const entry = poolEntries.get(id);
  if (!entry) {
    return {
      content: [{ type: 'text', text: `Context "${id}" not found. Active: ${[...poolEntries.keys()].join(', ') || 'none'}` }],
      isError: true,
    };
  }

  await cleanupEntry(id);
  return { content: [{ type: 'text', text: `Closed "${id}".` }] };
}

async function handlePoolList() {
  if (poolEntries.size === 0) {
    return {
      content: [{ type: 'text', text: `Session ${SESSION_ID}: No active contexts. Use pool_launch to create one.` }],
    };
  }

  const lines = [`Session ${SESSION_ID} — ${poolEntries.size} active context(s):`];
  for (const [id, entry] of poolEntries) {
    const marker = id === activeId ? ' <-- active' : '';
    let pageInfo = '';
    try {
      const pages = entry.browserContext.pages();
      if (entry.mode === 'tab' && entry.tabIndex != null) {
        // Show the specific page for this tab entry
        const page = pages[entry.tabIndex];
        pageInfo = page ? ` — ${page.url()}` : ' — (tab closed)';
      } else if (pages.length > 0) {
        // Window mode — show the last page
        const lastPage = pages[pages.length - 1];
        pageInfo = ` — ${lastPage.url()}`;
      }
    } catch {
      pageInfo = ' — (page info unavailable)';
    }
    lines.push(`  ${id} (${entry.mode}) [${entry.label}]${pageInfo}${marker}`);
  }
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

async function handlePoolSwitch(params) {
  const { id } = params;
  if (!poolEntries.has(id)) {
    return {
      content: [{ type: 'text', text: `Context "${id}" not found. Active: ${[...poolEntries.keys()].join(', ') || 'none'}` }],
      isError: true,
    };
  }
  activeId = id;
  const entry = poolEntries.get(id);
  return {
    content: [{ type: 'text', text: `Switched to "${id}" [${entry.label}]. All browser_* tools now target this context.` }],
  };
}

// --- Cleanup ---

async function cleanupEntry(id) {
  const entry = poolEntries.get(id);
  if (!entry) return;

  if (entry.mode === 'window') {
    // Dispose the backend first, then close the browser
    try { entry.backend.serverClosed?.(); } catch {}
    await entry.browserContext.close().catch(() => {});
    if (entry.contextDir && fs.existsSync(entry.contextDir)) {
      try { fs.rmSync(entry.contextDir, { recursive: true, force: true }); } catch {}
    }
  } else if (entry.mode === 'tab') {
    // For tab entries, close the specific page but keep the shared context alive
    // (unless this is the last tab entry)
    const tabEntries = [...poolEntries.entries()].filter(([, e]) => e.mode === 'tab');
    if (tabEntries.length <= 1) {
      // Last tab — tear down the shared context and backend
      try { tabBackend?.serverClosed?.(); } catch {}
      tabBackend = null;
      await tabContext?.close().catch(() => {});
      tabContext = null;
      if (tabContextDir && fs.existsSync(tabContextDir)) {
        try { fs.rmSync(tabContextDir, { recursive: true, force: true }); } catch {}
        tabContextDir = null;
      }
    } else {
      // Close one tab page (the one at tabIndex, or the most recent)
      try {
        const pages = entry.browserContext.pages();
        const idx = entry.tabIndex ?? pages.length - 1;
        if (idx >= 0 && idx < pages.length) {
          await pages[idx].close().catch(() => {});
        }
      } catch {}
    }
  }

  poolEntries.delete(id);

  // If we deleted the active context, pick another
  if (activeId === id) {
    const remaining = [...poolEntries.keys()];
    activeId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
  }
}

async function cleanupAll() {
  log('Cleaning up all contexts...');

  // Collect unique backends to avoid double-disposal
  const disposedBackends = new Set();

  // Close window-mode contexts and their backends
  for (const [, entry] of poolEntries) {
    if (entry.mode === 'window') {
      if (!disposedBackends.has(entry.backend)) {
        try { entry.backend.serverClosed?.(); } catch {}
        disposedBackends.add(entry.backend);
      }
      await entry.browserContext.close().catch(() => {});
      if (entry.contextDir && fs.existsSync(entry.contextDir)) {
        try { fs.rmSync(entry.contextDir, { recursive: true, force: true }); } catch {}
      }
    }
  }

  // Close shared tab backend and context
  if (tabBackend && !disposedBackends.has(tabBackend)) {
    try { tabBackend.serverClosed?.(); } catch {}
  }
  tabBackend = null;

  if (tabContext) {
    await tabContext.close().catch(() => {});
    tabContext = null;
  }
  if (tabContextDir && fs.existsSync(tabContextDir)) {
    try { fs.rmSync(tabContextDir, { recursive: true, force: true }); } catch {}
    tabContextDir = null;
  }

  poolEntries.clear();
  activeId = null;

  // Clean up template
  if (templateDir && fs.existsSync(templateDir)) {
    try { fs.rmSync(templateDir, { recursive: true, force: true }); } catch {}
  }

  log('Cleanup complete.');
}

// --- Composite Backend ---
// Implements the same interface as BrowserServerBackend (listTools, callTool,
// initialize, serverClosed) but adds pool tools and delegates browser tools
// to the active pool entry's backend.

class PoolCompositeBackend {
  constructor() {
    this._clientInfo = null;
    this._browserToolList = null;
    this._browserToolListPromise = this._computeToolList();
  }

  async _computeToolList() {
    const config = await resolveConfig({
      browser: { browserName: 'chromium' },
      capabilities: ['vision', 'pdf', 'testing', 'tracing'],
    });
    const tools = filteredTools(config);
    this._browserToolList = tools.map(t => toMcpTool(t.schema));
    this._browserTools = tools;
  }

  async initialize(clientInfo) {
    this._clientInfo = clientInfo;
    await this._browserToolListPromise;
  }

  async listTools() {
    await this._browserToolListPromise;

    // Pool management tools
    const poolTools = poolToolSchemas.map(schema => toMcpTool(schema));

    // Official browser tools (full list)
    const browserTools = this._browserToolList || [];

    return [...poolTools, ...browserTools];
  }

  async callTool(name, rawArguments, progress) {
    // Pool tools
    if (name === 'pool_launch') {
      const parsed = poolToolSchemas[0].inputSchema.parse(rawArguments || {});
      try {
        const result = await handlePoolLaunch(parsed);
        // Initialize the backend with clientInfo so it can create its internal
        // Context object. For tab mode, only initialize once (shared backend).
        const entry = poolEntries.get(activeId);
        if (entry && this._clientInfo && !entry.backend._initialized) {
          await entry.backend.initialize(this._clientInfo);
          entry.backend._initialized = true;
        }
        return result;
      } catch (error) {
        return { content: [{ type: 'text', text: `Error launching: ${error.message}` }], isError: true };
      }
    }

    if (name === 'pool_close') {
      const parsed = poolToolSchemas[1].inputSchema.parse(rawArguments || {});
      try {
        return await handlePoolClose(parsed);
      } catch (error) {
        return { content: [{ type: 'text', text: `Error closing: ${error.message}` }], isError: true };
      }
    }

    if (name === 'pool_list') {
      try {
        return await handlePoolList();
      } catch (error) {
        return { content: [{ type: 'text', text: `Error listing: ${error.message}` }], isError: true };
      }
    }

    if (name === 'pool_switch') {
      const parsed = poolToolSchemas[3].inputSchema.parse(rawArguments || {});
      try {
        return await handlePoolSwitch(parsed);
      } catch (error) {
        return { content: [{ type: 'text', text: `Error switching: ${error.message}` }], isError: true };
      }
    }

    // Intercept browser_close — redirect to pool_close for the active context
    // so the actual browser process is cleaned up properly.
    if (name === 'browser_close') {
      if (!activeId) {
        return { content: [{ type: 'text', text: 'No active browser context to close.' }], isError: true };
      }
      return handlePoolClose({ id: activeId });
    }

    // Browser tools — delegate to active backend
    if (!activeId || !poolEntries.has(activeId)) {
      return {
        content: [{
          type: 'text',
          text: 'No active browser context. Use pool_launch to create one first.',
        }],
        isError: true,
      };
    }

    const entry = poolEntries.get(activeId);
    return entry.backend.callTool(name, rawArguments, progress);
  }

  serverClosed(server) {
    // Called when the MCP server is shut down
    cleanupAll().catch(() => {});
  }
}

// --- Start the MCP server ---
log(`Starting (session: ${SESSION_ID}, golden: ${GOLDEN_PROFILE})`);

const backend = new PoolCompositeBackend();
const server = createServer('playwright-pool', '3.0.0', backend, false);

const transport = new mcpBundle.StdioServerTransport();
await server.connect(transport);

log('Ready. Use pool_launch to create a browser context, then use any browser_* tool.');

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
