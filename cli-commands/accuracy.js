// cli-commands/accuracy.js — Accuracy scoring tool for playwright-pool audit benchmarking
//
// Handles:
//   accuracy                        — run accuracy test against all fixture pages
//   accuracy --page test-page.html  — run against a specific page
//   accuracy --url http://...       — run against a real URL (no answer key, report only)
//   accuracy --json                 — output as JSON
//   accuracy --verbose              — show each bug: found/missed
//
// Scores audit findings against a known answer key to measure detection accuracy.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, launchStandalone } from './shared.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─── Audit Registry (mirrors audit.js — only implemented audits) ────────

// The audit names that map to real, implemented audit functions in audit.js.
// We import the handler map dynamically to avoid duplicating all the audit code.
const IMPLEMENTED_AUDITS = [
  'meta',
  'accessibility',
  'color_contrast',
  'breakpoints',
  'overflow',
  'image_sizes',
  'tap_targets',
  'core_web_vitals',
  'fonts',
  'dark_mode',
  'security_headers',
  'broken_links',
  'focus_order',
  'mixed_content',
  'third_party_scripts',
  'cookie_compliance',
  'spacing_consistency',
  'scroll',
  'print',
  'interaction',
];

// Category-to-audit mapping so we know which audits to run for each bug category
const CATEGORY_AUDITS = {
  accessibility: ['accessibility', 'color_contrast', 'focus_order', 'tap_targets', 'interaction'],
  seo: ['meta', 'broken_links'],
  visual: ['breakpoints', 'overflow', 'dark_mode', 'image_sizes', 'spacing_consistency', 'scroll'],
  spacing: ['spacing_consistency'],
  performance: ['core_web_vitals', 'image_sizes', 'fonts'],
  typography: ['fonts'],
  security: ['security_headers', 'mixed_content', 'third_party_scripts', 'cookie_compliance'],
  print: ['print'],
  forms: [],
};

// ─── Entry Point ────────────────────────────────────────────────────────

