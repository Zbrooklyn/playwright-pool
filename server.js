#!/usr/bin/env node

// playwright-pool v3 — Pool management layer on top of @playwright/mcp
//
// Uses the official Playwright MCP server's internal modules (BrowserServerBackend,
// tools, config) to expose all 35 official browser tools, while adding pool management
// (pool_launch, pool_close, pool_list) with golden profile auth overlay and
// UUID session isolation.

import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { chromium, devices } from 'playwright';
import { createRequire } from 'module';
import { getSchemas as getAuditBSchemas, handleAuditTool as handleAuditToolB, isAuditToolB } from './audit-tools-b.js';

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
    capabilities: ['core-install', 'core-tabs', 'internal', 'pdf', 'testing', 'tracing', 'vision'],
    allowUnrestrictedFileAccess: true,
    // Optimize MCP response size for token efficiency:
    // - incremental snapshots show only changes (not full tree every time)
    // - codegen: 'none' removes "Ran Playwright code" section from responses
    snapshot: { mode: 'incremental' },
    codegen: 'none',
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
      device: mcpBundle.z.string().optional().describe('Device preset for emulation (e.g., "iPhone 14", "Pixel 7", "iPad Pro 11"). Sets viewport, userAgent, deviceScaleFactor, isMobile, hasTouch. Overrides width/height. Window mode only.'),
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

// --- Phase 5: UI Audit tool definitions ---
const auditToolSchemas = [
  {
    name: 'audit_accessibility',
    title: 'Accessibility audit',
    description:
      'Run an accessibility audit on the current page. Injects axe-core logic inline (no CDN) and returns WCAG violations grouped by severity.',
    inputSchema: mcpBundle.z.object({
      standard: mcpBundle.z.enum(['WCAG2A', 'WCAG2AA', 'WCAG2AAA']).default('WCAG2AA').describe('WCAG standard level'),
    }),
    type: 'readOnly',
  },
  {
    name: 'audit_color_contrast',
    title: 'Color contrast audit',
    description:
      'Evaluate color contrast ratios for all visible text elements on the page using the WCAG luminance formula. Flags elements that fail the specified level.',
    inputSchema: mcpBundle.z.object({
      level: mcpBundle.z.enum(['AA', 'AAA']).default('AA').describe('WCAG contrast level (AA: 4.5:1 normal, 3:1 large; AAA: 7:1 normal, 4.5:1 large)'),
    }),
    type: 'readOnly',
  },
  {
    name: 'audit_breakpoints',
    title: 'Breakpoint screenshots',
    description:
      'Resize viewport to multiple breakpoints and take a screenshot at each. Returns screenshots for visual comparison across device sizes.',
    inputSchema: mcpBundle.z.object({
      url: mcpBundle.z.string().optional().describe('URL to navigate to before screenshotting (uses current page if omitted)'),
      breakpoints: mcpBundle.z.array(mcpBundle.z.object({
        label: mcpBundle.z.string(),
        width: mcpBundle.z.number(),
        height: mcpBundle.z.number(),
      })).optional().describe('Custom breakpoints array [{label, width, height}]. Defaults to desktop/tablet/mobile.'),
      savePath: mcpBundle.z.string().optional().describe('Directory to save screenshots to disk (optional)'),
    }),
    type: 'readOnly',
  },
  {
    name: 'audit_tap_targets',
    title: 'Tap target audit',
    description:
      'Find all interactive elements (buttons, links, inputs) and measure their bounding boxes. Flags any element smaller than the minimum touch target size.',
    inputSchema: mcpBundle.z.object({
      minSize: mcpBundle.z.number().default(48).describe('Minimum tap target size in px (default 48, per WCAG 2.5.8)'),
    }),
    type: 'readOnly',
  },
  {
    name: 'audit_core_web_vitals',
    title: 'Core Web Vitals',
    description:
      'Measure Core Web Vitals (LCP, CLS) using the PerformanceObserver API. Optionally navigates to a URL first and waits for metrics to stabilize.',
    inputSchema: mcpBundle.z.object({
      url: mcpBundle.z.string().optional().describe('URL to navigate to and measure (uses current page if omitted)'),
    }),
    type: 'readOnly',
  },
  {
    name: 'audit_image_sizes',
    title: 'Image audit',
    description:
      'Audit all <img> elements on the page: missing alt text, oversized images (naturalWidth >> rendered), broken src, missing lazy loading.',
    inputSchema: mcpBundle.z.object({}),
    type: 'readOnly',
  },
  {
    name: 'audit_fonts',
    title: 'Font audit',
    description:
      'Catalog all unique font-family, font-size, font-weight, and line-height combinations used on the page. Helps detect font inconsistencies.',
    inputSchema: mcpBundle.z.object({}),
    type: 'readOnly',
  },
  {
    name: 'audit_computed_styles',
    title: 'Computed styles',
    description:
      'Get the computed CSS properties for a specific element. Optionally filter to specific properties.',
    inputSchema: mcpBundle.z.object({
      selector: mcpBundle.z.string().describe('CSS selector for the target element'),
      properties: mcpBundle.z.array(mcpBundle.z.string()).optional().describe('List of CSS property names to return (returns all if omitted)'),
    }),
    type: 'readOnly',
  },
  {
    name: 'audit_overflow',
    title: 'Overflow detection',
    description:
      'Detect horizontal overflow at the current viewport or multiple breakpoints. Finds elements wider than the viewport that cause horizontal scrollbars.',
    inputSchema: mcpBundle.z.object({
      breakpoints: mcpBundle.z.array(mcpBundle.z.object({
        label: mcpBundle.z.string(),
        width: mcpBundle.z.number(),
        height: mcpBundle.z.number(),
      })).optional().describe('Breakpoints to test. If omitted, tests current viewport only.'),
    }),
    type: 'readOnly',
  },
  {
    name: 'audit_dark_mode',
    title: 'Dark mode comparison',
    description:
      'Emulate prefers-color-scheme for both light and dark modes, taking a screenshot of each for visual comparison.',
    inputSchema: mcpBundle.z.object({
      savePath: mcpBundle.z.string().optional().describe('Directory to save screenshots to disk (optional)'),
    }),
    type: 'readOnly',
  },
  {
    name: 'audit_meta',
    title: 'SEO metadata audit',
    description:
      'Extract and validate SEO metadata: title, description, Open Graph tags, heading hierarchy, canonical URL, robots, viewport meta.',
    inputSchema: mcpBundle.z.object({}),
    type: 'readOnly',
  },
  {
    name: 'audit_visual',
    title: 'Comprehensive visual audit',
    description:
      'Run a comprehensive programmatic UI audit in a single pass: layout overflow, element overlaps, spacing consistency, color contrast, typography, tap targets, images, accessibility, SEO meta, focus order, z-index stacking, and dark mode. Returns a structured text report organized by category with severity-rated issues.',
    inputSchema: mcpBundle.z.object({
      url: mcpBundle.z.string().optional().describe('URL to navigate to before auditing (uses current page if omitted)'),
    }),
    type: 'readOnly',
  },
];

// --- Utility tool definitions ---
const utilityToolSchemas = [
  {
    name: 'snapshot_compact',
    title: 'Compact interactive snapshot',
    description:
      'Get a compact snapshot of only interactive elements (buttons, links, inputs, selects). Uses ~90% fewer tokens than browser_snapshot. Best for when you need to click, type, or interact with the page.',
    inputSchema: mcpBundle.z.object({
      selector: mcpBundle.z.string().optional().describe('CSS selector to scope the snapshot (optional, defaults to full page)'),
    }),
    type: 'readOnly',
  },
];

