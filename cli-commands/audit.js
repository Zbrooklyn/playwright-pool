// cli-commands/audit.js — Audit command for playwright-pool CLI
//
// Handles:
//   audit <url...>           — run any combination of 27 audits
//   audit list               — print available audits by category
//   audit diff <fileA> <fileB> — pixel diff between two screenshots
//
// All audit logic is self-contained (ported from server.js / audit-tools-b.js).
// No imports from the MCP server.

import fs from 'fs';
import path from 'path';
import { parseArgs, getViewport, timestamp, ensureDir, launchStandalone, DEVICES } from './shared.js';

// ─── Audit Registry ──────────────────────────────────────────────────

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

// Map audit names to their handler functions
const AUDIT_HANDLERS = {
  meta: auditMeta,
  accessibility: auditAccessibility,
  color_contrast: auditColorContrast,
  breakpoints: auditBreakpoints,
  overflow: auditOverflow,
  image_sizes: auditImageSizes,
  tap_targets: auditTapTargets,
  core_web_vitals: auditCoreWebVitals,
  fonts: auditFonts,
  dark_mode: auditDarkMode,
  security_headers: auditSecurityHeaders,
  broken_links: auditBrokenLinks,
  lighthouse: auditLighthouse,
  focus_order: auditFocusOrder,
  interactive_states: auditStub,
  spacing_consistency: auditStub,
  z_index_map: auditStub,
  loading_states: auditStub,
  form_validation: auditStub,
  print_layout: auditStub,
  scroll_behavior: auditStub,
  element_overlap: auditStub,
  mixed_content: auditMixedContent,
  third_party_scripts: auditThirdPartyScripts,
  cookie_compliance: auditCookieCompliance,
  computed_styles: auditStub,
};

// ─── Entry Point ─────────────────────────────────────────────────────

export async function handleAudit(args) {
  const { flags, positional } = parseArgs(args);

  // Special: audit list
  if (positional[0] === 'list') {
    return printAuditList(flags.category);
  }

  // Special: audit diff <fileA> <fileB>
  if (positional[0] === 'diff') {
    return runDiff(positional[1], positional[2], flags);
  }

  // Collect URLs from positional args + --urls-file
  let urls = positional.filter(u => u.startsWith('http'));
  if (flags['urls-file']) {
    const filePath = flags['urls-file'];
    if (!fs.existsSync(filePath)) {
      console.error(`Error: URLs file not found: ${filePath}`);
      process.exit(1);
    }
    const lines = fs.readFileSync(filePath, 'utf8').split('\n')
      .map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    urls.push(...lines);
  }
  if (urls.length === 0) {
    console.error('Usage: playwright-pool audit <url> [url2 ...] [--only name,name] [--skip name] [--category seo]');
    console.error('       playwright-pool audit list');
    console.error('       playwright-pool audit diff <fileA> <fileB>');
    process.exit(1);
  }

  // Determine which audits to run
  let audits = [...ALL_AUDITS];
  if (flags.only) {
    audits = flags.only.split(',').map(s => s.trim());
  }
  if (flags.category) {
    const cats = flags.category.split(',').map(s => s.trim());
    audits = [];
    for (const cat of cats) {
      if (AUDIT_CATEGORIES[cat]) {
        audits.push(...AUDIT_CATEGORIES[cat]);
      } else {
        console.error(`Unknown category: ${cat}. Available: ${Object.keys(AUDIT_CATEGORIES).join(', ')}`);
        process.exit(1);
      }
    }
  }
  if (flags.skip) {
    const skip = new Set(flags.skip.split(',').map(s => s.trim()));
    audits = audits.filter(a => !skip.has(a));
  }

  // Validate audit names
  for (const a of audits) {
    if (!ALL_AUDITS.includes(a)) {
      console.error(`Unknown audit: "${a}". Run \`playwright-pool audit list\` for available audits.`);
      process.exit(1);
    }
  }

  // Output config
  const outputDir = flags.output || flags.save || null;
  const jsonMode = !!flags.json;
  const threshold = flags.threshold ? parseInt(flags.threshold, 10) : null;
  const failOn = flags['fail-on'] || null; // 'critical', 'serious', etc.

  // Launch browser
  const { browser, context, page } = await launchStandalone(flags);

  const allResults = {};
  let totalIssueCount = 0;
  let exitCode = 0;

  try {
    for (const url of urls) {
      console.error(`\n--- Auditing: ${url} ---`);

      // Navigate to URL
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Wait a bit for JS to settle
        await page.waitForTimeout(200);
      } catch (err) {
        console.error(`  Failed to navigate to ${url}: ${err.message}`);
        allResults[url] = { error: err.message };
        exitCode = 1;
        continue;
      }

      const urlResults = {};
      const urlSaveDir = outputDir
        ? path.resolve(outputDir, sanitizeDirName(url))
        : path.resolve('playwright-audit', timestamp(), sanitizeDirName(url));

      for (const auditName of audits) {
        const handler = AUDIT_HANDLERS[auditName];
        if (!handler) {
          urlResults[auditName] = { issues: [], text: `Unknown audit: ${auditName}` };
          continue;
        }

        try {
          console.error(`  Running: ${auditName}...`);
          const result = await handler(page, context, { savePath: urlSaveDir, flags });
          urlResults[auditName] = result;
          const issueCount = (result.issues || []).length;
          totalIssueCount += issueCount;
          if (issueCount > 0) {
            exitCode = 2;
          }
        } catch (err) {
          urlResults[auditName] = { issues: [], text: `Error: ${err.message}` };
          console.error(`    Error in ${auditName}: ${err.message}`);
        }
      }

      allResults[url] = urlResults;
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // ── Output ──

  if (jsonMode) {
    // JSON output to stdout
    const output = {};
    for (const [url, urlResults] of Object.entries(allResults)) {
      if (urlResults.error) {
        output[url] = { error: urlResults.error };
        continue;
      }
      output[url] = {};
      for (const [name, result] of Object.entries(urlResults)) {
        output[url][name] = {
          issues: result.issues || [],
          issueCount: (result.issues || []).length,
          text: result.text || '',
        };
      }
    }
    console.log(JSON.stringify(output, null, 2));
  } else {
    // Text output to stdout
    for (const [url, urlResults] of Object.entries(allResults)) {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`  ${url}`);
      console.log('='.repeat(70));

      if (urlResults.error) {
        console.log(`  ERROR: ${urlResults.error}`);
        continue;
      }

      for (const [name, result] of Object.entries(urlResults)) {
        console.log(`\n--- ${name} ---`);
        if (result.text) {
          console.log(result.text);
        }
        const issues = result.issues || [];
        if (issues.length > 0) {
          console.log(`  Issues: ${issues.length}`);
        }
      }
    }

    // Summary
    console.log(`\n${'='.repeat(70)}`);
    console.log(`SUMMARY: ${Object.keys(allResults).length} URL(s), ${audits.length} audit(s), ${totalIssueCount} issue(s) found`);
    if (totalIssueCount === 0) {
      console.log('Result: PASS');
    } else {
      console.log('Result: ISSUES FOUND');
    }
    console.log('='.repeat(70));
  }

  // Threshold / fail-on exit code logic
  if (threshold !== null && totalIssueCount >= threshold) {
    exitCode = 2;
  }

  if (failOn) {
    const severities = failOn.split(',').map(s => s.trim().toLowerCase());
    for (const urlResults of Object.values(allResults)) {
      if (urlResults.error) continue;
      for (const result of Object.values(urlResults)) {
        for (const issue of (result.issues || [])) {
          if (severities.includes((issue.severity || issue.impact || 'unknown').toLowerCase())) {
            exitCode = 2;
          }
        }
      }
    }
  }

  process.exit(exitCode);
}

// ─── Subcommands ─────────────────────────────────────────────────────

function printAuditList(filterCategory) {
  console.log('Available audits:\n');
  for (const [category, audits] of Object.entries(AUDIT_CATEGORIES)) {
    if (filterCategory && category !== filterCategory) continue;
    console.log(`  ${category.toUpperCase()}`);
    for (const a of audits) {
      const implemented = AUDIT_HANDLERS[a] && AUDIT_HANDLERS[a] !== auditStub;
      const marker = implemented ? '+' : '-';
      console.log(`    [${marker}] ${a}`);
    }
    console.log('');
  }
  console.log('Legend: [+] implemented  [-] stub');
  console.log(`\nTotal: ${ALL_AUDITS.length} audits across ${Object.keys(AUDIT_CATEGORIES).length} categories`);
}