export async function handleAccuracy(args) {
  const { flags } = parseArgs(args);

  if (flags.url) {
    // Real URL mode: just run all audits and report findings
    return runRealUrlAudit(flags.url, flags);
  }

  // Test page mode: run against fixtures, score against answer key
  const answerKeyPath = path.resolve(PROJECT_ROOT, 'tests', 'fixtures', 'answer-key.json');
  if (!fs.existsSync(answerKeyPath)) {
    console.error(`Error: Answer key not found at ${answerKeyPath}`);
    console.error('Create tests/fixtures/answer-key.json with known bugs for each test page.');
    process.exit(1);
  }

  const answerKey = JSON.parse(fs.readFileSync(answerKeyPath, 'utf8'));
  const pages = flags.page ? [flags.page] : Object.keys(answerKey);

  // Validate requested pages exist in answer key
  for (const pageName of pages) {
    if (!answerKey[pageName]) {
      console.error(`Error: Page "${pageName}" not found in answer key.`);
      console.error(`Available pages: ${Object.keys(answerKey).join(', ')}`);
      process.exit(1);
    }
  }

  // Launch browser once for all pages
  const { browser, context, page } = await launchStandalone(flags);

  const allScores = [];
  let totalFound = 0;
  let totalBugs = 0;

  try {
    for (const pageName of pages) {
      const pagePath = path.resolve(PROJECT_ROOT, 'tests', 'fixtures', pageName);
      if (!fs.existsSync(pagePath)) {
        console.error(`Warning: Test page not found: ${pagePath}`);
        continue;
      }

      const pageUrl = `file:///${pagePath.replace(/\\/g, '/')}`;
      const knownBugs = answerKey[pageName].bugs;

      // Navigate to the test page
      try {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(300);
      } catch (err) {
        console.error(`Failed to navigate to ${pageName}: ${err.message}`);
        continue;
      }

      // Run all implemented audits
      const findings = await runAllAudits(page, context);

      // Score findings against known bugs
      const score = scoreFindingsAgainstBugs(findings, knownBugs);

      allScores.push({ pageName, score, knownBugs, findings });
      totalFound += score.found;
      totalBugs += knownBugs.length;

      if (!flags.json) {
        printScore(pageName, score, findings, knownBugs, flags.verbose);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // Print summary
  if (!flags.json) {
    printSummary(allScores, totalFound, totalBugs);
  } else {
    printJsonOutput(allScores, totalFound, totalBugs);
  }

  // Exit with code 0 regardless — this is a measurement tool, not a pass/fail gate
  process.exit(0);
}

// ─── Audit Runner ───────────────────────────────────────────────────────

async function runAllAudits(page, context) {
  const findings = [];
  const opts = { savePath: null, flags: {} };

  // Dynamically import audit handlers from audit.js
  // We use a workaround: re-implement the core audit checks inline since
  // audit.js doesn't export individual handlers. This keeps accuracy.js
  // self-contained and avoids modifying audit.js.

  // 1. Accessibility audit
  try {
    const a11yResults = await runAccessibilityAudit(page);
    for (const v of a11yResults) {
      findings.push({
        audit: 'accessibility',
        category: 'accessibility',
        id: v.id,
        description: v.description,
        selector: v.target || '',
        severity: v.impact || 'moderate',
        count: v.count || 1,
      });
    }
  } catch (err) {
    console.error(`  Error in accessibility audit: ${err.message}`);
  }

  // 2. Color contrast audit
  try {
    const contrastResults = await runColorContrastAudit(page);
    for (const f of contrastResults) {
      findings.push({
        audit: 'color_contrast',
        category: 'accessibility',
        id: 'color-contrast',
        description: `Insufficient contrast: "${f.text}" — ratio ${f.ratio}:1 (required ${f.required}:1)`,
        selector: f.selector || '',
        severity: 'serious',
      });
    }
  } catch (err) {
    console.error(`  Error in color contrast audit: ${err.message}`);
  }

  // 3. Meta/SEO audit
  try {
    const metaResults = await runMetaAudit(page);
    for (const issue of metaResults) {
      findings.push({
        audit: 'meta',
        category: 'seo',
        id: issue.id,
        description: issue.msg,
        selector: 'head',
        severity: issue.severity || 'moderate',
      });
    }
  } catch (err) {
    console.error(`  Error in meta audit: ${err.message}`);
  }

  // 4. Overflow detection
  try {
    const overflowResults = await runOverflowAudit(page);
    for (const o of overflowResults) {
      findings.push({
        audit: 'overflow',
        category: 'visual',
        id: 'overflow',
        description: o.description || `Overflow detected: ${o.selector}`,
        selector: o.selector || '',
        severity: o.severity || 'serious',
      });
    }
  } catch (err) {
    console.error(`  Error in overflow audit: ${err.message}`);
  }

  // 5. Tap target audit
  try {
    const tapResults = await runTapTargetAudit(page);
    for (const t of tapResults) {
      findings.push({
        audit: 'tap_targets',
        category: 'accessibility',
        id: 'tap-target',
        description: t.description || `Tap target too small: ${t.selector}`,
        selector: t.selector || '',
        severity: t.severity || 'serious',
      });
    }
  } catch (err) {
    console.error(`  Error in tap target audit: ${err.message}`);
  }

  // 6. Image audit
  try {
    const imageResults = await runImageAudit(page);
    for (const img of imageResults) {
      findings.push({
        audit: 'image_sizes',
        category: 'visual',
        id: img.id || 'image-issue',
        description: img.description || img.msg || 'Image issue',
        selector: img.selector || '',
        severity: img.severity || 'moderate',
      });
    }
  } catch (err) {
    console.error(`  Error in image audit: ${err.message}`);
  }

  // 7. Focus order audit
  try {
    const focusResults = await runFocusOrderAudit(page);
    for (const f of focusResults) {
      findings.push({
        audit: 'focus_order',
        category: 'accessibility',
        id: f.id || 'focus-order',
        description: f.description || 'Focus order issue',
        selector: f.selector || '',
        severity: f.severity || 'moderate',
      });
    }
  } catch (err) {
    console.error(`  Error in focus order audit: ${err.message}`);
  }

  // 8. Font consistency audit
  try {
    const fontResults = await runFontAudit(page);
    for (const f of fontResults) {
      findings.push({
        audit: 'fonts',
        category: f.category || 'typography',
        id: f.id || 'font-consistency',
        description: f.description,
        selector: f.selector || '',
        severity: f.severity || 'moderate',
      });
    }
  } catch (err) {
    console.error(`  Error in font consistency audit: ${err.message}`);
  }

  // 9. Spacing consistency audit
  try {
    const spacingResults = await runSpacingAudit(page);
    for (const s of spacingResults) {
      findings.push({
        audit: 'spacing_consistency',
        category: s.category || 'spacing',
        id: s.id || 'spacing-inconsistency',
        description: s.description,
        selector: s.selector || '',
        severity: s.severity || 'moderate',
      });
    }
  } catch (err) {
    console.error(`  Error in spacing consistency audit: ${err.message}`);
  }

  // 10. Scroll audit (fixed/sticky overlap, scrollbar layout shift)
  try {
    const scrollResults = await runScrollAudit(page);
    for (const s of scrollResults) {
      findings.push({
        audit: 'scroll',
        category: s.category || 'visual',
        id: s.id || 'scroll-issue',
        description: s.description,
        selector: s.selector || '',
        severity: s.severity || 'serious',
      });
    }
  } catch (err) {
    console.error(`  Error in scroll audit: ${err.message}`);
  }

  // 11. Print audit (print stylesheet hides content)
  try {
    const printResults = await runPrintAudit(page);
    for (const p of printResults) {
      findings.push({
        audit: 'print',
        category: p.category || 'print',
        id: p.id || 'print-issue',
        description: p.description,
        selector: p.selector || '',
        severity: p.severity || 'serious',
      });
    }
  } catch (err) {
    console.error(`  Error in print audit: ${err.message}`);
  }

  // 12. Interaction audit (auto-playing animations, user-select: none)
  try {
    const interactionResults = await runInteractionAudit(page);
    for (const i of interactionResults) {
      findings.push({
        audit: 'interaction',
        category: i.category || 'accessibility',
        id: i.id || 'interaction-issue',
        description: i.description,
        selector: i.selector || '',
        severity: i.severity || 'serious',
      });
    }
  } catch (err) {
    console.error(`  Error in interaction audit: ${err.message}`);
  }

  return findings;
}

// ─── Individual Audit Implementations ───────────────────────────────────
// Lean versions of audit.js checks, returning raw finding arrays.

async function runAccessibilityAudit(page) {
  return page.evaluate(() => {
    const violations = [];

    function isVisible(el) {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
        && el.offsetWidth > 0 && el.offsetHeight > 0;
    }

    // Images without alt text
    document.querySelectorAll('img').forEach(img => {
      if (!img.hasAttribute('alt')) {
        violations.push({
          id: 'image-alt', impact: 'critical',
          description: 'Images must have alternate text',
          target: img.className ? `img.${img.className.split(' ')[0]}` : 'img',
        });
      }
    });

    // Form inputs without labels
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
          target: input.className ? `input.${input.className.split(' ')[0]}` : `input[${input.type || 'text'}]`,
        });
      }
    });

    // Empty links
    document.querySelectorAll('a[href]').forEach(link => {
      if (!isVisible(link)) return;
      const text = (link.textContent || '').trim();
      const ariaLabel = link.getAttribute('aria-label') || '';
      const img = link.querySelector('img[alt]');
      if (!text && !ariaLabel && !img) {
        violations.push({
          id: 'link-name', impact: 'serious',
          description: 'Links must have discernible text',
          target: link.className ? `a.${link.className.split(' ')[0]}` : 'a',
        });
      }
    });

    // Empty buttons (no text content, no aria-label, no child img with alt)
    document.querySelectorAll('button, [role="button"]').forEach(btn => {
      if (!isVisible(btn)) return;
      const text = (btn.textContent || '').trim();
      const ariaLabel = btn.getAttribute('aria-label') || '';
      const img = btn.querySelector('img[alt]');
      if (!text && !ariaLabel && !img) {
        const tag = btn.tagName.toLowerCase();
        const classes = (typeof btn.className === 'string' && btn.className.trim())
          ? '.' + btn.className.trim().split(/\s+/).join('.')
          : '';
        violations.push({
          id: 'button-name', impact: 'critical',
          description: 'Buttons must have discernible text',
          target: tag + classes,
        });
      }
    });

    // Document language
    if (!document.documentElement.getAttribute('lang')) {
      violations.push({
        id: 'html-has-lang', impact: 'serious',
        description: 'HTML element must have a lang attribute',
        target: 'html',
      });
    }

    // Page title
    if (!document.title || !document.title.trim()) {
      violations.push({
        id: 'document-title', impact: 'serious',
        description: 'Document must have a <title> element',
        target: 'head',
      });
    }

    // Heading order
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let prevLevel = 0;
    headings.forEach(h => {
      const level = parseInt(h.tagName[1]);
      if (prevLevel > 0 && level > prevLevel + 1) {
        violations.push({
          id: 'heading-order', impact: 'moderate',
          description: `Heading levels should increase by one: found h${level} after h${prevLevel}`,
          target: h.tagName.toLowerCase(),
        });
      }
      prevLevel = level;
    });

    // Invalid ARIA roles
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
          target: el.tagName.toLowerCase() + '[role=' + role + ']',
        });
      }
    });

    // Tabindex > 0
    document.querySelectorAll('[tabindex]').forEach(el => {
      const val = parseInt(el.getAttribute('tabindex'));
      if (val > 0) {
        violations.push({
          id: 'tabindex', impact: 'serious',
          description: 'Elements should not have tabindex > 0',
          target: el.tagName.toLowerCase() + '[tabindex=' + val + ']',
        });
      }
    });

    return violations;
  });
}