// --- Custom browser tool definitions (not in upstream @playwright/mcp) ---
const customToolSchemas = [
  {
    name: 'browser_cookies_get',
    title: 'Get cookies',
    description:
      'Get browser cookies for the current page or a specific URL. Returns name, value, domain, path, expires, httpOnly, secure, sameSite for each cookie.',
    inputSchema: mcpBundle.z.object({
      urls: mcpBundle.z.array(mcpBundle.z.string()).optional().describe('URLs to get cookies for (defaults to current page URL)'),
    }),
    type: 'readOnly',
  },
  {
    name: 'browser_cookies_set',
    title: 'Set cookie',
    description:
      'Set a browser cookie. Requires name and value at minimum. Domain defaults to the current page domain.',
    inputSchema: mcpBundle.z.object({
      name: mcpBundle.z.string().describe('Cookie name'),
      value: mcpBundle.z.string().describe('Cookie value'),
      url: mcpBundle.z.string().optional().describe('URL to associate the cookie with (defaults to current page URL)'),
      domain: mcpBundle.z.string().optional().describe('Cookie domain'),
      path: mcpBundle.z.string().optional().describe('Cookie path (default: /)'),
      expires: mcpBundle.z.number().optional().describe('Unix timestamp for expiration (-1 for session cookie)'),
      httpOnly: mcpBundle.z.boolean().optional().describe('HTTP-only flag'),
      secure: mcpBundle.z.boolean().optional().describe('Secure flag'),
      sameSite: mcpBundle.z.enum(['Strict', 'Lax', 'None']).optional().describe('SameSite attribute'),
    }),
    type: 'input',
  },
  {
    name: 'browser_cookies_clear',
    title: 'Clear cookies',
    description:
      'Clear all browser cookies, or only cookies matching a specific domain/name filter.',
    inputSchema: mcpBundle.z.object({
      name: mcpBundle.z.string().optional().describe('Only clear cookies with this name'),
      domain: mcpBundle.z.string().optional().describe('Only clear cookies for this domain'),
    }),
    type: 'input',
  },
  {
    name: 'browser_storage_get',
    title: 'Get storage',
    description:
      'Read localStorage or sessionStorage for the current page. Returns all key-value pairs, or a specific key.',
    inputSchema: mcpBundle.z.object({
      storageType: mcpBundle.z.enum(['localStorage', 'sessionStorage']).default('localStorage').describe('Which storage to read'),
      key: mcpBundle.z.string().optional().describe('Specific key to read (returns all if omitted)'),
    }),
    type: 'readOnly',
  },
  {
    name: 'browser_storage_set',
    title: 'Set storage',
    description:
      'Write a key-value pair to localStorage or sessionStorage for the current page.',
    inputSchema: mcpBundle.z.object({
      storageType: mcpBundle.z.enum(['localStorage', 'sessionStorage']).default('localStorage').describe('Which storage to write to'),
      key: mcpBundle.z.string().describe('Storage key'),
      value: mcpBundle.z.string().describe('Storage value'),
    }),
    type: 'input',
  },
  {
    name: 'browser_mouse_wheel',
    title: 'Mouse wheel scroll',
    description:
      'Dispatch a mouse wheel event to scroll the page or a specific element. Positive deltaY scrolls down, negative scrolls up. Positive deltaX scrolls right, negative scrolls left.',
    inputSchema: mcpBundle.z.object({
      deltaX: mcpBundle.z.number().default(0).describe('Horizontal scroll amount in pixels (positive = right)'),
      deltaY: mcpBundle.z.number().default(0).describe('Vertical scroll amount in pixels (positive = down, e.g., 500 to scroll down)'),
    }),
    type: 'input',
  },
];

// --- Custom tool handlers ---
async function handleCookiesGet(params) {
  const page = getActivePage();
  const context = page.context();
  const urls = params.urls || [page.url()];
  const cookies = await context.cookies(urls);
  if (cookies.length === 0) {
    return { content: [{ type: 'text', text: 'No cookies found.' }] };
  }
  const lines = cookies.map(c =>
    `${c.name}=${c.value} (domain=${c.domain}, path=${c.path}, expires=${c.expires === -1 ? 'session' : new Date(c.expires * 1000).toISOString()}, httpOnly=${c.httpOnly}, secure=${c.secure}, sameSite=${c.sameSite})`
  );
  return { content: [{ type: 'text', text: `${cookies.length} cookie(s):\n${lines.join('\n')}` }] };
}

async function handleCookiesSet(params) {
  const page = getActivePage();
  const context = page.context();
  const cookie = {
    name: params.name,
    value: params.value,
    url: params.url || page.url(),
  };
  if (params.domain) cookie.domain = params.domain;
  if (params.path) cookie.path = params.path;
  if (params.expires !== undefined) cookie.expires = params.expires;
  if (params.httpOnly !== undefined) cookie.httpOnly = params.httpOnly;
  if (params.secure !== undefined) cookie.secure = params.secure;
  if (params.sameSite) cookie.sameSite = params.sameSite;
  await context.addCookies([cookie]);
  return { content: [{ type: 'text', text: `Cookie "${params.name}" set successfully.` }] };
}

async function handleCookiesClear(params) {
  const page = getActivePage();
  const context = page.context();
  if (!params.name && !params.domain) {
    await context.clearCookies();
    return { content: [{ type: 'text', text: 'All cookies cleared.' }] };
  }
  // Selective clear: get all cookies, filter, then clear and re-add the ones to keep
  const allCookies = await context.cookies();
  const toRemove = allCookies.filter(c => {
    if (params.name && c.name !== params.name) return false;
    if (params.domain && !c.domain.includes(params.domain)) return false;
    return true;
  });
  if (toRemove.length === 0) {
    return { content: [{ type: 'text', text: 'No matching cookies found.' }] };
  }
  const toKeep = allCookies.filter(c => !toRemove.includes(c));
  await context.clearCookies();
  if (toKeep.length > 0) {
    await context.addCookies(toKeep);
  }
  return { content: [{ type: 'text', text: `Cleared ${toRemove.length} cookie(s). ${toKeep.length} remaining.` }] };
}

async function handleStorageGet(params) {
  const page = getActivePage();
  const storageType = params.storageType || 'localStorage';
  if (params.key) {
    const value = await page.evaluate(([type, key]) => window[type].getItem(key), [storageType, params.key]);
    if (value === null) {
      return { content: [{ type: 'text', text: `${storageType}["${params.key}"] = null (not found)` }] };
    }
    return { content: [{ type: 'text', text: `${storageType}["${params.key}"] = ${value}` }] };
  }
  const entries = await page.evaluate((type) => {
    const result = {};
    for (let i = 0; i < window[type].length; i++) {
      const key = window[type].key(i);
      result[key] = window[type].getItem(key);
    }
    return result;
  }, storageType);
  const keys = Object.keys(entries);
  if (keys.length === 0) {
    return { content: [{ type: 'text', text: `${storageType} is empty.` }] };
  }
  const lines = keys.map(k => `  ${k} = ${entries[k]}`);
  return { content: [{ type: 'text', text: `${storageType} (${keys.length} entries):\n${lines.join('\n')}` }] };
}

async function handleStorageSet(params) {
  const page = getActivePage();
  const storageType = params.storageType || 'localStorage';
  await page.evaluate(([type, key, value]) => window[type].setItem(key, value), [storageType, params.key, params.value]);
  return { content: [{ type: 'text', text: `${storageType}["${params.key}"] set successfully.` }] };
}

async function handleMouseWheel(params) {
  const page = getActivePage();
  const deltaX = params.deltaX || 0;
  const deltaY = params.deltaY || 0;
  await page.mouse.wheel(deltaX, deltaY);
  const direction = [];
  if (deltaY > 0) direction.push('down');
  else if (deltaY < 0) direction.push('up');
  if (deltaX > 0) direction.push('right');
  else if (deltaX < 0) direction.push('left');
  return { content: [{ type: 'text', text: `Scrolled ${direction.join(' and ')} (deltaX=${deltaX}, deltaY=${deltaY}).` }] };
}

// --- Audit tool helper: get active page ---
function getActivePage() {
  if (!activeId || !poolEntries.has(activeId)) {
    throw new Error('No active browser context. Use pool_launch to create one first.');
  }
  const entry = poolEntries.get(activeId);
  const pages = entry.browserContext.pages();
  if (pages.length === 0) {
    throw new Error('No pages open in the active browser context.');
  }
  return pages[pages.length - 1];
}

// --- Audit tool handlers ---