async function runDiff(fileA, fileB, flags) {
  if (!fileA || !fileB) {
    console.error('Usage: playwright-pool audit diff <screenshotA.png> <screenshotB.png> [--threshold 1]');
    process.exit(1);
  }

  if (!fs.existsSync(fileA)) {
    console.error(`Error: File not found: ${fileA}`);
    process.exit(1);
  }
  if (!fs.existsSync(fileB)) {
    console.error(`Error: File not found: ${fileB}`);
    process.exit(1);
  }

  const diffThreshold = flags.threshold ? parseFloat(flags.threshold) : 1;

  // Launch a headless browser to use canvas for pixel comparison
  const { browser, page } = await launchStandalone({ ...flags, headed: false });

  try {
    const b64A = fs.readFileSync(fileA).toString('base64');
    const b64B = fs.readFileSync(fileB).toString('base64');

    // Navigate to a blank page so canvas works
    await page.goto('about:blank');

    const result = await page.evaluate(async ({ imgA, imgB }) => {
      function loadImage(b64) {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${b64}`;
        });
      }

      const [imageA, imageB] = await Promise.all([loadImage(imgA), loadImage(imgB)]);

      const w = Math.max(imageA.width, imageB.width);
      const h = Math.max(imageA.height, imageB.height);

      const canvasA = new OffscreenCanvas(w, h);
      const ctxA = canvasA.getContext('2d');
      ctxA.drawImage(imageA, 0, 0);
      const dataA = ctxA.getImageData(0, 0, w, h).data;

      const canvasB = new OffscreenCanvas(w, h);
      const ctxB = canvasB.getContext('2d');
      ctxB.drawImage(imageB, 0, 0);
      const dataB = ctxB.getImageData(0, 0, w, h).data;

      let diffPixels = 0;
      const totalPixels = w * h;
      let minX = w, maxX = 0, minY = h, maxY = 0;

      for (let i = 0; i < dataA.length; i += 4) {
        const dr = Math.abs(dataA[i] - dataB[i]);
        const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
        const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
        const da = Math.abs(dataA[i + 3] - dataB[i + 3]);
        if (dr > 2 || dg > 2 || db > 2 || da > 2) {
          diffPixels++;
          const px = (i / 4) % w;
          const py = Math.floor((i / 4) / w);
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }

      const pct = totalPixels > 0 ? (diffPixels / totalPixels) * 100 : 0;
      return {
        widthA: imageA.width, heightA: imageA.height,
        widthB: imageB.width, heightB: imageB.height,
        totalPixels, diffPixels,
        changedPct: Math.round(pct * 100) / 100,
        diffRegion: diffPixels > 0 ? { minX, minY, maxX, maxY } : null,
      };
    }, { imgA: b64A, imgB: b64B });

    const sizeMatch = result.widthA === result.widthB && result.heightA === result.heightB;
    const verdict = result.changedPct >= diffThreshold ? 'DIFFERENT' : 'SAME (within threshold)';

    if (flags.json) {
      console.log(JSON.stringify({ ...result, threshold: diffThreshold, verdict, sizeMatch }, null, 2));
    } else {
      console.log(`Visual Diff Result`);
      console.log(`  Image A: ${result.widthA}x${result.heightA} (${fileA})`);
      console.log(`  Image B: ${result.widthB}x${result.heightB} (${fileB})`);
      console.log(`  Size match: ${sizeMatch ? 'Yes' : 'NO'}`);
      console.log(`  Total pixels: ${result.totalPixels.toLocaleString()}`);
      console.log(`  Changed pixels: ${result.diffPixels.toLocaleString()}`);
      console.log(`  Changed %: ${result.changedPct}%`);
      console.log(`  Threshold: ${diffThreshold}%`);
      console.log(`  Verdict: ${verdict}`);
      if (result.diffRegion) {
        const r = result.diffRegion;
        console.log(`  Diff region: (${r.minX},${r.minY}) to (${r.maxX},${r.maxY}) — ${r.maxX - r.minX + 1}x${r.maxY - r.minY + 1}px`);
      }
    }

    process.exit(result.changedPct >= diffThreshold ? 2 : 0);
  } finally {
    await browser.close().catch(() => {});
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function sanitizeDirName(url) {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).replace(/[^a-zA-Z0-9.-]/g, '_').replace(/_+/g, '_').slice(0, 60);
  } catch {
    return 'unknown';
  }
}

// ─── Stub for unimplemented audits ───────────────────────────────────

async function auditStub(page, _context, _opts) {
  return { issues: [], text: 'Not yet implemented in CLI mode.' };
}

// ─── 1. audit_meta ──────────────────────────────────────────────────

async function auditMeta(page, _context, _opts) {
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
    metas.forEach(m => {
      const name = (m.getAttribute('name') || '').toLowerCase();
      const property = (m.getAttribute('property') || '').toLowerCase();
      const content = m.getAttribute('content') || '';

      if (name === 'description') result.description = content;
      if (name === 'robots') result.robots = content;
      if (name === 'viewport') result.viewport = content;
      if (m.getAttribute('charset')) result.charset = m.getAttribute('charset');
      if (m.httpEquiv && m.httpEquiv.toLowerCase() === 'content-type') {
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
      headings.forEach(h => {
        result.headings[`h${i}`].push((h.textContent || '').trim().slice(0, 100));
      });
    }

    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    jsonLdScripts.forEach(script => {
      try {
        const data = JSON.parse(script.textContent);
        result.structuredData.push(data['@type'] || 'Unknown');
      } catch { /* skip */ }
    });

    // Issue checks
    if (!result.title) result.issues.push({ id: 'title-missing', severity: 'critical', msg: 'Missing <title>' });
    else if (result.title.length < 10) result.issues.push({ id: 'title-short', severity: 'moderate', msg: `Title too short (${result.title.length} chars)` });
    else if (result.title.length > 60) result.issues.push({ id: 'title-long', severity: 'moderate', msg: `Title too long (${result.title.length} chars)` });

    if (!result.description) result.issues.push({ id: 'desc-missing', severity: 'critical', msg: 'Missing meta description' });
    else if (result.description.length < 50) result.issues.push({ id: 'desc-short', severity: 'moderate', msg: `Description too short (${result.description.length} chars)` });
    else if (result.description.length > 160) result.issues.push({ id: 'desc-long', severity: 'moderate', msg: `Description too long (${result.description.length} chars)` });

    if (!result.viewport) result.issues.push({ id: 'viewport-missing', severity: 'critical', msg: 'Missing viewport meta' });
    if (!result.canonical) result.issues.push({ id: 'canonical-missing', severity: 'moderate', msg: 'No canonical URL' });

    const h1Count = result.headings.h1.length;
    if (h1Count === 0) result.issues.push({ id: 'h1-missing', severity: 'critical', msg: 'No <h1> on page' });
    else if (h1Count > 1) result.issues.push({ id: 'h1-multiple', severity: 'moderate', msg: `Multiple <h1> tags (${h1Count})` });

    if (!result.ogTags['og:title']) result.issues.push({ id: 'og-title-missing', severity: 'minor', msg: 'Missing og:title' });
    if (!result.ogTags['og:description']) result.issues.push({ id: 'og-desc-missing', severity: 'minor', msg: 'Missing og:description' });
    if (!result.ogTags['og:image']) result.issues.push({ id: 'og-image-missing', severity: 'minor', msg: 'Missing og:image' });

    return result;
  });

  const lines = [
    `SEO Metadata Audit`,
    `URL: ${meta.url}`,
    '',
    `--- BASIC ---`,
    `Title: ${meta.title || '(missing)'}${meta.title ? ` (${meta.title.length} chars)` : ''}`,
    `Description: ${meta.description ? meta.description.slice(0, 100) : '(missing)'}${meta.description ? ` (${meta.description.length} chars)` : ''}`,
    `Canonical: ${meta.canonical || '(not set)'}`,
    `Robots: ${meta.robots || '(not set)'}`,
    `Viewport: ${meta.viewport || '(missing)'}`,
    `Charset: ${meta.charset || '(not set)'}`,
    '',
    '--- OPEN GRAPH ---',
  ];

  const ogEntries = Object.entries(meta.ogTags);
  if (ogEntries.length > 0) {
    for (const [k, v] of ogEntries) lines.push(`  ${k}: ${v}`);
  } else {
    lines.push('  (none)');
  }

  lines.push('', '--- HEADING HIERARCHY ---');
  for (let i = 1; i <= 6; i++) {
    const key = `h${i}`;
    for (const text of meta.headings[key]) {
      lines.push(`  ${'  '.repeat(i - 1)}H${i}: ${text}`);
    }
  }

  if (meta.structuredData.length > 0) {
    lines.push('', '--- STRUCTURED DATA (JSON-LD) ---');
    for (const t of meta.structuredData) lines.push(`  @type: ${t}`);
  }

  lines.push('', '--- AUDIT RESULTS ---');
  for (const issue of meta.issues) {
    const prefix = issue.severity === 'critical' ? 'FAIL' : issue.severity === 'moderate' ? 'WARN' : 'INFO';
    lines.push(`  ${prefix}: ${issue.msg}`);
  }

  return { issues: meta.issues, text: lines.join('\n') };
}

// ─── 2. audit_accessibility ──────────────────────────────────────────

async function auditAccessibility(page, _context, _opts) {
  const results = await page.evaluate(() => {
    const violations = [];

    function isVisible(el) {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
        && el.offsetWidth > 0 && el.offsetHeight > 0;
    }

    // 1. Images without alt text
    document.querySelectorAll('img').forEach(img => {
      if (!img.hasAttribute('alt')) {
        violations.push({
          id: 'image-alt', impact: 'critical',
          description: 'Images must have alternate text',
          target: img.tagName + (img.id ? '#' + img.id : ''),
        });
      }
    });

    // 2. Form inputs without labels
    document.querySelectorAll('input, select, textarea').forEach(input => {
      if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button') return;
      const hasLabel = input.id && document.querySelector(`label[for="${input.id}"]`);
      const hasAriaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
      const wrappedInLabel = input.closest('label');
      const hasTitle = input.getAttribute('title');
      if (!hasLabel && !hasAriaLabel && !wrappedInLabel && !hasTitle) {
        violations.push({
          id: 'label', impact: 'critical',
          description: 'Form elements must have labels',
          target: input.tagName + '[' + (input.type || 'text') + ']',
        });
      }
    });

    // 3. Empty links
    document.querySelectorAll('a[href]').forEach(link => {
      if (!isVisible(link)) return;
      const text = (link.textContent || '').trim();
      const ariaLabel = link.getAttribute('aria-label') || '';
      const img = link.querySelector('img[alt]');
      if (!text && !ariaLabel && !img) {
        violations.push({
          id: 'link-name', impact: 'serious',
          description: 'Links must have discernible text',
          target: 'a[href="' + (link.getAttribute('href') || '').slice(0, 40) + '"]',
        });
      }
    });

    // 4. Empty buttons
    document.querySelectorAll('button, [role="button"]').forEach(btn => {
      if (!isVisible(btn)) return;
      const text = (btn.textContent || '').trim();
      const ariaLabel = btn.getAttribute('aria-label') || '';
      const img = btn.querySelector('img[alt]');
      if (!text && !ariaLabel && !img) {
        violations.push({
          id: 'button-name', impact: 'critical',
          description: 'Buttons must have discernible text',
          target: btn.tagName,
        });
      }
    });

    // 5. Document language
    if (!document.documentElement.getAttribute('lang')) {
      violations.push({
        id: 'html-has-lang', impact: 'serious',
        description: 'HTML element must have a lang attribute',
        target: 'html',
      });
    }

    // 6. Page title
    if (!document.title || !document.title.trim()) {
      violations.push({
        id: 'document-title', impact: 'serious',
        description: 'Document must have a <title> element',
        target: 'head',
      });
    }

    // 7. Heading order
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let prevLevel = 0;
    headings.forEach(h => {
      const level = parseInt(h.tagName[1]);
      if (prevLevel > 0 && level > prevLevel + 1) {
        violations.push({
          id: 'heading-order', impact: 'moderate',
          description: `Heading levels should increase by one: found h${level} after h${prevLevel}`,
          target: h.tagName,
        });
      }
      prevLevel = level;
    });

    // 8. Invalid ARIA roles
    const validRoles = new Set(['alert', 'alertdialog', 'application', 'article', 'banner', 'button',
      'cell', 'checkbox', 'columnheader', 'combobox', 'complementary', 'contentinfo', 'definition',
      'dialog', 'directory', 'document', 'feed', 'figure', 'form', 'grid', 'gridcell', 'group',
      'heading', 'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'marquee', 'math',
      'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation', 'none', 'note',
      'option', 'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup',
      'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status',
      'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox', 'timer', 'toolbar',
      'tooltip', 'tree', 'treegrid', 'treeitem']);

    document.querySelectorAll('[role]').forEach(el => {
      const role = el.getAttribute('role');
      if (role && !validRoles.has(role)) {
        violations.push({
          id: 'aria-roles', impact: 'serious',
          description: `Invalid ARIA role: "${role}"`,
          target: el.tagName + '[role=' + role + ']',
        });
      }
    });

    // 9. Tabindex > 0
    document.querySelectorAll('[tabindex]').forEach(el => {
      const val = parseInt(el.getAttribute('tabindex'));
      if (val > 0) {
        violations.push({
          id: 'tabindex', impact: 'serious',
          description: 'Elements should not have tabindex > 0',
          target: el.tagName + '[tabindex=' + val + ']',
        });
      }
    });

    // Deduplicate by id (group)
    const grouped = {};
    violations.forEach(v => {
      if (!grouped[v.id]) {
        grouped[v.id] = { ...v, count: 0 };
      }
      grouped[v.id].count++;
    });

    return Object.values(grouped);
  });

  // Format as issues
  const issues = results.map(v => ({
    id: v.id,
    severity: v.impact,
    msg: `${v.description} (${v.count} instance${v.count > 1 ? 's' : ''})`,
    target: v.target,
  }));

  const bySeverity = { critical: [], serious: [], moderate: [], minor: [] };
  for (const v of results) {
    const sev = v.impact || 'moderate';
    if (bySeverity[sev]) bySeverity[sev].push(v);
  }

  const totalViolations = results.reduce((sum, v) => sum + v.count, 0);
  const lines = [
    `Accessibility Audit (WCAG2AA)`,
    `URL: ${await page.url()}`,
    `Total violations: ${totalViolations} across ${results.length} rules`,
    `  Critical: ${bySeverity.critical.reduce((s, v) => s + v.count, 0)}`,
    `  Serious: ${bySeverity.serious.reduce((s, v) => s + v.count, 0)}`,
    `  Moderate: ${bySeverity.moderate.reduce((s, v) => s + v.count, 0)}`,
    `  Minor: ${bySeverity.minor.reduce((s, v) => s + v.count, 0)}`,
    '',
  ];

  for (const [severity, violations] of Object.entries(bySeverity)) {
    if (violations.length === 0) continue;
    lines.push(`--- ${severity.toUpperCase()} ---`);
    for (const v of violations) {
      lines.push(`[${v.id}] ${v.description} (${v.count}x)`);
      lines.push(`  Target: ${v.target}`);
      lines.push('');
    }
  }

  return { issues, text: lines.join('\n') };
}

// ─── 3. audit_color_contrast ─────────────────────────────────────────

async function auditColorContrast(page, _context, _opts) {
  const results = await page.evaluate(() => {
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
      return fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    }

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
      return { r: 255, g: 255, b: 255 };
    }

    const textElements = document.querySelectorAll('p, span, a, h1, h2, h3, h4, h5, h6, li, td, th, label, button, div, strong, em, b, i, small');
    const r = { pass: 0, fail: 0, failures: [] };
    const checked = new Set();

    textElements.forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
      if (el.offsetWidth === 0 || el.offsetHeight === 0) return;

      const hasDirectText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
      if (!hasDirectText) return;

      const key = el.tagName + '|' + (el.textContent || '').slice(0, 30);
      if (checked.has(key)) return;
      checked.add(key);

      const fgParsed = parseColor(style.color);
      const bgParsed = getEffectiveBackground(el);
      if (!fgParsed || !bgParsed) return;

      const fgLum = getLuminance(fgParsed.r, fgParsed.g, fgParsed.b);
      const bgLum = getLuminance(bgParsed.r, bgParsed.g, bgParsed.b);
      const ratio = contrastRatio(fgLum, bgLum);
      const large = isLargeText(el);
      const required = large ? 3 : 4.5;

      if (ratio >= required) {
        r.pass++;
      } else {
        r.fail++;
        if (r.failures.length < 50) {
          r.failures.push({
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

    return r;
  });

  const issues = results.failures.map(f => ({
    id: 'color-contrast',
    severity: 'serious',
    msg: `"${f.text}" — ratio ${f.ratio}:1 (required ${f.required}:1)`,
    selector: f.selector,
  }));

  const lines = [
    `Color Contrast Audit (WCAG AA)`,
    `URL: ${await page.url()}`,
    `Pass: ${results.pass} | Fail: ${results.fail}`,
    '',
  ];

  if (results.failures.length > 0) {
    lines.push('--- FAILING ELEMENTS ---');
    for (const f of results.failures) {
      lines.push(`[${f.selector}] "${f.text}"`);
      lines.push(`  FG: ${f.foreground} | BG: ${f.background}`);
      lines.push(`  Ratio: ${f.ratio}:1 (required: ${f.required}:1) | Large: ${f.large} | Size: ${f.fontSize} Weight: ${f.fontWeight}`);
      lines.push('');
    }
    if (results.fail > results.failures.length) {
      lines.push(`... and ${results.fail - results.failures.length} more failures (showing first 50)`);
    }
  }

  return { issues, text: lines.join('\n') };
}

// ─── 4. audit_breakpoints ────────────────────────────────────────────

async function auditBreakpoints(page, _context, opts) {
  const breakpoints = [
    { label: 'desktop', width: 1280, height: 800 },
    { label: 'tablet', width: 768, height: 1024 },
    { label: 'mobile', width: 375, height: 812 },
  ];

  const originalViewport = page.viewportSize();
  const savePath = opts.savePath;
  const lines = [`Breakpoints Audit`, `URL: ${await page.url()}`, ''];

  for (const bp of breakpoints) {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    await page.waitForTimeout(300);

    const buffer = await page.screenshot({ fullPage: true });

    if (savePath) {
      ensureDir(savePath);
      const filename = `breakpoint-${bp.label}-${bp.width}x${bp.height}.png`;
      const filePath = path.join(savePath, filename);
      fs.writeFileSync(filePath, buffer);
      lines.push(`${bp.label} (${bp.width}x${bp.height}) saved to: ${filePath}`);
    } else {
      lines.push(`${bp.label} (${bp.width}x${bp.height}) — screenshot captured (${buffer.length} bytes)`);
    }
  }

  // Restore original viewport
  if (originalViewport) {
    await page.setViewportSize(originalViewport);
  }

  return { issues: [], text: lines.join('\n') };
}

// ─── 5. audit_overflow ───────────────────────────────────────────────

async function auditOverflow(page, _context, _opts) {
  const breakpoints = [
    { label: 'desktop', width: 1280, height: 800 },
    { label: 'tablet', width: 768, height: 1024 },
    { label: 'mobile', width: 375, height: 812 },
  ];

  const originalViewport = page.viewportSize();
  const overflowResults = [];

  for (const bp of breakpoints) {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    await page.waitForTimeout(300);

    const data = await page.evaluate(() => {
      const viewportWidth = window.innerWidth;
      const docWidth = document.documentElement.scrollWidth;
      const hasOverflow = docWidth > viewportWidth;
      const offenders = [];

      if (hasOverflow) {
        document.querySelectorAll('*').forEach(el => {
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
        offenders.sort((a, b) => b.overflow - a.overflow);
      }

      return { viewportWidth, documentWidth: docWidth, hasOverflow, overflowAmount: docWidth - viewportWidth, offenders: offenders.slice(0, 30) };
    });

    overflowResults.push({ label: bp.label, width: bp.width, ...data });
  }

  if (originalViewport) {
    await page.setViewportSize(originalViewport);
  }

  const issues = overflowResults
    .filter(r => r.hasOverflow)
    .map(r => ({
      id: 'overflow',
      severity: 'serious',
      msg: `${r.label} (${r.width}px): document overflows by ${r.overflowAmount}px`,
    }));

  const lines = [`Overflow Detection`, `URL: ${await page.url()}`, ''];
  for (const r of overflowResults) {
    const status = r.hasOverflow ? 'OVERFLOW' : 'OK';
    lines.push(`[${status}] ${r.label} (${r.width}px) — document: ${r.documentWidth}px${r.hasOverflow ? ` (+${r.overflowAmount}px)` : ''}`);
    if (r.offenders.length > 0) {
      lines.push('  Offending elements:');
      for (const o of r.offenders.slice(0, 10)) {
        lines.push(`    ${o.selector} — width: ${o.width}px, extends ${o.overflow}px past viewport`);
      }
    }
    lines.push('');
  }

  return { issues, text: lines.join('\n') };
}

// ─── 6. audit_image_sizes ────────────────────────────────────────────

async function auditImageSizes(page, _context, _opts) {
  const results = await page.evaluate(() => {
    const images = document.querySelectorAll('img');
    const issues = { missingAlt: [], oversized: [], broken: [], notLazy: [] };
    const summary = { total: images.length, missingAlt: 0, oversized: 0, broken: 0, notLazy: 0 };

    images.forEach(img => {
      const src = img.src || img.getAttribute('data-src') || '(none)';
      const shortSrc = src.length > 80 ? src.slice(0, 77) + '...' : src;

      if (!img.hasAttribute('alt')) {
        summary.missingAlt++;
        issues.missingAlt.push({ src: shortSrc });
      }

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

      if (!img.complete || img.naturalWidth === 0) {
        if (!img.getAttribute('loading') || img.getAttribute('loading') !== 'lazy') {
          summary.broken++;
          issues.broken.push({ src: shortSrc });
        }
      }

      const rect = img.getBoundingClientRect();
      if (rect.top > window.innerHeight && img.getAttribute('loading') !== 'lazy') {
        summary.notLazy++;
        issues.notLazy.push({ src: shortSrc, distanceBelowFold: Math.round(rect.top - window.innerHeight) });
      }
    });

    return { summary, issues };
  });

  const issueList = [];
  if (results.summary.missingAlt > 0) issueList.push({ id: 'img-alt', severity: 'critical', msg: `${results.summary.missingAlt} image(s) missing alt` });
  if (results.summary.oversized > 0) issueList.push({ id: 'img-oversized', severity: 'moderate', msg: `${results.summary.oversized} image(s) oversized (>2x)` });
  if (results.summary.broken > 0) issueList.push({ id: 'img-broken', severity: 'serious', msg: `${results.summary.broken} image(s) broken` });
  if (results.summary.notLazy > 0) issueList.push({ id: 'img-lazy', severity: 'moderate', msg: `${results.summary.notLazy} below-fold image(s) without lazy loading` });

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
    for (const i of results.issues.missingAlt.slice(0, 20)) lines.push(`  ${i.src}`);
    lines.push('');
  }
  if (results.issues.oversized.length > 0) {
    lines.push('--- OVERSIZED ---');
    for (const i of results.issues.oversized.slice(0, 20)) lines.push(`  ${i.src} — natural: ${i.natural}, rendered: ${i.rendered} (${i.ratio}x)`);
    lines.push('');
  }
  if (results.issues.broken.length > 0) {
    lines.push('--- BROKEN ---');
    for (const i of results.issues.broken.slice(0, 20)) lines.push(`  ${i.src}`);
    lines.push('');
  }
  if (results.issues.notLazy.length > 0) {
    lines.push('--- BELOW FOLD WITHOUT LAZY ---');
    for (const i of results.issues.notLazy.slice(0, 20)) lines.push(`  ${i.src} — ${i.distanceBelowFold}px below fold`);
    lines.push('');
  }

  return { issues: issueList, text: lines.join('\n') };
}

// ─── 7. audit_tap_targets ────────────────────────────────────────────

async function auditTapTargets(page, _context, _opts) {
  const minSize = 48;

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

    return { pass: pass.length, fail: fail.length, failures: fail.slice(0, 50) };
  }, minSize);

  const issues = results.failures.map(f => ({
    id: 'tap-target',
    severity: 'moderate',
    msg: `[${f.selector}] "${f.text}" — ${f.width}x${f.height}px (min ${minSize}x${minSize})`,
  }));

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
  }

  return { issues, text: lines.join('\n') };
}

// ─── 8. audit_core_web_vitals ────────────────────────────────────────

async function auditCoreWebVitals(page, _context, _opts) {
  const metrics = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const results = { lcp: null, cls: 0 };
      let clsEntries = [];

      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length > 0) results.lcp = entries[entries.length - 1].startTime;
      });
      try { lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true }); } catch { /* skip */ }

      const clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) clsEntries.push(entry);
        }
      });
      try { clsObserver.observe({ type: 'layout-shift', buffered: true }); } catch { /* skip */ }

      const paintEntries = performance.getEntriesByType('paint');
      const fcp = paintEntries.find(e => e.name === 'first-contentful-paint');

      setTimeout(() => {
        lcpObserver.disconnect();
        clsObserver.disconnect();

        // CLS session windows
        let maxSessionValue = 0;
        let currentSessionValue = 0;
        let previousEnd = 0;
        for (const entry of clsEntries) {
          if (entry.startTime - previousEnd > 1000 || entry.startTime - previousEnd < 0) {
            currentSessionValue = entry.value;
          } else {
            currentSessionValue += entry.value;
          }
          if (currentSessionValue > maxSessionValue) maxSessionValue = currentSessionValue;
          previousEnd = entry.startTime;
        }
        results.cls = Math.round(maxSessionValue * 10000) / 10000;

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

  const issues = [];
  if (metrics.lcp !== null && metrics.lcp > 4000) issues.push({ id: 'lcp-poor', severity: 'critical', msg: `LCP: ${metrics.lcp}ms (poor, target <2500ms)` });
  else if (metrics.lcp !== null && metrics.lcp > 2500) issues.push({ id: 'lcp-slow', severity: 'moderate', msg: `LCP: ${metrics.lcp}ms (needs improvement, target <2500ms)` });

  if (metrics.cls > 0.25) issues.push({ id: 'cls-poor', severity: 'critical', msg: `CLS: ${metrics.cls} (poor, target <0.1)` });
  else if (metrics.cls > 0.1) issues.push({ id: 'cls-slow', severity: 'moderate', msg: `CLS: ${metrics.cls} (needs improvement, target <0.1)` });

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

  return { issues, text: lines.join('\n') };
}

// ─── 9. audit_fonts ──────────────────────────────────────────────────

async function auditFonts(page, _context, _opts) {
  const results = await page.evaluate(() => {
    const elements = document.querySelectorAll('*');
    const combinations = new Map();
    const families = new Set();

    elements.forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) return;

      const family = style.fontFamily;
      const size = style.fontSize;
      const weight = style.fontWeight;
      const lineHeight = style.lineHeight;

      families.add(family);

      const key = `${family}|${size}|${weight}|${lineHeight}`;
      if (!combinations.has(key)) {
        combinations.set(key, { family, size, weight, lineHeight, count: 0, sampleElements: [] });
      }
      const entry = combinations.get(key);
      entry.count++;
      if (entry.sampleElements.length < 3) {
        entry.sampleElements.push({ tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 40) });
      }
    });

    const loadedFonts = [];
    try {
      document.fonts.forEach(font => {
        loadedFonts.push({ family: font.family, weight: font.weight, style: font.style, status: font.status });
      });
    } catch { /* skip */ }

    const sorted = [...combinations.values()].sort((a, b) => b.count - a.count);

    return {
      uniqueFamilies: [...families],
      totalCombinations: sorted.length,
      combinations: sorted.slice(0, 40),
      loadedFonts: loadedFonts.slice(0, 30),
    };
  });

  const issues = [];
  if (results.uniqueFamilies.length > 4) {
    issues.push({ id: 'font-families', severity: 'moderate', msg: `${results.uniqueFamilies.length} font families — consider consolidating` });
  }
  if (results.totalCombinations > 15) {
    issues.push({ id: 'font-combos', severity: 'moderate', msg: `${results.totalCombinations} unique font style combinations — consider a more consistent type scale` });
  }

  const lines = [
    `Font Audit`,
    `URL: ${await page.url()}`,
    `Unique font families: ${results.uniqueFamilies.length}`,
    `Unique style combinations: ${results.totalCombinations}`,
    '',
    '--- FONT FAMILIES ---',
  ];
  for (const f of results.uniqueFamilies) lines.push(`  ${f}`);
  lines.push('');

  if (results.loadedFonts.length > 0) {
    lines.push('--- LOADED WEB FONTS ---');
    for (const f of results.loadedFonts) lines.push(`  ${f.family} (${f.weight} ${f.style}) — ${f.status}`);
    lines.push('');
  }

  lines.push('--- STYLE COMBINATIONS (by frequency) ---');
  for (const c of results.combinations.slice(0, 20)) {
    lines.push(`  ${c.family} | ${c.size} | weight: ${c.weight} | line-height: ${c.lineHeight} — used ${c.count}x`);
  }

  lines.push('', '--- CONSISTENCY NOTES ---');
  if (results.uniqueFamilies.length > 4) lines.push(`  WARNING: ${results.uniqueFamilies.length} font families detected.`);
  if (results.totalCombinations > 15) lines.push(`  WARNING: ${results.totalCombinations} unique style combos.`);
  if (results.uniqueFamilies.length <= 4 && results.totalCombinations <= 15) lines.push(`  Font usage looks consistent.`);

  return { issues, text: lines.join('\n') };
}

// ─── 10. audit_dark_mode ─────────────────────────────────────────────

async function auditDarkMode(page, _context, opts) {
  const savePath = opts.savePath;

  // Light mode
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(500);
  const lightBuffer = await page.screenshot({ fullPage: true });

  // Dark mode
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(500);
  const darkBuffer = await page.screenshot({ fullPage: true });

  // Reset
  await page.emulateMedia({ colorScheme: 'no-preference' });

  const lines = [
    `Dark Mode Audit`,
    `URL: ${await page.url()}`,
    '',
  ];

  if (savePath) {
    ensureDir(savePath);
    const lightPath = path.join(savePath, 'dark-mode-light.png');
    const darkPath = path.join(savePath, 'dark-mode-dark.png');
    fs.writeFileSync(lightPath, lightBuffer);
    fs.writeFileSync(darkPath, darkBuffer);
    lines.push(`Light mode screenshot: ${lightPath}`);
    lines.push(`Dark mode screenshot: ${darkPath}`);
  } else {
    lines.push(`Light mode: captured (${lightBuffer.length} bytes)`);
    lines.push(`Dark mode: captured (${darkBuffer.length} bytes)`);
  }

  // Compare — if screenshots are identical, dark mode may not be implemented
  const identical = lightBuffer.length === darkBuffer.length && lightBuffer.equals(darkBuffer);
  if (identical) {
    lines.push('');
    lines.push('WARNING: Light and dark mode screenshots are identical. Dark mode may not be implemented.');
  } else {
    lines.push('');
    lines.push('Light and dark mode produce different renders.');
  }

  const issues = identical
    ? [{ id: 'dark-mode-missing', severity: 'moderate', msg: 'Dark mode may not be implemented (identical screenshots)' }]
    : [];

  return { issues, text: lines.join('\n') };
}

// ─── 11. audit_security_headers ──────────────────────────────────────

async function auditSecurityHeaders(page, _context, _opts) {
  const url = page.url();

  let headers = {};
  try {
    const response = await page.request.get(url, { timeout: 10000 });
    const allHeaders = await response.headers();
    for (const [k, v] of Object.entries(allHeaders)) {
      headers[k.toLowerCase()] = v;
    }
  } catch {
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      if (response) {
        const allHeaders = await response.allHeaders();
        for (const [k, v] of Object.entries(allHeaders)) {
          headers[k.toLowerCase()] = v;
        }
      }
    } catch {
      return { issues: [], text: `Error: Could not fetch headers for ${url}` };
    }
  }

  const SECURITY_HEADERS = [
    { name: 'content-security-policy', display: 'Content-Security-Policy', recommendation: "default-src 'self'; script-src 'self'" },
    { name: 'strict-transport-security', display: 'Strict-Transport-Security', recommendation: 'max-age=31536000; includeSubDomains' },
    { name: 'x-content-type-options', display: 'X-Content-Type-Options', recommendation: 'nosniff' },
    { name: 'x-frame-options', display: 'X-Frame-Options', recommendation: 'DENY or SAMEORIGIN' },
    { name: 'referrer-policy', display: 'Referrer-Policy', recommendation: 'strict-origin-when-cross-origin' },
    { name: 'permissions-policy', display: 'Permissions-Policy', recommendation: 'camera=(), microphone=(), geolocation=()' },
    { name: 'x-xss-protection', display: 'X-XSS-Protection', recommendation: '0 (or 1; mode=block)' },
  ];

  const issues = [];
  let presentCount = 0;
  let missingCount = 0;

  const lines = [
    `Security Headers Audit`,
    `URL: ${url}`,
    `Protocol: ${url.startsWith('https://') ? 'HTTPS' : 'HTTP (not secure)'}`,
    '',
  ];

  for (const header of SECURITY_HEADERS) {
    const value = headers[header.name];
    if (!value) {
      missingCount++;
      issues.push({ id: `header-${header.name}`, severity: 'moderate', msg: `Missing ${header.display}` });
      lines.push(`  MISSING: ${header.display} — add: ${header.recommendation}`);
    } else {
      presentCount++;
      lines.push(`  OK: ${header.display}: ${value.slice(0, 80)}`);
    }
  }

  lines.unshift('');
  lines.unshift(`Present: ${presentCount}/${SECURITY_HEADERS.length} | Missing: ${missingCount}`);

  return { issues, text: lines.join('\n') };
}

// ─── 12. audit_broken_links ──────────────────────────────────────────

async function auditBrokenLinks(page, _context, _opts) {
  const linkData = await page.evaluate(() => {
    const pageOrigin = window.location.origin;
    const pageUrl = window.location.href;
    const results = [];

    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      const text = (a.textContent || '').trim().slice(0, 50);

      if (!href || href === '#') { results.push({ type: 'link', href: href || '', text, status: 'empty' }); continue; }
      if (href.startsWith('javascript:')) { results.push({ type: 'link', href, text, status: 'javascript-href' }); continue; }
      if (href.startsWith('mailto:') || href.startsWith('tel:')) { results.push({ type: 'link', href, text, status: 'skip-protocol' }); continue; }

      if (href.startsWith('#') && href.length > 1) {
        const target = document.getElementById(href.slice(1));
        results.push({ type: 'link', href, text, status: target ? 'ok-anchor' : 'dead-anchor' });
        continue;
      }

      let resolvedUrl = '';
      try { resolvedUrl = new URL(href, pageUrl).href; } catch { results.push({ type: 'link', href, text, status: 'invalid-url' }); continue; }
      const isExternal = !resolvedUrl.startsWith(pageOrigin);
      results.push({ type: 'link', href, text, status: 'check', resolvedUrl, isExternal });
    }

    for (const img of document.querySelectorAll('img[src]')) {
      const src = img.getAttribute('src');
      const alt = img.getAttribute('alt') || '';
      if (!src) { results.push({ type: 'image', href: '', text: alt, status: 'empty-src' }); continue; }
      if (src.startsWith('data:')) { continue; }
      let resolvedUrl = '';
      try { resolvedUrl = new URL(src, pageUrl).href; } catch { results.push({ type: 'image', href: src, text: alt, status: 'invalid-url' }); continue; }
      const isExternal = !resolvedUrl.startsWith(pageOrigin);
      results.push({ type: 'image', href: src, text: alt, status: 'check', resolvedUrl, isExternal });
    }

    return results;
  });

  // Check internal URLs only (no external by default for speed)
  const toCheck = linkData.filter(l => l.status === 'check' && !l.isExternal);

  for (const link of toCheck) {
    try {
      const response = await page.request.head(link.resolvedUrl, { timeout: 5000 });
      link.status = response.status() >= 400 ? `${response.status()}` : 'ok';
    } catch {
      try {
        const response = await page.request.get(link.resolvedUrl, { timeout: 5000 });
        link.status = response.status() >= 400 ? `${response.status()}` : 'ok';
      } catch {
        link.status = 'error-network';
      }
    }
  }

  // Mark unchecked external links
  for (const link of linkData.filter(l => l.status === 'check' && l.isExternal)) {
    link.status = 'skipped-external';
  }

  const broken = linkData.filter(l =>
    ['empty', 'dead-anchor', 'invalid-url', 'empty-src', 'error-network'].includes(l.status) ||
    (l.status.match(/^\d+$/) && parseInt(l.status) >= 400)
  );

  const issues = broken.map(b => ({
    id: 'broken-link',
    severity: b.status === 'dead-anchor' ? 'moderate' : 'serious',
    msg: `[${b.type}] ${b.status}: ${b.href.slice(0, 60)} "${b.text}"`,
  }));

  const lines = [
    `Broken Links Audit`,
    `URL: ${await page.url()}`,
    `Total links/images: ${linkData.length}`,
    `Checked (internal): ${toCheck.length}`,
    `Broken/problematic: ${broken.length}`,
    '',
  ];

  if (broken.length > 0) {
    lines.push('--- BROKEN/PROBLEMATIC ---');
    for (const b of broken) {
      lines.push(`  [${b.type}] ${b.status} — ${b.href.slice(0, 60)} "${b.text}"`);
    }
  }

  const jsHrefs = linkData.filter(l => l.status === 'javascript-href');
  if (jsHrefs.length > 0) {
    lines.push('', `--- javascript: hrefs (${jsHrefs.length}) ---`);
    for (const j of jsHrefs.slice(0, 10)) {
      lines.push(`  ${j.href.slice(0, 60)} — "${j.text}"`);
    }
  }

  return { issues, text: lines.join('\n') };
}

// ─── 13. audit_focus_order ───────────────────────────────────────────

async function auditFocusOrder(page, _context, _opts) {
  const maxElements = 50;

  // Reset focus
  await page.evaluate(() => {
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
  });

  const elements = [];

  for (let i = 0; i < maxElements; i++) {
    await page.keyboard.press('Tab');

    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;

      const tag = el.tagName.toLowerCase();
      const rect = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);

      const outlineWidth = parseFloat(cs.outlineWidth) || 0;
      const hasOutline = outlineWidth > 0 && cs.outlineStyle !== 'none';
      const hasBoxShadow = cs.boxShadow && cs.boxShadow !== 'none';
      const hasVisibleFocus = hasOutline || hasBoxShadow;

      let selector = tag;
      if (el.id) selector += `#${el.id}`;
      else if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (cls) selector += `.${cls}`;
      }

      return {
        selector,
        tag,
        text: (el.textContent || '').trim().slice(0, 60),
        tabIndex: el.tabIndex,
        hasVisibleFocus,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y) },
      };
    });

    if (!info) break;

    const fingerprint = `${info.selector}@${info.rect.x},${info.rect.y}`;
    if (elements.length > 0 && elements[0]._fingerprint === fingerprint) break;

    info._fingerprint = fingerprint;
    elements.push(info);
  }

  const missingFocus = elements.filter(e => !e.hasVisibleFocus);

  const issues = missingFocus.map(e => ({
    id: 'focus-indicator',
    severity: 'serious',
    msg: `No visible focus indicator: ${e.selector} "${e.text.slice(0, 30)}"`,
  }));

  const lines = [
    `Focus Order Audit`,
    `Total focusable elements: ${elements.length}`,
    `Missing visible focus indicator: ${missingFocus.length}`,
    '',
    '--- TAB ORDER ---',
  ];

  for (let i = 0; i < elements.length; i++) {
    const e = elements[i];
    const focusIcon = e.hasVisibleFocus ? 'Yes' : 'NO';
    lines.push(`  ${i + 1}. [${e.selector}] "${e.text.slice(0, 40)}" — tabIndex: ${e.tabIndex}, focus visible: ${focusIcon}`);
  }

  if (missingFocus.length > 0) {
    lines.push('', '--- MISSING FOCUS INDICATOR ---');
    for (const e of missingFocus) {
      lines.push(`  - ${e.selector} — "${e.text.slice(0, 40)}"`);
    }
  }

  return { issues, text: lines.join('\n') };
}