async function runColorContrastAudit(page) {
  return page.evaluate(() => {
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

    const textElements = document.querySelectorAll(
      'p, span, a, h1, h2, h3, h4, h5, h6, li, td, th, label, button, div, strong, em, b, i, small'
    );
    const failures = [];
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

      if (ratio < required) {
        failures.push({
          text: (el.textContent || '').trim().slice(0, 60),
          selector: el.tagName.toLowerCase() +
            (el.className ? '.' + String(el.className).split(' ')[0] : ''),
          foreground: style.color,
          background: `rgb(${bgParsed.r}, ${bgParsed.g}, ${bgParsed.b})`,
          ratio: Math.round(ratio * 100) / 100,
          required,
        });
      }
    });

    return failures;
  });
}

async function runMetaAudit(page) {
  return page.evaluate(() => {
    const issues = [];

    const title = document.title || null;
    if (!title) {
      issues.push({ id: 'title-missing', severity: 'critical', msg: 'Missing <title>' });
    } else if (title.length < 10) {
      issues.push({ id: 'title-short', severity: 'moderate', msg: `Title too short (${title.length} chars)` });
    } else if (title.length > 60) {
      issues.push({ id: 'title-long', severity: 'moderate', msg: `Title too long (${title.length} chars)` });
    }

    const descMeta = document.querySelector('meta[name="description"]');
    const description = descMeta ? descMeta.getAttribute('content') : null;
    if (!description) {
      issues.push({ id: 'desc-missing', severity: 'critical', msg: 'Missing meta description' });
    } else if (description.length < 50) {
      issues.push({ id: 'desc-short', severity: 'moderate', msg: `Description too short (${description.length} chars)` });
    } else if (description.length > 160) {
      issues.push({ id: 'desc-long', severity: 'moderate', msg: `Description too long (${description.length} chars)` });
    }

    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (!viewportMeta) {
      issues.push({ id: 'viewport-missing', severity: 'critical', msg: 'Missing viewport meta' });
    }

    const canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      issues.push({ id: 'canonical-missing', severity: 'moderate', msg: 'No canonical URL' });
    }

    const h1Count = document.querySelectorAll('h1').length;
    if (h1Count === 0) {
      issues.push({ id: 'h1-missing', severity: 'critical', msg: 'No <h1> on page' });
    } else if (h1Count > 1) {
      issues.push({ id: 'h1-multiple', severity: 'moderate', msg: `Multiple <h1> tags (${h1Count})` });
    }

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (!ogTitle) issues.push({ id: 'og-title-missing', severity: 'minor', msg: 'Missing og:title' });

    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (!ogDesc) issues.push({ id: 'og-desc-missing', severity: 'minor', msg: 'Missing og:description' });

    const ogImage = document.querySelector('meta[property="og:image"]');
    if (!ogImage) issues.push({ id: 'og-image-missing', severity: 'minor', msg: 'Missing og:image' });

    return issues;
  });
}

async function runOverflowAudit(page) {
  return page.evaluate(() => {
    const issues = [];
    const viewportWidth = window.innerWidth;

    // Check document-level overflow
    if (document.documentElement.scrollWidth > viewportWidth + 5) {
      issues.push({
        description: `Page has horizontal overflow: scrollWidth ${document.documentElement.scrollWidth}px > viewport ${viewportWidth}px`,
        selector: 'html',
        severity: 'serious',
      });
    }

    // Check individual elements
    const all = document.querySelectorAll('*');
    const checked = new Set();
    all.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      // Element extends beyond viewport
      if (rect.right > viewportWidth + 5) {
        const selector = el.tagName.toLowerCase() +
          (el.className ? '.' + String(el.className).split(' ')[0] : '') +
          (el.id ? '#' + el.id : '');
        if (checked.has(selector)) return;
        checked.add(selector);
        issues.push({
          description: `Element overflows viewport: ${selector} (right edge at ${Math.round(rect.right)}px, viewport is ${viewportWidth}px)`,
          selector,
          severity: 'serious',
        });
      }

      // Element content overflows its own container
      if (el.scrollWidth > el.clientWidth + 5 && el.clientWidth > 0) {
        const style = window.getComputedStyle(el);
        const overflowX = style.overflowX;
        // Only flag if overflow is visible (not hidden/scroll/auto)
        if (overflowX === 'visible') {
          const selector = el.tagName.toLowerCase() +
            (el.className ? '.' + String(el.className).split(' ')[0] : '') +
            (el.id ? '#' + el.id : '');
          if (checked.has(selector)) return;
          checked.add(selector);
          issues.push({
            description: `Content overflows container: ${selector} (scrollWidth ${el.scrollWidth}px > clientWidth ${el.clientWidth}px)`,
            selector,
            severity: 'serious',
          });
        }
      }
    });

    return issues;
  });
}

async function runTapTargetAudit(page) {
  return page.evaluate(() => {
    const issues = [];
    const MIN_SIZE = 44; // WCAG 2.5.5 minimum

    const interactiveSelectors = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [tabindex]';
    const elements = document.querySelectorAll(interactiveSelectors);

    elements.forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
        const selector = el.tagName.toLowerCase() +
          (el.className ? '.' + String(el.className).split(' ')[0] : '') +
          (el.id ? '#' + el.id : '');
        issues.push({
          description: `Tap target too small: ${selector} (${Math.round(rect.width)}x${Math.round(rect.height)}px, minimum ${MIN_SIZE}x${MIN_SIZE}px)`,
          selector,
          severity: 'serious',
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    });

    return issues;
  });
}