async function handleAuditAccessibility(params) {
  const page = getActivePage();
  const standard = params.standard || 'WCAG2AA';

  // Map standard to axe-core runOnly tags
  const tagMap = {
    'WCAG2A': ['wcag2a', 'best-practice'],
    'WCAG2AA': ['wcag2a', 'wcag2aa', 'best-practice'],
    'WCAG2AAA': ['wcag2a', 'wcag2aa', 'wcag2aaa', 'best-practice'],
  };
  const tags = tagMap[standard] || tagMap['WCAG2AA'];

  // Inject axe-core inline and run it
  const results = await page.evaluate(async (runTags) => {
    // Inline a minimal axe-core-like accessibility checker
    // Since we can't use CDN (supply-chain risk), we implement WCAG checks directly
    const violations = [];

    // Helper: get all elements
    function getAllElements() {
      return Array.from(document.querySelectorAll('*'));
    }

    // Helper: is element visible
    function isVisible(el) {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
        && el.offsetWidth > 0 && el.offsetHeight > 0;
    }

    // 1. Images without alt text
    const images = document.querySelectorAll('img');
    images.forEach(img => {
      if (!img.hasAttribute('alt')) {
        violations.push({
          id: 'image-alt',
          impact: 'critical',
          description: 'Images must have alternate text',
          help: 'Ensure <img> elements have alt attributes',
          nodes: [{ html: img.outerHTML.slice(0, 200), target: img.tagName + (img.id ? '#' + img.id : '') + (img.className ? '.' + String(img.className).split(' ').join('.') : '') }],
        });
      }
    });

    // 2. Form inputs without labels
    const inputs = document.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button') return;
      const hasLabel = input.id && document.querySelector(`label[for="${input.id}"]`);
      const hasAriaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
      const wrappedInLabel = input.closest('label');
      const hasTitle = input.getAttribute('title');
      if (!hasLabel && !hasAriaLabel && !wrappedInLabel && !hasTitle) {
        violations.push({
          id: 'label',
          impact: 'critical',
          description: 'Form elements must have labels',
          help: 'Ensure every form input has an associated label',
          nodes: [{ html: input.outerHTML.slice(0, 200), target: input.tagName + '[' + (input.type || 'text') + ']' + (input.name ? '[name=' + input.name + ']' : '') }],
        });
      }
    });

    // 3. Empty links
    const links = document.querySelectorAll('a[href]');
    links.forEach(link => {
      if (!isVisible(link)) return;
      const text = (link.textContent || '').trim();
      const ariaLabel = link.getAttribute('aria-label') || '';
      const img = link.querySelector('img[alt]');
      if (!text && !ariaLabel && !img) {
        violations.push({
          id: 'link-name',
          impact: 'serious',
          description: 'Links must have discernible text',
          help: 'Ensure links have text content or aria-label',
          nodes: [{ html: link.outerHTML.slice(0, 200), target: 'a[href="' + (link.getAttribute('href') || '') + '"]' }],
        });
      }
    });

    // 4. Empty buttons
    const buttons = document.querySelectorAll('button, [role="button"]');
    buttons.forEach(btn => {
      if (!isVisible(btn)) return;
      const text = (btn.textContent || '').trim();
      const ariaLabel = btn.getAttribute('aria-label') || '';
      const img = btn.querySelector('img[alt]');
      if (!text && !ariaLabel && !img) {
        violations.push({
          id: 'button-name',
          impact: 'critical',
          description: 'Buttons must have discernible text',
          help: 'Ensure buttons have text content or aria-label',
          nodes: [{ html: btn.outerHTML.slice(0, 200), target: btn.tagName + (btn.className ? '.' + String(btn.className).split(' ')[0] : '') }],
        });
      }
    });

    // 5. Document language
    const htmlEl = document.documentElement;
    if (!htmlEl.getAttribute('lang')) {
      violations.push({
        id: 'html-has-lang',
        impact: 'serious',
        description: 'HTML element must have a lang attribute',
        help: '<html> element must have a lang attribute',
        nodes: [{ html: '<html>', target: 'html' }],
      });
    }

    // 6. Page title
    if (!document.title || !document.title.trim()) {
      violations.push({
        id: 'document-title',
        impact: 'serious',
        description: 'Document must have a <title> element',
        help: 'Ensure the page has a descriptive title',
        nodes: [{ html: '<head>', target: 'head' }],
      });
    }

    // 7. Heading order (skip levels)
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let prevLevel = 0;
    headings.forEach(h => {
      const level = parseInt(h.tagName[1]);
      if (prevLevel > 0 && level > prevLevel + 1) {
        violations.push({
          id: 'heading-order',
          impact: 'moderate',
          description: `Heading levels should increase by one: found h${level} after h${prevLevel}`,
          help: 'Ensure heading levels are sequential',
          nodes: [{ html: h.outerHTML.slice(0, 200), target: h.tagName }],
        });
      }
      prevLevel = level;
    });

    // 8. Color contrast (basic check for body text)
    // Full contrast check is in audit_color_contrast, this is a quick flag
    function getLuminance(r, g, b) {
      const [rs, gs, bs] = [r, g, b].map(c => {
        c = c / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    }

    function parseColor(color) {
      const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) };
      return null;
    }

    function contrastRatio(l1, l2) {
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    // 9. ARIA roles validation
    const ariaElements = document.querySelectorAll('[role]');
    const validRoles = new Set(['alert', 'alertdialog', 'application', 'article', 'banner', 'button',
      'cell', 'checkbox', 'columnheader', 'combobox', 'complementary', 'contentinfo', 'definition',
      'dialog', 'directory', 'document', 'feed', 'figure', 'form', 'grid', 'gridcell', 'group',
      'heading', 'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'marquee', 'math',
      'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation', 'none', 'note',
      'option', 'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup',
      'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status',
      'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox', 'timer', 'toolbar',
      'tooltip', 'tree', 'treegrid', 'treeitem']);

    ariaElements.forEach(el => {
      const role = el.getAttribute('role');
      if (role && !validRoles.has(role)) {
        violations.push({
          id: 'aria-roles',
          impact: 'serious',
          description: `Invalid ARIA role: "${role}"`,
          help: 'ARIA roles must be valid',
          nodes: [{ html: el.outerHTML.slice(0, 200), target: el.tagName + '[role=' + role + ']' }],
        });
      }
    });

    // 10. Tabindex > 0 (anti-pattern)
    const tabindexEls = document.querySelectorAll('[tabindex]');
    tabindexEls.forEach(el => {
      const val = parseInt(el.getAttribute('tabindex'));
      if (val > 0) {
        violations.push({
          id: 'tabindex',
          impact: 'serious',
          description: 'Elements should not have tabindex > 0',
          help: 'Avoid positive tabindex values as they disrupt natural tab order',
          nodes: [{ html: el.outerHTML.slice(0, 200), target: el.tagName + '[tabindex=' + val + ']' }],
        });
      }
    });

    // Deduplicate violations by id (group nodes)
    const grouped = {};
    violations.forEach(v => {
      if (!grouped[v.id]) {
        grouped[v.id] = { ...v, nodes: [] };
      }
      grouped[v.id].nodes.push(...v.nodes);
    });

    return Object.values(grouped);
  }, tags);

  // Group by severity
  const bySeverity = { critical: [], serious: [], moderate: [], minor: [] };
  for (const v of results) {
    const sev = v.impact || 'moderate';
    if (bySeverity[sev]) bySeverity[sev].push(v);
    else bySeverity.moderate.push(v);
  }

  const totalViolations = results.reduce((sum, v) => sum + v.nodes.length, 0);
  const summary = [
    `Accessibility Audit (${standard})`,
    `URL: ${await page.url()}`,
    `Total violations: ${totalViolations} across ${results.length} rules`,
    `  Critical: ${bySeverity.critical.reduce((s, v) => s + v.nodes.length, 0)}`,
    `  Serious: ${bySeverity.serious.reduce((s, v) => s + v.nodes.length, 0)}`,
    `  Moderate: ${bySeverity.moderate.reduce((s, v) => s + v.nodes.length, 0)}`,
    `  Minor: ${bySeverity.minor.reduce((s, v) => s + v.nodes.length, 0)}`,
    '',
  ];

  for (const [severity, violations] of Object.entries(bySeverity)) {
    if (violations.length === 0) continue;
    summary.push(`--- ${severity.toUpperCase()} ---`);
    for (const v of violations) {
      summary.push(`[${v.id}] ${v.description}`);
      summary.push(`  Help: ${v.help}`);
      summary.push(`  Affected elements (${v.nodes.length}):`);
      for (const n of v.nodes.slice(0, 10)) {
        summary.push(`    - ${n.target}: ${n.html.slice(0, 120)}`);
      }
      if (v.nodes.length > 10) summary.push(`    ... and ${v.nodes.length - 10} more`);
      summary.push('');
    }
  }

  return { content: [{ type: 'text', text: summary.join('\n') }] };
}