// ─── 14. audit_mixed_content ─────────────────────────────────────────

async function auditMixedContent(page, _context, _opts) {
  const result = await page.evaluate(() => {
    const pageUrl = window.location.href;
    const isHttps = window.location.protocol === 'https:';
    const mixedItems = [];

    if (!isHttps) return { isHttps: false, pageUrl, mixedItems: [] };

    for (const el of document.querySelectorAll('[src]')) {
      const src = el.getAttribute('src');
      if (!src) continue;
      try {
        const resolved = new URL(src, pageUrl).href;
        if (resolved.startsWith('http://')) {
          const tag = el.tagName.toLowerCase();
          mixedItems.push({
            elementType: tag,
            attribute: 'src',
            url: resolved,
            isActive: ['script', 'iframe'].includes(tag),
          });
        }
      } catch { /* skip */ }
    }

    for (const el of document.querySelectorAll('link[href]')) {
      const href = el.getAttribute('href');
      if (!href) continue;
      const rel = el.getAttribute('rel') || '';
      if (!['stylesheet', 'preload', 'prefetch', 'icon'].includes(rel)) continue;
      try {
        const resolved = new URL(href, pageUrl).href;
        if (resolved.startsWith('http://')) {
          mixedItems.push({
            elementType: 'link',
            attribute: 'href',
            url: resolved,
            isActive: rel === 'stylesheet',
          });
        }
      } catch { /* skip */ }
    }

    return { isHttps, pageUrl, mixedItems };
  });

  if (!result.isHttps) {
    return { issues: [], text: `Mixed Content Audit\nPage is served over HTTP — mixed content detection is not applicable.` };
  }

  const activeContent = result.mixedItems.filter(i => i.isActive);
  const passiveContent = result.mixedItems.filter(i => !i.isActive);

  const issues = [];
  if (activeContent.length > 0) issues.push({ id: 'mixed-active', severity: 'critical', msg: `${activeContent.length} active mixed content resource(s) (scripts/iframes over HTTP)` });
  if (passiveContent.length > 0) issues.push({ id: 'mixed-passive', severity: 'moderate', msg: `${passiveContent.length} passive mixed content resource(s) (images/media over HTTP)` });

  const lines = [
    `Mixed Content Audit`,
    `URL: ${result.pageUrl}`,
    `Total mixed content: ${result.mixedItems.length}`,
    `Active (high risk): ${activeContent.length}`,
    `Passive (lower risk): ${passiveContent.length}`,
  ];

  if (result.mixedItems.length === 0) {
    lines.push('', 'No mixed content detected.');
  } else {
    for (const item of result.mixedItems) {
      lines.push(`  [${item.isActive ? 'ACTIVE' : 'passive'}] <${item.elementType}> ${item.url.slice(0, 70)}`);
    }
  }

  return { issues, text: lines.join('\n') };
}