async function runImageAudit(page) {
  return page.evaluate(() => {
    const issues = [];

    document.querySelectorAll('img').forEach(img => {
      // Missing alt
      if (!img.hasAttribute('alt')) {
        const selector = img.className ? `img.${img.className.split(' ')[0]}` : 'img';
        issues.push({
          id: 'image-alt-missing',
          description: `Image missing alt attribute: ${img.src ? img.src.slice(0, 80) : '(no src)'}`,
          selector,
          severity: 'critical',
        });
      }

      // Missing dimensions (width/height attributes)
      if (!img.hasAttribute('width') && !img.hasAttribute('height')) {
        const selector = img.className ? `img.${img.className.split(' ')[0]}` : 'img';
        issues.push({
          id: 'image-dimensions',
          description: `Image missing explicit dimensions (causes layout shift)`,
          selector,
          severity: 'moderate',
        });
      }

      // Missing lazy loading
      if (!img.hasAttribute('loading')) {
        const rect = img.getBoundingClientRect();
        if (rect.top > window.innerHeight) {
          const selector = img.className ? `img.${img.className.split(' ')[0]}` : 'img';
          issues.push({
            id: 'image-lazy',
            description: `Below-fold image missing loading="lazy"`,
            selector,
            severity: 'minor',
          });
        }
      }
    });

    return issues;
  });
}

async function runFocusOrderAudit(page) {
  return page.evaluate(() => {
    const issues = [];

    // Check for positive tabindex (disrupts natural order)
    document.querySelectorAll('[tabindex]').forEach(el => {
      const val = parseInt(el.getAttribute('tabindex'));
      if (val > 0) {
        const selector = el.tagName.toLowerCase() +
          (el.className ? '.' + String(el.className).split(' ')[0] : '');
        issues.push({
          id: 'positive-tabindex',
          description: `Element has positive tabindex (${val}), disrupts focus order`,
          selector,
          severity: 'serious',
        });
      }
    });

    // Check focusable elements are in DOM order
    const focusable = document.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    let prevRect = null;
    let outOfOrder = 0;
    focusable.forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      if (prevRect) {
        // Flag if visual order doesn't match DOM order (element appears before previous in visual layout)
        if (rect.top < prevRect.top - 50 && rect.left < prevRect.left - 50) {
          outOfOrder++;
        }
      }
      prevRect = rect;
    });

    if (outOfOrder > 0) {
      issues.push({
        id: 'focus-order-mismatch',
        description: `${outOfOrder} focusable element(s) may have visual order different from DOM order`,
        selector: 'body',
        severity: 'moderate',
      });
    }

    return issues;
  });
}

async function runFontAudit(page) {
  return page.evaluate(() => {
    const issues = [];

    // ── Helpers ──

    function isVisible(el) {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
        && el.offsetWidth > 0 && el.offsetHeight > 0;
    }

    function hasDirectText(el) {
      return Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
    }

    // Extract the primary (first) font from a computed font-family stack.
    // e.g. '"Helvetica Neue", Arial, sans-serif' -> 'helvetica neue'
    function primaryFont(fontFamily) {
      if (!fontFamily) return '';
      const first = fontFamily.split(',')[0].trim();
      return first.replace(/["']/g, '').toLowerCase();
    }

    // Known groups of similar-but-different fonts that indicate copy-paste
    // inconsistency or accidental mixing.
    const SIMILAR_FONT_GROUPS = [
      ['arial', 'helvetica', 'helvetica neue'],
      ['times new roman', 'times', 'georgia', 'palatino'],
      ['courier new', 'courier', 'lucida console'],
      ['verdana', 'tahoma', 'trebuchet ms'],
      ['segoe ui', 'roboto', 'open sans', 'noto sans'],
      ['calibri', 'carlito'],
    ];

    function findFontGroup(fontName) {
      const lower = fontName.toLowerCase();
      for (const group of SIMILAR_FONT_GROUPS) {
        if (group.includes(lower)) return group;
      }
      return null;
    }

    // ── 1. Collect computed font-family and font-size for every visible text element ──

    const TEXT_SELECTOR = 'p, span, a, h1, h2, h3, h4, h5, h6, li, td, th, label, button, div, strong, em, b, i, small, blockquote, figcaption, dt, dd';
    const elements = document.querySelectorAll(TEXT_SELECTOR);

    // Map: primaryFont -> { count, selectors[], fullStack }
    const fontUsage = {};
    // Map: tag -> { fontSize -> selectors[] }
    const sizesByTag = {};

    elements.forEach(el => {
      if (!isVisible(el)) return;
      if (!hasDirectText(el)) return;

      const style = window.getComputedStyle(el);
      const fullStack = style.fontFamily;
      const primary = primaryFont(fullStack);
      const fontSize = style.fontSize;
      const tag = el.tagName.toLowerCase();
      const selector = tag +
        (el.className ? '.' + String(el.className).split(' ')[0] : '') +
        (el.id ? '#' + el.id : '');

      if (primary) {
        if (!fontUsage[primary]) {
          fontUsage[primary] = { count: 0, selectors: [], fullStack };
        }
        fontUsage[primary].count++;
        if (fontUsage[primary].selectors.length < 3) {
          fontUsage[primary].selectors.push(selector);
        }
      }

      // Track sizes by heading/semantic tag for consistency checks
      const semanticTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'td', 'th', 'button', 'a'];
      if (semanticTags.includes(tag)) {
        if (!sizesByTag[tag]) sizesByTag[tag] = {};
        if (!sizesByTag[tag][fontSize]) sizesByTag[tag][fontSize] = [];
        if (sizesByTag[tag][fontSize].length < 3) {
          sizesByTag[tag][fontSize].push(selector);
        }
      }
    });

    // ── 2. Detect similar-but-different fonts (e.g. Arial vs Helvetica) ──

    const primaryFonts = Object.keys(fontUsage);
    const flaggedPairs = new Set();

    for (let i = 0; i < primaryFonts.length; i++) {
      const fontA = primaryFonts[i];
      const groupA = findFontGroup(fontA);
      if (!groupA) continue;

      for (let j = i + 1; j < primaryFonts.length; j++) {
        const fontB = primaryFonts[j];
        if (fontA === fontB) continue;
        const groupB = findFontGroup(fontB);
        if (!groupB) continue;

        // Same similarity group -> flag inconsistency
        if (groupA === groupB) {
          const pairKey = [fontA, fontB].sort().join('|');
          if (flaggedPairs.has(pairKey)) continue;
          flaggedPairs.add(pairKey);

          const examplesA = fontUsage[fontA].selectors.slice(0, 2).join(', ');
          const examplesB = fontUsage[fontB].selectors.slice(0, 2).join(', ');

          issues.push({
            category: 'typography',
            id: 'font-similar-mismatch',
            description: `Similar but different fonts used: "${fontA}" (${fontUsage[fontA].count} elements, e.g. ${examplesA}) vs "${fontB}" (${fontUsage[fontB].count} elements, e.g. ${examplesB})`,
            selector: fontUsage[fontA].selectors[0] || '',
            severity: 'serious',
          });
        }
      }
    }

    // ── 3. Detect mixed font families (more than 3 distinct primary fonts is suspicious) ──

    const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);
    const nonGenericFonts = primaryFonts.filter(f => !GENERIC.has(f));

    if (nonGenericFonts.length > 3) {
      const fontList = nonGenericFonts.map(f => `"${f}" (${fontUsage[f].count})`).join(', ');
      issues.push({
        category: 'typography',
        id: 'font-too-many-families',
        description: `Too many distinct font families (${nonGenericFonts.length}): ${fontList}. Aim for 2-3 max for visual consistency.`,
        selector: 'body',
        severity: 'moderate',
      });
    }

    // ── 4. Detect inconsistent font sizes within same element type ──

    const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
    for (const tag of Object.keys(sizesByTag)) {
      const sizes = Object.keys(sizesByTag[tag]);
      if (sizes.length <= 1) continue;

      // Only flag if there are enough elements to make it meaningful
      const totalElements = sizes.reduce((sum, s) => sum + sizesByTag[tag][s].length, 0);
      if (totalElements < 2) continue;

      // For headings, any size variation is a problem
      // For body text, minor variations may be intentional
      const isHeading = headingTags.includes(tag);
      if (!isHeading && sizes.length <= 2) continue;

      const sizeDetail = sizes.map(s => {
        const examples = sizesByTag[tag][s].slice(0, 2).join(', ');
        return `${s} (e.g. ${examples})`;
      }).join(', ');

      issues.push({
        category: 'typography',
        id: 'font-size-inconsistent',
        description: `Inconsistent font sizes for <${tag}>: ${sizeDetail}`,
        selector: tag,
        severity: isHeading ? 'serious' : 'moderate',
      });
    }

    return issues;
  });
}

