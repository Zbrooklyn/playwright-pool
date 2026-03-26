# Modular Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two composable modules (Interact + Inspect) that eliminate AI thinking overhead from browser workflows, achieving 15-30s for tasks that currently take 5-15 minutes.

**Architecture:** Module A (Interact) batch-executes declared browser steps with semi-adaptive obstacle handling. Module B (Inspect) performs intent-driven page analysis with single-pass DOM collection and configurable detail levels. They compose: `interact(url, steps) → page → inspect(page, intent, detail) → report`. Both work via CLI and MCP.

**Tech Stack:** Node.js ESM, Playwright API, golden profile auth overlay

**Spec:** `docs/superpowers/specs/2026-03-25-modular-workflow-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `cli-commands/interact.js` | Module A: navigate, click, fill, wait, scroll with obstacle handling |
| `cli-commands/inspect-engine.js` | Module B: intent mapping, single-pass DOM collection, analysis, report formatting |
| `cli-commands/intent-map.js` | Intent → checks mapping with fuzzy matching |
| `cli-commands/dom-collector.js` | Single page.evaluate() that collects all DOM data |
| `cli-commands/analyzers.js` | Individual analysis functions (contrast, spacing, overflow, etc.) |
| `cli-commands/report-formatter.js` | Quick/standard/deep report formatting |
| `cli-commands/workflow.js` | Modify: compose interact → inspect, refactor existing workflows |
| `server.js` | Modify: add `workflow_inspect` MCP tool |
| `cli.js` | Modify: add `inspect` command routing |
| `tests/fixtures/test-page-images.html` | New test page: 5 broken + 5 working images |
| `tests/fixtures/test-page-product.html` | New test page: product with correct/incorrect prices |
| `tests/fixtures/test-page-form.html` | New test page: contact form with states |
| `tests/fixtures/test-page-menu.html` | New test page: hamburger menu |
| `scripts/scenario-benchmark.js` | 15-scenario benchmark runner |

---

## Task 1: Interact Module

**Files:**
- Create: `cli-commands/interact.js`

The core of Module A. Executes declared browser steps in sequence with semi-adaptive obstacle handling.

- [ ] **Step 1: Create interact.js with step parser**

Parse step declarations into executable actions:
```javascript
// cli-commands/interact.js
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

const GOLDEN_PROFILE = process.env.GOLDEN_PROFILE || path.join(os.homedir(), '.playwright-pool', 'golden-profile');
const AUTH_FILES = [
  'Default/Network/Cookies', 'Default/Network/Cookies-journal',
  'Default/Login Data', 'Default/Login Data-journal',
  'Default/Login Data For Account', 'Default/Login Data For Account-journal',
  'Default/Local Storage', 'Default/Session Storage',
  'Default/Web Data', 'Default/Web Data-journal',
  'Default/Preferences', 'Default/Secure Preferences', 'Local State',
];
const LOCK_FILES = new Set(['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile', 'LOCK']);