async function handleAuditColorContrast(params) {
  const page = getActivePage();
  const level = params.level || 'AA';

  const results = await page.evaluate((wcagLevel) => {
    function getLuminance(r, g, b) {
      const [rs, gs, bs] = [r, g, b].map(c => {
        c = c / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    }

    function parseColor(color) {
      const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) };
      return null;
    }

    function contrastRatio(l1, l2) {
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function isLargeText(el) {
      const style = window.getComputedStyle(el);
      const fontSize = parseFloat(style.fontSize);
      const fontWeight = parseInt(style.fontWeight) || (style.fontWeight === 'bold' ? 700 : 400);
      // Large text: >= 18pt (24px) or >= 14pt (18.66px) bold
      return fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    }

    // Get effective background color by walking up the DOM
    function getEffectiveBackground(el) {
      let current = el;
      while (current && current !== document.documentElement) {
        const style = window.getComputedStyle(current);
        const bg = style.backgroundColor;
        const parsed = parseColor(bg);
        if (parsed) {
          const m = bg.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
          const alpha = m ? parseFloat(m[4]) : 1;
          if (alpha > 0.1) return parsed;
        }
        current = current.parentElement;
      }
      return { r: 255, g: 255, b: 255 }; // default white
    }

    const textElements = document.querySelectorAll('p, span, a, h1, h2, h3, h4, h5, h6, li, td, th, label, button, div, strong, em, b, i, small');
    const results = { pass: 0, fail: 0, failures: [] };

    const checked = new Set();
    textElements.forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
      if (el.offsetWidth === 0 || el.offsetHeight === 0) return;

      // Only check elements with direct text content
      const hasDirectText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
      if (!hasDirectText) return;

      // Avoid duplicate checks
      const key = el.tagName + '|' + el.textContent.slice(0, 30);
      if (checked.has(key)) return;
      checked.add(key);

      const fgParsed = parseColor(style.color);
      const bgParsed = getEffectiveBackground(el);
      if (!fgParsed || !bgParsed) return;

      const fgLum = getLuminance(fgParsed.r, fgParsed.g, fgParsed.b);
      const bgLum = getLuminance(bgParsed.r, bgParsed.g, bgParsed.b);
      const ratio = contrastRatio(fgLum, bgLum);
      const large = isLargeText(el);

      let required;
      if (wcagLevel === 'AAA') {
        required = large ? 4.5 : 7;
      } else {
        required = large ? 3 : 4.5;
      }

      if (ratio >= required) {
        results.pass++;
      } else {
        results.fail++;
        if (results.failures.length < 50) {
          results.failures.push({
            text: (el.textContent || '').trim().slice(0, 60),
            selector: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
            foreground: style.color,
            background: `rgb(${bgParsed.r}, ${bgParsed.g}, ${bgParsed.b})`,
            ratio: Math.round(ratio * 100) / 100,
            required,
            large,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
          });
        }
      }
    });

    return results;
  }, level);

  const lines = [
    `Color Contrast Audit (WCAG ${level})`,
    `URL: ${await page.url()}`,
    `Pass: ${results.pass} | Fail: ${results.fail}`,
    '',
  ];

  if (results.failures.length > 0) {
    lines.push('--- FAILING ELEMENTS ---');
    for (const f of results.failures) {
      lines.push(`[${f.selector}] "${f.text}"`);
      lines.push(`  FG: ${f.foreground} | BG: ${f.background}`);
      lines.push(`  Ratio: ${f.ratio}:1 (required: ${f.required}:1) | Large text: ${f.large} | Size: ${f.fontSize} Weight: ${f.fontWeight}`);
      lines.push('');
    }
    if (results.fail > results.failures.length) {
      lines.push(`... and ${results.fail - results.failures.length} more failures (showing first 50)`);
    }
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

async function handleAuditBreakpoints(params) {
  const page = getActivePage();
  const defaultBreakpoints = [
    { label: 'desktop', width: 1280, height: 800 },
    { label: 'tablet', width: 768, height: 1024 },
    { label: 'mobile', width: 375, height: 812 },
  ];
  const breakpoints = params.breakpoints || defaultBreakpoints;

  // Save original viewport to restore later
  const originalViewport = page.viewportSize();

  if (params.url) {
    await page.goto(params.url, { waitUntil: 'domcontentloaded' });
  }

  const content = [];

  for (const bp of breakpoints) {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    // Wait a moment for layout to stabilize
    await page.waitForTimeout(300);

    const buffer = await page.screenshot({ fullPage: true });

    if (params.savePath) {
      const filename = `breakpoint-${bp.label}-${bp.width}x${bp.height}.png`;
      const filePath = path.join(params.savePath, filename);
      fs.mkdirSync(params.savePath, { recursive: true });
      fs.writeFileSync(filePath, buffer);
      content.push({ type: 'text', text: `${bp.label} (${bp.width}x${bp.height}) saved to: ${filePath}` });
    }

    content.push({
      type: 'image',
      data: buffer.toString('base64'),
      mimeType: 'image/png',
    });
    content.push({ type: 'text', text: `${bp.label} (${bp.width}x${bp.height})` });
  }

  // Restore original viewport
  if (originalViewport) {
    await page.setViewportSize(originalViewport);
  }

  return { content };
}

async function handleAuditTapTargets(params) {
  const page = getActivePage();
  const minSize = params.minSize || 48;

  const results = await page.evaluate((min) => {
    const selectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [onclick], [tabindex]';
    const elements = document.querySelectorAll(selectors);
    const pass = [];
    const fail = [];

    elements.forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      if (el.type === 'hidden') return;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      const entry = {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || el.getAttribute('aria-label') || el.getAttribute('value') || '').trim().slice(0, 50),
        selector: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
      };

      if (rect.width >= min && rect.height >= min) {
        pass.push(entry);
      } else {
        fail.push(entry);
      }
    });

    return { pass: pass.length, fail: fail.length, failures: fail.slice(0, 50), passDetails: pass.slice(0, 10) };
  }, minSize);

  const lines = [
    `Tap Target Audit (minimum: ${minSize}x${minSize}px)`,
    `URL: ${await page.url()}`,
    `Pass: ${results.pass} | Fail: ${results.fail}`,
    '',
  ];

  if (results.failures.length > 0) {
    lines.push('--- UNDERSIZED ELEMENTS ---');
    for (const f of results.failures) {
      lines.push(`[${f.selector}] "${f.text}" — ${f.width}x${f.height}px`);
    }
    if (results.fail > results.failures.length) {
      lines.push(`... and ${results.fail - results.failures.length} more (showing first 50)`);
    }
    lines.push('');
  }

  if (results.passDetails.length > 0) {
    lines.push('--- SAMPLE PASSING ELEMENTS ---');
    for (const p of results.passDetails) {
      lines.push(`[${p.selector}] "${p.text}" — ${p.width}x${p.height}px`);
    }
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

async function handleAuditCoreWebVitals(params) {
  const page = getActivePage();

  if (params.url) {
    // Navigate and wait for load
    await page.goto(params.url, { waitUntil: 'load' });
  }

  // Inject performance observers and wait for metrics
  const metrics = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const results = { lcp: null, cls: 0 };
      let clsEntries = [];

      // LCP observer
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length > 0) {
          results.lcp = entries[entries.length - 1].startTime;
        }
      });
      try { lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}

      // CLS observer
      const clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            clsEntries.push(entry);
          }
        }
      });
      try { clsObserver.observe({ type: 'layout-shift', buffered: true }); } catch {}

      // Also grab paint timing
      const paintEntries = performance.getEntriesByType('paint');
      const fcp = paintEntries.find(e => e.name === 'first-contentful-paint');

      // Wait for metrics to stabilize
      setTimeout(() => {
        lcpObserver.disconnect();
        clsObserver.disconnect();

        // Calculate CLS using session windows
        let maxSessionValue = 0;
        let currentSessionValue = 0;
        let previousEnd = 0;

        for (const entry of clsEntries) {
          if (entry.startTime - previousEnd > 1000 || entry.startTime - previousEnd < 0) {
            currentSessionValue = entry.value;
          } else {
            currentSessionValue += entry.value;
          }
          if (currentSessionValue > maxSessionValue) {
            maxSessionValue = currentSessionValue;
          }
          previousEnd = entry.startTime;
        }
        results.cls = Math.round(maxSessionValue * 10000) / 10000;

        // Navigation timing
        const nav = performance.getEntriesByType('navigation')[0];
        results.ttfb = nav ? Math.round(nav.responseStart) : null;
        results.domContentLoaded = nav ? Math.round(nav.domContentLoadedEventEnd) : null;
        results.loadComplete = nav ? Math.round(nav.loadEventEnd) : null;
        results.fcp = fcp ? Math.round(fcp.startTime) : null;
        results.lcp = results.lcp ? Math.round(results.lcp) : null;

        resolve(results);
      }, 3000);
    });
  });

  // Rate metrics
  function rateLCP(ms) {
    if (ms === null) return 'N/A';
    if (ms <= 2500) return 'Good';
    if (ms <= 4000) return 'Needs Improvement';
    return 'Poor';
  }
  function rateCLS(val) {
    if (val <= 0.1) return 'Good';
    if (val <= 0.25) return 'Needs Improvement';
    return 'Poor';
  }

  const lines = [
    `Core Web Vitals`,
    `URL: ${await page.url()}`,
    '',
    `LCP (Largest Contentful Paint): ${metrics.lcp !== null ? metrics.lcp + 'ms' : 'N/A'} — ${rateLCP(metrics.lcp)}`,
    `CLS (Cumulative Layout Shift): ${metrics.cls} — ${rateCLS(metrics.cls)}`,
    '',
    `--- Additional Timing ---`,
    `TTFB: ${metrics.ttfb !== null ? metrics.ttfb + 'ms' : 'N/A'}`,
    `FCP (First Contentful Paint): ${metrics.fcp !== null ? metrics.fcp + 'ms' : 'N/A'}`,
    `DOM Content Loaded: ${metrics.domContentLoaded !== null ? metrics.domContentLoaded + 'ms' : 'N/A'}`,
    `Load Complete: ${metrics.loadComplete !== null ? metrics.loadComplete + 'ms' : 'N/A'}`,
    '',
    `Thresholds:`,
    `  LCP: Good <= 2500ms, Needs Improvement <= 4000ms, Poor > 4000ms`,
    `  CLS: Good <= 0.1, Needs Improvement <= 0.25, Poor > 0.25`,
  ];

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

