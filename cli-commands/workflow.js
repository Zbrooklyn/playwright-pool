// cli-commands/workflow.js — batched multi-step browser workflows
import path from 'path';
import fs from 'fs';
import { parseArgs as _parseArgs, getViewport, timestamp, ensureDir, getOrLaunchBrowser, DEVICES } from './shared.js';

// Extended parseArgs that collects repeated flags into arrays
function parseArgsMulti(args) {
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
        // Collect repeated flags into arrays
        if (flags[key] !== undefined) {
          if (!Array.isArray(flags[key])) flags[key] = [flags[key]];
          flags[key].push(next);
        } else {
          flags[key] = next;
        }
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

// Normalize --click to always be an array
function normalizeClicks(flags) {
  if (!flags.click) return [];
  if (Array.isArray(flags.click)) return flags.click;
  return [flags.click];
}

// Parse --breakpoints "1280x800,768x1024,375x812" or use defaults
function parseBreakpoints(flags) {
  if (flags.mobile) {
    return [{ label: 'mobile', width: 375, height: 812 }];
  }
  if (flags.tablet) {
    return [{ label: 'tablet', width: 768, height: 1024 }];
  }
  if (flags.breakpoints && typeof flags.breakpoints === 'string') {
    return flags.breakpoints.split(',').map(bp => {
      const [w, h] = bp.trim().split('x').map(Number);
      return { label: `${w}x${h}`, width: w, height: h || 800 };
    });
  }
  return [
    { label: 'desktop', width: 1280, height: 800 },
    { label: 'tablet', width: 768, height: 1024 },
    { label: 'mobile', width: 375, height: 812 },
  ];
}

// Parse --audits "meta,accessibility,contrast" or use defaults
function parseAudits(flags) {
  const defaults = ['meta', 'accessibility', 'contrast', 'overflow', 'tap_targets', 'images'];
  if (flags.audits && typeof flags.audits === 'string') {
    return flags.audits.split(',').map(a => a.trim());
  }
  return defaults;
}

// Click an element by text or CSS selector, then wait for settle
async function clickAndSettle(page, selector) {
  // Try text-based click first, fall back to CSS selector
  try {
    const textLocator = page.getByText(selector, { exact: false });
    if (await textLocator.count() > 0) {
      await textLocator.first().click();
    } else {
      await page.click(selector);
    }
  } catch {
    // If getByText fails, try as CSS selector
    try {
      await page.click(selector);
    } catch (err) {
      console.error(`  Failed to click "${selector}": ${err.message}`);
      return;
    }
  }
  // Wait for page to settle after click
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1000);
}

// ─── Inline audit logic (self-contained, no imports from audit.js) ──────────

async function auditMeta(page) {
  const meta = await page.evaluate(() => {
    const result = {
      title: document.title || null,
      description: null,
      canonical: null,
      viewport: null,
      ogTags: {},
      headings: { h1: [], h2: [], h3: [] },
      issues: [],
    };
    const descEl = document.querySelector('meta[name="description"]');
    if (descEl) result.description = descEl.getAttribute('content');
    const canonEl = document.querySelector('link[rel="canonical"]');
    if (canonEl) result.canonical = canonEl.getAttribute('href');
    const vpEl = document.querySelector('meta[name="viewport"]');
    if (vpEl) result.viewport = vpEl.getAttribute('content');
    document.querySelectorAll('meta[property^="og:"]').forEach(el => {
      result.ogTags[el.getAttribute('property')] = el.getAttribute('content');
    });
    for (let i = 1; i <= 3; i++) {
      document.querySelectorAll(`h${i}`).forEach(h => {
        result.headings[`h${i}`].push((h.textContent || '').trim().slice(0, 100));
      });
    }
    // Issues
    if (!result.title) result.issues.push('FAIL: Missing <title>');
    else if (result.title.length < 10) result.issues.push('WARN: Title too short');
    else if (result.title.length > 60) result.issues.push('WARN: Title too long');
    if (!result.description) result.issues.push('FAIL: Missing meta description');
    else if (result.description.length < 50) result.issues.push('WARN: Description too short');
    else if (result.description.length > 160) result.issues.push('WARN: Description too long');
    if (!result.viewport) result.issues.push('FAIL: Missing viewport meta');
    if (!result.canonical) result.issues.push('WARN: No canonical URL');
    const h1Count = result.headings.h1.length;
    if (h1Count === 0) result.issues.push('FAIL: No <h1> on page');
    else if (h1Count > 1) result.issues.push(`WARN: Multiple <h1> tags (${h1Count})`);
    if (!result.ogTags['og:title']) result.issues.push('WARN: Missing og:title');
    if (!result.ogTags['og:description']) result.issues.push('WARN: Missing og:description');
    if (!result.ogTags['og:image']) result.issues.push('WARN: Missing og:image');
    return result;
  });
  const fails = meta.issues.filter(i => i.startsWith('FAIL')).length;
  const warns = meta.issues.filter(i => i.startsWith('WARN')).length;
  return { name: 'Meta', issues: meta.issues, critical: fails, warnings: warns, total: fails + warns };
}

