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

  // Special: --only visual runs the comprehensive visual audit
  const isVisualAudit = flags.only && flags.only.trim() === 'visual';

  // Determine which audits to run
  let audits = [...ALL_AUDITS];
  if (flags.only && !isVisualAudit) {
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

  // Validate audit names (skip validation for the special 'visual' audit)
  if (!isVisualAudit) {
    for (const a of audits) {
      if (!ALL_AUDITS.includes(a)) {
        console.error(`Unknown audit: "${a}". Run \`playwright-pool audit list\` for available audits.`);
        process.exit(1);
      }
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

      // Special: comprehensive visual audit
      if (isVisualAudit) {
        console.error(`  Running: comprehensive visual audit...`);
        try {
          const result = await runVisualAudit(page, context, { flags });
          allResults[url] = { visual: result };
          const issueCount = (result.issues || []).length;
          totalIssueCount += issueCount;
          if (issueCount > 0) exitCode = 2;
          // Print the report directly
          if (!jsonMode) {
            console.log(result.text);
          }
        } catch (err) {
          allResults[url] = { visual: { issues: [], text: `Error: ${err.message}` } };
          console.error(`    Error in visual audit: ${err.message}`);
        }
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

  if (isVisualAudit) {
    // Visual audit already printed its report above; handle JSON mode here
    if (jsonMode) {
      const output = {};
      for (const [url, urlResults] of Object.entries(allResults)) {
        if (urlResults.error) { output[url] = { error: urlResults.error }; continue; }
        const vr = urlResults.visual || {};
        output[url] = {
          visual: {
            issues: vr.issues || [],
            issueCount: (vr.issues || []).length,
            sections: vr.sections || {},
          },
        };
      }
      console.log(JSON.stringify(output, null, 2));
    }
  } else if (jsonMode) {
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
  console.log('');
  console.log('  SPECIAL');
  console.log('    [+] visual  (comprehensive: runs layout, spacing, contrast, typography,');
  console.log('                 tap targets, images, a11y, SEO, focus, z-index, dark mode)');
  console.log('        Usage: playwright-pool audit <url> --only visual');
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
    await page.waitForTimeout(50);

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
    await page.waitForTimeout(50);

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

// ─── 18. Comprehensive Visual Audit ─────────────────────────────────
// Runs ALL programmatic UI checks in one pass: layout, spacing, contrast,
// typography, touch targets, images, accessibility, SEO, focus order,
// z-index, and dark mode comparison.  Produces a single structured report.

export async function runVisualAudit(page, _context, opts = {}) {
  const url = await page.url();
  const originalViewport = page.viewportSize() || { width: 1280, height: 800 };
  const ts = new Date().toISOString();

  // ── Phase 1: ONE big page.evaluate() to collect all DOM metrics ──
  const dom = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bodyScrollW = document.documentElement.scrollWidth;
    const bodyScrollH = document.documentElement.scrollHeight;

    // Helper: is element visible?
    function isVis(el) {
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'
        && el.offsetWidth > 0 && el.offsetHeight > 0;
    }

    // Helper: parse rgb/rgba
    function parseColor(c) {
      const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
    }

    // Helper: effective background
    function effBg(el) {
      let cur = el;
      while (cur && cur !== document.documentElement) {
        const s = window.getComputedStyle(cur);
        const p = parseColor(s.backgroundColor);
        if (p) {
          const am = s.backgroundColor.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/);
          const a = am ? +am[1] : 1;
          if (a > 0.1) return p;
        }
        cur = cur.parentElement;
      }
      return { r: 255, g: 255, b: 255 };
    }

    // Collect every element
    const allEls = document.querySelectorAll('*');
    const elements = [];       // bounding rects for overlap detection
    const spacingData = [];    // margin/padding
    const textData = [];       // color contrast + typography
    const interactiveData = []; // tap targets
    const imageData = [];      // images
    const headingData = [];    // heading hierarchy
    const zIndexData = [];     // z-index map

    const fontFamilies = new Set();
    const fontSizes = new Set();
    const spacingValues = new Set();

    allEls.forEach(el => {
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none') return;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      // Selector helper
      let sel = el.tagName.toLowerCase();
      if (el.id) sel += '#' + el.id;
      else if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (cls) sel += '.' + cls;
      }

      // Bounding rect for overlap detection (only visible, meaningful elements)
      if (isVis(el) && rect.width > 1 && rect.height > 1) {
        elements.push({
          sel,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
      }

      // Spacing
      const mt = parseFloat(cs.marginTop) || 0;
      const mr = parseFloat(cs.marginRight) || 0;
      const mb = parseFloat(cs.marginBottom) || 0;
      const ml = parseFloat(cs.marginLeft) || 0;
      const pt = parseFloat(cs.paddingTop) || 0;
      const pr = parseFloat(cs.paddingRight) || 0;
      const pb = parseFloat(cs.paddingBottom) || 0;
      const pl = parseFloat(cs.paddingLeft) || 0;
      const gap = parseFloat(cs.gap) || 0;

      [mt, mr, mb, ml, pt, pr, pb, pl, gap].forEach(v => {
        if (v !== 0) spacingValues.add(Math.round(v));
      });

      spacingData.push({ sel, mt, mr, mb, ml, pt, pr, pb, pl, gap });

      // Z-index
      const zi = cs.zIndex;
      if (zi && zi !== 'auto' && zi !== '0') {
        zIndexData.push({ sel, zIndex: parseInt(zi, 10) });
      }

      // Typography + contrast (text elements only)
      const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
      if (hasText && isVis(el)) {
        const family = cs.fontFamily;
        const size = cs.fontSize;
        const weight = cs.fontWeight;
        const lineHeight = cs.lineHeight;
        fontFamilies.add(family.split(',')[0].trim().replace(/['"]/g, ''));
        fontSizes.add(size);

        const fg = parseColor(cs.color);
        const bg = effBg(el);
        textData.push({
          sel,
          text: (el.textContent || '').trim().slice(0, 60),
          family, size, weight, lineHeight,
          fg: fg ? `rgb(${fg.r},${fg.g},${fg.b})` : cs.color,
          bg: bg ? `rgb(${bg.r},${bg.g},${bg.b})` : 'rgb(255,255,255)',
          fgRaw: fg, bgRaw: bg,
          fontSize: parseFloat(size),
          fontWeight: parseInt(weight) || (weight === 'bold' ? 700 : 400),
        });
      }

      // Interactive elements
      const isInteractive = el.matches('a, button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [onclick], [tabindex]');
      if (isInteractive && isVis(el) && el.type !== 'hidden') {
        interactiveData.push({
          sel,
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || el.getAttribute('aria-label') || el.getAttribute('value') || '').trim().slice(0, 50),
          w: Math.round(rect.width * 10) / 10,
          h: Math.round(rect.height * 10) / 10,
        });
      }
    });

    // Images
    document.querySelectorAll('img').forEach(img => {
      const src = img.src || img.getAttribute('data-src') || '(none)';
      const shortSrc = src.length > 80 ? src.slice(0, 77) + '...' : src;
      const rect = img.getBoundingClientRect();
      imageData.push({
        src: shortSrc,
        alt: img.hasAttribute('alt') ? img.getAttribute('alt') : null,
        naturalW: img.naturalWidth,
        naturalH: img.naturalHeight,
        renderedW: img.width,
        renderedH: img.height,
        loading: img.getAttribute('loading'),
        complete: img.complete,
        belowFold: rect.top > vh,
        broken: !img.complete && img.naturalWidth === 0 && img.getAttribute('loading') !== 'lazy',
      });
    });

    // Headings
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
      headingData.push({
        level: parseInt(h.tagName[1]),
        text: (h.textContent || '').trim().slice(0, 80),
      });
    });

    // Meta tags
    const metaInfo = {
      title: document.title || null,
      description: null,
      canonical: null,
      viewport: null,
      lang: document.documentElement.getAttribute('lang') || null,
      ogTags: {},
      h1Count: document.querySelectorAll('h1').length,
    };
    document.querySelectorAll('meta').forEach(m => {
      const name = (m.getAttribute('name') || '').toLowerCase();
      const prop = (m.getAttribute('property') || '').toLowerCase();
      const content = m.getAttribute('content') || '';
      if (name === 'description') metaInfo.description = content;
      if (name === 'viewport') metaInfo.viewport = content;
      if (prop.startsWith('og:')) metaInfo.ogTags[prop] = content;
    });
    const canonEl = document.querySelector('link[rel="canonical"]');
    if (canonEl) metaInfo.canonical = canonEl.getAttribute('href');

    // Form labels
    const missingLabels = [];
    document.querySelectorAll('input, select, textarea').forEach(inp => {
      if (inp.type === 'hidden' || inp.type === 'submit' || inp.type === 'button') return;
      const hasLabel = inp.id && document.querySelector(`label[for="${inp.id}"]`);
      const hasAria = inp.getAttribute('aria-label') || inp.getAttribute('aria-labelledby');
      const wrapped = inp.closest('label');
      const hasTitle = inp.getAttribute('title');
      if (!hasLabel && !hasAria && !wrapped && !hasTitle) {
        let s = inp.tagName.toLowerCase();
        if (inp.id) s += '#' + inp.id;
        else if (inp.name) s += '[name=' + inp.name + ']';
        missingLabels.push(s);
      }
    });

    // Empty buttons
    const emptyButtons = [];
    document.querySelectorAll('button, [role="button"]').forEach(btn => {
      if (!isVis(btn)) return;
      const txt = (btn.textContent || '').trim();
      const aria = btn.getAttribute('aria-label') || '';
      const img = btn.querySelector('img[alt]');
      if (!txt && !aria && !img) {
        let s = btn.tagName.toLowerCase();
        if (btn.className && typeof btn.className === 'string') s += '.' + btn.className.trim().split(/\s+/)[0];
        emptyButtons.push(s);
      }
    });

    // Empty links
    const emptyLinks = [];
    document.querySelectorAll('a[href]').forEach(a => {
      if (!isVis(a)) return;
      const txt = (a.textContent || '').trim();
      const aria = a.getAttribute('aria-label') || '';
      const img = a.querySelector('img[alt]');
      if (!txt && !aria && !img) {
        emptyLinks.push(a.getAttribute('href').slice(0, 40));
      }
    });

    return {
      vw, vh, bodyScrollW, bodyScrollH,
      elementCount: elements.length,
      elements: elements.slice(0, 500),
      spacingData: spacingData.slice(0, 500),
      spacingValues: [...spacingValues].sort((a, b) => a - b),
      textData: textData.slice(0, 500),
      fontFamilies: [...fontFamilies],
      fontSizes: [...fontSizes].sort((a, b) => parseFloat(a) - parseFloat(b)),
      interactiveData,
      imageData,
      headingData,
      zIndexData: zIndexData.sort((a, b) => a.zIndex - b.zIndex),
      metaInfo,
      missingLabels: missingLabels.slice(0, 20),
      emptyButtons: emptyButtons.slice(0, 20),
      emptyLinks: emptyLinks.slice(0, 20),
    };
  });

  // ── Phase 2: Process collected data in Node.js ──

  // Contrast ratio calculation
  function getLuminance(r, g, b) {
    const [rs, gs, bs] = [r, g, b].map(c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  function contrastRatio(fg, bg) {
    const l1 = getLuminance(fg.r, fg.g, fg.b);
    const l2 = getLuminance(bg.r, bg.g, bg.b);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // Contrast failures
  const contrastFailures = [];
  const contrastChecked = new Set();
  for (const t of dom.textData) {
    if (!t.fgRaw || !t.bgRaw) continue;
    const key = `${t.fg}|${t.bg}|${t.sel}`;
    if (contrastChecked.has(key)) continue;
    contrastChecked.add(key);
    const ratio = contrastRatio(t.fgRaw, t.bgRaw);
    const isLarge = t.fontSize >= 24 || (t.fontSize >= 18.66 && t.fontWeight >= 700);
    const required = isLarge ? 3 : 4.5;
    if (ratio < required) {
      contrastFailures.push({
        sel: t.sel,
        text: t.text,
        ratio: Math.round(ratio * 100) / 100,
        required,
        fg: t.fg,
        bg: t.bg,
      });
    }
  }

  // Spacing outlier detection
  const spacingScale = dom.spacingValues;
  // Common design scales: 0,4,8,12,16,20,24,32,48,64,96
  const commonScale = new Set([0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128]);
  const spacingOutliers = [];
  for (const sd of dom.spacingData) {
    const vals = [
      { prop: 'margin-top', val: sd.mt },
      { prop: 'margin-right', val: sd.mr },
      { prop: 'margin-bottom', val: sd.mb },
      { prop: 'margin-left', val: sd.ml },
      { prop: 'padding-top', val: sd.pt },
      { prop: 'padding-right', val: sd.pr },
      { prop: 'padding-bottom', val: sd.pb },
      { prop: 'padding-left', val: sd.pl },
      { prop: 'gap', val: sd.gap },
    ];
    for (const v of vals) {
      const rounded = Math.round(Math.abs(v.val));
      if (rounded !== 0 && !commonScale.has(rounded) && rounded < 200) {
        spacingOutliers.push({ sel: sd.sel, prop: v.prop, val: rounded });
      }
    }
  }
  // Deduplicate by sel+prop
  const seenOutliers = new Set();
  const uniqueOutliers = spacingOutliers.filter(o => {
    const key = `${o.sel}|${o.prop}`;
    if (seenOutliers.has(key)) return false;
    seenOutliers.add(key);
    return true;
  }).slice(0, 20);

  // Element overlap detection
  const overlaps = [];
  const rects = dom.elements;
  // Only check elements that are likely content (limit scope for performance)
  const checkRects = rects.slice(0, 200);
  for (let i = 0; i < checkRects.length; i++) {
    for (let j = i + 1; j < checkRects.length; j++) {
      const a = checkRects[i];
      const b = checkRects[j];
      // Skip if one is ancestor of other (common case, not a real overlap)
      if (a.sel.startsWith(b.sel) || b.sel.startsWith(a.sel)) continue;
      // Check intersection
      const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (overlapX > 5 && overlapY > 5) {
        const areaOverlap = overlapX * overlapY;
        const areaSmaller = Math.min(a.w * a.h, b.w * b.h);
        // Only flag if overlap is more than 30% of smaller element
        if (areaSmaller > 0 && (areaOverlap / areaSmaller) > 0.3) {
          overlaps.push({ a: a.sel, b: b.sel, overlapPx: `${overlapX}x${overlapY}` });
        }
      }
    }
    if (overlaps.length >= 20) break;
  }

  // Touch targets below minimum
  const minTap = 48;
  const smallTargets = dom.interactiveData.filter(e => e.w < minTap || e.h < minTap);

  // Heading hierarchy check
  let headingSkip = null;
  let prevLevel = 0;
  for (const h of dom.headingData) {
    if (prevLevel > 0 && h.level > prevLevel + 1) {
      headingSkip = `h${prevLevel} -> h${h.level}, missing h${prevLevel + 1}`;
      break;
    }
    prevLevel = h.level;
  }

  // Image issues
  const imgMissingAlt = dom.imageData.filter(i => i.alt === null);
  const imgOversized = dom.imageData.filter(i => i.naturalW > 0 && i.renderedW > 0 && (i.naturalW / i.renderedW) > 2);
  const imgBroken = dom.imageData.filter(i => i.broken);
  const imgMissingLazy = dom.imageData.filter(i => i.belowFold && i.loading !== 'lazy');

  // SEO checks
  const meta = dom.metaInfo;
  const missingOg = ['og:title', 'og:description', 'og:image'].filter(k => !meta.ogTags[k]);

  // ── Phase 3: Viewport-dependent checks (overflow at breakpoints) ──
  const breakpoints = [
    { label: 'Desktop', width: 1280, height: 800 },
    { label: 'Tablet', width: 768, height: 1024 },
    { label: 'Mobile', width: 375, height: 812 },
  ];

  const vpResults = [];
  for (const bp of breakpoints) {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    await page.waitForTimeout(100);
    const data = await page.evaluate(() => {
      const vw = window.innerWidth;
      const docW = document.documentElement.scrollWidth;
      const offenders = [];
      if (docW > vw) {
        document.querySelectorAll('*').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.right > vw + 1) {
            const s = window.getComputedStyle(el);
            if (s.display === 'none' || s.visibility === 'hidden') return;
            let sel = el.tagName.toLowerCase();
            if (el.id) sel += '#' + el.id;
            else if (el.className && typeof el.className === 'string') {
              const cls = el.className.trim().split(/\s+/)[0];
              if (cls) sel += '.' + cls;
            }
            offenders.push({ sel, width: Math.round(r.width) });
          }
        });
        offenders.sort((a, b) => b.width - a.width);
      }
      return { vw, docW, hasOverflow: docW > vw, offenders: offenders.slice(0, 5) };
    });
    vpResults.push({ label: bp.label, width: bp.width, ...data });
  }

  // Restore viewport
  await page.setViewportSize(originalViewport);

  // ── Phase 4: Focus order check (requires interaction) ──
  await page.evaluate(() => {
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
  });

  const focusElements = [];
  const missingFocusStyle = [];
  for (let i = 0; i < 50; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      const cs = window.getComputedStyle(el);
      const outlineW = parseFloat(cs.outlineWidth) || 0;
      const hasOutline = outlineW > 0 && cs.outlineStyle !== 'none';
      const hasBoxShadow = cs.boxShadow && cs.boxShadow !== 'none';
      let sel = el.tagName.toLowerCase();
      if (el.id) sel += '#' + el.id;
      else if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (cls) sel += '.' + cls;
      }
      return {
        sel,
        text: (el.textContent || '').trim().slice(0, 40),
        hasVisibleFocus: hasOutline || hasBoxShadow,
        x: Math.round(el.getBoundingClientRect().x),
        y: Math.round(el.getBoundingClientRect().y),
      };
    });
    if (!info) break;
    const fp = `${info.sel}@${info.x},${info.y}`;
    if (focusElements.length > 0 && focusElements[0]._fp === fp) break;
    info._fp = fp;
    focusElements.push(info);
    if (!info.hasVisibleFocus) {
      missingFocusStyle.push(info);
    }
  }

  // ── Phase 5: Dark mode comparison ──
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(300);
  const lightColors = await page.evaluate(() => {
    const cs = window.getComputedStyle(document.body);
    return { bg: cs.backgroundColor, color: cs.color };
  });

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  const darkColors = await page.evaluate(() => {
    const cs = window.getComputedStyle(document.body);
    return { bg: cs.backgroundColor, color: cs.color };
  });

  await page.emulateMedia({ colorScheme: 'no-preference' });

  const darkModeActive = lightColors.bg !== darkColors.bg || lightColors.color !== darkColors.color;

  // ── Phase 6: Build structured report ──
  const allIssues = [];
  const sections = {};

  // LAYOUT
  const layoutLines = [];
  const desktopOverflow = vpResults.find(r => r.label === 'Desktop');
  layoutLines.push(`  Overflow: ${desktopOverflow && desktopOverflow.hasOverflow ? `YES (body: ${desktopOverflow.docW}px > viewport: ${desktopOverflow.vw}px)` : `NONE (body: ${dom.bodyScrollW}px, viewport: ${dom.vw}px)`}`);
  layoutLines.push(`  Element overlaps: ${overlaps.length} detected`);
  if (overlaps.length > 0) {
    for (const o of overlaps.slice(0, 5)) {
      layoutLines.push(`    ${o.a} <-> ${o.b} (${o.overlapPx})`);
    }
  }
  layoutLines.push('  Viewport breakpoints:');
  for (const vp of vpResults) {
    if (vp.hasOverflow) {
      layoutLines.push(`    ${vp.label} (${vp.width}px): OVERFLOW (body: ${vp.docW}px > ${vp.vw}px viewport)`);
      for (const o of vp.offenders.slice(0, 3)) {
        layoutLines.push(`      Offender: ${o.sel} (width: ${o.width}px)`);
      }
      allIssues.push({ id: 'overflow-' + vp.label.toLowerCase(), severity: 'moderate', msg: `${vp.label} (${vp.width}px): overflow by ${vp.docW - vp.vw}px` });
    } else {
      layoutLines.push(`    ${vp.label} (${vp.width}px): OK`);
    }
  }
  if (overlaps.length > 0) {
    allIssues.push({ id: 'element-overlap', severity: 'serious', msg: `${overlaps.length} element overlap(s) detected` });
  }
  sections.layout = layoutLines;

  // SPACING
  const spacingLines = [];
  spacingLines.push(`  Elements checked: ${dom.spacingData.length}`);
  spacingLines.push(`  Spacing scale detected: [${spacingScale.slice(0, 15).join(', ')}${spacingScale.length > 15 ? ', ...' : ''}]`);
  spacingLines.push(`  Outliers: ${uniqueOutliers.length}`);
  for (const o of uniqueOutliers.slice(0, 10)) {
    spacingLines.push(`    ${o.sel} { ${o.prop}: ${o.val}px } -- not in common scale`);
    allIssues.push({ id: 'spacing-outlier', severity: 'moderate', msg: `${o.sel} { ${o.prop}: ${o.val}px }` });
  }
  sections.spacing = spacingLines;

  // COLORS & CONTRAST
  const contrastLines = [];
  contrastLines.push(`  Text elements checked: ${contrastChecked.size}`);
  contrastLines.push(`  Contrast failures (AA): ${contrastFailures.length}`);
  for (const f of contrastFailures.slice(0, 10)) {
    contrastLines.push(`    "${f.sel}" -- ratio ${f.ratio}:1 (need ${f.required}:1) -- fg: ${f.fg} bg: ${f.bg}`);
    allIssues.push({ id: 'color-contrast', severity: 'critical', msg: `${f.sel}: ratio ${f.ratio}:1 (need ${f.required}:1)` });
  }
  if (contrastFailures.length > 10) {
    contrastLines.push(`    ... and ${contrastFailures.length - 10} more`);
  }
  sections.contrast = contrastLines;

  // TYPOGRAPHY
  const typoLines = [];
  typoLines.push(`  Font families: ${dom.fontFamilies.join(', ') || '(none detected)'}`);
  typoLines.push(`  Unique sizes: ${dom.fontSizes.join(', ') || '(none)'}`);
  typoLines.push(`  Consistency: ${dom.fontFamilies.length <= 4 ? 'OK' : 'WARNING'} (${dom.fontFamilies.length} families, ${dom.fontSizes.length} sizes)`);
  const typoIssueCount = (dom.fontFamilies.length > 4 ? 1 : 0) + (dom.fontSizes.length > 10 ? 1 : 0);
  typoLines.push(`  Issues: ${typoIssueCount}`);
  if (dom.fontFamilies.length > 4) {
    typoLines.push(`    Too many font families (${dom.fontFamilies.length})`);
    allIssues.push({ id: 'font-families', severity: 'moderate', msg: `${dom.fontFamilies.length} font families detected` });
  }
  if (dom.fontSizes.length > 10) {
    typoLines.push(`    Too many font sizes (${dom.fontSizes.length})`);
    allIssues.push({ id: 'font-sizes', severity: 'moderate', msg: `${dom.fontSizes.length} unique font sizes` });
  }
  sections.typography = typoLines;

  // TOUCH TARGETS
  const tapLines = [];
  tapLines.push(`  Interactive elements: ${dom.interactiveData.length}`);
  tapLines.push(`  Below ${minTap}px minimum: ${smallTargets.length}`);
  for (const t of smallTargets.slice(0, 10)) {
    tapLines.push(`    ${t.sel} -- ${t.w}x${t.h}px`);
    allIssues.push({ id: 'tap-target', severity: 'serious', msg: `${t.sel} -- ${t.w}x${t.h}px (min ${minTap}x${minTap})` });
  }
  if (smallTargets.length > 10) {
    tapLines.push(`    ... and ${smallTargets.length - 10} more`);
  }
  sections.tapTargets = tapLines;

  // IMAGES
  const imgLines = [];
  imgLines.push(`  Total: ${dom.imageData.length}`);
  imgLines.push(`  Missing alt: ${imgMissingAlt.length}${imgMissingAlt.length > 0 ? ' -- ' + imgMissingAlt.slice(0, 3).map(i => i.src.slice(0, 40)).join(', ') : ''}`);
  imgLines.push(`  Oversized: ${imgOversized.length}`);
  imgLines.push(`  Broken src: ${imgBroken.length}`);
  imgLines.push(`  Missing lazy: ${imgMissingLazy.length}`);
  if (imgMissingAlt.length > 0) allIssues.push({ id: 'img-missing-alt', severity: 'critical', msg: `${imgMissingAlt.length} image(s) missing alt text` });
  if (imgBroken.length > 0) allIssues.push({ id: 'img-broken', severity: 'serious', msg: `${imgBroken.length} broken image(s)` });
  if (imgMissingLazy.length > 0) allIssues.push({ id: 'img-lazy', severity: 'minor', msg: `${imgMissingLazy.length} below-fold image(s) without lazy loading` });
  sections.images = imgLines;

  // ACCESSIBILITY
  const a11yLines = [];
  a11yLines.push(`  Missing labels: ${dom.missingLabels.length}${dom.missingLabels.length > 0 ? ' -- ' + dom.missingLabels.slice(0, 5).join(', ') : ''}`);
  a11yLines.push(`  Empty buttons: ${dom.emptyButtons.length}${dom.emptyButtons.length > 0 ? ' -- ' + dom.emptyButtons.slice(0, 5).join(', ') : ''}`);
  a11yLines.push(`  Empty links: ${dom.emptyLinks.length}`);
  a11yLines.push(`  Missing lang: ${meta.lang ? `NO (lang="${meta.lang}" present)` : 'YES'}`);
  a11yLines.push(`  Heading order: ${headingSkip ? `SKIP (${headingSkip})` : 'OK'}`);
  if (dom.missingLabels.length > 0) allIssues.push({ id: 'missing-labels', severity: 'critical', msg: `${dom.missingLabels.length} form element(s) missing labels` });
  if (dom.emptyButtons.length > 0) allIssues.push({ id: 'empty-buttons', severity: 'critical', msg: `${dom.emptyButtons.length} empty button(s)` });
  if (dom.emptyLinks.length > 0) allIssues.push({ id: 'empty-links', severity: 'serious', msg: `${dom.emptyLinks.length} empty link(s)` });
  if (!meta.lang) allIssues.push({ id: 'missing-lang', severity: 'serious', msg: 'Missing lang attribute on <html>' });
  if (headingSkip) allIssues.push({ id: 'heading-skip', severity: 'serious', msg: `Heading order: ${headingSkip}` });
  sections.accessibility = a11yLines;

  // SEO
  const seoLines = [];
  const titleLen = meta.title ? meta.title.length : 0;
  seoLines.push(`  Title: ${meta.title ? `"${meta.title.slice(0, 50)}" (${titleLen} chars)` : 'MISSING'} -- ${!meta.title ? 'FAIL' : titleLen >= 10 && titleLen <= 60 ? 'OK' : 'WARN'}`);
  seoLines.push(`  Description: ${meta.description ? `"${meta.description.slice(0, 50)}..." (${meta.description.length} chars)` : 'MISSING'}`);
  seoLines.push(`  Canonical: ${meta.canonical || 'MISSING'}`);
  seoLines.push(`  Viewport: ${meta.viewport ? 'OK' : 'MISSING'}`);
  seoLines.push(`  H1 count: ${meta.h1Count} -- ${meta.h1Count === 1 ? 'OK' : meta.h1Count === 0 ? 'MISSING' : `WARNING (${meta.h1Count} h1 tags)`}`);
  seoLines.push(`  OG tags: ${missingOg.length === 0 ? 'OK' : 'MISSING (' + missingOg.join(', ') + ')'}`);
  if (!meta.title) allIssues.push({ id: 'seo-title', severity: 'critical', msg: 'Missing <title>' });
  if (!meta.description) allIssues.push({ id: 'seo-description', severity: 'serious', msg: 'Missing meta description' });
  if (!meta.canonical) allIssues.push({ id: 'seo-canonical', severity: 'moderate', msg: 'Missing canonical URL' });
  if (meta.h1Count === 0) allIssues.push({ id: 'seo-h1', severity: 'serious', msg: 'No <h1> on page' });
  if (missingOg.length > 0) allIssues.push({ id: 'seo-og', severity: 'minor', msg: `Missing OG tags: ${missingOg.join(', ')}` });
  sections.seo = seoLines;

  // FOCUS ORDER
  const focusLines = [];
  focusLines.push(`  Focusable elements: ${focusElements.length}`);
  focusLines.push(`  Missing focus style: ${missingFocusStyle.length}`);
  for (const e of missingFocusStyle.slice(0, 10)) {
    focusLines.push(`    ${e.sel} -- no visible outline/box-shadow on :focus`);
    allIssues.push({ id: 'focus-indicator', severity: 'serious', msg: `${e.sel}: no visible focus indicator` });
  }
  if (missingFocusStyle.length > 10) {
    focusLines.push(`    ... and ${missingFocusStyle.length - 10} more`);
  }
  sections.focusOrder = focusLines;

  // Z-INDEX
  const zLines = [];
  zLines.push(`  Elements with z-index: ${dom.zIndexData.length}`);
  for (const z of dom.zIndexData.slice(0, 15)) {
    zLines.push(`    ${z.sel} { z-index: ${z.zIndex} }`);
  }
  if (dom.zIndexData.length > 15) {
    zLines.push(`    ... and ${dom.zIndexData.length - 15} more`);
  }
  // Check for z-index conflicts (same value on siblings)
  const zValues = new Map();
  for (const z of dom.zIndexData) {
    if (!zValues.has(z.zIndex)) zValues.set(z.zIndex, []);
    zValues.get(z.zIndex).push(z.sel);
  }
  const zConflicts = [...zValues.entries()].filter(([, sels]) => sels.length > 1);
  zLines.push(`  Conflicts: ${zConflicts.length === 0 ? 'NONE' : zConflicts.length + ' (same z-index on multiple elements)'}`);
  for (const [val, sels] of zConflicts.slice(0, 5)) {
    zLines.push(`    z-index: ${val} shared by: ${sels.slice(0, 3).join(', ')}`);
  }
  sections.zIndex = zLines;

  // DARK MODE
  const darkLines = [];
  darkLines.push(`  Dark mode support: ${darkModeActive ? 'YES (styles change with prefers-color-scheme: dark)' : 'NO (no visual change detected)'}`);
  darkLines.push(`  Light: bg=${lightColors.bg}, text=${lightColors.color}`);
  darkLines.push(`  Dark:  bg=${darkColors.bg}, text=${darkColors.color}`);
  if (!darkModeActive) {
    allIssues.push({ id: 'dark-mode', severity: 'moderate', msg: 'Dark mode not implemented' });
  }
  sections.darkMode = darkLines;

  // SUMMARY
  const severityCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const issue of allIssues) {
    const sev = issue.severity || 'moderate';
    severityCounts[sev] = (severityCounts[sev] || 0) + 1;
  }

  // Build the final report
  const lines = [];
  lines.push('VISUAL AUDIT REPORT');
  lines.push(`URL: ${url}`);
  lines.push(`Viewport: ${originalViewport.width}x${originalViewport.height}`);
  lines.push(`Timestamp: ${ts}`);
  lines.push('');

  const sectionMap = [
    ['LAYOUT', sections.layout],
    ['SPACING', sections.spacing],
    ['COLORS & CONTRAST', sections.contrast],
    ['TYPOGRAPHY', sections.typography],
    ['TOUCH TARGETS', sections.tapTargets],
    ['IMAGES', sections.images],
    ['ACCESSIBILITY', sections.accessibility],
    ['SEO', sections.seo],
    ['FOCUS ORDER', sections.focusOrder],
    ['Z-INDEX', sections.zIndex],
    ['DARK MODE', sections.darkMode],
  ];

  for (const [title, content] of sectionMap) {
    lines.push(`\u2550\u2550\u2550 ${title} \u2550\u2550\u2550`);
    lines.push(...content);
    lines.push('');
  }

  lines.push('\u2550\u2550\u2550 SUMMARY \u2550\u2550\u2550');
  lines.push(`  Total issues: ${allIssues.length}`);
  lines.push(`  Critical: ${severityCounts.critical} (${allIssues.filter(i => i.severity === 'critical').map(i => i.id).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'none'})`);
  lines.push(`  Serious: ${severityCounts.serious} (${allIssues.filter(i => i.severity === 'serious').map(i => i.id).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'none'})`);
  lines.push(`  Moderate: ${severityCounts.moderate} (${allIssues.filter(i => i.severity === 'moderate').map(i => i.id).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'none'})`);
  lines.push(`  Minor: ${severityCounts.minor} (${allIssues.filter(i => i.severity === 'minor').map(i => i.id).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'none'})`);

  return { issues: allIssues, text: lines.join('\n'), sections };
}