async function handleAuditImageSizes(_params) {
  const page = getActivePage();

  const results = await page.evaluate(() => {
    const images = document.querySelectorAll('img');
    const issues = { missingAlt: [], oversized: [], broken: [], notLazy: [] };
    const summary = { total: images.length, missingAlt: 0, oversized: 0, broken: 0, notLazy: 0 };

    images.forEach(img => {
      const src = img.src || img.getAttribute('data-src') || '(none)';
      const shortSrc = src.length > 80 ? src.slice(0, 77) + '...' : src;

      // Missing alt
      if (!img.hasAttribute('alt')) {
        summary.missingAlt++;
        issues.missingAlt.push({ src: shortSrc });
      }

      // Oversized (natural > 2x rendered)
      if (img.naturalWidth > 0 && img.width > 0) {
        const ratio = img.naturalWidth / img.width;
        if (ratio > 2) {
          summary.oversized++;
          issues.oversized.push({
            src: shortSrc,
            natural: `${img.naturalWidth}x${img.naturalHeight}`,
            rendered: `${img.width}x${img.height}`,
            ratio: Math.round(ratio * 10) / 10,
          });
        }
      }

      // Broken
      if (!img.complete || img.naturalWidth === 0) {
        // Double check it's not just lazy loaded
        if (!img.getAttribute('loading') || img.getAttribute('loading') !== 'lazy') {
          summary.broken++;
          issues.broken.push({ src: shortSrc });
        }
      }

      // Not lazy loaded (below fold)
      const rect = img.getBoundingClientRect();
      if (rect.top > window.innerHeight && img.getAttribute('loading') !== 'lazy') {
        summary.notLazy++;
        issues.notLazy.push({ src: shortSrc, distanceBelowFold: Math.round(rect.top - window.innerHeight) });
      }
    });

    return { summary, issues };
  });

  const lines = [
    `Image Audit`,
    `URL: ${await page.url()}`,
    `Total images: ${results.summary.total}`,
    '',
    `Issues:`,
    `  Missing alt: ${results.summary.missingAlt}`,
    `  Oversized (>2x): ${results.summary.oversized}`,
    `  Broken/failed: ${results.summary.broken}`,
    `  Below fold without lazy: ${results.summary.notLazy}`,
    '',
  ];

  if (results.issues.missingAlt.length > 0) {
    lines.push('--- MISSING ALT ---');
    for (const i of results.issues.missingAlt.slice(0, 20)) {
      lines.push(`  ${i.src}`);
    }
    lines.push('');
  }

  if (results.issues.oversized.length > 0) {
    lines.push('--- OVERSIZED ---');
    for (const i of results.issues.oversized.slice(0, 20)) {
      lines.push(`  ${i.src} — natural: ${i.natural}, rendered: ${i.rendered} (${i.ratio}x)`);
    }
    lines.push('');
  }

  if (results.issues.broken.length > 0) {
    lines.push('--- BROKEN ---');
    for (const i of results.issues.broken.slice(0, 20)) {
      lines.push(`  ${i.src}`);
    }
    lines.push('');
  }

  if (results.issues.notLazy.length > 0) {
    lines.push('--- BELOW FOLD WITHOUT LAZY LOADING ---');
    for (const i of results.issues.notLazy.slice(0, 20)) {
      lines.push(`  ${i.src} — ${i.distanceBelowFold}px below fold`);
    }
    lines.push('');
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

async function handleAuditFonts(_params) {
  const page = getActivePage();

  const results = await page.evaluate(() => {
    const elements = document.querySelectorAll('*');
    const combinations = new Map();
    const families = new Set();

    elements.forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      // Only check elements with direct text content
      const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) return;

      const family = style.fontFamily;
      const size = style.fontSize;
      const weight = style.fontWeight;
      const lineHeight = style.lineHeight;

      families.add(family);

      const key = `${family}|${size}|${weight}|${lineHeight}`;
      if (!combinations.has(key)) {
        combinations.set(key, {
          family,
          size,
          weight,
          lineHeight,
          count: 0,
          sampleElements: [],
        });
      }
      const entry = combinations.get(key);
      entry.count++;
      if (entry.sampleElements.length < 3) {
        entry.sampleElements.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 40),
        });
      }
    });

    // Check loaded fonts via document.fonts
    const loadedFonts = [];
    try {
      document.fonts.forEach(font => {
        loadedFonts.push({
          family: font.family,
          weight: font.weight,
          style: font.style,
          status: font.status,
        });
      });
    } catch {}

    // Sort combinations by count (most used first)
    const sorted = [...combinations.values()].sort((a, b) => b.count - a.count);

    return {
      uniqueFamilies: [...families],
      totalCombinations: sorted.length,
      combinations: sorted.slice(0, 40),
      loadedFonts: loadedFonts.slice(0, 30),
    };
  });

  const lines = [
    `Font Audit`,
    `URL: ${await page.url()}`,
    `Unique font families: ${results.uniqueFamilies.length}`,
    `Unique style combinations: ${results.totalCombinations}`,
    '',
    '--- FONT FAMILIES ---',
  ];
  for (const f of results.uniqueFamilies) {
    lines.push(`  ${f}`);
  }
  lines.push('');

  if (results.loadedFonts.length > 0) {
    lines.push('--- LOADED WEB FONTS ---');
    for (const f of results.loadedFonts) {
      lines.push(`  ${f.family} (${f.weight} ${f.style}) — ${f.status}`);
    }
    lines.push('');
  }

  lines.push('--- STYLE COMBINATIONS (by frequency) ---');
  for (const c of results.combinations) {
    lines.push(`  ${c.family} | ${c.size} | weight: ${c.weight} | line-height: ${c.lineHeight} — used ${c.count}x`);
    for (const s of c.sampleElements) {
      lines.push(`    <${s.tag}> "${s.text}"`);
    }
  }

  // Consistency notes
  lines.push('');
  lines.push('--- CONSISTENCY NOTES ---');
  if (results.uniqueFamilies.length > 4) {
    lines.push(`  WARNING: ${results.uniqueFamilies.length} font families detected. Consider consolidating.`);
  }
  if (results.totalCombinations > 15) {
    lines.push(`  WARNING: ${results.totalCombinations} unique font style combinations. Consider a more consistent type scale.`);
  }
  if (results.uniqueFamilies.length <= 4 && results.totalCombinations <= 15) {
    lines.push(`  Font usage looks consistent.`);
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

async function handleAuditComputedStyles(params) {
  const page = getActivePage();
  const { selector, properties } = params;

  const results = await page.evaluate(({ sel, props }) => {
    const el = document.querySelector(sel);
    if (!el) return { error: `Element not found: ${sel}` };

    const style = window.getComputedStyle(el);
    const result = {};

    if (props && props.length > 0) {
      for (const prop of props) {
        result[prop] = style.getPropertyValue(prop);
      }
    } else {
      // Return all computed properties
      for (let i = 0; i < style.length; i++) {
        const prop = style[i];
        result[prop] = style.getPropertyValue(prop);
      }
    }

    return {
      selector: sel,
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: el.className ? String(el.className).split(' ').filter(Boolean) : [],
      boundingBox: (() => {
        const rect = el.getBoundingClientRect();
        return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
      })(),
      properties: result,
    };
  }, { sel: selector, props: properties || null });

  if (results.error) {
    return { content: [{ type: 'text', text: results.error }], isError: true };
  }

  const lines = [
    `Computed Styles`,
    `URL: ${await page.url()}`,
    `Selector: ${results.selector}`,
    `Element: <${results.tag}>${results.id ? '#' + results.id : ''} ${results.classes.length > 0 ? '.' + results.classes.join('.') : ''}`,
    `Bounding box: ${results.boundingBox.width}x${results.boundingBox.height} at (${results.boundingBox.x}, ${results.boundingBox.y})`,
    '',
    '--- PROPERTIES ---',
  ];

  const propEntries = Object.entries(results.properties);
  for (const [prop, val] of propEntries) {
    if (val) lines.push(`  ${prop}: ${val}`);
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

async function handleAuditOverflow(params) {
  const page = getActivePage();

  const breakpoints = params.breakpoints || null;
  const originalViewport = page.viewportSize();

  async function checkOverflow() {
    return page.evaluate(() => {
      const viewportWidth = window.innerWidth;
      const docWidth = document.documentElement.scrollWidth;
      const hasOverflow = docWidth > viewportWidth;

      const offenders = [];
      if (hasOverflow) {
        const all = document.querySelectorAll('*');
        all.forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.right > viewportWidth + 1) {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return;
            offenders.push({
              selector: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
              width: Math.round(rect.width),
              right: Math.round(rect.right),
              overflow: Math.round(rect.right - viewportWidth),
            });
          }
        });

        // Deduplicate — keep only elements that aren't children of other offenders
        // Sort by overflow amount descending
        offenders.sort((a, b) => b.overflow - a.overflow);
      }

      return {
        viewportWidth,
        documentWidth: docWidth,
        hasOverflow,
        overflowAmount: docWidth - viewportWidth,
        offenders: offenders.slice(0, 30),
      };
    });
  }

  const results = [];

  if (breakpoints && breakpoints.length > 0) {
    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.waitForTimeout(300);
      const data = await checkOverflow();
      results.push({ label: bp.label, width: bp.width, height: bp.height, ...data });
    }
    // Restore viewport
    if (originalViewport) {
      await page.setViewportSize(originalViewport);
    }
  } else {
    const data = await checkOverflow();
    results.push({ label: 'current', width: originalViewport?.width || data.viewportWidth, height: originalViewport?.height || 0, ...data });
  }

  const lines = [
    `Overflow Detection`,
    `URL: ${await page.url()}`,
    '',
  ];

  for (const r of results) {
    const status = r.hasOverflow ? 'OVERFLOW' : 'OK';
    lines.push(`[${status}] ${r.label} (${r.width}px) — document: ${r.documentWidth}px${r.hasOverflow ? ` (+${r.overflowAmount}px)` : ''}`);

    if (r.offenders.length > 0) {
      lines.push('  Offending elements:');
      for (const o of r.offenders) {
        lines.push(`    ${o.selector} — width: ${o.width}px, extends ${o.overflow}px past viewport`);
      }
    }
    lines.push('');
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

async function handleAuditDarkMode(params) {
  const page = getActivePage();
  const content = [];

  // Light mode
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(500);
  const lightBuffer = await page.screenshot({ fullPage: true });

  if (params.savePath) {
    fs.mkdirSync(params.savePath, { recursive: true });
    const lightPath = path.join(params.savePath, 'dark-mode-light.png');
    fs.writeFileSync(lightPath, lightBuffer);
    content.push({ type: 'text', text: `Light mode saved to: ${lightPath}` });
  }
  content.push({ type: 'text', text: 'Light mode (prefers-color-scheme: light)' });
  content.push({ type: 'image', data: lightBuffer.toString('base64'), mimeType: 'image/png' });

  // Dark mode
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(500);
  const darkBuffer = await page.screenshot({ fullPage: true });

  if (params.savePath) {
    const darkPath = path.join(params.savePath, 'dark-mode-dark.png');
    fs.writeFileSync(darkPath, darkBuffer);
    content.push({ type: 'text', text: `Dark mode saved to: ${darkPath}` });
  }
  content.push({ type: 'text', text: 'Dark mode (prefers-color-scheme: dark)' });
  content.push({ type: 'image', data: darkBuffer.toString('base64'), mimeType: 'image/png' });

  // Reset to no preference
  await page.emulateMedia({ colorScheme: 'no-preference' });

  return { content };
}

async function handleAuditMeta(_params) {
  const page = getActivePage();

  const meta = await page.evaluate(() => {
    const result = {
      url: window.location.href,
      title: document.title || null,
      description: null,
      canonical: null,
      robots: null,
      viewport: null,
      charset: null,
      ogTags: {},
      twitterTags: {},
      headings: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
      structuredData: [],
      issues: [],
    };

    // Meta tags
    const metas = document.querySelectorAll('meta');
    metas.forEach(m => {
      const name = (m.getAttribute('name') || '').toLowerCase();
      const property = (m.getAttribute('property') || '').toLowerCase();
      const content = m.getAttribute('content') || '';

      if (name === 'description') result.description = content;
      if (name === 'robots') result.robots = content;
      if (name === 'viewport') result.viewport = content;
      if (m.getAttribute('charset')) result.charset = m.getAttribute('charset');
      if (m.httpEquiv?.toLowerCase() === 'content-type') {
        const match = content.match(/charset=([^\s;]+)/i);
        if (match) result.charset = match[1];
      }

      if (property.startsWith('og:')) result.ogTags[property] = content;
      if (name.startsWith('twitter:') || property.startsWith('twitter:')) {
        result.twitterTags[name || property] = content;
      }
    });

    // Canonical
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) result.canonical = canonical.getAttribute('href');

    // Headings
    for (let i = 1; i <= 6; i++) {
      const headings = document.querySelectorAll(`h${i}`);
      headings.forEach(h => {
        result.headings[`h${i}`].push((h.textContent || '').trim().slice(0, 100));
      });
    }

    // Structured data (JSON-LD)
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    jsonLdScripts.forEach(script => {
      try {
        const data = JSON.parse(script.textContent);
        result.structuredData.push(data['@type'] || 'Unknown');
      } catch {}
    });

    // Issue checks
    if (!result.title) result.issues.push('FAIL: Missing <title>');
    else if (result.title.length < 10) result.issues.push('WARN: Title too short (< 10 chars)');
    else if (result.title.length > 60) result.issues.push('WARN: Title too long (> 60 chars)');
    else result.issues.push('PASS: Title length OK');

    if (!result.description) result.issues.push('FAIL: Missing meta description');
    else if (result.description.length < 50) result.issues.push('WARN: Description too short (< 50 chars)');
    else if (result.description.length > 160) result.issues.push('WARN: Description too long (> 160 chars)');
    else result.issues.push('PASS: Description length OK');

    if (!result.viewport) result.issues.push('FAIL: Missing viewport meta');
    else result.issues.push('PASS: Viewport meta present');

    if (!result.canonical) result.issues.push('WARN: No canonical URL');
    else result.issues.push('PASS: Canonical URL set');

    const h1Count = result.headings.h1.length;
    if (h1Count === 0) result.issues.push('FAIL: No <h1> on page');
    else if (h1Count > 1) result.issues.push(`WARN: Multiple <h1> tags (${h1Count})`);
    else result.issues.push('PASS: Single <h1>');

    if (!result.ogTags['og:title']) result.issues.push('WARN: Missing og:title');
    if (!result.ogTags['og:description']) result.issues.push('WARN: Missing og:description');
    if (!result.ogTags['og:image']) result.issues.push('WARN: Missing og:image');

    return result;
  });

  const lines = [
    `SEO Metadata Audit`,
    `URL: ${meta.url}`,
    '',
    `--- BASIC ---`,
    `Title: ${meta.title || '(missing)'}${meta.title ? ` (${meta.title.length} chars)` : ''}`,
    `Description: ${meta.description || '(missing)'}${meta.description ? ` (${meta.description.length} chars)` : ''}`,
    `Canonical: ${meta.canonical || '(not set)'}`,
    `Robots: ${meta.robots || '(not set)'}`,
    `Viewport: ${meta.viewport || '(missing)'}`,
    `Charset: ${meta.charset || '(not set)'}`,
    '',
    `--- OPEN GRAPH ---`,
  ];

  const ogEntries = Object.entries(meta.ogTags);
  if (ogEntries.length > 0) {
    for (const [k, v] of ogEntries) lines.push(`  ${k}: ${v}`);
  } else {
    lines.push('  (none)');
  }

  lines.push('');
  lines.push('--- TWITTER CARDS ---');
  const twEntries = Object.entries(meta.twitterTags);
  if (twEntries.length > 0) {
    for (const [k, v] of twEntries) lines.push(`  ${k}: ${v}`);
  } else {
    lines.push('  (none)');
  }

  lines.push('');
  lines.push('--- HEADING HIERARCHY ---');
  for (let i = 1; i <= 6; i++) {
    const key = `h${i}`;
    if (meta.headings[key].length > 0) {
      for (const text of meta.headings[key]) {
        lines.push(`  ${'  '.repeat(i - 1)}H${i}: ${text}`);
      }
    }
  }

  if (meta.structuredData.length > 0) {
    lines.push('');
    lines.push('--- STRUCTURED DATA (JSON-LD) ---');
    for (const t of meta.structuredData) lines.push(`  @type: ${t}`);
  }

  lines.push('');
  lines.push('--- AUDIT RESULTS ---');
  for (const issue of meta.issues) lines.push(`  ${issue}`);

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

// --- audit_visual handler (comprehensive visual audit) ---
async function handleAuditVisual(params) {
  const page = getActivePage();

  if (params.url) {
    await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(200);
  }

  // Import and run the visual audit from the CLI module
  const { runVisualAudit } = await import('./cli-commands/audit.js');
  const result = await runVisualAudit(page, null, {});

  return { content: [{ type: 'text', text: result.text }] };
}

// --- Utility tool handlers ---

async function handleSnapshotCompact(params) {
  const page = getActivePage();
  const scopeSelector = params.selector || 'body';

  const elements = await page.evaluate((scope) => {
    const root = document.querySelector(scope);
    if (!root) return { error: `Selector "${scope}" not found` };

    // Interactive element selectors
    const SELECTORS = [
      'a[href]',
      'button', '[role="button"]',
      'input', 'textarea', 'select',
      '[tabindex]:not([tabindex="-1"])',
      '[onclick]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
      '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
      '[role="combobox"]', '[role="listbox"]', '[role="slider"]',
      '[role="searchbox"]', '[role="spinbutton"]',
      '[role="menuitemcheckbox"]', '[role="menuitemradio"]',
    ];

    const selector = SELECTORS.join(', ');
    const nodes = root.querySelectorAll(selector);
    const seen = new Set();
    const results = [];

    for (const node of nodes) {
      // Deduplicate (an element can match multiple selectors)
      if (seen.has(node)) continue;
      seen.add(node);

      // Skip invisible elements
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const tag = node.tagName.toLowerCase();
      const role = node.getAttribute('role') || '';
      const type = node.getAttribute('type') || '';
      const href = node.getAttribute('href') || '';
      const disabled = node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true';
      const ariaExpanded = node.getAttribute('aria-expanded');
      const ariaCurrent = node.getAttribute('aria-current');

      // Accessible name: aria-label > aria-labelledby > alt > title > placeholder > innerText
      let name = '';
      const ariaLabel = node.getAttribute('aria-label');
      const ariaLabelledBy = node.getAttribute('aria-labelledby');
      if (ariaLabel) {
        name = ariaLabel;
      } else if (ariaLabelledBy) {
        const labelEl = document.getElementById(ariaLabelledBy);
        if (labelEl) name = (labelEl.textContent || '').trim();
      } else if (node.getAttribute('alt')) {
        name = node.getAttribute('alt');
      } else if (node.getAttribute('title')) {
        name = node.getAttribute('title');
      } else if (node.getAttribute('placeholder')) {
        name = node.getAttribute('placeholder');
      } else {
        // For inputs, check associated label
        if (node.id) {
          const label = document.querySelector(`label[for="${node.id}"]`);
          if (label) name = (label.textContent || '').trim();
        }
        if (!name) {
          name = (node.textContent || '').trim().replace(/\s+/g, ' ');
        }
      }
      // Truncate long names
      if (name.length > 60) name = name.slice(0, 57) + '...';

      // Current value for inputs/selects/textareas
      let value = undefined;
      if (tag === 'input' || tag === 'textarea') {
        if (node.value !== undefined && node.value !== '') {
          value = node.value;
          if (value.length > 40) value = value.slice(0, 37) + '...';
        }
      }

      // Select options
      let options = undefined;
      let selectedOption = undefined;
      if (tag === 'select') {
        const opts = Array.from(node.options || []);
        selectedOption = node.options[node.selectedIndex]?.text || '';
        options = opts.slice(0, 5).map(o => o.text);
        if (opts.length > 5) options.push(`+${opts.length - 5} more`);
      }

      // Shortest unique selector (best effort)
      let cssSelector = '';
      if (node.id) {
        cssSelector = `#${node.id}`;
      } else {
        // tag + nth-of-type within parent
        const parent = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.querySelectorAll(`:scope > ${tag}`));
          const idx = siblings.indexOf(node);
          cssSelector = tag + (siblings.length > 1 ? `:nth-of-type(${idx + 1})` : '');
        } else {
          cssSelector = tag;
        }
      }

      results.push({
        tag,
        role,
        type,
        name,
        href,
        disabled,
        expanded: ariaExpanded,
        active: ariaCurrent === 'page' || ariaCurrent === 'true',
        value,
        selectedOption,
        options,
        cssSelector,
      });
    }

    return { elements: results };
  }, scopeSelector);

  if (elements.error) {
    return { content: [{ type: 'text', text: `Error: ${elements.error}` }], isError: true };
  }

  // Format as compact flat list
  const items = elements.elements;
  const lines = [`Interactive Elements (${items.length} found):`];

  for (let i = 0; i < items.length; i++) {
    const el = items[i];
    const ref = `@${i + 1}`;
    const parts = [ref.padEnd(5)];

    // Determine display type
    const tag = el.tag;
    const role = el.role;

    if (tag === 'a' || role === 'link') {
      // Link
      let shortHref = el.href;
      if (shortHref) {
        try {
          const url = new URL(shortHref, 'http://dummy');
          shortHref = url.pathname + (url.search || '');
          if (shortHref.length > 50) shortHref = shortHref.slice(0, 47) + '...';
        } catch {
          if (shortHref.length > 50) shortHref = shortHref.slice(0, 47) + '...';
        }
      }
      let line = `link "${el.name}"`;
      if (shortHref) line += ` \u2192 ${shortHref}`;
      if (el.active) line += ' [active]';
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    } else if (tag === 'button' || role === 'button') {
      // Button
      let line = `button "${el.name}"`;
      if (el.expanded === 'true' || el.expanded === 'false') line += ' \u25BE';
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    } else if (tag === 'input') {
      // Input
      const inputType = el.type || 'text';
      let line = `input[${inputType}] "${el.name}"`;
      if (el.value !== undefined) line += ` = "${el.value}"`;
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    } else if (tag === 'textarea') {
      let line = `textarea "${el.name}"`;
      if (el.value !== undefined) line += ` = "${el.value}"`;
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    } else if (tag === 'select') {
      let line = `select "${el.name}"`;
      if (el.selectedOption) line += ` = "${el.selectedOption}"`;
      if (el.options && el.options.length > 0) line += ` [options: ${el.options.join(', ')}]`;
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    } else if (role === 'tab') {
      let line = `tab "${el.name}"`;
      if (el.active) line += ' [active]';
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    } else if (role === 'checkbox') {
      let line = `checkbox "${el.name}"`;
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    } else if (role === 'radio') {
      let line = `radio "${el.name}"`;
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    } else if (role === 'menuitem' || role === 'menuitemcheckbox' || role === 'menuitemradio') {
      let line = `menuitem "${el.name}"`;
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    } else {
      // Fallback — use role if available, else tag
      const label = role || tag;
      let line = `${label} "${el.name}"`;
      if (el.href) line += ` \u2192 ${el.href}`;
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    }

    lines.push('  ' + parts.join(' '));
  }

  const output = lines.join('\n');
  return { content: [{ type: 'text', text: output }] };
}