async function auditAccessibility(page) {
  const violations = await page.evaluate(() => {
    const issues = [];
    // Missing alt on images
    document.querySelectorAll('img').forEach(img => {
      if (!img.hasAttribute('alt')) {
        issues.push({ type: 'critical', desc: `Missing alt: ${(img.src || '').slice(0, 80)}` });
      }
    });
    // Missing labels on inputs
    document.querySelectorAll('input, textarea, select').forEach(el => {
      const id = el.id;
      const hasLabel = id && document.querySelector(`label[for="${id}"]`);
      const hasAriaLabel = el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby');
      const hasTitle = el.hasAttribute('title');
      const hasPlaceholder = el.hasAttribute('placeholder');
      if (!hasLabel && !hasAriaLabel && !hasTitle && !hasPlaceholder) {
        issues.push({ type: 'serious', desc: `Missing label: <${el.tagName.toLowerCase()}> ${el.type || ''}` });
      }
    });
    // Empty buttons
    document.querySelectorAll('button, [role="button"]').forEach(btn => {
      const text = (btn.textContent || '').trim();
      const ariaLabel = btn.getAttribute('aria-label');
      const title = btn.getAttribute('title');
      if (!text && !ariaLabel && !title && !btn.querySelector('img[alt]')) {
        issues.push({ type: 'serious', desc: 'Empty button (no text, aria-label, or title)' });
      }
    });
    // Heading order
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    let lastLevel = 0;
    for (const h of headings) {
      const level = parseInt(h.tagName[1]);
      if (level > lastLevel + 1 && lastLevel > 0) {
        issues.push({ type: 'moderate', desc: `Heading skip: h${lastLevel} → h${level}` });
      }
      lastLevel = level;
    }
    return issues;
  });
  const critical = violations.filter(v => v.type === 'critical').length;
  const serious = violations.filter(v => v.type === 'serious').length;
  const total = violations.length;
  let summary = `${total} issues`;
  if (critical) summary += ` (${critical} critical`;
  if (serious) summary += critical ? `, ${serious} serious` : ` (${serious} serious`;
  if (critical || serious) summary += ')';
  return { name: 'Accessibility', issues: violations.map(v => `${v.type.toUpperCase()}: ${v.desc}`), critical, warnings: serious, total };
}

