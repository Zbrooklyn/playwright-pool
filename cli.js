#!/usr/bin/env node

// playwright-pool CLI — thin router dispatching to command modules
//
// Setup (inline):  init, login, config, status, clean
// Browser:         browser launch/navigate/click/type/... → ./cli-commands/browser.js
// Quick:           screenshot, snap, eval, pdf            → ./cli-commands/quick.js
// Audit:           audit <url>, audit list, audit diff     → ./cli-commands/audit.js
// Inspect:         console, network, run, wait, verify, locator → ./cli-commands/inspect.js
// Mouse:           mouse move/click/drag                  → ./cli-commands/mouse.js
// Trace:           trace start/stop                       → ./cli-commands/trace.js
// Benchmark:       benchmark                              → ./cli-commands/benchmark.js
// Install:         install (inline — npx playwright install chromium)

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOME = os.homedir();
const POOL_BASE = path.join(HOME, '.playwright-pool');
const GOLDEN_PROFILE = path.join(POOL_BASE, 'golden-profile');
const POOL_CONTEXTS = path.join(POOL_BASE, 'pool-contexts');

// ─── Argument Parsing ─────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

// Global flags
if (args.includes('--version') || args.includes('-V')) {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

if (!command || command === '--help' || command === '-h') {
  printUsage();
  process.exit(0);
}

switch (command) {
  // ── Setup commands (inline implementations) ─────────────────────
  case 'init':
    await cmdInit();
    break;
  case 'login':
    await cmdLogin(args[1]);
    break;
  case 'config':
    cmdConfig();
    break;
  case 'status':
    cmdStatus();
    break;
  case 'clean':
    await cmdClean();
    break;

  // ── Browser commands (persistent browser context) ───────────────
  case 'browser': {
    const { handleBrowser } = await import('./cli-commands/browser.js');
    await handleBrowser(args.slice(1));
    break;
  }

  // ── Quick operations (standalone — launch, do, close) ───────────
  case 'screenshot':
  case 'snap':
  case 'eval':
  case 'pdf': {
    const { handleQuick } = await import('./cli-commands/quick.js');
    await handleQuick(command, args.slice(1));
    break;
  }

  // ── Audit (standalone — full audit suite) ───────────────────────
  case 'audit': {
    const { handleAudit } = await import('./cli-commands/audit.js');
    await handleAudit(args.slice(1));
    break;
  }

  // ── Inspection commands (persistent browser context) ────────────
  case 'console':
  case 'network':
  case 'run':
  case 'wait':
  case 'verify':
  case 'locator': {
    const { handleInspect } = await import('./cli-commands/inspect.js');
    await handleInspect(command, args.slice(1));
    break;
  }

  // ── Mouse commands (persistent browser context) ─────────────────
  case 'mouse': {
    const { handleMouse } = await import('./cli-commands/mouse.js');
    await handleMouse(args.slice(1));
    break;
  }

  // ── Trace commands (persistent browser context) ─────────────────
  case 'trace': {
    const { handleTrace } = await import('./cli-commands/trace.js');
    await handleTrace(args.slice(1));
    break;
  }

  // ── Benchmark (standalone — performance matrix) ────────────────
  case 'benchmark': {
    const { handleBenchmark } = await import('./cli-commands/benchmark.js');
    await handleBenchmark(args.slice(1));
    break;
  }

  // ── Install Chromium ────────────────────────────────────────────
  case 'install': {
    const { execSync } = await import('child_process');
    console.log('Installing Chromium...');
    execSync('npx playwright install chromium', { stdio: 'inherit' });
    console.log('Chromium installed.');
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
}

// ─── Help ─────────────────────────────────────────────────────────

function printUsage() {
  console.log(`
playwright-pool CLI

Usage:
  playwright-pool <command> [options]

Global Flags:
  --version, -V     Show version number
  --help, -h        Show this help message

Setup:
  init              Create ~/.playwright-pool/ directory structure
  login [url]       Launch browser to log in (default: https://accounts.google.com)
  config            Output .mcp.json snippet for Claude Code
  status            Show pool directories and golden profile info
  clean             Remove orphaned pool-context directories
  install           Install Chromium for Playwright

Browser (persistent session):
  browser launch    Launch a persistent browser session
  browser navigate  Navigate to a URL
  browser click     Click an element
  browser type      Type text into an element
  browser key       Press a keyboard key
  browser fill      Fill a form field
  browser select    Select a dropdown option
  browser hover     Hover over an element
  browser drag      Drag an element
  browser upload    Upload a file
  browser dialog    Handle a dialog
  browser resize    Resize the viewport
  browser tabs      List open tabs
  browser back      Navigate back
  browser list      List browser sessions
  browser switch    Switch to a browser session
  browser close     Close browser session(s)

Quick Operations (standalone):
  screenshot <url>  Take a screenshot (--full-page, --mobile, --breakpoints)
  snap <url>        Get accessibility snapshot (--interactive)
  eval <url> <expr> Evaluate JavaScript expression
  pdf <url>         Save page as PDF

Audit (standalone):
  audit <url>       Run audit suite (--only, --skip, --category, --json)
  audit list        List all available audits
  audit diff <a> <b> Pixel-diff two screenshots

Inspection (persistent session):
  console           Show console messages (--level)
  network           Show network requests (--filter)
  run <code>        Run code against the active page
  wait <condition>  Wait for text, selector, or timeout
  verify <check>    Verify text, element, list, or value
  locator <query>   Generate a Playwright locator

Mouse (persistent session):
  mouse move <x> <y>         Move mouse to coordinates
  mouse click <x> <y>        Click at coordinates
  mouse drag <x1> <y1> <x2> <y2>  Drag between coordinates

Trace (persistent session):
  trace start       Start recording a trace
  trace stop [file] Stop and save trace

Benchmark (standalone):
  benchmark              Run performance benchmark matrix (--quick, --site, --operation, --runs, --warmup)
  benchmark compare <a> <b>  Compare two benchmark JSON files (Welch's t-test regression detection)

Examples:
  playwright-pool init
  playwright-pool login
  playwright-pool screenshot https://example.com --mobile
  playwright-pool audit https://example.com --only meta,accessibility
  playwright-pool browser launch
  playwright-pool browser navigate https://example.com
`);
}

// ─── init ─────────────────────────────────────────────────────────

async function cmdInit() {
  const dirs = [POOL_BASE, GOLDEN_PROFILE, POOL_CONTEXTS];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`  Created: ${dir}`);
    } else {
      console.log(`  Exists:  ${dir}`);
    }
  }

  console.log();
  console.log('Run `playwright-pool login` to set up your golden profile.');
}