// Parse step string into action objects
// Supports: "click 'Blog'", "fill '#email' 'test@test.com'", "wait 2", "scroll down"
export function parseSteps(stepsInput) {
  if (!stepsInput) return [];
  const steps = Array.isArray(stepsInput) ? stepsInput : stepsInput.split(',').map(s => s.trim());
  return steps.map(step => {
    const clickMatch = step.match(/^click\s+['"](.+)['"]$/i) || step.match(/^click\s+(.+)$/i);
    if (clickMatch) return { action: 'click', target: clickMatch[1] };

    const fillMatch = step.match(/^fill\s+['"](.+)['"]\s+['"](.+)['"]$/i);
    if (fillMatch) return { action: 'fill', target: fillMatch[1], value: fillMatch[2] };

    const waitMatch = step.match(/^wait\s+(\d+)$/i);
    if (waitMatch) return { action: 'wait', seconds: parseInt(waitMatch[1]) };

    const waitForMatch = step.match(/^wait\s+['"](.+)['"]$/i);
    if (waitForMatch) return { action: 'waitFor', target: waitForMatch[1] };

    const scrollMatch = step.match(/^scroll\s+(down|up|bottom|top)$/i);
    if (scrollMatch) return { action: 'scroll', direction: scrollMatch[1].toLowerCase() };

    // Default: treat as click target
    return { action: 'click', target: step };
  });
}
```

- [ ] **Step 2: Add auth overlay for headless launches**

```javascript
// Create authenticated browser context using golden profile overlay
export async function launchWithAuth(options = {}) {
  const { headless = true, viewport = { width: 1280, height: 800 } } = options;
  const tempDir = path.join(os.tmpdir(), `pw-interact-${Date.now()}`);

  // Create fresh profile
  const tempCtx = await chromium.launchPersistentContext(tempDir, { headless: true });
  await tempCtx.close();

  // Overlay auth files from golden profile
  if (fs.existsSync(GOLDEN_PROFILE)) {
    for (const f of AUTH_FILES) {
      const src = path.join(GOLDEN_PROFILE, f);
      const dst = path.join(tempDir, f);
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
  }

  // Launch with auth
  const context = await chromium.launchPersistentContext(tempDir, {
    headless,
    viewport,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = context.pages()[0] || await context.newPage();
  return { context, page, tempDir };
}
```

- [ ] **Step 3: Add adaptive click function**

```javascript
// Click with multiple selector strategies and obstacle handling
async function adaptiveClick(page, target, timeout = 10000) {
  const strategies = [
    () => page.getByRole('button', { name: target }),
    () => page.getByRole('link', { name: target }),
    () => page.getByRole('tab', { name: target }),
    () => page.getByRole('menuitem', { name: target }),
    () => page.getByText(target, { exact: false }),
    () => page.locator(`text=${target}`),
    () => page.locator(target), // CSS selector fallback
  ];

  for (const strategy of strategies) {
    try {
      const locator = strategy();
      if (await locator.count() > 0) {
        await Promise.all([
          page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}),
          locator.first().click({ timeout }),
        ]);
        // Wait for page to settle (OAuth, SPA navigation, loading)
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(300);
        return { success: true, strategy: strategy.toString().slice(6, 40) };
      }
    } catch { continue; }
  }
  return { success: false, error: `Element not found: "${target}"` };
}
```

- [ ] **Step 4: Add the main interact function**

```javascript
// Execute all steps and return the page in desired state
export async function interact(url, steps, options = {}) {
  const { auth = true, headless = true, viewport, headed } = options;
  const log = [];
  const startTime = Date.now();

  // Launch browser with auth if requested
  const { context, page, tempDir } = auth
    ? await launchWithAuth({ headless: headed ? false : headless, viewport })
    : await launchStandalone({ headless: headed ? false : headless, viewport });

  // Navigate
  log.push({ step: 'navigate', url, time: Date.now() - startTime });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  // Execute steps
  const parsedSteps = parseSteps(steps);
  for (let i = 0; i < parsedSteps.length; i++) {
    const step = parsedSteps[i];
    const stepStart = Date.now();

    switch (step.action) {
      case 'click': {
        const result = await adaptiveClick(page, step.target);
        log.push({ step: `click "${step.target}"`, ...result, time: Date.now() - startTime });
        break;
      }
      case 'fill': {
        await page.fill(step.target, step.value).catch(err =>
          log.push({ step: `fill "${step.target}"`, success: false, error: err.message, time: Date.now() - startTime })
        );
        log.push({ step: `fill "${step.target}"`, success: true, time: Date.now() - startTime });
        break;
      }
      case 'wait': {
        await page.waitForTimeout(step.seconds * 1000);
        log.push({ step: `wait ${step.seconds}s`, success: true, time: Date.now() - startTime });
        break;
      }
      case 'waitFor': {
        try {
          await page.waitForSelector(`text=${step.target}`, { timeout: 15000 });
          log.push({ step: `waitFor "${step.target}"`, success: true, time: Date.now() - startTime });
        } catch {
          log.push({ step: `waitFor "${step.target}"`, success: false, error: 'timeout', time: Date.now() - startTime });
        }
        break;
      }
      case 'scroll': {
        const scrollMap = { down: 500, up: -500, bottom: 99999, top: -99999 };
        await page.evaluate(y => window.scrollBy(0, y), scrollMap[step.direction] || 500);
        log.push({ step: `scroll ${step.direction}`, success: true, time: Date.now() - startTime });
        break;
      }
    }
  }

  return { page, context, tempDir, log, totalTime: Date.now() - startTime };
}
```

- [ ] **Step 5: Verify it parses**

Run: `node --check cli-commands/interact.js`
Expected: No output (clean parse)

- [ ] **Step 6: Commit**

```bash
git add cli-commands/interact.js
git commit -m "feat: add interact module — batch step execution with auth overlay and adaptive clicking"
```

---

## Task 2: DOM Collector (Single-Pass)

**Files:**
- Create: `cli-commands/dom-collector.js`

One `page.evaluate()` call that collects ALL DOM data needed for any audit check.

- [ ] **Step 1: Create dom-collector.js**

```javascript
// cli-commands/dom-collector.js
// Single-pass DOM data collection — runs ONE page.evaluate() to gather everything

export async function collectDOMData(page) {
  return await page.evaluate(() => {
    const data = {
      url: window.location.href,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
      hasOverflow: document.documentElement.scrollWidth > window.innerWidth,
      elements: [],
      images: [],
      headings: [],
      links: [],
      forms: [],
      meta: {},
      interactive: [],
      textContent: [],
    };

    // Helper: is element visible?
    function isVisible(el) {
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'
        && el.offsetWidth > 0 && el.offsetHeight > 0;
    }

    // Helper: get unique short selector
    function getSelector(el) {
      if (el.id) return `#${el.id}`;
      let s = el.tagName.toLowerCase();
      if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
      return s;
    }

    // Collect visible elements with styles (limit to avoid performance issues)
    const allElements = document.querySelectorAll('*');
    let elementCount = 0;
    const MAX_ELEMENTS = 500;

    allElements.forEach(el => {
      if (elementCount >= MAX_ELEMENTS) return;
      if (!isVisible(el)) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      const style = getComputedStyle(el);
      elementCount++;

      data.elements.push({
        selector: getSelector(el),
        tag: el.tagName.toLowerCase(),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        styles: {
          color: style.color,
          backgroundColor: style.backgroundColor,
          fontSize: style.fontSize,
          fontFamily: style.fontFamily.split(',')[0].trim().replace(/['"]/g, ''),
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
          margin: `${style.marginTop} ${style.marginRight} ${style.marginBottom} ${style.marginLeft}`,
          zIndex: style.zIndex !== 'auto' ? parseInt(style.zIndex) : null,
          position: style.position,
          overflow: style.overflow,
          textOverflow: style.textOverflow,
        },
        text: el.textContent?.trim().slice(0, 100) || '',
      });
    });

    // Images
    document.querySelectorAll('img').forEach(img => {
      data.images.push({
        src: img.src?.slice(0, 200),
        alt: img.alt,
        hasAlt: img.hasAttribute('alt'),
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        displayWidth: img.clientWidth,
        displayHeight: img.clientHeight,
        loading: img.loading,
        broken: img.naturalWidth === 0 && img.complete,
        selector: getSelector(img),
      });
    });

    // Headings
    document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
      data.headings.push({
        level: parseInt(h.tagName[1]),
        text: h.textContent?.trim().slice(0, 100),
        selector: getSelector(h),
      });
    });

    // Links
    document.querySelectorAll('a[href]').forEach(a => {
      data.links.push({
        href: a.href,
        text: a.textContent?.trim().slice(0, 50),
        empty: !a.textContent?.trim() && !a.querySelector('img[alt]') && !a.getAttribute('aria-label'),
        selector: getSelector(a),
      });
    });

    // Forms and inputs
    document.querySelectorAll('input,select,textarea').forEach(input => {
      if (input.type === 'hidden') return;
      const hasLabel = input.id && document.querySelector(`label[for="${input.id}"]`);
      const hasAria = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
      const inLabel = input.closest('label');
      data.forms.push({
        tag: input.tagName.toLowerCase(),
        type: input.type || 'text',
        name: input.name,
        hasLabel: !!(hasLabel || hasAria || inLabel || input.getAttribute('title')),
        placeholder: input.placeholder,
        required: input.required,
        selector: getSelector(input),
        rect: { w: Math.round(input.getBoundingClientRect().width), h: Math.round(input.getBoundingClientRect().height) },
      });
    });

    // Interactive elements (for tap target check)
    document.querySelectorAll('a,button,[role="button"],input,select,textarea,[tabindex]:not([tabindex="-1"])').forEach(el => {
      if (!isVisible(el)) return;
      const rect = el.getBoundingClientRect();
      data.interactive.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        text: (el.textContent?.trim() || el.getAttribute('aria-label') || '').slice(0, 50),
        rect: { w: Math.round(rect.width), h: Math.round(rect.height) },
        selector: getSelector(el),
      });
    });

    // Meta tags
    data.meta.title = document.title;
    data.meta.description = document.querySelector('meta[name="description"]')?.content || null;
    data.meta.canonical = document.querySelector('link[rel="canonical"]')?.href || null;
    data.meta.viewport = document.querySelector('meta[name="viewport"]')?.content || null;
    data.meta.lang = document.documentElement.lang || null;
    data.meta.ogTitle = document.querySelector('meta[property="og:title"]')?.content || null;
    data.meta.ogDescription = document.querySelector('meta[property="og:description"]')?.content || null;
    data.meta.ogImage = document.querySelector('meta[property="og:image"]')?.content || null;
    data.meta.robots = document.querySelector('meta[name="robots"]')?.content || null;

    // Buttons without text
    document.querySelectorAll('button,[role="button"]').forEach(btn => {
      if (!isVisible(btn)) return;
      const text = btn.textContent?.trim();
      const aria = btn.getAttribute('aria-label');
      const imgAlt = btn.querySelector('img[alt]')?.alt;
      if (!text && !aria && !imgAlt) {
        data.forms.push({
          tag: 'button',
          type: 'empty-button',
          hasLabel: false,
          selector: getSelector(btn),
          rect: { w: Math.round(btn.getBoundingClientRect().width), h: Math.round(btn.getBoundingClientRect().height) },
        });
      }
    });

    return data;
  });
}
```

- [ ] **Step 2: Verify it parses**

Run: `node --check cli-commands/dom-collector.js`

- [ ] **Step 3: Commit**

```bash
git add cli-commands/dom-collector.js
git commit -m "feat: add single-pass DOM collector — one page.evaluate() for all data"
```

---

## Task 3: Intent Map + Analyzers

**Files:**
- Create: `cli-commands/intent-map.js`
- Create: `cli-commands/analyzers.js`

- [ ] **Step 1: Create intent-map.js**

Maps natural language intents to check names using keyword matching:

```javascript
// cli-commands/intent-map.js

const INTENT_KEYWORDS = {
  layout: ['layout', 'look', 'right', 'correct', 'broken', 'wrong', 'display'],
  overflow: ['overflow', 'scroll', 'horizontal', 'mobile', 'responsive', 'breakpoint'],
  contrast: ['contrast', 'color', 'readable', 'text', 'accessibility', 'a11y', 'wcag'],
  spacing: ['spacing', 'padding', 'margin', 'alignment', 'aligned', 'consistent'],
  images: ['image', 'img', 'photo', 'picture', 'alt', 'broken image'],
  headings: ['heading', 'h1', 'h2', 'hierarchy', 'seo', 'structure'],
  tap_targets: ['tap', 'touch', 'button', 'click', 'mobile', 'target', 'size'],
  meta: ['seo', 'meta', 'title', 'description', 'og', 'social', 'search'],
  links: ['link', 'broken', 'href', '404', 'dead'],
  forms: ['form', 'input', 'label', 'validation', 'submit', 'field'],
  text_content: ['text', 'content', 'price', 'showing', 'display', 'says'],
  performance: ['performance', 'speed', 'fast', 'slow', 'load', 'vitals'],
  all: ['full', 'audit', 'everything', 'complete', 'all'],
  describe: ['describe', 'what', 'everything', 'inventory', 'list'],
};

const CATEGORY_CHECKS = {
  'check mobile': ['overflow', 'tap_targets', 'images', 'text_content'],
  'check accessibility': ['contrast', 'forms', 'headings', 'tap_targets', 'images'],
  'check seo': ['meta', 'headings', 'links', 'images'],
  'check performance': ['images', 'text_content'],
  'full audit': ['all'],
};

export function mapIntentToChecks(intent) {
  if (!intent) return ['layout', 'overflow', 'contrast', 'images', 'headings', 'tap_targets'];

  const lower = intent.toLowerCase();

  // Check category shortcuts first
  for (const [category, checks] of Object.entries(CATEGORY_CHECKS)) {
    if (lower.includes(category.replace('check ', ''))) return checks;
  }

  // Fuzzy match keywords
  const matched = new Set();
  for (const [check, keywords] of Object.entries(INTENT_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) { matched.add(check); break; }
    }
  }

  // If "all" matched, return everything
  if (matched.has('all')) return Object.keys(INTENT_KEYWORDS).filter(k => k !== 'all');

  // Default if nothing matched
  if (matched.size === 0) return ['layout', 'overflow', 'contrast', 'images', 'headings', 'tap_targets'];

  return [...matched];
}
```

- [ ] **Step 2: Create analyzers.js**

Individual analysis functions that operate on collected DOM data (not on the page):

```javascript
// cli-commands/analyzers.js
// Each analyzer takes DOM data and returns { issues: [], info: {} }

export function analyzeOverflow(domData, breakpointData) {
  const issues = [];
  for (const bp of breakpointData) {
    if (bp.hasOverflow) {
      issues.push({
        severity: 'critical',
        message: `Horizontal overflow at ${bp.width}px — scrollWidth ${bp.scrollWidth}px > viewport ${bp.width}px`,
        offenders: bp.offenders || [],
      });
    }
  }
  return { issues };
}

export function analyzeContrast(domData) {
  // WCAG luminance contrast calculation
  function getLuminance(r, g, b) {
    const [rs, gs, bs] = [r, g, b].map(c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  function parseColor(color) {
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return m ? { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) } : null;
  }

  const issues = [];
  for (const el of domData.elements) {
    if (!el.text || el.text.length === 0) continue;
    const fg = parseColor(el.styles.color);
    const bg = parseColor(el.styles.backgroundColor);
    if (!fg || !bg) continue;
    // Skip transparent backgrounds
    if (el.styles.backgroundColor.includes('rgba') && el.styles.backgroundColor.match(/,\s*0\s*\)/)) continue;

    const fgLum = getLuminance(fg.r, fg.g, fg.b);
    const bgLum = getLuminance(bg.r, bg.g, bg.b);
    const ratio = (Math.max(fgLum, bgLum) + 0.05) / (Math.min(fgLum, bgLum) + 0.05);
    const fontSize = parseFloat(el.styles.fontSize);
    const required = fontSize >= 24 || (fontSize >= 18.66 && parseInt(el.styles.fontWeight) >= 700) ? 3 : 4.5;

    if (ratio < required) {
      issues.push({
        severity: 'serious',
        message: `Low contrast: "${el.text.slice(0, 30)}" — ratio ${ratio.toFixed(1)}:1 (need ${required}:1)`,
        selector: el.selector,
        fg: el.styles.color,
        bg: el.styles.backgroundColor,
      });
    }
  }
  return { issues, info: { checked: domData.elements.filter(e => e.text).length } };
}

export function analyzeTapTargets(domData, minSize = 48) {
  const issues = [];
  for (const el of domData.interactive) {
    if (el.rect.w < minSize || el.rect.h < minSize) {
      issues.push({
        severity: 'serious',
        message: `Tap target too small: "${el.text || el.selector}" — ${el.rect.w}x${el.rect.h}px (need ${minSize}px)`,
        selector: el.selector,
      });
    }
  }
  return { issues, info: { checked: domData.interactive.length } };
}

export function analyzeImages(domData) {
  const issues = [];
  for (const img of domData.images) {
    if (!img.hasAlt) issues.push({ severity: 'critical', message: `Missing alt: ${img.selector}`, selector: img.selector });
    if (img.broken) issues.push({ severity: 'serious', message: `Broken image: ${img.src?.slice(0, 60)}`, selector: img.selector });
    if (img.naturalWidth > img.displayWidth * 2 && img.displayWidth > 0) {
      issues.push({ severity: 'moderate', message: `Oversized: ${img.naturalWidth}px natural, ${img.displayWidth}px displayed`, selector: img.selector });
    }
  }
  return { issues, info: { total: domData.images.length } };
}

export function analyzeHeadings(domData) {
  const issues = [];
  let prevLevel = 0;
  const h1Count = domData.headings.filter(h => h.level === 1).length;
  if (h1Count === 0) issues.push({ severity: 'serious', message: 'No <h1> on page' });
  if (h1Count > 1) issues.push({ severity: 'moderate', message: `Multiple <h1> tags (${h1Count})` });
  for (const h of domData.headings) {
    if (prevLevel > 0 && h.level > prevLevel + 1) {
      issues.push({ severity: 'moderate', message: `Heading skip: h${prevLevel} → h${h.level}` });
    }
    prevLevel = h.level;
  }
  return { issues, info: { headings: domData.headings } };
}

export function analyzeForms(domData) {
  const issues = [];
  for (const input of domData.forms) {
    if (!input.hasLabel && input.type !== 'submit' && input.type !== 'button') {
      issues.push({ severity: 'serious', message: `Missing label: <${input.tag}> ${input.type} ${input.name || ''}`, selector: input.selector });
    }
  }
  return { issues };
}

export function analyzeMeta(domData) {
  const issues = [];
  const m = domData.meta;
  if (!m.title) issues.push({ severity: 'critical', message: 'Missing <title>' });
  if (!m.description) issues.push({ severity: 'serious', message: 'Missing meta description' });
  if (!m.canonical) issues.push({ severity: 'moderate', message: 'No canonical URL' });
  if (!m.viewport) issues.push({ severity: 'serious', message: 'Missing viewport meta' });
  if (!m.lang) issues.push({ severity: 'moderate', message: 'Missing lang attribute' });
  if (!m.ogTitle) issues.push({ severity: 'moderate', message: 'Missing og:title' });
  if (!m.ogDescription) issues.push({ severity: 'moderate', message: 'Missing og:description' });
  if (!m.ogImage) issues.push({ severity: 'moderate', message: 'Missing og:image' });
  return { issues, info: m };
}

export function analyzeTextContent(domData, searchText) {
  if (!searchText) return { issues: [], info: {} };
  const found = domData.elements.some(el => el.text.includes(searchText));
  return {
    issues: found ? [] : [{ severity: 'critical', message: `Text not found: "${searchText}"` }],
    info: { searched: searchText, found },
  };
}

export function analyzeLayout(domData) {
  const issues = [];
  // Check for overflow
  if (domData.hasOverflow) {
    issues.push({ severity: 'critical', message: `Page overflows: scrollWidth ${domData.scrollWidth}px > viewport ${domData.viewport.width}px` });
  }
  return { issues, info: { viewport: domData.viewport, elements: domData.elements.length } };
}
```

- [ ] **Step 3: Verify both parse**

Run: `node --check cli-commands/intent-map.js && node --check cli-commands/analyzers.js`

- [ ] **Step 4: Commit**

```bash
git add cli-commands/intent-map.js cli-commands/analyzers.js
git commit -m "feat: add intent mapping and DOM analyzers — programmatic checks on collected data"
```

---

## Task 4: Report Formatter

**Files:**
- Create: `cli-commands/report-formatter.js`

- [ ] **Step 1: Create report-formatter.js**

Formats analysis results at quick/standard/deep detail levels:

```javascript
// cli-commands/report-formatter.js

export function formatReport(url, intent, analysisResults, screenshotPaths, detail = 'standard') {
  const allIssues = [];
  for (const [check, result] of Object.entries(analysisResults)) {
    for (const issue of result.issues || []) {
      allIssues.push({ ...issue, check });
    }
  }

  const critical = allIssues.filter(i => i.severity === 'critical').length;
  const serious = allIssues.filter(i => i.severity === 'serious').length;
  const moderate = allIssues.filter(i => i.severity === 'moderate').length;
  const minor = allIssues.filter(i => i.severity === 'minor').length;

  if (detail === 'quick') return formatQuick(url, intent, allIssues, screenshotPaths, { critical, serious, moderate, minor });
  if (detail === 'deep') return formatDeep(url, intent, allIssues, analysisResults, screenshotPaths, { critical, serious, moderate, minor });
  return formatStandard(url, intent, allIssues, analysisResults, screenshotPaths, { critical, serious, moderate, minor });
}

function formatQuick(url, intent, issues, screenshots, counts) {
  const lines = [];
  lines.push(`URL: ${url}`);
  if (intent) lines.push(`Intent: ${intent}`);
  lines.push(`Issues: ${counts.critical} critical, ${counts.serious} serious, ${counts.moderate} moderate`);
  for (const issue of issues.slice(0, 10)) {
    lines.push(`  ${issue.severity.toUpperCase()}: ${issue.message}`);
  }
  if (issues.length > 10) lines.push(`  ... and ${issues.length - 10} more`);
  if (screenshots.length) lines.push(`Screenshots: ${screenshots.join(', ')}`);
  return lines.join('\n');
}

function formatStandard(url, intent, issues, results, screenshots, counts) {
  const lines = [];
  lines.push(`URL: ${url}`);
  if (intent) lines.push(`Intent: "${intent}"`);
  lines.push('');

  // Group issues by check
  const grouped = {};
  for (const issue of issues) {
    if (!grouped[issue.check]) grouped[issue.check] = [];
    grouped[issue.check].push(issue);
  }

  for (const [check, checkIssues] of Object.entries(grouped)) {
    const label = check.toUpperCase();
    lines.push(`${label}:`);
    for (const issue of checkIssues) {
      lines.push(`  ${issue.severity.toUpperCase()}: ${issue.message}`);
      if (issue.selector) lines.push(`    Element: ${issue.selector}`);
    }
    lines.push('');
  }

  // Measurements from results
  if (results.layout?.info) {
    lines.push('MEASUREMENTS:');
    lines.push(`  Viewport: ${results.layout.info.viewport?.width}x${results.layout.info.viewport?.height}`);
    lines.push(`  Elements analyzed: ${results.layout.info.elements}`);
  }
  if (results.contrast?.info) lines.push(`  Text elements checked: ${results.contrast.info.checked}`);
  if (results.tap_targets?.info) lines.push(`  Interactive elements: ${results.tap_targets.info.checked}`);
  if (results.images?.info) lines.push(`  Images: ${results.images.info.total}`);

  lines.push('');
  lines.push(`SUMMARY: ${issues.length} issues (${counts.critical} critical, ${counts.serious} serious, ${counts.moderate} moderate)`);
  if (screenshots.length) lines.push(`Screenshots: ${screenshots.join(', ')}`);
  return lines.join('\n');
}

function formatDeep(url, intent, issues, results, screenshots, counts) {
  // Standard output plus full element data
  let output = formatStandard(url, intent, issues, results, screenshots, counts);
  output += '\n\nDETAILED DATA:\n';

  // Add headings hierarchy
  if (results.headings?.info?.headings) {
    output += '\nHeading Hierarchy:\n';
    for (const h of results.headings.info.headings) {
      output += `  ${'  '.repeat(h.level - 1)}H${h.level}: ${h.text}\n`;
    }
  }

  // Add meta details
  if (results.meta?.info) {
    output += '\nMeta Tags:\n';
    for (const [key, value] of Object.entries(results.meta.info)) {
      output += `  ${key}: ${value || '(missing)'}\n`;
    }
  }

  return output;
}
```

- [ ] **Step 2: Verify it parses**

Run: `node --check cli-commands/report-formatter.js`

- [ ] **Step 3: Commit**

```bash
git add cli-commands/report-formatter.js
git commit -m "feat: add report formatter — quick/standard/deep detail levels"
```

---

## Task 5: Inspect Engine (Module B)

**Files:**
- Create: `cli-commands/inspect-engine.js`

Composes DOM collector, intent map, analyzers, and report formatter.

- [ ] **Step 1: Create inspect-engine.js**

```javascript
// cli-commands/inspect-engine.js
import { collectDOMData } from './dom-collector.js';
import { mapIntentToChecks } from './intent-map.js';
import * as analyzers from './analyzers.js';
import { formatReport } from './report-formatter.js';
import fs from 'fs';
import path from 'path';

const ANALYZER_MAP = {
  layout: analyzers.analyzeLayout,
  overflow: analyzers.analyzeOverflow,
  contrast: analyzers.analyzeContrast,
  spacing: null, // TODO: port from accuracy.js
  images: analyzers.analyzeImages,
  headings: analyzers.analyzeHeadings,
  tap_targets: analyzers.analyzeTapTargets,
  meta: analyzers.analyzeMeta,
  links: null, // TODO
  forms: analyzers.analyzeForms,
  text_content: analyzers.analyzeTextContent,
  performance: null, // TODO
  describe: null, // special case
};

export async function inspect(page, options = {}) {
  const {
    intent = null,
    detail = 'standard',
    breakpoints = [
      { width: 1280, height: 800, label: 'desktop' },
      { width: 768, height: 1024, label: 'tablet' },
      { width: 375, height: 812, label: 'mobile' },
    ],
    savePath = null,
    systemPrompt = null,
  } = options;

  const startTime = Date.now();
  const saveDir = savePath || path.join('.', 'playwright-inspect', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));

  // Determine which checks to run
  const checks = mapIntentToChecks(intent);

  // Screenshot at breakpoints
  const originalViewport = page.viewportSize();
  const screenshotPaths = [];

  fs.mkdirSync(saveDir, { recursive: true });
  for (const bp of breakpoints) {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    await page.waitForTimeout(100);
    const filename = `${bp.label}-${bp.width}x${bp.height}.png`;
    const filepath = path.join(saveDir, filename);
    await page.screenshot({ path: filepath });
    screenshotPaths.push(filepath);
  }

  // Collect DOM data at each breakpoint for overflow checks
  const breakpointData = [];
  for (const bp of breakpoints) {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    await page.waitForTimeout(100);
    const bpData = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      hasOverflow: document.documentElement.scrollWidth > window.innerWidth,
    }));
    breakpointData.push({ ...bpData, label: bp.label });
  }

  // Restore viewport and collect full DOM data
  if (originalViewport) await page.setViewportSize(originalViewport);
  const domData = await collectDOMData(page);

  // Run relevant analyzers
  const results = {};
  for (const check of checks) {
    const analyzer = ANALYZER_MAP[check];
    if (!analyzer) continue;

    if (check === 'overflow') {
      results[check] = analyzer(domData, breakpointData);
    } else if (check === 'text_content' && intent) {
      // Extract search text from intent
      const priceMatch = intent.match(/['"]([^'"]+)['"]/);
      const searchText = priceMatch ? priceMatch[1] : null;
      results[check] = analyzer(domData, searchText);
    } else {
      results[check] = analyzer(domData);
    }
  }

  // Format report
  const report = formatReport(domData.url, intent, results, screenshotPaths, detail);

  return {
    report,
    results,
    screenshots: screenshotPaths,
    time: Date.now() - startTime,
    checksRun: checks,
  };
}
```

- [ ] **Step 2: Verify it parses**

Run: `node --check cli-commands/inspect-engine.js`

- [ ] **Step 3: Commit**

```bash
git add cli-commands/inspect-engine.js
git commit -m "feat: add inspect engine — intent-driven analysis with single-pass DOM collection"
```

---

## Task 6: Wire Into CLI and MCP

**Files:**
- Modify: `cli-commands/workflow.js`
- Modify: `cli.js`
- Modify: `server.js`

- [ ] **Step 1: Add `inspect` CLI command to cli.js**

Add a new case to the main switch:
```javascript
case 'inspect': {
  const { handleInspectWorkflow } = await import('./cli-commands/workflow.js');
  await handleInspectWorkflow(args.slice(1));
  break;
}
```

- [ ] **Step 2: Add handleInspectWorkflow to workflow.js**

```javascript
// In workflow.js — compose interact → inspect
import { interact } from './interact.js';
import { inspect } from './inspect-engine.js';