async function runSpacingAudit(page) {
  return page.evaluate(() => {
    const issues = [];

    function isVisible(el) {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
        && el.offsetWidth > 0 && el.offsetHeight > 0;
    }

    function buildSelector(el) {
      const tag = el.tagName.toLowerCase();
      const cls = el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/)[0]
        : '';
      const id = el.id ? '#' + el.id : '';
      return tag + id + cls;
    }

    // ── 1. Collect margin/padding values from all visible elements ──
    const spacingFreq = {};       // value (px number) -> count
    const spacingElements = {};   // value (px number) -> first selector seen
    const props = [
      'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    ];

    const allElements = document.querySelectorAll('body *');
    for (const el of allElements) {
      if (!isVisible(el)) continue;
      const style = window.getComputedStyle(el);

      for (const prop of props) {
        const raw = parseFloat(style[prop]);
        if (isNaN(raw) || raw === 0) continue; // skip 0 — always valid
        const val = Math.round(raw);
        spacingFreq[val] = (spacingFreq[val] || 0) + 1;
        if (!spacingElements[val]) {
          spacingElements[val] = { selector: buildSelector(el), prop };
        }
      }
    }

    // ── 2. Detect dominant spacing scale ──
    // Common design-system scales: multiples of 4, multiples of 8, multiples of 5
    // Strategy: check which base divides the most frequently-used values
    const entries = Object.entries(spacingFreq)
      .map(([val, count]) => ({ val: Number(val), count }))
      .sort((a, b) => b.count - a.count);

    if (entries.length === 0) return issues;

    // Total occurrences for weighting
    const totalOccurrences = entries.reduce((sum, e) => sum + e.count, 0);

    // Score each candidate base (2, 4, 5, 6, 8, 10) by what % of occurrences it explains
    const candidateBases = [2, 4, 5, 6, 8, 10];
    let bestBase = 4;
    let bestCoverage = 0;

    for (const base of candidateBases) {
      let covered = 0;
      for (const { val, count } of entries) {
        if (val % base === 0) covered += count;
      }
      const coverage = covered / totalOccurrences;
      if (coverage > bestCoverage) {
        bestCoverage = coverage;
        bestBase = base;
      }
    }

    // Build the scale set: all multiples of bestBase that actually appear, plus 0
    const scaleSet = new Set([0]);
    for (const { val } of entries) {
      if (val % bestBase === 0) scaleSet.add(val);
    }

    // ── 3. Flag outliers — values that don't fit the dominant scale ──
    // Only flag if the scale explains >= 60% of values (otherwise there's no clear scale)
    if (bestCoverage >= 0.6) {
      for (const { val, count } of entries) {
        if (val % bestBase !== 0 && val > 1) {
          // Determine severity: high-frequency outliers are more serious
          const severity = count >= 5 ? 'serious' : 'moderate';
          const nearest = Math.round(val / bestBase) * bestBase;
          const info = spacingElements[val];
          issues.push({
            category: 'spacing',
            description: `Spacing outlier: ${val}px used ${count} time(s) — doesn't fit ${bestBase}px scale (nearest: ${nearest}px)`,
            selector: info ? info.selector : '',
            severity,
            id: 'spacing-scale-outlier',
          });
        }
      }
    }

    // ── 4. Check CSS Grid gap values for inconsistency ──
    const gridGaps = {};    // gap value -> count
    const gridGapEls = {};  // gap value -> first selector

    for (const el of allElements) {
      if (!isVisible(el)) continue;
      const style = window.getComputedStyle(el);
      if (style.display !== 'grid' && style.display !== 'inline-grid') continue;

      // rowGap and columnGap are the resolved properties
      const rowGap = parseFloat(style.rowGap);
      const colGap = parseFloat(style.columnGap);
      const selector = buildSelector(el);

      for (const gap of [rowGap, colGap]) {
        if (isNaN(gap) || gap === 0) continue;
        const rounded = Math.round(gap);
        gridGaps[rounded] = (gridGaps[rounded] || 0) + 1;
        if (!gridGapEls[rounded]) gridGapEls[rounded] = selector;
      }
    }

    const gapValues = Object.keys(gridGaps).map(Number).sort((a, b) => a - b);

    if (gapValues.length > 1) {
      // Find the most common gap value
      let dominantGap = gapValues[0];
      let maxCount = 0;
      for (const v of gapValues) {
        if (gridGaps[v] > maxCount) {
          maxCount = gridGaps[v];
          dominantGap = v;
        }
      }

      // Flag gap values that differ from the dominant gap
      for (const v of gapValues) {
        if (v !== dominantGap) {
          issues.push({
            category: 'spacing',
            description: `Grid gap inconsistency: ${v}px (used ${gridGaps[v]} time(s)) vs dominant ${dominantGap}px — selector: ${gridGapEls[v]}`,
            selector: gridGapEls[v] || '',
            severity: 'moderate',
            id: 'grid-gap-inconsistency',
          });
        }
      }
    }

    // Also flag grid gaps that don't fit the detected spacing scale
    if (bestCoverage >= 0.6) {
      for (const v of gapValues) {
        if (v % bestBase !== 0 && v > 1) {
          const nearest = Math.round(v / bestBase) * bestBase;
          issues.push({
            category: 'spacing',
            description: `Grid gap ${v}px doesn't fit ${bestBase}px spacing scale (nearest: ${nearest}px) — selector: ${gridGapEls[v]}`,
            selector: gridGapEls[v] || '',
            severity: 'moderate',
            id: 'grid-gap-scale-outlier',
          });
        }
      }
    }

    return issues;
  });
}