// ─── login ────────────────────────────────────────────────────────

async function cmdLogin(url) {
  const targetUrl = url || 'https://accounts.google.com';

  // Ensure the golden profile directory exists
  if (!fs.existsSync(GOLDEN_PROFILE)) {
    fs.mkdirSync(GOLDEN_PROFILE, { recursive: true });
  }

  console.log(`Launching browser with golden profile...`);
  console.log(`  Profile: ${GOLDEN_PROFILE}`);
  console.log(`  URL:     ${targetUrl}`);
  console.log();
  console.log('Log in to your accounts, then close the browser when done.');
  console.log();

  const { chromium } = await import('playwright');

  const context = await chromium.launchPersistentContext(GOLDEN_PROFILE, {
    headless: false,
    viewport: null,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  // Navigate the first page to the target URL
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {
    // Ignore navigation errors (e.g. if user is already logged in and gets redirected)
  });

  // Wait for the browser to be closed by the user
  await new Promise((resolve) => {
    context.on('close', resolve);
  });

  console.log('Golden profile saved. Your credentials are ready.');
}

// ─── config ───────────────────────────────────────────────────────

function cmdConfig() {
  const serverPath = path.join(__dirname, 'server.js');
  const goldenPath = GOLDEN_PROFILE;

  // Unix-style paths
  const unixServer = serverPath.replace(/\\/g, '/');
  const unixGolden = goldenPath.replace(/\\/g, '/');

  // Windows-style paths (with escaped backslashes for JSON)
  const winServer = serverPath.replace(/\//g, '\\');
  const winGolden = goldenPath.replace(/\//g, '\\');

  console.log('Add this to your .mcp.json (or Claude Code MCP config):');
  console.log();
  console.log('--- Unix / macOS / Linux ---');
  console.log(JSON.stringify({
    mcpServers: {
      'playwright-pool': {
        command: 'node',
        args: [unixServer],
        env: {
          GOLDEN_PROFILE: unixGolden,
        },
      },
    },
  }, null, 2));

  console.log();
  console.log('--- Windows ---');
  console.log(JSON.stringify({
    mcpServers: {
      'playwright-pool': {
        command: 'node',
        args: [winServer],
        env: {
          GOLDEN_PROFILE: winGolden,
        },
      },
    },
  }, null, 2));
}

// ─── status ───────────────────────────────────────────────────────

function cmdStatus() {
  console.log('playwright-pool status');
  console.log('='.repeat(40));
  console.log();

  // Golden profile
  const goldenExists = fs.existsSync(GOLDEN_PROFILE);
  const goldenHasDefault = goldenExists && fs.existsSync(path.join(GOLDEN_PROFILE, 'Default'));
  console.log(`Golden profile: ${GOLDEN_PROFILE}`);
  if (!goldenExists) {
    console.log('  Status: NOT FOUND — run `playwright-pool init` then `playwright-pool login`');
  } else if (!goldenHasDefault) {
    console.log('  Status: EXISTS but no Default/ directory — run `playwright-pool login`');
  } else {
    console.log('  Status: READY');
  }
  console.log();

  // Pool contexts
  console.log(`Pool contexts: ${POOL_CONTEXTS}`);
  if (!fs.existsSync(POOL_CONTEXTS)) {
    console.log('  Status: NOT FOUND — run `playwright-pool init`');
  } else {
    const entries = fs.readdirSync(POOL_CONTEXTS, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    if (entries.length === 0) {
      console.log('  No active sessions.');
    } else {
      console.log(`  ${entries.length} session director${entries.length === 1 ? 'y' : 'ies'}:`);
      for (const entry of entries) {
        const fullPath = path.join(POOL_CONTEXTS, entry.name);
        const stat = fs.statSync(fullPath);
        const age = Date.now() - stat.mtimeMs;
        const ageStr = formatAge(age);
        const isTemplate = entry.name.includes('-template');
        const isTabs = entry.name.includes('-tabs');
        const label = isTemplate ? ' (template)' : isTabs ? ' (tabs)' : '';
        console.log(`    ${entry.name}${label} — last modified ${ageStr} ago`);
      }
    }
  }
}

function formatAge(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ─── clean ────────────────────────────────────────────────────────

async function cmdClean() {
  if (!fs.existsSync(POOL_CONTEXTS)) {
    console.log('No pool-contexts directory found. Nothing to clean.');
    return;
  }

  const entries = fs.readdirSync(POOL_CONTEXTS, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  if (entries.length === 0) {
    console.log('No session directories found. Nothing to clean.');
    return;
  }

  console.log(`Found ${entries.length} session director${entries.length === 1 ? 'y' : 'ies'}:`);
  for (const entry of entries) {
    const fullPath = path.join(POOL_CONTEXTS, entry.name);
    const stat = fs.statSync(fullPath);
    const age = Date.now() - stat.mtimeMs;
    console.log(`  ${entry.name} — last modified ${formatAge(age)} ago`);
  }

  console.log();
  const confirmed = await confirm('Remove all these directories? (y/N) ');

  if (confirmed) {
    for (const entry of entries) {
      const fullPath = path.join(POOL_CONTEXTS, entry.name);
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log(`  Removed: ${entry.name}`);
    }
    console.log('Done.');
  } else {
    console.log('Cancelled.');
  }
}

function confirm(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