async function auditContrast(page) {
  const result = await page.evaluate(() => {
    function luminance(r, g, b) {
      const [rs, gs, bs] = [r, g, b].map(c => {
        c = c / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    }
    function parseColor(str) {
      const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
      return null;
    }
    function contrastRatio(l1, l2) {
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }
    const fails = [];
    const textEls = document.querySelectorAll('p, span, a, button, li, td, th, label, h1, h2, h3, h4, h5, h6, div');
    for (const el of textEls) {
      const style = window.getComputedStyle(el);
      const text = (el.textContent || '').trim();
      if (!text || style.display === 'none' || style.visibility === 'hidden') continue;
      const fg = parseColor(style.color);
      const bg = parseColor(style.backgroundColor);
      if (!fg || !bg) continue;
      // Skip transparent backgrounds
      const bgAlpha = style.backgroundColor.match(/rgba\([^)]+,\s*([\d.]+)\)/);
      if (bgAlpha && parseFloat(bgAlpha[1]) < 0.1) continue;
      const fgL = luminance(...fg);
      const bgL = luminance(...bg);
      const ratio = contrastRatio(fgL, bgL);
      const fontSize = parseFloat(style.fontSize);
      const fontWeight = parseInt(style.fontWeight) || 400;
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const required = isLarge ? 3 : 4.5;
      if (ratio < required) {
        fails.push({
          text: text.slice(0, 40),
          ratio: ratio.toFixed(2),
          required,
          selector: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
        });
        if (fails.length >= 20) break;
      }
    }
    return { total: fails.length, failures: fails };
  });
  if (result.total === 0) {
    return { name: 'Contrast', issues: [], critical: 0, warnings: 0, total: 0, status: 'PASS' };
  }
  return {
    name: 'Contrast',
    issues: result.failures.map(f => `FAIL: "${f.text}" ratio ${f.ratio}:1 (need ${f.required}:1) [${f.selector}]`),
    critical: result.total,
    warnings: 0,
    total: result.total,
    status: 'FAIL',
  };
}

async function auditOverflow(page, breakpoints) {
  const results = [];
  for (const bp of breakpoints) {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    await page.waitForTimeout(300);
    const data = await page.evaluate(() => {
      const docWidth = document.documentElement.scrollWidth;
      const vpWidth = window.innerWidth;
      const hasOverflow = docWidth > vpWidth;
      const offenders = [];
      if (hasOverflow) {
        document.querySelectorAll('*').forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.right > vpWidth + 1 && rect.width > 0) {
            offenders.push({
              selector: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
              width: Math.round(rect.width),
              overflow: Math.round(rect.right - vpWidth),
            });
          }
        });
        // Deduplicate, take top 5
        const seen = new Set();
        const unique = [];
        for (const o of offenders) {
          if (!seen.has(o.selector)) {
            seen.add(o.selector);
            unique.push(o);
          }
          if (unique.length >= 5) break;
        }
        return { hasOverflow, docWidth, vpWidth, offenders: unique };
      }
      return { hasOverflow, docWidth, vpWidth, offenders: [] };
    });
    results.push({ ...bp, ...data });
  }
  const failing = results.filter(r => r.hasOverflow);
  const issues = failing.map(r => {
    const offenderStr = r.offenders.map(o => `${o.selector}(+${o.overflow}px)`).join(', ');
    return `FAIL at ${r.label} (${r.vpWidth}px): doc=${r.docWidth}px${offenderStr ? ' — ' + offenderStr : ''}`;
  });
  return {
    name: 'Overflow',
    issues,
    critical: failing.length,
    warnings: 0,
    total: failing.length,
    status: failing.length === 0 ? 'PASS' : 'FAIL',
    details: results,
  };
}

async function auditTapTargets(page) {
  const result = await page.evaluate(() => {
    const MIN_SIZE = 48;
    const targets = document.querySelectorAll('a, button, input, textarea, select, [role="button"], [role="link"], [tabindex]');
    const undersized = [];
    for (const el of targets) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
        const text = (el.textContent || '').trim().slice(0, 40);
        undersized.push({
          selector: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
          text,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
        if (undersized.length >= 30) break;
      }
    }
    return { total: undersized.length, items: undersized };
  });
  return {
    name: 'Tap targets',
    issues: result.items.map(i => `"${i.text}" — ${i.width}x${i.height}px [${i.selector}]`),
    critical: 0,
    warnings: result.total,
    total: result.total,
  };
}

async function auditImages(page) {
  const result = await page.evaluate(() => {
    const issues = { missingAlt: [], oversized: [], broken: [] };
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      const src = (img.src || '').slice(0, 80);
      if (!img.hasAttribute('alt')) {
        issues.missingAlt.push({ src });
      }
      if (img.naturalWidth > 0 && img.width > 0) {
        const ratio = img.naturalWidth / img.width;
        if (ratio > 3) {
          issues.oversized.push({ src, natural: `${img.naturalWidth}x${img.naturalHeight}`, rendered: `${img.width}x${img.height}`, ratio: ratio.toFixed(1) });
        }
      }
      if (img.complete && img.naturalWidth === 0 && img.src) {
        issues.broken.push({ src });
      }
    }
    return issues;
  });
  const total = result.missingAlt.length + result.oversized.length + result.broken.length;
  const issues = [];
  if (result.missingAlt.length) issues.push(`${result.missingAlt.length} missing alt`);
  if (result.oversized.length) issues.push(`${result.oversized.length} oversized`);
  if (result.broken.length) issues.push(`${result.broken.length} broken`);
  return {
    name: 'Images',
    issues,
    critical: result.broken.length,
    warnings: result.missingAlt.length + result.oversized.length,
    total,
  };
}

