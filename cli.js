#!/usr/bin/env node

// playwright-pool CLI — standalone setup, config, and audit tool
//
// Commands:
//   init    — Create ~/.playwright-pool/ directory structure
//   login   — Launch headed browser to save credentials to golden profile
//   config  — Output .mcp.json snippet for Claude Code
//   status  — Show pool directories and golden profile status
//   clean   — Remove orphaned pool-context directories
//   audit   — Standalone audit: accessibility, meta, breakpoints, contrast

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

if (!command || command === '--help' || command === '-h') {
  printUsage();
  process.exit(0);
}

switch (command) {
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
  case 'audit':
    await cmdAudit(args[1], args.slice(2));
    break;
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

Commands:
  init              Create ~/.playwright-pool/ directory structure
  login [url]       Launch browser to log in (default: https://accounts.google.com)
  config            Output .mcp.json snippet for Claude Code
  status            Show pool directories and golden profile info
  clean             Remove orphaned pool-context directories
  audit <url>       Run accessibility, meta, breakpoints, and contrast audits

Examples:
  playwright-pool init
  playwright-pool login
  playwright-pool login https://github.com/login
  playwright-pool config
  playwright-pool audit https://example.com
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

// ─── audit ────────────────────────────────────────────────────────

async function cmdAudit(url, extraArgs) {
  if (!url) {
    console.error('Usage: playwright-pool audit <url>');
    console.error('Example: playwright-pool audit https://example.com');
    process.exit(1);
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    console.error(`Invalid URL: ${url}`);
    process.exit(1);
  }

  console.log(`Auditing: ${url}`);
  console.log('Launching browser...');
  console.log();

  const { chromium } = await import('playwright');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Extra wait for JS-heavy pages
    await page.waitForTimeout(1000);

    // 1. SEO Meta Audit
    console.log('='.repeat(60));
    console.log('  SEO METADATA AUDIT');
    console.log('='.repeat(60));
    await runMetaAudit(page);

    // 2. Accessibility Audit
    console.log();
    console.log('='.repeat(60));
    console.log('  ACCESSIBILITY AUDIT');
    console.log('='.repeat(60));
    await runAccessibilityAudit(page);

    // 3. Color Contrast Audit
    console.log();
    console.log('='.repeat(60));
    console.log('  COLOR CONTRAST AUDIT');
    console.log('='.repeat(60));
    await runContrastAudit(page);

    // 4. Breakpoint Screenshots
    console.log();
    console.log('='.repeat(60));
    console.log('  BREAKPOINT AUDIT');
    console.log('='.repeat(60));
    await runBreakpointAudit(page);

    console.log();
    console.log('Audit complete.');
  } catch (err) {
    console.error(`Audit failed: ${err.message}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

// ─── Audit: Meta ──────────────────────────────────────────────────

async function runMetaAudit(page) {
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

    const metas = document.querySelectorAll('meta');
    metas.forEach((m) => {
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

    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) result.canonical = canonical.getAttribute('href');

    for (let i = 1; i <= 6; i++) {
      const headings = document.querySelectorAll(`h${i}`);
      headings.forEach((h) => {
        result.headings[`h${i}`].push((h.textContent || '').trim().slice(0, 100));
      });
    }

    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    jsonLdScripts.forEach((script) => {
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

  console.log(`URL: ${meta.url}`);
  console.log();
  console.log('--- Basic ---');
  console.log(`  Title: ${meta.title || '(missing)'}${meta.title ? ` (${meta.title.length} chars)` : ''}`);
  console.log(`  Description: ${meta.description ? meta.description.slice(0, 80) + (meta.description.length > 80 ? '...' : '') : '(missing)'}${meta.description ? ` (${meta.description.length} chars)` : ''}`);
  console.log(`  Canonical: ${meta.canonical || '(not set)'}`);
  console.log(`  Robots: ${meta.robots || '(not set)'}`);
  console.log(`  Viewport: ${meta.viewport || '(missing)'}`);
  console.log(`  Charset: ${meta.charset || '(not set)'}`);

  const ogEntries = Object.entries(meta.ogTags);
  if (ogEntries.length > 0) {
    console.log();
    console.log('--- Open Graph ---');
    for (const [k, v] of ogEntries) console.log(`  ${k}: ${v.slice(0, 100)}`);
  }

  const twEntries = Object.entries(meta.twitterTags);
  if (twEntries.length > 0) {
    console.log();
    console.log('--- Twitter Cards ---');
    for (const [k, v] of twEntries) console.log(`  ${k}: ${v.slice(0, 100)}`);
  }

  console.log();
  console.log('--- Heading Hierarchy ---');
  let hasHeadings = false;
  for (let i = 1; i <= 6; i++) {
    const key = `h${i}`;
    if (meta.headings[key].length > 0) {
      hasHeadings = true;
      for (const text of meta.headings[key]) {
        console.log(`  ${'  '.repeat(i - 1)}H${i}: ${text}`);
      }
    }
  }
  if (!hasHeadings) console.log('  (none)');

  if (meta.structuredData.length > 0) {
    console.log();
    console.log('--- Structured Data (JSON-LD) ---');
    for (const t of meta.structuredData) console.log(`  @type: ${t}`);
  }

  console.log();
  console.log('--- Results ---');
  for (const issue of meta.issues) console.log(`  ${issue}`);
}

// ─── Audit: Accessibility ─────────────────────────────────────────

async function runAccessibilityAudit(page) {
  const violations = await page.evaluate(() => {
    const violations = [];

    function isVisible(el) {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
        && el.offsetWidth > 0 && el.offsetHeight > 0;
    }

    // 1. Images without alt text
    const images = document.querySelectorAll('img');
    let imgMissing = 0;
    images.forEach((img) => {
      if (!img.hasAttribute('alt')) imgMissing++;
    });
    if (imgMissing > 0) {
      violations.push({ id: 'image-alt', impact: 'critical', count: imgMissing, description: 'Images missing alt text' });
    }

    // 2. Form inputs without labels
    const inputs = document.querySelectorAll('input, select, textarea');
    let inputMissing = 0;
    inputs.forEach((input) => {
      if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button') return;
      const hasLabel = input.id && document.querySelector(`label[for="${input.id}"]`);
      const hasAriaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
      const wrappedInLabel = input.closest('label');
      const hasTitle = input.getAttribute('title');
      if (!hasLabel && !hasAriaLabel && !wrappedInLabel && !hasTitle) inputMissing++;
    });
    if (inputMissing > 0) {
      violations.push({ id: 'label', impact: 'critical', count: inputMissing, description: 'Form inputs missing labels' });
    }

    // 3. Empty links
    const links = document.querySelectorAll('a[href]');
    let emptyLinks = 0;
    links.forEach((link) => {
      if (!isVisible(link)) return;
      const text = (link.textContent || '').trim();
      const ariaLabel = link.getAttribute('aria-label') || '';
      const img = link.querySelector('img[alt]');
      if (!text && !ariaLabel && !img) emptyLinks++;
    });
    if (emptyLinks > 0) {
      violations.push({ id: 'link-name', impact: 'serious', count: emptyLinks, description: 'Links without discernible text' });
    }

    // 4. Empty buttons
    const buttons = document.querySelectorAll('button, [role="button"]');
    let emptyButtons = 0;
    buttons.forEach((btn) => {
      if (!isVisible(btn)) return;
      const text = (btn.textContent || '').trim();
      const ariaLabel = btn.getAttribute('aria-label') || '';
      const img = btn.querySelector('img[alt]');
      if (!text && !ariaLabel && !img) emptyButtons++;
    });
    if (emptyButtons > 0) {
      violations.push({ id: 'button-name', impact: 'critical', count: emptyButtons, description: 'Buttons without discernible text' });
    }

    // 5. Document language
    if (!document.documentElement.getAttribute('lang')) {
      violations.push({ id: 'html-has-lang', impact: 'serious', count: 1, description: 'HTML element missing lang attribute' });
    }

    // 6. Page title
    if (!document.title || !document.title.trim()) {
      violations.push({ id: 'document-title', impact: 'serious', count: 1, description: 'Document missing <title>' });
    }

    // 7. Heading order
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let prevLevel = 0;
    let skipCount = 0;
    headings.forEach((h) => {
      const level = parseInt(h.tagName[1]);
      if (prevLevel > 0 && level > prevLevel + 1) skipCount++;
      prevLevel = level;
    });
    if (skipCount > 0) {
      violations.push({ id: 'heading-order', impact: 'moderate', count: skipCount, description: 'Heading levels skip (not sequential)' });
    }

    return violations;
  });

  if (violations.length === 0) {
    console.log('  No accessibility violations found.');
  } else {
    for (const v of violations) {
      const icon = v.impact === 'critical' ? 'CRITICAL' : v.impact === 'serious' ? 'SERIOUS' : 'MODERATE';
      console.log(`  [${icon}] ${v.description} (${v.count} instance${v.count > 1 ? 's' : ''})`);
    }
  }
}

// ─── Audit: Color Contrast ────────────────────────────────────────

async function runContrastAudit(page) {
  const results = await page.evaluate(() => {
    function getLuminance(r, g, b) {
      const [rs, gs, bs] = [r, g, b].map((c) => {
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
      return fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    }

    // Get all text nodes' parent elements
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });

    const checked = new Set();
    const failures = [];
    let totalChecked = 0;

    let node;
    while ((node = walker.nextNode())) {
      const el = node.parentElement;
      if (!el || checked.has(el)) continue;
      checked.add(el);

      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      if (el.offsetWidth === 0 || el.offsetHeight === 0) continue;

      const fg = parseColor(style.color);
      const bg = parseColor(style.backgroundColor);
      if (!fg || !bg) continue;

      // Skip transparent backgrounds
      const bgAlpha = style.backgroundColor.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*([0-9.]+)\)/);
      if (bgAlpha && parseFloat(bgAlpha[1]) < 0.1) continue;

      totalChecked++;

      const fgLum = getLuminance(fg.r, fg.g, fg.b);
      const bgLum = getLuminance(bg.r, bg.g, bg.b);
      const ratio = contrastRatio(fgLum, bgLum);

      const large = isLargeText(el);
      const required = large ? 3 : 4.5; // AA level

      if (ratio < required) {
        const text = (el.textContent || '').trim().slice(0, 50);
        failures.push({
          text,
          ratio: Math.round(ratio * 100) / 100,
          required,
          fg: style.color,
          bg: style.backgroundColor,
          large,
          selector: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
        });
      }
    }

    return { totalChecked, failures: failures.slice(0, 20) }; // Cap at 20 for readability
  });

  console.log(`  Checked ${results.totalChecked} text elements.`);

  if (results.failures.length === 0) {
    console.log('  All elements pass AA contrast requirements.');
  } else {
    console.log(`  ${results.failures.length} element${results.failures.length > 1 ? 's' : ''} failing contrast (showing up to 20):`);
    console.log();
    for (const f of results.failures) {
      console.log(`    "${f.text.slice(0, 40)}${f.text.length > 40 ? '...' : ''}"`);
      console.log(`      Ratio: ${f.ratio}:1 (need ${f.required}:1${f.large ? ', large text' : ''})  |  fg: ${f.fg}  bg: ${f.bg}`);
    }
  }
}

// ─── Audit: Breakpoints ──────────────────────────────────────────

async function runBreakpointAudit(page) {
  const breakpoints = [
    { label: 'desktop', width: 1280, height: 800 },
    { label: 'tablet', width: 768, height: 1024 },
    { label: 'mobile', width: 375, height: 812 },
  ];

  const originalViewport = page.viewportSize();

  for (const bp of breakpoints) {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    await page.waitForTimeout(300);

    // Check for horizontal overflow
    const overflow = await page.evaluate(() => {
      return {
        bodyWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth,
        overflows: document.body.scrollWidth > window.innerWidth,
      };
    });

    const overflowStr = overflow.overflows
      ? `OVERFLOW (body: ${overflow.bodyWidth}px > viewport: ${overflow.viewportWidth}px)`
      : 'OK';

    console.log(`  ${bp.label} (${bp.width}x${bp.height}): ${overflowStr}`);
  }

  // Restore original viewport
  if (originalViewport) {
    await page.setViewportSize(originalViewport);
  }

  console.log();
  console.log('  Note: For full breakpoint screenshots, use the MCP audit_breakpoints tool.');
}