export async function handleInspectWorkflow(args) {
  const { flags, positional } = parseArgs(args);
  const url = positional[0];
  if (!url) {
    console.error('Usage: playwright-pool inspect <url> [--steps "..."] [--intent "..."] [--detail quick|standard|deep]');
    process.exit(1);
  }

  const steps = normalizeClicks(flags); // reuse existing click parsing
  const intent = flags.intent || null;
  const detail = flags.detail || 'standard';
  const savePath = flags.save || null;
  const auth = flags.auth !== 'false';

  // Module A: Interact — get to the page
  const { page, context, tempDir, log } = await interact(url, steps, {
    auth,
    headed: !!flags.headed,
  });

  // Module B: Inspect — analyze the page
  const result = await inspect(page, { intent, detail, savePath });

  // Output
  console.log(result.report);
  console.log(`\nTime: ${(result.time / 1000).toFixed(1)}s | Checks: ${result.checksRun.join(', ')}`);

  // Cleanup
  await context.close();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  process.exit(0);
}
```

- [ ] **Step 3: Add workflow_inspect MCP tool to server.js**

Add to the tool schemas and callTool routing. The MCP tool uses the active pool page (from pool_launch) instead of launching a new browser.

- [ ] **Step 4: Verify all files parse**

```bash
node --check cli.js && node --check cli-commands/workflow.js && node --check server.js
```

- [ ] **Step 5: Test end-to-end**

```bash
# CLI test
node cli.js inspect https://example.com --intent "does this look right?" --detail quick

