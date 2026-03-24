# Playwright Pool Full CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full CLI with 42 commands covering 100% of the MCP server's 67 tools, optimized for AI context savings (file-based output instead of inline data).

**Architecture:** Modular CLI with a thin router (`cli.js`) dispatching to command modules (`cli-commands/*.js`). Persistent browser commands use CDP reconnection via a state file (`~/.playwright-pool/cli-state.json`). Standalone commands (screenshot, audit, etc.) manage their own browser lifecycle.

**Tech Stack:** Node.js ESM, Playwright API, manual arg parsing (no external deps)

**Spec:** `docs/superpowers/specs/2026-03-24-cli-full-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `cli.js` | Entry point — global flags, command routing, help text |
| `cli-commands/shared.js` | Shared utilities — arg parsing, CDP state, device presets, timestamps, output helpers |
| `cli-commands/browser.js` | `browser launch/list/switch/close/navigate/back/tabs/click/hover/type/key/fill/select/resize/upload/dialog/drag` |
| `cli-commands/audit.js` | `audit <url>` and `audit list` — runs all 27 audit tools, handles `--only/--skip/--category/--output/--save/--threshold` |
| `cli-commands/quick.js` | `screenshot`, `snap`, `eval`, `pdf` — standalone fire-and-forget |
| `cli-commands/inspect.js` | `console`, `network`, `run`, `wait`, `verify`, `locator` — persistent context required |
| `cli-commands/mouse.js` | `mouse move/click/drag` — persistent context required |
| `cli-commands/trace.js` | `trace start/stop` — persistent context required |

---

## Task 1: Shared Utilities Module

**Files:**
- Create: `cli-commands/shared.js`

This module is the foundation — every other command module imports from it.

- [ ] **Step 1: Create `cli-commands/shared.js` with arg parsing helpers**

```javascript
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
```

- [ ] **Step 2: Verify it parses**

Run: `node --check cli-commands/shared.js`
Expected: No output (clean parse)

- [ ] **Step 3: Commit**

```bash
git add cli-commands/shared.js
git commit -m "feat(cli): add shared utilities module — arg parsing, CDP state, device presets"
```

---

## Task 2: Refactor cli.js as Router

**Files:**
- Modify: `cli.js` — replace monolithic file with thin router that delegates to command modules
- Note: Keep existing setup commands (init, login, config, status, clean) in cli.js since they're already built and working

- [ ] **Step 1: Refactor cli.js to route to command modules**

Replace the current `switch` block with one that handles setup commands inline and delegates new command groups to modules. Add global flags (`--version`, `--quiet`, `--verbose`). Keep all existing setup command implementations intact.

Key changes to the switch block:
```javascript
// Add at top, after arg parsing:
if (args.includes('--version') || args.includes('-V')) {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

// Add new cases to existing switch:
case 'browser':
  const { handleBrowser } = await import('./cli-commands/browser.js');
  await handleBrowser(args.slice(1));
  break;
case 'screenshot':
case 'snap':
case 'eval':
case 'pdf':
  const { handleQuick } = await import('./cli-commands/quick.js');
  await handleQuick(command, args.slice(1));
  break;
case 'console':
case 'network':
case 'run':
case 'wait':
case 'verify':
case 'locator':
  const { handleInspect } = await import('./cli-commands/inspect.js');
  await handleInspect(command, args.slice(1));
  break;
case 'mouse':
  const { handleMouse } = await import('./cli-commands/mouse.js');
  await handleMouse(args.slice(1));
  break;
case 'trace':
  const { handleTrace } = await import('./cli-commands/trace.js');
  await handleTrace(args.slice(1));
  break;
case 'install':
  const { execSync } = await import('child_process');
  console.log('Installing Chromium...');
  execSync('npx playwright install chromium', { stdio: 'inherit' });
  console.log('Chromium installed.');
  break;
```

Also update `printUsage()` to show all command groups.

- [ ] **Step 2: Replace existing `audit` case to use the new audit module**

```javascript
case 'audit':
  const { handleAudit } = await import('./cli-commands/audit.js');
  await handleAudit(args.slice(1));
  break;
```

- [ ] **Step 3: Verify it parses**

Run: `node --check cli.js`
Expected: No output (clean parse)

- [ ] **Step 4: Commit**

```bash
git add cli.js
git commit -m "feat(cli): refactor cli.js as thin router — delegates to command modules"
```

---

## Task 3: Browser Commands

**Files:**
- Create: `cli-commands/browser.js`

The most complex command group — 17 subcommands. The key challenge is CDP persistence: `browser launch` starts a browser and saves the WebSocket endpoint to a state file. All other browser commands reconnect via that endpoint.

- [ ] **Step 1: Create `cli-commands/browser.js`**

Implement `handleBrowser(args)` that parses the subcommand and routes:

```javascript
export async function handleBrowser(args) {
  const action = args[0];
  const rest = args.slice(1);
  switch (action) {
    case 'launch': return browserLaunch(rest);
    case 'list': return browserList(rest);
    case 'switch': return browserSwitch(rest);
    case 'close': return browserClose(rest);
    case 'navigate': return browserNavigate(rest);
    case 'back': return browserBack(rest);
    case 'tabs': return browserTabs(rest);
    case 'click': return browserClick(rest);
    case 'hover': return browserHover(rest);
    case 'type': return browserType(rest);
    case 'key': return browserKey(rest);
    case 'fill': return browserFill(rest);
    case 'select': return browserSelect(rest);
    case 'resize': return browserResize(rest);
    case 'upload': return browserUpload(rest);
    case 'dialog': return browserDialog(rest);
    case 'drag': return browserDrag(rest);
    default:
      console.error(`Unknown browser command: ${action}`);
      process.exit(1);
  }
}
```

**`browserLaunch`** is the critical one — concrete implementation:

```javascript
async function browserLaunch(args) {
  const { flags } = parseArgs(args);
  const viewport = getViewport(flags);
  const mode = flags.mode || 'window';
  const label = flags.label || 'default';

  // Launch browser with CDP enabled
  const browser = await chromium.launch({
    headless: false,
    args: ['--remote-debugging-port=0', '--disable-blink-features=AutomationControlled'],
  });

  // Get the CDP WebSocket endpoint for reconnection
  const wsEndpoint = browser.wsEndpoint();

  // Create context with golden profile auth overlay
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  // Save state for other CLI commands to reconnect
  saveState({ wsEndpoint, label, mode, viewport });

  console.log(`Browser launched [${label}] (${viewport.width}x${viewport.height})`);
  console.log(`WebSocket: ${wsEndpoint}`);
  console.log('Browser is running. Use other commands to interact. Close with: playwright-pool browser close all');

  // Keep process alive until browser closes
  await new Promise(resolve => browser.on('disconnected', resolve));
  clearState();
}
```

**All other browser commands** call `connectToActiveBrowser()` from shared.js, perform their action on the returned page, then disconnect (without closing the browser).

**Element interaction commands** (click, hover, type, fill, select, drag) use Playwright's snapshot-based locator system. The `ref` argument corresponds to Playwright's accessibility snapshot references. Use `page.locator()` with the role/name from the snapshot, or use `page.getByRole()` / `page.getByText()` for natural selectors:

- [ ] **Step 2: Implement all 17 browser subcommands**

Each subcommand follows this pattern:
```javascript
async function browserClick(args) {
  const { flags, positional } = parseArgs(args);
  const ref = positional[0];
  if (!ref) { console.error('Usage: playwright-pool browser click <selector>'); process.exit(1); }
  const { browser, page } = await connectToActiveBrowser();
  // Support CSS selectors, text= selectors, and role selectors
  await page.click(ref, {
    button: flags.button || 'left',
    modifiers: flags.modifiers ? flags.modifiers.split(',') : undefined,
  });
  const info = { url: page.url(), title: await page.title() };
  console.log(`Clicked "${ref}" — ${info.url}`);
  browser.disconnect(); // disconnect, don't close
}
```

**`browser type --slowly`:** Use `page.type()` with `{ delay: 50 }` for character-by-character typing (maps to `browser_press_sequentially`):
```javascript
async function browserType(args) {
  const { flags, positional } = parseArgs(args);
  const selector = positional[0];
  const text = positional[1];
  const { browser, page } = await connectToActiveBrowser();
  if (flags.slowly) {
    await page.type(selector, text, { delay: 50 });
  } else {
    await page.fill(selector, text);
  }
  console.log(`Typed "${text}" into ${selector}`);
  browser.disconnect();
}
```

- [ ] **Step 3: Verify it parses**

Run: `node --check cli-commands/browser.js`

- [ ] **Step 4: Test manually**

Run: `node cli.js browser launch`
Expected: Browser opens, state file created, process stays alive
Run (in another terminal): `node cli.js browser navigate https://example.com`
Expected: Browser navigates, prints URL and title
Run: `node cli.js browser close all`
Expected: Browser closes, state file cleared

- [ ] **Step 5: Commit**

```bash
git add cli-commands/browser.js
git commit -m "feat(cli): add browser commands — launch, navigate, click, type, key, etc."
```

---

## Task 4: Quick Operations (screenshot, snap, eval, pdf)

**Files:**
- Create: `cli-commands/quick.js`

These are standalone — they launch a browser, do one thing, close, and exit. Simplest command group.

- [ ] **Step 1: Create `cli-commands/quick.js`**

```javascript
import { parseArgs, getViewport, timestamp, ensureDir, launchStandalone, DEVICES } from './shared.js';

export async function handleQuick(command, args) {
  switch (command) {
    case 'screenshot': return cmdScreenshot(args);
    case 'snap': return cmdSnap(args);
    case 'eval': return cmdEval(args);
    case 'pdf': return cmdPdf(args);
  }
}
```

**`cmdScreenshot`:**
- Parse URL (positional[0]), filename (positional[1] or auto-generate)
- Handle `--full-page`, `--mobile`, `--tablet`, `--breakpoints`
- For `--breakpoints`: resize to 3 viewports, screenshot each, save with labels
- Print file path(s) to stdout

**`cmdSnap`:**
- Navigate to URL, get accessibility snapshot via Playwright's `page.content()` + `page.evaluate()` to build element tree (note: `page.accessibility.snapshot()` is deprecated in newer Playwright — use `page.evaluate()` to walk the DOM and build an accessible tree, or use `aria-snapshot` if available)
- If `--interactive`, filter to only interactive elements (buttons, links, inputs, selects)
- Save as markdown file, print element count + path

**`cmdEval`:**
- Navigate to URL, run `page.evaluate(expression)`
- Print result to stdout as JSON

**`cmdPdf`:**
- Navigate to URL, `page.pdf({ path })`
- Print file path

- [ ] **Step 2: Verify it parses**

Run: `node --check cli-commands/quick.js`

- [ ] **Step 3: Test screenshot**

Run: `node cli.js screenshot https://example.com test-shot.png`
Expected: `Saved: test-shot.png` and file exists

Run: `node cli.js screenshot https://example.com --breakpoints`
Expected: `Saved: desktop.png, tablet.png, mobile.png`

- [ ] **Step 4: Commit**

```bash
git add cli-commands/quick.js
git commit -m "feat(cli): add quick operations — screenshot, snap, eval, pdf"
```

---

## Task 5: Audit Command

**Files:**
- Create: `cli-commands/audit.js`

The most important command. Must run any combination of 27 audits, handle `--only/--skip/--category/--output/--save/--threshold/--fail-on`, and produce smart output (text to stdout, screenshots to files).

- [ ] **Step 1: Create `cli-commands/audit.js` with audit registry and runner**

The audit registry maps audit names to categories and handler functions. Each handler receives a `page` object and returns `{ issues: [...], screenshots: [...], text: string }`.

```javascript
const AUDIT_CATEGORIES = {
  performance: ['core_web_vitals', 'image_sizes', 'fonts', 'loading_states'],
  accessibility: ['accessibility', 'color_contrast', 'focus_order', 'tap_targets', 'interactive_states'],
  seo: ['meta', 'broken_links'],
  security: ['security_headers', 'mixed_content', 'third_party_scripts', 'cookie_compliance'],
  visual: ['breakpoints', 'overflow', 'dark_mode', 'element_overlap', 'spacing_consistency',
           'z_index_map', 'scroll_behavior', 'print_layout', 'computed_styles'],
  forms: ['form_validation'],
  comprehensive: ['lighthouse'],
};

const ALL_AUDITS = Object.values(AUDIT_CATEGORIES).flat();
```

- [ ] **Step 2: Implement `handleAudit(args)` with flag parsing**

Parse `--only`, `--skip`, `--category` to determine which audits to run (split comma-separated values: `flags.only.split(',')`). Parse `--output`, `--save`, `--threshold`, `--fail-on` for output control. Handle special cases:

- `audit list` subcommand — print all audit names grouped by category
- `audit diff <fileA> <fileB>` — special case, no URL needed, runs pixel diff between two screenshot files
- Multiple URLs — `audit <url1> <url2> <url3>` — run audits on each URL sequentially, aggregate results
- `--urls-file <file>` — read URLs from text file (one per line, skip empty lines and lines starting with #)

```javascript
export async function handleAudit(args) {
  const { flags, positional } = parseArgs(args);

  // Special: audit list
  if (positional[0] === 'list') { return printAuditList(flags.category); }

  // Special: audit diff <fileA> <fileB>
  if (positional[0] === 'diff') { return runDiff(positional[1], positional[2], flags); }

  // Collect URLs from positional args + --urls-file
  let urls = positional.filter(u => u.startsWith('http'));
  if (flags['urls-file']) {
    const lines = fs.readFileSync(flags['urls-file'], 'utf8').split('\n')
      .map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    urls.push(...lines);
  }
  if (urls.length === 0) { console.error('No URLs provided.'); process.exit(1); }

  // Determine which audits to run
  let audits = ALL_AUDITS;
  if (flags.only) audits = flags.only.split(',').map(s => s.trim());
  if (flags.category) audits = AUDIT_CATEGORIES[flags.category] || [];
  if (flags.skip) {
    const skip = new Set(flags.skip.split(',').map(s => s.trim()));
    audits = audits.filter(a => !skip.has(a));
  }

  // Run audits for each URL
  for (const url of urls) { await runAuditsForUrl(url, audits, flags); }
}
```

- [ ] **Step 3: Implement each audit handler**

Port the audit logic from `server.js` (audit tools A) and `audit-tools-b.js` into standalone functions that take a `page` object. Each returns a structured result.

This is the largest step — 27 audit functions. Many can be extracted from the existing MCP handlers by stripping the MCP-specific wrapper and keeping the `page.evaluate()` logic.

- [ ] **Step 4: Implement output formatting**

- Default: print compact text summary to stdout, save screenshots to `./playwright-audit/<timestamp>/`
- `--json`: print JSON to stdout
- `--save <dir>`: save all artifacts (text + screenshots) to specified directory
- Summary line with issue counts and severity breakdown
- Exit code logic: check `--threshold` and `--fail-on`

- [ ] **Step 5: Verify it parses**

Run: `node --check cli-commands/audit.js`

- [ ] **Step 6: Test full audit**

Run: `node cli.js audit https://example.com`
Expected: Runs all audits, prints summary, saves screenshots

Run: `node cli.js audit https://example.com --only meta,a11y --json`
Expected: JSON output with only meta and accessibility results

Run: `node cli.js audit list`
Expected: Prints all audit names grouped by category

- [ ] **Step 7: Commit**

```bash
git add cli-commands/audit.js
git commit -m "feat(cli): add audit command — 27 audits, categories, smart output, CI mode"
```

---

## Task 6: Inspection Commands

**Files:**
- Create: `cli-commands/inspect.js`

Operate on the active browser context (persistent). Commands: console, network, run, wait, verify, locator.

- [ ] **Step 1: Create `cli-commands/inspect.js`**

```javascript
import { connectToActiveBrowser, parseArgs } from './shared.js';

export async function handleInspect(command, args) {
  switch (command) {
    case 'console': return cmdConsole(args);
    case 'network': return cmdNetwork(args);
    case 'run': return cmdRun(args);
    case 'wait': return cmdWait(args);
    case 'verify': return cmdVerify(args);
    case 'locator': return cmdLocator(args);
  }
}
```

**`cmdConsole`:** Connect to browser, get console messages, filter by `--level`, print to stdout.

**`cmdNetwork`:** Connect to browser, get network requests, filter by `--filter` pattern, exclude static by default.

**`cmdRun`:** Connect to browser, take code string from args, auto-wrap bare expressions in `async (page) => {}`, execute via `page.evaluate()` or Playwright API, print result.

**`cmdWait`:** Parse `wait text "..."`, `wait gone "..."`, or `wait <seconds>`. Use `page.waitForSelector` / `page.waitForTimeout`. Print OK or TIMEOUT, set exit code.

**`cmdVerify`:** Parse `verify text "..."`, `verify element <role> "name"`, `verify list <ref> ...`, `verify value <ref> "expected"`. Print PASS/FAIL, set exit code.

**`cmdLocator`:** Connect to browser, use `page.getByRole()` or `page.locator()` to find element, print the selector.

- [ ] **Step 2: Verify it parses**

Run: `node --check cli-commands/inspect.js`

- [ ] **Step 3: Commit**

```bash
git add cli-commands/inspect.js
git commit -m "feat(cli): add inspection commands — console, network, run, wait, verify, locator"
```

---

## Task 7: Mouse & Trace Commands

**Files:**
- Create: `cli-commands/mouse.js`
- Create: `cli-commands/trace.js`

Small modules — 3 mouse commands and 2 trace commands.

- [ ] **Step 1: Create `cli-commands/mouse.js`**

```javascript
import { connectToActiveBrowser } from './shared.js';

export async function handleMouse(args) {
  const action = args[0];
  const { browser, page } = await connectToActiveBrowser();
  switch (action) {
    case 'move':
      await page.mouse.move(Number(args[1]), Number(args[2]));
      console.log(`Mouse moved to ${args[1]}, ${args[2]}`);
      break;
    case 'click':
      const button = args.includes('--button') ? args[args.indexOf('--button') + 1] : 'left';
      await page.mouse.click(Number(args[1]), Number(args[2]), { button });
      console.log(`Mouse clicked at ${args[1]}, ${args[2]} (${button})`);
      break;
    case 'drag':
      await page.mouse.move(Number(args[1]), Number(args[2]));
      await page.mouse.down();
      await page.mouse.move(Number(args[3]), Number(args[4]));
      await page.mouse.up();
      console.log(`Mouse dragged from ${args[1]},${args[2]} to ${args[3]},${args[4]}`);
      break;
    default:
      console.error(`Unknown mouse command: ${action}`);
      process.exit(1);
  }
  browser.disconnect();
}
```

- [ ] **Step 2: Create `cli-commands/trace.js`**

```javascript
import { connectToActiveBrowser, timestamp } from './shared.js';

export async function handleTrace(args) {
  const action = args[0];
  const { browser, context } = await connectToActiveBrowser();
  switch (action) {
    case 'start':
      await context.tracing.start({ screenshots: true, snapshots: true });
      console.log('Trace recording started.');
      break;
    case 'stop':
      const file = args[1] || `trace-${timestamp()}.zip`;
      await context.tracing.stop({ path: file });
      console.log(`Trace saved: ${file}`);
      break;
    default:
      console.error(`Unknown trace command: ${action}`);
      process.exit(1);
  }
  browser.disconnect();
}
```

- [ ] **Step 3: Verify both parse**

Run: `node --check cli-commands/mouse.js && node --check cli-commands/trace.js`

- [ ] **Step 4: Commit**

```bash
git add cli-commands/mouse.js cli-commands/trace.js
git commit -m "feat(cli): add mouse and trace commands"
```

---

## Task 8: Integration Testing & Final Commit

**Files:**
- Modify: `package.json` — bump version to 4.0.0

- [ ] **Step 1: Run all syntax checks**

```bash
node --check cli.js
node --check cli-commands/shared.js
node --check cli-commands/browser.js
node --check cli-commands/quick.js
node --check cli-commands/audit.js
node --check cli-commands/inspect.js
node --check cli-commands/mouse.js
node --check cli-commands/trace.js
```

- [ ] **Step 2: Test help output**

Run: `node cli.js --help`
Expected: Shows all command groups with descriptions

Run: `node cli.js --version`
Expected: Prints version number

- [ ] **Step 3: Test standalone commands**

```bash
node cli.js screenshot https://example.com test-shot.png
node cli.js snap https://example.com test-snap.md
node cli.js eval https://example.com "document.title"
node cli.js audit https://example.com --only meta
node cli.js audit list
```

- [ ] **Step 4: Test persistent browser commands**

```bash
# Terminal 1: launch browser (keeps running)
node cli.js browser launch

# Terminal 2: interact
node cli.js browser navigate https://example.com
node cli.js browser list
node cli.js verify text "Example Domain"
node cli.js console
node cli.js browser close all
```

- [ ] **Step 5: Bump version and commit**

```bash
# Update package.json version to 4.0.0
git add cli.js cli-commands/ package.json
git commit -m "v4.0.0: Full CLI — 42 commands, 67/67 MCP parity, zero external deps"
```

- [ ] **Step 6: Push and update README**

```bash
git push
```

Update README.md to document the CLI commands (or create a separate CLI.md reference).

---

## Execution Order Summary

| Task | What | Depends On | Est. Complexity |
|------|------|-----------|-----------------|
| 1 | Shared utilities | — | Small |
| 2 | CLI router refactor | Task 1 | Small |
| 3 | Browser commands | Tasks 1, 2 | Large (17 subcommands + CDP persistence) |
| 4 | Quick operations | Tasks 1, 2 | Medium (4 commands) |
| 5 | Audit command | Tasks 1, 2 | Large (27 audit handlers + output formatting) |
| 6 | Inspection commands | Tasks 1, 2 | Medium (6 commands) |
| 7 | Mouse & trace | Tasks 1, 2 | Small (5 commands) |
| 8 | Integration testing | All above | Small |

**Tasks 3-7 can run in parallel** (they only depend on tasks 1-2 and don't modify the same files).

**Total: 8 tasks, ~42 commands**