// --- Pool tool handlers ---

async function handlePoolLaunch(params) {
  const mode = params.mode || 'window';
  const id = `${SESSION_ID}-${nextId++}`;

  // Resolve device emulation preset
  let deviceOptions = {};
  if (params.device) {
    if (mode === 'tab') {
      return {
        content: [{ type: 'text', text: 'Device emulation is only supported in "window" mode (each window gets its own context). Use mode "window" with a device preset.' }],
        isError: true,
      };
    }
    const preset = devices[params.device];
    if (!preset) {
      const available = Object.keys(devices).filter(d => !d.includes('landscape')).slice(0, 20);
      return {
        content: [{ type: 'text', text: `Unknown device "${params.device}". Examples: ${available.join(', ')}` }],
        isError: true,
      };
    }
    deviceOptions = { ...preset };
  }

  const vw = params.width || deviceOptions.viewport?.width || 1280;
  const vh = params.height || deviceOptions.viewport?.height || 800;

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

    // Build context options, merging device preset if provided
    const contextLaunchOptions = {
      headless: false,
      viewport: { width: vw, height: vh },
      args: [
        '--disable-blink-features=AutomationControlled',
        `--remote-debugging-port=${cdpPort}`,
      ],
    };
    // Apply device emulation options (userAgent, deviceScaleFactor, isMobile, hasTouch, screen)
    if (deviceOptions.userAgent) contextLaunchOptions.userAgent = deviceOptions.userAgent;
    if (deviceOptions.deviceScaleFactor) contextLaunchOptions.deviceScaleFactor = deviceOptions.deviceScaleFactor;
    if (deviceOptions.isMobile !== undefined) contextLaunchOptions.isMobile = deviceOptions.isMobile;
    if (deviceOptions.hasTouch !== undefined) contextLaunchOptions.hasTouch = deviceOptions.hasTouch;
    if (deviceOptions.screen) contextLaunchOptions.screen = deviceOptions.screen;

    browserContext = await chromium.launchPersistentContext(contextDir, contextLaunchOptions);

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

  const deviceSuffix = params.device ? ` [device: ${params.device}]` : '';
  log(`${mode === 'tab' ? 'Tab' : 'Window'} "${id}" created (${vw}x${vh}${deviceSuffix})`);
  return {
    content: [{
      type: 'text',
      text: `Created ${mode} "${id}"${params.label ? ` [${params.label}]` : ''}${deviceSuffix} (${vw}x${vh})\nThis is now the active context. All browser_* tools will operate on it.`,
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
      capabilities: ['core-install', 'core-tabs', 'internal', 'pdf', 'testing', 'tracing', 'vision'],
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

    // Audit tools (batch A — built into server.js)
    const auditToolsA = auditToolSchemas.map(schema => toMcpTool(schema));

    // Audit tools (batch B — from audit-tools-b.js)
    const auditToolsB = getAuditBSchemas(mcpBundle.z).map(schema => toMcpTool(schema));

    // Utility tools (snapshot_compact, etc.)
    const utilityTools = utilityToolSchemas.map(schema => toMcpTool(schema));

    // Custom browser tools (storage, cookies, mouse wheel — not in upstream @playwright/mcp)
    const customTools = customToolSchemas.map(schema => toMcpTool(schema));

    // Official browser tools (full list)
    const browserTools = this._browserToolList || [];

    return [...poolTools, ...auditToolsA, ...auditToolsB, ...utilityTools, ...customTools, ...browserTools];
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

    // Audit tools — find matching schema and route to handler
    const auditSchemaIndex = auditToolSchemas.findIndex(s => s.name === name);
    if (auditSchemaIndex !== -1) {
      const schema = auditToolSchemas[auditSchemaIndex];
      const parsed = schema.inputSchema.parse(rawArguments || {});
      try {
        switch (name) {
          case 'audit_accessibility': return await handleAuditAccessibility(parsed);
          case 'audit_color_contrast': return await handleAuditColorContrast(parsed);
          case 'audit_breakpoints': return await handleAuditBreakpoints(parsed);
          case 'audit_tap_targets': return await handleAuditTapTargets(parsed);
          case 'audit_core_web_vitals': return await handleAuditCoreWebVitals(parsed);
          case 'audit_image_sizes': return await handleAuditImageSizes(parsed);
          case 'audit_fonts': return await handleAuditFonts(parsed);
          case 'audit_computed_styles': return await handleAuditComputedStyles(parsed);
          case 'audit_overflow': return await handleAuditOverflow(parsed);
          case 'audit_dark_mode': return await handleAuditDarkMode(parsed);
          case 'audit_meta': return await handleAuditMeta(parsed);
          case 'audit_visual': return await handleAuditVisual(parsed);
          default: break;
        }
      } catch (error) {
        return { content: [{ type: 'text', text: `Error in ${name}: ${error.message}` }], isError: true };
      }
    }

    // Audit tools batch B (from audit-tools-b.js)
    if (isAuditToolB(name)) {
      if (!activeId || !poolEntries.has(activeId)) {
        return { content: [{ type: 'text', text: 'No active browser context. Use pool_launch first.' }], isError: true };
      }
      try {
        return await handleAuditToolB(name, rawArguments || {}, poolEntries.get(activeId));
      } catch (error) {
        return { content: [{ type: 'text', text: `Error in ${name}: ${error.message}` }], isError: true };
      }
    }

    // Utility tools (snapshot_compact, etc.)
    if (name === 'snapshot_compact') {
      const schema = utilityToolSchemas.find(s => s.name === name);
      const parsed = schema.inputSchema.parse(rawArguments || {});
      try {
        return await handleSnapshotCompact(parsed);
      } catch (error) {
        return { content: [{ type: 'text', text: `Error in ${name}: ${error.message}` }], isError: true };
      }
    }

    // Custom browser tools (storage, cookies, mouse wheel)
    const customSchema = customToolSchemas.find(s => s.name === name);
    if (customSchema) {
      const parsed = customSchema.inputSchema.parse(rawArguments || {});
      try {
        switch (name) {
          case 'browser_cookies_get': return await handleCookiesGet(parsed);
          case 'browser_cookies_set': return await handleCookiesSet(parsed);
          case 'browser_cookies_clear': return await handleCookiesClear(parsed);
          case 'browser_storage_get': return await handleStorageGet(parsed);
          case 'browser_storage_set': return await handleStorageSet(parsed);
          case 'browser_mouse_wheel': return await handleMouseWheel(parsed);
          default: break;
        }
      } catch (error) {
        return { content: [{ type: 'text', text: `Error in ${name}: ${error.message}` }], isError: true };
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