# Expected: compact report with issues, screenshots saved
```

- [ ] **Step 6: Commit**

```bash
git add cli.js cli-commands/workflow.js server.js
git commit -m "feat: wire interact + inspect into CLI and MCP — one command for full workflow"
```

---

## Task 7: Test Pages for Scenarios

**Files:**
- Create: `tests/fixtures/test-page-images.html`
- Create: `tests/fixtures/test-page-product.html`
- Create: `tests/fixtures/test-page-form.html`
- Create: `tests/fixtures/test-page-menu.html`

- [ ] **Step 1: Create test pages**

4 new test pages for scenarios 3, 4, 7, 8. Each self-contained HTML with known bugs for accuracy testing.

- [ ] **Step 2: Update answer-key.json**

Add entries for all new test pages.

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/
git commit -m "test: add test pages for image, product, form, and menu scenarios"
```

---

## Task 8: Scenario Benchmark Runner

**Files:**
- Create: `scripts/scenario-benchmark.js`

- [ ] **Step 1: Create benchmark runner**

Runs all 15 scenarios through approaches C (new workflow CLI) and D (new MCP workflow_inspect), measuring all 8 metrics.

- [ ] **Step 2: Test with 3 scenarios**

```bash
node scripts/scenario-benchmark.js --scenarios 1,3,9
```

- [ ] **Step 3: Commit and push**

```bash
git add scripts/scenario-benchmark.js
git commit -m "feat: add 15-scenario benchmark runner for workflow comparison"
git push
```

---

## Execution Order

| Task | What | Depends On | Parallelizable |
|------|------|-----------|----------------|
| 1 | Interact module | — | Start here |
| 2 | DOM collector | — | Parallel with 1 |
| 3 | Intent map + analyzers | — | Parallel with 1, 2 |
| 4 | Report formatter | — | Parallel with 1, 2, 3 |
| 5 | Inspect engine | Tasks 2, 3, 4 | After 2, 3, 4 |
| 6 | CLI + MCP wiring | Tasks 1, 5 | After 1, 5 |
| 7 | Test pages | — | Parallel with anything |
| 8 | Benchmark runner | Tasks 6, 7 | After 6, 7 |

**Tasks 1-4 and 7 can run in parallel.** Task 5 composes 2-4. Task 6 composes 1+5. Task 8 tests everything.