// ─── Scroll Audit ───────────────────────────────────────────────────────
// Detects fixed/sticky elements covering content and scrollbar layout shift.

async function runScrollAudit(page) {
  // Measure body width before scroll
  const widthBefore = await page.evaluate(() => document.body.offsetWidth);

  // Scroll to the bottom of the page
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);

  // Measure body width after scroll (scrollbar appearance may shift layout)
  const widthAfter = await page.evaluate(() => document.body.offsetWidth);

  const issues = [];

  // Check for scrollbar layout shift
  if (Math.abs(widthBefore - widthAfter) > 1) {
    issues.push({
      category: 'visual',
      id: 'scrollbar-layout-shift',
      description: `Scrollbar causes layout shift: body width changed from ${widthBefore}px to ${widthAfter}px on scroll`,
      selector: 'html',
      severity: 'serious',
    });
  }

  // Check for fixed/sticky elements that overlap main content while scrolled
  const fixedOverlapIssues = await page.evaluate(() => {
    const results = [];
    const allElements = document.querySelectorAll('*');
    const fixedEls = [];

    for (const el of allElements) {
      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'sticky') {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        fixedEls.push({ el, rect, position: style.position });
      }
    }

    // Find main content area
    const mainContent = document.querySelector('main, [role="main"], article, .content, #content, .main, #main');
    const contentRect = mainContent
      ? mainContent.getBoundingClientRect()
      : { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };

    for (const { el, rect, position } of fixedEls) {
      // Check if fixed element overlaps the content region
      const overlapsHorizontally = rect.left < contentRect.right && rect.right > contentRect.left;
      const overlapsVertically = rect.top < contentRect.bottom && rect.bottom > contentRect.top;

      if (overlapsHorizontally && overlapsVertically) {
        // Calculate overlap area
        const overlapHeight = Math.min(rect.bottom, contentRect.bottom) - Math.max(rect.top, contentRect.top);
        const overlapWidth = Math.min(rect.right, contentRect.right) - Math.max(rect.left, contentRect.left);
        const overlapArea = overlapHeight * overlapWidth;
        const contentArea = (contentRect.bottom - contentRect.top) * (contentRect.right - contentRect.left);
        const overlapPercent = contentArea > 0 ? Math.round((overlapArea / contentArea) * 100) : 0;

        // Only flag if overlap is significant (covers more than a trivial portion)
        if (overlapPercent >= 5 || overlapHeight >= 50) {
          const selector = el.tagName.toLowerCase() +
            (el.className ? '.' + String(el.className).split(' ')[0] : '') +
            (el.id ? '#' + el.id : '');
          results.push({
            category: 'visual',
            id: 'fixed-element-overlap',
            description: `${position} element "${selector}" covers content when scrolled (${Math.round(rect.height)}px tall, overlaps ~${overlapPercent}% of content area)`,
            selector,
            severity: overlapPercent >= 20 ? 'critical' : 'serious',
          });
        }
      }
    }

    return results;
  });

  issues.push(...fixedOverlapIssues);

  // Scroll back to top to restore state for subsequent audits
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);

  return issues;
}

// ─── Print Audit ────────────────────────────────────────────────────────
// Checks if print stylesheet hides main content.

async function runPrintAudit(page) {
  const issues = [];

  // Emulate print media
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(200);

  const printIssues = await page.evaluate(() => {
    const results = [];

    // Check if main content containers are hidden
    const contentSelectors = [
      'main', '[role="main"]', 'article', '.content', '#content',
      '.main', '#main', '.page', '#page', '.wrapper', '#wrapper',
      'body > div', 'body > section',
    ];

    let mainContentHidden = false;
    let hiddenSelector = '';

    for (const sel of contentSelectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') {
          mainContentHidden = true;
          hiddenSelector = sel + (el.className ? '.' + String(el.className).split(' ')[0] : '');
          break;
        }
      }
      if (mainContentHidden) break;
    }

    if (mainContentHidden) {
      results.push({
        category: 'print',
        id: 'print-content-hidden',
        description: `Print stylesheet hides main content (${hiddenSelector} has display:none or visibility:hidden)`,
        selector: hiddenSelector,
        severity: 'critical',
      });
    }

    // Check if body itself is hidden
    const bodyStyle = window.getComputedStyle(document.body);
    if (bodyStyle.display === 'none' || bodyStyle.visibility === 'hidden') {
      results.push({
        category: 'print',
        id: 'print-body-hidden',
        description: 'Print stylesheet hides the entire body',
        selector: 'body',
        severity: 'critical',
      });
    }

    // Check how many visible text elements remain
    const textEls = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, span, a');
    let visibleTextCount = 0;
    let totalTextCount = 0;
    for (const el of textEls) {
      const text = (el.textContent || '').trim();
      if (!text) continue;
      totalTextCount++;
      const style = window.getComputedStyle(el);
      if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
        visibleTextCount++;
      }
    }

    if (totalTextCount > 0 && visibleTextCount === 0) {
      results.push({
        category: 'print',
        id: 'print-all-text-hidden',
        description: `Print stylesheet hides all text content (0 of ${totalTextCount} text elements visible)`,
        selector: 'body',
        severity: 'critical',
      });
    } else if (totalTextCount > 5 && visibleTextCount < totalTextCount * 0.3) {
      results.push({
        category: 'print',
        id: 'print-most-text-hidden',
        description: `Print stylesheet hides most text content (${visibleTextCount} of ${totalTextCount} text elements visible)`,
        selector: 'body',
        severity: 'serious',
      });
    }

    return results;
  });

  issues.push(...printIssues);

  // Restore screen media
  await page.emulateMedia({ media: 'screen' });
  await page.waitForTimeout(100);

  return issues;
}