// ─── 15. audit_third_party_scripts ───────────────────────────────────

async function auditThirdPartyScripts(page, _context, _opts) {
  const result = await page.evaluate(() => {
    const pageOrigin = window.location.origin;
    const scripts = [];

    for (const el of document.querySelectorAll('script')) {
      const src = el.getAttribute('src');
      if (!src) {
        scripts.push({ type: 'inline', domain: '(inline)', url: '', async: false, defer: false, size: (el.textContent || '').length, isThirdParty: false });
        continue;
      }

      let resolvedUrl = '', domain = '', isThirdParty = false;
      try {
        const parsed = new URL(src, window.location.href);
        resolvedUrl = parsed.href;
        domain = parsed.hostname;
        isThirdParty = parsed.origin !== pageOrigin;
      } catch {
        resolvedUrl = src;
        domain = '(invalid)';
      }

      scripts.push({ type: isThirdParty ? 'third-party' : 'first-party', domain, url: resolvedUrl, async: el.async, defer: el.defer, size: 0, isThirdParty });
    }

    // Performance data
    const perfEntries = performance.getEntriesByType('resource').filter(e => e.initiatorType === 'script');
    for (const script of scripts) {
      if (!script.url) continue;
      const perf = perfEntries.find(e => e.name === script.url);
      if (perf) {
        script.size = perf.decodedBodySize || perf.transferSize || 0;
        script.duration = Math.round(perf.duration);
      }
    }

    return { pageOrigin, scripts };
  });

  const thirdParty = result.scripts.filter(s => s.isThirdParty);
  const renderBlocking = thirdParty.filter(s => !s.async && !s.defer);

  const issues = [];
  if (renderBlocking.length > 0) issues.push({ id: 'render-blocking-3p', severity: 'moderate', msg: `${renderBlocking.length} render-blocking third-party script(s)` });

  function formatSize(bytes) {
    if (bytes === 0) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const totalThirdPartySize = thirdParty.reduce((sum, s) => sum + (s.size || 0), 0);

  const lines = [
    `Third-Party Scripts Audit`,
    `URL: ${await page.url()}`,
    `Total scripts: ${result.scripts.length}`,
    `Third-party: ${thirdParty.length} (${formatSize(totalThirdPartySize)})`,
    `Inline: ${result.scripts.filter(s => s.type === 'inline').length}`,
    `Render-blocking 3P: ${renderBlocking.length}`,
    '',
  ];

  if (thirdParty.length > 0) {
    lines.push('--- THIRD-PARTY SCRIPTS ---');
    for (const s of thirdParty) {
      const flags = [];
      if (s.async) flags.push('async');
      if (s.defer) flags.push('defer');
      if (!s.async && !s.defer) flags.push('BLOCKING');
      lines.push(`  ${s.domain} — ${s.url.slice(0, 70)} [${flags.join(',')}] ${formatSize(s.size)}`);
    }
  }

  return { issues, text: lines.join('\n') };
}

// ─── 16. audit_cookie_compliance ─────────────────────────────────────

async function auditCookieCompliance(page, context, _opts) {
  const url = page.url();
  const cookies = await context.cookies();

  function classifyCookie(name) {
    const n = name.toLowerCase();
    if (/^_ga|^_gid|^_gat|^__utm|^_hjid|^_hj|^ajs_|^mp_|^amplitude|^_clck|^_clsk|^__hstc|^hubspot|^_pk_|^_paq/.test(n)) return 'analytics';
    if (/^_fbp|^_fbc|^fr$|^_gcl|^IDE$|^DSID$|^__gads|^_uet|^_ttp|^_tt_|^_pin_|^li_|^bcookie|^bscookie|^_rdt_|^muc_ads|^personalization_id/.test(n)) return 'marketing';
    if (/^session|^csrf|^xsrf|^token|^auth|^__Host-|^__Secure-|^connect\.sid|^PHPSESSID|^JSESSIONID|^ASP\.NET_SessionId|^wp-settings|^wordpress_logged_in|^__cf_bm|^cf_clearance|^__cfruid|^_csrf/.test(n)) return 'necessary';
    if (/^lang|^locale|^theme|^dark_?mode|^cookie_?consent|^preferences|^timezone|^currency|^country/.test(n)) return 'functional';
    return 'unclassified';
  }

  const now = Date.now() / 1000;
  const ONE_YEAR = 365 * 24 * 60 * 60;
  const issueList = [];

  const counts = { necessary: 0, functional: 0, analytics: 0, marketing: 0, unclassified: 0 };

  for (const cookie of cookies) {
    const category = classifyCookie(cookie.name);
    counts[category] = (counts[category] || 0) + 1;

    const cookieIssues = [];
    if (!cookie.secure) cookieIssues.push('Missing Secure flag');
    if (!cookie.httpOnly && category === 'necessary') cookieIssues.push('Missing HttpOnly flag');
    if (!cookie.sameSite) cookieIssues.push('Missing SameSite attribute');

    if (cookie.expires && cookie.expires > 0) {
      const ttl = cookie.expires - now;
      const days = Math.round(ttl / (24 * 60 * 60));
      if (ttl > ONE_YEAR && (category === 'analytics' || category === 'marketing')) {
        cookieIssues.push(`Expires in ${days} days (GDPR max: 13 months)`);
      }
    }

    for (const ci of cookieIssues) {
      issueList.push({ id: 'cookie', severity: 'moderate', msg: `${cookie.name} (${category}): ${ci}` });
    }
  }

  const hasAnalyticsOrMarketing = counts.analytics > 0 || counts.marketing > 0;

  const lines = [
    `Cookie Compliance Audit`,
    `URL: ${url}`,
    `Total cookies: ${cookies.length}`,
    '',
    `By category:`,
    `  Necessary: ${counts.necessary}`,
    `  Functional: ${counts.functional}`,
    `  Analytics: ${counts.analytics}`,
    `  Marketing: ${counts.marketing}`,
    `  Unclassified: ${counts.unclassified}`,
  ];

  if (issueList.length > 0) {
    lines.push('', `--- ISSUES (${issueList.length}) ---`);
    for (const issue of issueList.slice(0, 20)) {
      lines.push(`  ${issue.msg}`);
    }
  }

  if (hasAnalyticsOrMarketing) {
    lines.push('', '--- GDPR/CCPA ---');
    lines.push(`  ${counts.analytics + counts.marketing} analytics/marketing cookie(s) require consent banner.`);
  }

  return { issues: issueList, text: lines.join('\n') };
}

// ─── 17. audit_lighthouse (aggregator) ───────────────────────────────

async function auditLighthouse(page, context, opts) {
  const url = await page.url();

  // Performance
  const perfData = await page.evaluate(() => {
    const result = { lcp: null, cls: null, fcp: null, imageIssues: 0, totalImages: 0, fontIssues: 0 };

    try {
      const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
      if (lcpEntries.length > 0) result.lcp = lcpEntries[lcpEntries.length - 1].startTime;
    } catch { /* skip */ }

    try {
      const clsEntries = performance.getEntriesByType('layout-shift');
      let clsScore = 0;
      for (const entry of clsEntries) { if (!entry.hadRecentInput) clsScore += entry.value; }
      result.cls = clsScore;
    } catch { /* skip */ }

    try {
      const paintEntries = performance.getEntriesByType('paint');
      const fcp = paintEntries.find(e => e.name === 'first-contentful-paint');
      if (fcp) result.fcp = fcp.startTime;
    } catch { /* skip */ }

    const images = document.querySelectorAll('img');
    result.totalImages = images.length;
    for (const img of images) {
      if (!img.loading) result.imageIssues++;
      if (!img.getAttribute('width') || !img.getAttribute('height')) result.imageIssues++;
      if (!img.hasAttribute('alt')) result.imageIssues++;
    }

    const fontEntries = performance.getEntriesByType('resource').filter(e =>
      e.initiatorType === 'css' || e.name.match(/\.(woff2?|ttf|otf|eot)/i)
    );
    result.fontIssues = fontEntries.filter(e => e.startTime > 500).length;

    return result;
  });

  let perfScore = 100;
  const perfIssues = [];

  if (perfData.lcp !== null) {
    if (perfData.lcp > 4000) { perfScore -= 30; perfIssues.push(`LCP: ${(perfData.lcp / 1000).toFixed(1)}s (poor)`); }
    else if (perfData.lcp > 2500) { perfScore -= 15; perfIssues.push(`LCP: ${(perfData.lcp / 1000).toFixed(1)}s (needs improvement)`); }
  } else { perfScore -= 5; }

  if (perfData.cls !== null) {
    if (perfData.cls > 0.25) { perfScore -= 25; perfIssues.push(`CLS: ${perfData.cls.toFixed(3)} (poor)`); }
    else if (perfData.cls > 0.1) { perfScore -= 10; perfIssues.push(`CLS: ${perfData.cls.toFixed(3)} (needs improvement)`); }
  }

  if (perfData.fcp !== null) {
    if (perfData.fcp > 3000) { perfScore -= 20; perfIssues.push(`FCP: ${(perfData.fcp / 1000).toFixed(1)}s (poor)`); }
    else if (perfData.fcp > 1800) { perfScore -= 10; perfIssues.push(`FCP: ${(perfData.fcp / 1000).toFixed(1)}s (needs improvement)`); }
  }

  if (perfData.totalImages > 0) {
    const imgPenalty = Math.min(15, Math.round((perfData.imageIssues / Math.max(1, perfData.totalImages)) * 15));
    if (imgPenalty > 0) { perfScore -= imgPenalty; perfIssues.push(`${perfData.imageIssues} image optimization issue(s)`); }
  }

  if (perfData.fontIssues > 0) {
    perfScore -= Math.min(5, perfData.fontIssues * 2);
    perfIssues.push(`${perfData.fontIssues} late-loading font(s)`);
  }
  perfScore = Math.max(0, Math.min(100, perfScore));

  // Accessibility
  const a11yData = await page.evaluate(() => {
    let total = 0, issues = 0;
    const problems = [];

    const imgs = document.querySelectorAll('img');
    total += imgs.length;
    for (const img of imgs) { if (!img.hasAttribute('alt')) { issues++; problems.push('Image missing alt'); } }

    const inputs = document.querySelectorAll('input:not([type="hidden"]), select, textarea');
    total += inputs.length;
    for (const input of inputs) {
      const hasLabel = input.id && document.querySelector(`label[for="${input.id}"]`);
      const hasAriaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
      const wrappedInLabel = input.closest('label');
      if (!hasLabel && !hasAriaLabel && !wrappedInLabel) { issues++; problems.push('Input missing label'); }
    }

    const buttons = document.querySelectorAll('button, [role="button"]');
    total += buttons.length;
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim();
      const ariaLabel = btn.getAttribute('aria-label') || btn.getAttribute('aria-labelledby');
      if (!text && !ariaLabel) { issues++; problems.push('Button missing name'); }
    }

    const html = document.documentElement;
    if (!html.getAttribute('lang')) { issues++; problems.push('Missing lang'); }

    const landmarks = document.querySelectorAll('main, [role="main"], nav, [role="navigation"]');
    if (landmarks.length === 0) { issues++; problems.push('No landmarks'); }

    total = Math.max(total, 1);
    return { total, issues, problems: [...new Set(problems)].slice(0, 15) };
  });

  let a11yScore = 100;
  if (a11yData.total > 0) {
    const issueRatio = a11yData.issues / a11yData.total;
    a11yScore = Math.max(0, Math.round(100 - issueRatio * 100 - a11yData.problems.length * 3));
  }
  a11yScore = Math.max(0, Math.min(100, a11yScore));

  // SEO
  const seoData = await page.evaluate(() => {
    const issues = [];
    let score = 100;

    const title = document.title;
    if (!title) { score -= 15; issues.push('Missing <title>'); }
    else if (title.length < 10) { score -= 5; issues.push('Title too short'); }
    else if (title.length > 70) { score -= 5; issues.push('Title too long'); }

    const desc = document.querySelector('meta[name="description"]');
    if (!desc || !desc.content) { score -= 15; issues.push('Missing meta description'); }

    if (!document.querySelector('link[rel="canonical"]')) { score -= 10; issues.push('Missing canonical'); }
    if (document.querySelectorAll('h1').length === 0) { score -= 10; issues.push('Missing <h1>'); }
    if (!document.querySelector('meta[name="viewport"]')) { score -= 10; issues.push('Missing viewport'); }
    if (!document.querySelector('meta[property="og:title"]')) { score -= 5; issues.push('Missing OG tags'); }
    if (!document.querySelector('script[type="application/ld+json"]')) { score -= 5; issues.push('No structured data'); }
    if (!document.documentElement.getAttribute('lang')) { score -= 5; issues.push('Missing lang'); }

    return { score: Math.max(0, score), issues };
  });

  // Best Practices
  let bpScore = 100;
  const bpIssues = [];

  if (!url.startsWith('https://')) { bpScore -= 20; bpIssues.push('Not HTTPS'); }

  try {
    const response = await page.request.get(url, { timeout: 10000 });
    const respHeaders = await response.headers();
    const normalized = {};
    for (const [k, v] of Object.entries(respHeaders)) normalized[k.toLowerCase()] = v;

    const criticalHeaders = ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'x-frame-options'];
    const missing = criticalHeaders.filter(h => !normalized[h]);
    if (missing.length > 0) {
      bpScore -= missing.length * 5;
      bpIssues.push(`Missing headers: ${missing.join(', ')}`);
    }
  } catch {
    bpScore -= 10;
    bpIssues.push('Could not fetch headers');
  }

  bpScore = Math.max(0, Math.min(100, bpScore));

  const overallScore = Math.round((perfScore + a11yScore + seoData.score + bpScore) / 4);

  function scoreColor(score) {
    if (score >= 90) return 'GOOD';
    if (score >= 50) return 'NEEDS IMPROVEMENT';
    return 'POOR';
  }

  const allIssues = [
    ...perfIssues.map(i => ({ category: 'Performance', issue: i })),
    ...a11yData.problems.map(i => ({ category: 'Accessibility', issue: i })),
    ...seoData.issues.map(i => ({ category: 'SEO', issue: i })),
    ...bpIssues.map(i => ({ category: 'Best Practices', issue: i })),
  ];

  const issues = allIssues.map(i => ({
    id: 'lighthouse',
    severity: 'moderate',
    msg: `[${i.category}] ${i.issue}`,
  }));

  const lines = [
    `Lighthouse-Style Audit`,
    `URL: ${url}`,
    `Overall Score: ${overallScore}/100 (${scoreColor(overallScore)})`,
    '',
    `  Performance:    ${perfScore}/100 (${scoreColor(perfScore)})`,
    `  Accessibility:  ${a11yScore}/100 (${scoreColor(a11yScore)})`,
    `  SEO:            ${seoData.score}/100 (${scoreColor(seoData.score)})`,
    `  Best Practices: ${bpScore}/100 (${scoreColor(bpScore)})`,
  ];

  if (allIssues.length > 0) {
    lines.push('', '--- TOP ISSUES ---');
    for (const item of allIssues.slice(0, 20)) {
      lines.push(`  [${item.category}] ${item.issue}`);
    }
  }

  lines.push('', 'Note: This is a lightweight approximation, not a full Lighthouse audit.');

  return { issues, text: lines.join('\n') };
}