// Map audit name to function
const AUDIT_MAP = {
  meta: auditMeta,
  accessibility: auditAccessibility,
  contrast: auditContrast,
  overflow: auditOverflow,
  tap_targets: auditTapTargets,
  images: auditImages,
};

// ─── Workflow: audit-page ───────────────────────────────────────────────────

async function workflowAuditPage(args) {
  const { flags, positional } = parseArgsMulti(args);
  const url = positional[0];
  if (!url) {
    console.error('Usage: playwright-pool workflow audit-page <url> [--click "..."] [--save dir] [--breakpoints "WxH,..."] [--audits "..."] [--headed] [--mobile] [--tablet]');
    process.exit(1);
  }

  const clicks = normalizeClicks(flags);
  const breakpoints = parseBreakpoints(flags);
  const auditNames = parseAudits(flags);
  const saveDir = ensureDir(flags.save || `./playwright-audit/${timestamp()}`);
  const startTime = Date.now();

  // Build step description
  const steps = ['navigate'];
  clicks.forEach(c => steps.push(`click "${c}"`));
  steps.push(`screenshot × ${breakpoints.length}`);
  steps.push(`audit × ${auditNames.length}`);

  console.log(`\nWorkflow: audit-page`);
  console.log(`URL: ${url}`);
  console.log(`Steps: ${steps.join(' → ')}`);
  console.log();

  // 1. Launch ONE browser
  const { browser, page, reused } = await getOrLaunchBrowser(flags);

  try {
    // 2. Navigate
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(500);

    // 3. Execute click steps
    for (const selector of clicks) {
      console.log(`  Clicking: "${selector}"`);
      await clickAndSettle(page, selector);
    }

    // 4. Screenshot at each breakpoint
    console.log(`\nScreenshots saved:`);
    const screenshotPaths = [];
    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.waitForTimeout(300);
      const filename = `${bp.label}-${bp.width}x${bp.height}.png`;
      const filepath = path.join(saveDir, filename);
      await page.screenshot({ path: filepath, fullPage: true });
      screenshotPaths.push(filepath);
      console.log(`  ${filepath}`);
    }

    // 5. Run audits
    console.log(`\nAudit Summary:`);
    const auditResults = [];
    let totalIssues = 0;
    for (const auditName of auditNames) {
      const auditFn = AUDIT_MAP[auditName];
      if (!auditFn) {
        console.log(`  ${auditName}: UNKNOWN (skipped)`);
        continue;
      }
      let result;
      if (auditName === 'overflow') {
        result = await auditFn(page, breakpoints);
      } else {
        // Reset to desktop viewport for non-overflow audits
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForTimeout(200);
        result = await auditFn(page);
      }
      auditResults.push(result);
      totalIssues += result.total;

      if (result.total === 0) {
        console.log(`  ${result.name}: PASS`);
      } else {
        const parts = [];
        if (result.critical) parts.push(`${result.critical} critical`);
        if (result.warnings) parts.push(`${result.warnings} warnings`);
        console.log(`  ${result.name}: ${result.status || 'FAIL'} — ${result.total} issues${parts.length ? ' (' + parts.join(', ') + ')' : ''}`);
        for (const issue of result.issues.slice(0, 5)) {
          console.log(`    • ${issue}`);
        }
        if (result.issues.length > 5) {
          console.log(`    ... and ${result.issues.length - 5} more`);
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nTotal: ${totalIssues} issues | Time: ${elapsed}s`);

    // 6. Save full report
    const report = {
      workflow: 'audit-page',
      url,
      timestamp: new Date().toISOString(),
      clicks,
      breakpoints: breakpoints.map(b => `${b.width}x${b.height}`),
      screenshots: screenshotPaths,
      audits: auditResults,
      totalIssues,
      elapsed: `${elapsed}s`,
    };
    const reportPath = path.join(saveDir, 'audit-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nFull report: ${reportPath}`);

    return report;
  } finally {
    if (reused) { await page.close().catch(() => {}); browser.disconnect(); } else { await browser.close(); }
  }
}

// ─── Workflow: compare ──────────────────────────────────────────────────────

async function workflowCompare(args) {
  const { flags, positional } = parseArgsMulti(args);
  const urlA = positional[0];
  const urlB = positional[1];
  if (!urlA || !urlB) {
    console.error('Usage: playwright-pool workflow compare <url-a> <url-b> [--save dir] [--breakpoints "WxH,..."]');
    process.exit(1);
  }

  const breakpoints = parseBreakpoints(flags);
  const saveDir = ensureDir(flags.save || `./playwright-compare/${timestamp()}`);
  const startTime = Date.now();

  console.log(`\nWorkflow: compare`);
  console.log(`URL A: ${urlA}`);
  console.log(`URL B: ${urlB}`);
  console.log(`Breakpoints: ${breakpoints.map(b => `${b.width}x${b.height}`).join(', ')}`);
  console.log();

  const { browser, page, reused } = await getOrLaunchBrowser(flags);

  try {
    const screenshotsA = [];
    const screenshotsB = [];

    // Screenshot URL A at all breakpoints
    console.log(`Capturing URL A...`);
    await page.goto(urlA, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(500);
    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.waitForTimeout(300);
      const filename = `a-${bp.label}-${bp.width}x${bp.height}.png`;
      const filepath = path.join(saveDir, filename);
      await page.screenshot({ path: filepath, fullPage: true });
      screenshotsA.push(filepath);
      console.log(`  ${filepath}`);
    }

    // Screenshot URL B at all breakpoints
    console.log(`Capturing URL B...`);
    await page.goto(urlB, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(500);
    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.waitForTimeout(300);
      const filename = `b-${bp.label}-${bp.width}x${bp.height}.png`;
      const filepath = path.join(saveDir, filename);
      await page.screenshot({ path: filepath, fullPage: true });
      screenshotsB.push(filepath);
      console.log(`  ${filepath}`);
    }

    // Compare file sizes as a rough diff indicator
    console.log(`\nComparison:`);
    for (let i = 0; i < breakpoints.length; i++) {
      const bp = breakpoints[i];
      const sizeA = fs.statSync(screenshotsA[i]).size;
      const sizeB = fs.statSync(screenshotsB[i]).size;
      const diffPct = Math.abs(sizeA - sizeB) / Math.max(sizeA, sizeB) * 100;
      const status = diffPct < 5 ? 'SIMILAR' : diffPct < 20 ? 'CHANGED' : 'VERY DIFFERENT';
      console.log(`  ${bp.label} (${bp.width}x${bp.height}): ${status} (size diff: ${diffPct.toFixed(1)}%)`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nTime: ${elapsed}s`);
    console.log(`Results saved to: ${saveDir}`);

    const report = {
      workflow: 'compare',
      urlA,
      urlB,
      timestamp: new Date().toISOString(),
      screenshotsA,
      screenshotsB,
      elapsed: `${elapsed}s`,
    };
    const reportPath = path.join(saveDir, 'compare-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    return report;
  } finally {
    if (reused) { await page.close().catch(() => {}); browser.disconnect(); } else { await browser.close(); }
  }
}

// ─── Workflow: monitor ──────────────────────────────────────────────────────

async function workflowMonitor(args) {
  const { flags, positional } = parseArgsMulti(args);
  const url = positional[0];
  if (!url) {
    console.error('Usage: playwright-pool workflow monitor <url> [--baseline dir] [--save dir] [--breakpoints "WxH,..."] [--audits "..."]');
    process.exit(1);
  }

  const breakpoints = parseBreakpoints(flags);
  const auditNames = parseAudits(flags);
  const saveDir = ensureDir(flags.save || `./playwright-monitor/${timestamp()}`);
  const baselineDir = flags.baseline || null;
  const startTime = Date.now();

  console.log(`\nWorkflow: monitor`);
  console.log(`URL: ${url}`);
  if (baselineDir) console.log(`Baseline: ${baselineDir}`);
  console.log();

  const { browser, page, reused } = await getOrLaunchBrowser(flags);

  try {
    // Navigate and settle
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(500);

    // Screenshot at breakpoints
    console.log(`Screenshots:`);
    const screenshotPaths = [];
    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.waitForTimeout(300);
      const filename = `${bp.label}-${bp.width}x${bp.height}.png`;
      const filepath = path.join(saveDir, filename);
      await page.screenshot({ path: filepath, fullPage: true });
      screenshotPaths.push({ label: bp.label, path: filepath });
      console.log(`  ${filepath}`);
    }

    // Run audits
    console.log(`\nAudit Summary:`);
    const auditResults = [];
    let totalIssues = 0;
    for (const auditName of auditNames) {
      const auditFn = AUDIT_MAP[auditName];
      if (!auditFn) continue;
      let result;
      if (auditName === 'overflow') {
        result = await auditFn(page, breakpoints);
      } else {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForTimeout(200);
        result = await auditFn(page);
      }
      auditResults.push(result);
      totalIssues += result.total;
      console.log(`  ${result.name}: ${result.total === 0 ? 'PASS' : `${result.total} issues`}`);
    }

    // Compare against baseline if provided
    if (baselineDir && fs.existsSync(path.join(baselineDir, 'audit-report.json'))) {
      const baseline = JSON.parse(fs.readFileSync(path.join(baselineDir, 'audit-report.json'), 'utf8'));
      console.log(`\nBaseline Comparison:`);
      const baselineIssues = baseline.totalIssues || 0;
      const diff = totalIssues - baselineIssues;
      if (diff === 0) {
        console.log(`  No change: ${totalIssues} issues (same as baseline)`);
      } else if (diff > 0) {
        console.log(`  REGRESSION: ${totalIssues} issues (+${diff} from baseline ${baselineIssues})`);
      } else {
        console.log(`  IMPROVEMENT: ${totalIssues} issues (${diff} from baseline ${baselineIssues})`);
      }

      // Compare screenshots by file size
      for (const sp of screenshotPaths) {
        const baselineScreenshot = path.join(baselineDir, path.basename(sp.path));
        if (fs.existsSync(baselineScreenshot)) {
          const currentSize = fs.statSync(sp.path).size;
          const baselineSize = fs.statSync(baselineScreenshot).size;
          const diffPct = Math.abs(currentSize - baselineSize) / Math.max(currentSize, baselineSize) * 100;
          const status = diffPct < 5 ? 'UNCHANGED' : diffPct < 20 ? 'CHANGED' : 'VERY DIFFERENT';
          console.log(`  ${sp.label}: ${status} (size diff: ${diffPct.toFixed(1)}%)`);
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nTotal: ${totalIssues} issues | Time: ${elapsed}s`);

    const report = {
      workflow: 'audit-page',
      url,
      timestamp: new Date().toISOString(),
      screenshots: screenshotPaths.map(s => s.path),
      audits: auditResults,
      totalIssues,
      elapsed: `${elapsed}s`,
    };
    const reportPath = path.join(saveDir, 'audit-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`Full report: ${reportPath}`);

    return report;
  } finally {
    if (reused) { await page.close().catch(() => {}); browser.disconnect(); } else { await browser.close(); }
  }
}

// ─── Router ─────────────────────────────────────────────────────────────────

export async function handleWorkflow(args) {
  const action = args[0];
  const rest = args.slice(1);
  switch (action) {
    case 'audit-page': return workflowAuditPage(rest);
    case 'compare': return workflowCompare(rest);
    case 'monitor': return workflowMonitor(rest);
    default:
      console.error(`Unknown workflow: ${action || '(none)'}`);
      console.error('Available: audit-page, compare, monitor');
      process.exit(1);
  }
}

// Export for MCP server usage
export { workflowAuditPage, workflowCompare, workflowMonitor, AUDIT_MAP, parseBreakpoints, parseAudits, clickAndSettle };