// ─── Interaction Audit ──────────────────────────────────────────────────
// Checks for auto-playing animations without reduced-motion support and
// user-select: none on text content.

async function runInteractionAudit(page) {
  return page.evaluate(() => {
    const issues = [];

    // --- Auto-playing CSS animations ---
    // Find elements with animation that run automatically (not triggered by hover/focus)
    const allElements = document.querySelectorAll('*');
    const animatedEls = [];

    for (const el of allElements) {
      const style = window.getComputedStyle(el);
      const animName = style.animationName;
      const animDuration = parseFloat(style.animationDuration);
      const animPlayState = style.animationPlayState;

      if (animName && animName !== 'none' && animDuration > 0 && animPlayState !== 'paused') {
        animatedEls.push({ el, animName, animDuration });
      }
    }

    if (animatedEls.length > 0) {
      // Check if the page has a prefers-reduced-motion media query
      let hasReducedMotionSupport = false;
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules || []) {
            if (rule instanceof CSSMediaRule &&
                rule.conditionText &&
                rule.conditionText.includes('prefers-reduced-motion')) {
              hasReducedMotionSupport = true;
              break;
            }
          }
        } catch (e) {
          // Cross-origin stylesheet, skip
        }
        if (hasReducedMotionSupport) break;
      }

      for (const { el, animName, animDuration } of animatedEls) {
        const selector = el.tagName.toLowerCase() +
          (el.className ? '.' + String(el.className).split(' ')[0] : '') +
          (el.id ? '#' + el.id : '');

        // Check if this specific animation has iteration count > 1 or infinite
        const style = window.getComputedStyle(el);
        const iterCount = style.animationIterationCount;
        const isLooping = iterCount === 'infinite' || parseFloat(iterCount) > 1;

        if (isLooping) {
          issues.push({
            category: 'accessibility',
            id: 'auto-animation-looping',
            description: `Auto-playing CSS animation "${animName}" loops on ${selector} (${iterCount} iterations, ${animDuration}s duration)`,
            selector,
            severity: 'serious',
          });
        }

        if (!hasReducedMotionSupport) {
          issues.push({
            category: 'accessibility',
            id: 'no-reduced-motion',
            description: `Page has CSS animations but no prefers-reduced-motion media query support (animation "${animName}" on ${selector})`,
            selector,
            severity: 'serious',
          });
          // Only report once per page
          break;
        }
      }

      // Check for animations that cannot be paused by the user
      for (const { el, animName } of animatedEls) {
        const style = window.getComputedStyle(el);
        const iterCount = style.animationIterationCount;
        if (iterCount === 'infinite') {
          // Check if there's a pause button nearby (heuristic)
          const parent = el.closest('section, div, article') || el.parentElement;
          const pauseBtn = parent?.querySelector('button[aria-label*="pause"], button[aria-label*="stop"], .pause, .stop, [data-pause]');
          if (!pauseBtn) {
            const selector = el.tagName.toLowerCase() +
              (el.className ? '.' + String(el.className).split(' ')[0] : '') +
              (el.id ? '#' + el.id : '');
            issues.push({
              category: 'accessibility',
              id: 'animation-no-pause',
              description: `Infinite CSS animation "${animName}" on ${selector} has no visible pause control`,
              selector,
              severity: 'serious',
            });
          }
        }
      }
    }

    // --- user-select: none on text content ---
    const textContentSelectors = 'p, td, th, li, span, div, article, section, main, h1, h2, h3, h4, h5, h6, blockquote, figcaption, label, dd, dt';
    const textElements = document.querySelectorAll(textContentSelectors);

    for (const el of textElements) {
      const style = window.getComputedStyle(el);
      if (style.userSelect === 'none' || style.webkitUserSelect === 'none') {
        // Only flag if element has meaningful text content
        const text = (el.textContent || '').trim();
        if (text.length < 5) continue;

        // Skip if it's an interactive element (button-like) where user-select: none is expected
        const role = el.getAttribute('role');
        if (role === 'button' || role === 'tab' || role === 'menuitem') continue;
        if (el.closest('button, [role="button"], nav, .nav, .navbar, .toolbar')) continue;

        const selector = el.tagName.toLowerCase() +
          (el.className ? '.' + String(el.className).split(' ')[0] : '') +
          (el.id ? '#' + el.id : '');

        issues.push({
          category: 'accessibility',
          id: 'user-select-none',
          description: `user-select: none on text content: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}" (${selector})`,
          selector,
          severity: 'serious',
        });
      }
    }

    return issues;
  });
}

// ─── Scoring Engine ─────────────────────────────────────────────────────

function scoreFindingsAgainstBugs(findings, knownBugs) {
  const matched = new Map();   // bugId -> finding that matched it
  const unmatched = [];        // bugs not matched
  const falsePositives = [];   // findings that didn't match any bug
  const findingUsed = new Set();

  for (const bug of knownBugs) {
    let bestMatch = null;
    let bestScore = 0;
    let bestIdx = -1;

    for (let i = 0; i < findings.length; i++) {
      if (findingUsed.has(i)) continue;
      const score = matchScore(bug, findings[i]);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = findings[i];
        bestIdx = i;
      }
    }

    // Require at least a moderate confidence match (score >= 2)
    if (bestMatch && bestScore >= 2) {
      matched.set(bug.id, { bug, finding: bestMatch, score: bestScore });
      findingUsed.add(bestIdx);
    } else {
      unmatched.push(bug);
    }
  }

  // Remaining findings are false positives (or bugs the answer key missed)
  for (let i = 0; i < findings.length; i++) {
    if (!findingUsed.has(i)) {
      falsePositives.push(findings[i]);
    }
  }

  return {
    found: matched.size,
    missed: unmatched.length,
    total: knownBugs.length,
    percentage: knownBugs.length > 0
      ? Math.round((matched.size / knownBugs.length) * 100)
      : 0,
    matched: [...matched.values()],
    unmatched,
    falsePositives,
  };
}

function matchScore(bug, finding) {
  let score = 0;

  // 1. Category match (broad)
  if (bug.category === finding.category) score += 1;

  // 2. Subcategory / audit ID match (strong signal)
  if (bug.subcategory) {
    const bugSub = bug.subcategory.toLowerCase().replace(/[_-]/g, '');
    const findingId = (finding.id || '').toLowerCase().replace(/[_-]/g, '');
    const findingAudit = (finding.audit || '').toLowerCase().replace(/[_-]/g, '');

    if (bugSub === findingId) score += 3;
    else if (findingId.includes(bugSub) || bugSub.includes(findingId)) score += 2;
    else if (bugSub === findingAudit) score += 1;
  }

  // 3. Selector match
  if (bug.selector && finding.selector) {
    const bugSel = bug.selector.toLowerCase();
    const findSel = finding.selector.toLowerCase();

    if (bugSel === findSel) score += 3;
    else if (findSel.includes(bugSel) || bugSel.includes(findSel)) score += 2;
    else {
      // Check class name overlap
      const bugClasses = bugSel.match(/\.[\w-]+/g) || [];
      const findClasses = findSel.match(/\.[\w-]+/g) || [];
      const overlap = bugClasses.filter(c => findClasses.includes(c));
      if (overlap.length > 0) score += 2;
    }
  }

  // 4. matchHints — fuzzy keyword matching
  if (bug.matchHints && bug.matchHints.length > 0) {
    const findingText = [
      finding.id, finding.description, finding.selector, finding.audit
    ].join(' ').toLowerCase();

    let hintMatches = 0;
    for (const hint of bug.matchHints) {
      if (findingText.includes(hint.toLowerCase())) {
        hintMatches++;
      }
    }
    // Each matching hint adds 0.5, up to 2
    score += Math.min(hintMatches * 0.5, 2);
  }

  // 5. Description similarity (basic word overlap)
  if (bug.description && finding.description) {
    const bugWords = new Set(bug.description.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    const findWords = new Set(finding.description.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    let overlap = 0;
    for (const w of bugWords) {
      if (findWords.has(w)) overlap++;
    }
    if (overlap >= 3) score += 1;
    else if (overlap >= 1) score += 0.5;
  }

  return score;
}

// ─── Real URL Mode ──────────────────────────────────────────────────────

async function runRealUrlAudit(url, flags) {
  console.log(`Running audit against: ${url}`);
  console.log('(No answer key — reporting all findings)\n');

  const { browser, context, page } = await launchStandalone(flags);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(500);

    const findings = await runAllAudits(page, context);

    if (flags.json) {
      console.log(JSON.stringify({
        url,
        mode: 'real-url',
        totalFindings: findings.length,
        findings: findings.map(f => ({
          audit: f.audit,
          category: f.category,
          id: f.id,
          description: f.description,
          selector: f.selector,
          severity: f.severity,
        })),
      }, null, 2));
    } else {
      console.log(`AUDIT FINDINGS: ${url}`);
      console.log('='.repeat(60));
      console.log(`Total findings: ${findings.length}\n`);

      // Group by category
      const byCategory = {};
      for (const f of findings) {
        const cat = f.category || 'other';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(f);
      }

      for (const [category, catFindings] of Object.entries(byCategory)) {
        console.log(`--- ${category.toUpperCase()} (${catFindings.length}) ---`);
        for (const f of catFindings) {
          const sev = (f.severity || 'unknown').toUpperCase().padEnd(8);
          console.log(`  [${sev}] ${f.description}`);
          if (flags.verbose && f.selector) {
            console.log(`           selector: ${f.selector}`);
          }
        }
        console.log('');
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  process.exit(0);
}

// ─── Output Formatting ─────────────────────────────────────────────────

function printScore(pageName, score, findings, knownBugs, verbose) {
  console.log('');
  console.log(`ACCURACY TEST: ${pageName}`);
  console.log('\u2550'.repeat(35 + pageName.length));
  console.log(`Known bugs: ${score.total}`);
  console.log(`Found:      ${score.found}`);
  console.log(`Missed:     ${score.missed}`);
  console.log(`False positives: ${score.falsePositives.length}`);
  console.log('');
  console.log(`Score: ${score.percentage}% (${score.found}/${score.total})`);
  console.log('');

  if (verbose) {
    // Show each bug status
    for (const { bug, finding } of score.matched) {
      console.log(`  \u2713 FOUND: ${bug.description} [${bug.id}]`);
    }
    for (const bug of score.unmatched) {
      console.log(`  \u2717 MISSED: ${bug.description} [${bug.id}]`);
    }
    if (score.falsePositives.length > 0) {
      console.log('');
      console.log('  False positives (audit found, not in answer key):');
      for (const fp of score.falsePositives) {
        console.log(`    ? ${fp.description} [${fp.audit}]`);
      }
    }
    console.log('');
  }
}

function printSummary(allScores, totalFound, totalBugs) {
  console.log('');
  console.log('SUMMARY');
  console.log('\u2550'.repeat(40));

  for (const { pageName, score } of allScores) {
    const pct = `${score.percentage}%`.padStart(4);
    const ratio = `(${score.found}/${score.total})`;
    console.log(`${pageName.padEnd(30)} ${pct} ${ratio}`);
  }

  const overallPct = totalBugs > 0 ? Math.round((totalFound / totalBugs) * 100) : 0;
  console.log('-'.repeat(40));
  console.log(`${'Overall:'.padEnd(30)} ${String(overallPct + '%').padStart(4)} (${totalFound}/${totalBugs})`);
}

function printJsonOutput(allScores, totalFound, totalBugs) {
  const overallPct = totalBugs > 0 ? Math.round((totalFound / totalBugs) * 100) : 0;

  const output = {
    summary: {
      totalBugs,
      totalFound,
      totalMissed: totalBugs - totalFound,
      overallPercentage: overallPct,
    },
    pages: {},
  };

  for (const { pageName, score, findings } of allScores) {
    output.pages[pageName] = {
      knownBugs: score.total,
      found: score.found,
      missed: score.missed,
      falsePositives: score.falsePositives.length,
      percentage: score.percentage,
      matched: score.matched.map(m => ({
        bugId: m.bug.id,
        bugDescription: m.bug.description,
        findingId: m.finding.id,
        findingDescription: m.finding.description,
        matchScore: m.score,
      })),
      unmatched: score.unmatched.map(b => ({
        bugId: b.id,
        bugDescription: b.description,
        category: b.category,
      })),
      falsePositiveDetails: score.falsePositives.map(f => ({
        audit: f.audit,
        id: f.id,
        description: f.description,
        category: f.category,
      })),
    };
  }

  console.log(JSON.stringify(output, null, 2));
}
