// audit-tools-b.js — Audit tools 12–22 for playwright-pool v3
//
// Exports:
//   getSchemas(z) — returns array of MCP tool schemas
//   handleAuditTool(name, params, activeEntry) — dispatches to handler
//
// These tools operate on the active pool entry's browserContext.
// The caller (server.js) is responsible for resolving activeEntry.

import fs from 'fs';
import path from 'path';

// ─── Schema Definitions ─────────────────────────────────────────────

export function getSchemas(z) {
  return [
    // 12. audit_diff
    {
      name: 'audit_diff',
      title: 'Visual diff between two screenshots',
      description:
        'Compare two screenshot files pixel-by-pixel. Reports the percentage of changed pixels and a textual description of differences. Both files must be PNG images on disk.',
      inputSchema: z.object({
        screenshotA: z.string().describe('Absolute path to the first PNG screenshot'),
        screenshotB: z.string().describe('Absolute path to the second PNG screenshot'),
        threshold: z.number().default(1).describe('Minimum percentage of changed pixels to flag as "different" (default 1%)'),
      }),
      type: 'readOnly',
    },
    // 13. audit_focus_order
    {
      name: 'audit_focus_order',
      title: 'Tab-order audit',
      description:
        'Tab through every focusable element on the page, recording the order and whether each element has a visible focus indicator (outline, box-shadow, etc.). Returns an ordered list.',
      inputSchema: z.object({
        maxElements: z.number().default(50).describe('Maximum number of elements to tab through (default 50)'),
      }),
      type: 'readOnly',
    },
    // 14. audit_interactive_states
    {
      name: 'audit_interactive_states',
      title: 'Interactive state audit',
      description:
        'For buttons, links, and inputs on the page, trigger hover and focus states and check for visual style changes. Reports how many elements are missing hover/focus feedback.',
      inputSchema: z.object({
        selector: z.string().optional().describe('CSS selector to limit scope (default: all buttons, links, inputs)'),
        savePath: z.string().optional().describe('Directory to save state screenshots'),
      }),
      type: 'readOnly',
    },
    // 15. audit_spacing_consistency
    {
      name: 'audit_spacing_consistency',
      title: 'Spacing consistency audit',
      description:
        'Extract computed margin and padding values from all visible elements, build a frequency table, and flag values that fall outside the expected spacing scale.',
      inputSchema: z.object({
        scale: z.array(z.number()).optional().describe('Expected spacing scale, e.g. [0,4,8,16,24,32,48,64]. If omitted, auto-detects the most common values.'),
      }),
      type: 'readOnly',
    },
    // 16. audit_z_index_map
    {
      name: 'audit_z_index_map',
      title: 'Z-index stacking map',
      description:
        'Find all elements with explicit z-index, map the stacking order, and flag potential conflicts (duplicate z-index values in overlapping stacking contexts).',
      inputSchema: z.object({}),
      type: 'readOnly',
    },
    // 17. audit_broken_links
    {
      name: 'audit_broken_links',
      title: 'Broken link checker',
      description:
        'Check all <a> hrefs and <img> srcs on the page. Flags 404s, empty hrefs, javascript: hrefs, and dead anchor references. Optionally checks external URLs.',
      inputSchema: z.object({
        checkExternal: z.boolean().default(false).describe('Whether to check external (off-origin) URLs (default false)'),
        timeout: z.number().default(5000).describe('HTTP request timeout in ms for each URL check (default 5000)'),
      }),
      type: 'readOnly',
    },
    // 18. audit_loading_states
    {
      name: 'audit_loading_states',
      title: 'Loading state capture',
      description:
        'Throttle the network via CDP, navigate to a URL, and capture screenshots at timed intervals to audit loading/skeleton states.',
      inputSchema: z.object({
        url: z.string().describe('URL to navigate to with throttled network'),
        intervals: z.array(z.number()).default([1, 3, 5]).describe('Seconds after navigation start to capture screenshots (default [1,3,5])'),
        savePath: z.string().optional().describe('Directory to save screenshots'),
      }),
      type: 'readOnly',
    },
    // 19. audit_form_validation
    {
      name: 'audit_form_validation',
      title: 'Form validation audit',
      description:
        'Submit a form without filling it to trigger validation errors. Captures the error state screenshot and extracts visible error messages.',
      inputSchema: z.object({
        formSelector: z.string().describe('CSS selector for the form element'),
      }),
      type: 'readOnly',
    },
    // 20. audit_print_layout
    {
      name: 'audit_print_layout',
      title: 'Print layout audit',
      description:
        'Emulate print media type and capture a screenshot of the page as it would appear when printed.',
      inputSchema: z.object({
        savePath: z.string().optional().describe('File path to save the print screenshot'),
      }),
      type: 'readOnly',
    },
    // 21. audit_scroll_behavior
    {
      name: 'audit_scroll_behavior',
      title: 'Scroll behavior audit',
      description:
        'Scroll the page in steps, checking for layout shifts at each step and capturing screenshots. Useful for finding sticky header bugs, lazy-load glitches, and CLS issues.',
      inputSchema: z.object({
        steps: z.number().default(5).describe('Number of scroll steps (default 5)'),
        scrollDistance: z.number().default(500).describe('Pixels to scroll per step (default 500)'),
      }),
      type: 'readOnly',
    },
    // 22. audit_element_overlap
    {
      name: 'audit_element_overlap',
      title: 'Element overlap detector',
      description:
        'Find elements that visually overlap by comparing bounding boxes of visible, non-trivially-sized elements. Reports overlapping pairs with their selectors and overlap area.',
      inputSchema: z.object({}),
      type: 'readOnly',
    },
    // 23. audit_security_headers
    {
      name: 'audit_security_headers',
      title: 'Security headers audit',
      description:
        'Inspect the current page\'s HTTP response headers for security best practices. Checks Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, and X-XSS-Protection. Rates each as present, missing, or weak.',
      inputSchema: z.object({}),
      type: 'readOnly',
    },
    // 24. audit_mixed_content
    {
      name: 'audit_mixed_content',
      title: 'Mixed content detector',
      description:
        'Detect HTTP resources loaded on HTTPS pages. Finds all elements with src/href attributes pointing to http:// URLs on an https:// page. Reports element type, URL, and selector for each violation.',
      inputSchema: z.object({}),
      type: 'readOnly',
    },
    // 25. audit_third_party_scripts
    {
      name: 'audit_third_party_scripts',
      title: 'Third-party script inventory',
      description:
        'Inventory all third-party scripts loaded on the page. Classifies scripts as first-party or third-party, reports domain, full URL, async/defer status, and size/timing data from the Performance API.',
      inputSchema: z.object({}),
      type: 'readOnly',
    },
    // 26. audit_cookie_compliance
    {
      name: 'audit_cookie_compliance',
      title: 'Cookie compliance audit',
      description:
        'Analyze cookies for GDPR/CCPA compliance. Classifies cookies as necessary, functional, analytics, or marketing based on name patterns. Checks secure flag, httpOnly, sameSite, and expiry length.',
      inputSchema: z.object({}),
      type: 'readOnly',
    },
    // 27. audit_lighthouse
    {
      name: 'audit_lighthouse',
      title: 'Lightweight Lighthouse-style audit',
      description:
        'Run a lightweight Lighthouse-style audit scoring performance, accessibility, SEO, and best practices 0–100. Aggregates data from Core Web Vitals, accessibility checks, meta tag analysis, security headers, and mixed content detection. Not the real Lighthouse — a fast approximation using existing audit logic.',
      inputSchema: z.object({}),
      type: 'readOnly',
    },
  ];
}

// ─── Tool Names (for routing) ────────────────────────────────────────

const TOOL_NAMES = new Set([
  'audit_diff',
  'audit_focus_order',
  'audit_interactive_states',
  'audit_spacing_consistency',
  'audit_z_index_map',
  'audit_broken_links',
  'audit_loading_states',
  'audit_form_validation',
  'audit_print_layout',
  'audit_scroll_behavior',
  'audit_element_overlap',
  'audit_security_headers',
  'audit_mixed_content',
  'audit_third_party_scripts',
  'audit_cookie_compliance',
  'audit_lighthouse',
]);

export function isAuditToolB(name) {
  return TOOL_NAMES.has(name);
}

// ─── Main Dispatcher ─────────────────────────────────────────────────

export async function handleAuditTool(name, params, activeEntry) {
  switch (name) {
    case 'audit_diff':               return handleAuditDiff(params, activeEntry);
    case 'audit_focus_order':        return handleAuditFocusOrder(params, activeEntry);
    case 'audit_interactive_states': return handleAuditInteractiveStates(params, activeEntry);
    case 'audit_spacing_consistency':return handleAuditSpacingConsistency(params, activeEntry);
    case 'audit_z_index_map':        return handleAuditZIndexMap(params, activeEntry);
    case 'audit_broken_links':       return handleAuditBrokenLinks(params, activeEntry);
    case 'audit_loading_states':     return handleAuditLoadingStates(params, activeEntry);
    case 'audit_form_validation':    return handleAuditFormValidation(params, activeEntry);
    case 'audit_print_layout':       return handleAuditPrintLayout(params, activeEntry);
    case 'audit_scroll_behavior':    return handleAuditScrollBehavior(params, activeEntry);
    case 'audit_element_overlap':    return handleAuditElementOverlap(params, activeEntry);
    case 'audit_security_headers':   return handleAuditSecurityHeaders(params, activeEntry);
    case 'audit_mixed_content':      return handleAuditMixedContent(params, activeEntry);
    case 'audit_third_party_scripts':return handleAuditThirdPartyScripts(params, activeEntry);
    case 'audit_cookie_compliance':  return handleAuditCookieCompliance(params, activeEntry);
    case 'audit_lighthouse':         return handleAuditLighthouse(params, activeEntry);
    default:
      return { content: [{ type: 'text', text: `Unknown audit tool: ${name}` }], isError: true };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function getPage(activeEntry) {
  const pages = activeEntry.browserContext.pages();
  if (pages.length === 0) throw new Error('No pages open in active browser context');
  return pages[pages.length - 1];
}

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function imageResult(buffer, text) {
  const content = [];
  if (text) content.push({ type: 'text', text });
  content.push({ type: 'image', data: buffer.toString('base64'), mimeType: 'image/png' });
  return { content };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ─── 12. audit_diff ──────────────────────────────────────────────────

async function handleAuditDiff(params, _activeEntry) {
  const { screenshotA, screenshotB, threshold = 1 } = params;

  // We use Playwright's page to do the pixel comparison in-browser via canvas
  // But since this is a file comparison, we'll use the active page's evaluate
  // with the image data loaded from disk.
  if (!fs.existsSync(screenshotA)) {
    return textResult(`Error: screenshotA not found at ${screenshotA}`);
  }
  if (!fs.existsSync(screenshotB)) {
    return textResult(`Error: screenshotB not found at ${screenshotB}`);
  }

  const page = getPage(_activeEntry);

  const bufA = fs.readFileSync(screenshotA);
  const bufB = fs.readFileSync(screenshotB);
  const b64A = bufA.toString('base64');
  const b64B = bufB.toString('base64');

  // Pixel comparison done in-browser via canvas API
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
    // Track regions of change
    let minX = w, maxX = 0, minY = h, maxY = 0;

    for (let i = 0; i < dataA.length; i += 4) {
      const dr = Math.abs(dataA[i] - dataB[i]);
      const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
      const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
      const da = Math.abs(dataA[i + 3] - dataB[i + 3]);
      // Threshold: any channel diff > 2 counts as changed
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
      totalPixels,
      diffPixels,
      changedPct: Math.round(pct * 100) / 100,
      diffRegion: diffPixels > 0 ? { minX, minY, maxX, maxY } : null,
    };
  }, { imgA: b64A, imgB: b64B });

  const sizeMatch = result.widthA === result.widthB && result.heightA === result.heightB;
  const lines = [
    `## Visual Diff Result`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Image A | ${result.widthA}x${result.heightA} |`,
    `| Image B | ${result.widthB}x${result.heightB} |`,
    `| Size match | ${sizeMatch ? 'Yes' : 'NO — different dimensions'} |`,
    `| Total pixels | ${result.totalPixels.toLocaleString()} |`,
    `| Changed pixels | ${result.diffPixels.toLocaleString()} |`,
    `| Changed % | ${result.changedPct}% |`,
    `| Threshold | ${threshold}% |`,
    `| Verdict | ${result.changedPct >= threshold ? 'DIFFERENT' : 'SAME (within threshold)'} |`,
  ];

  if (result.diffRegion) {
    const r = result.diffRegion;
    lines.push(``);
    lines.push(`**Diff region:** (${r.minX},${r.minY}) to (${r.maxX},${r.maxY}) — ${r.maxX - r.minX + 1}x${r.maxY - r.minY + 1}px area`);
  }

  return textResult(lines.join('\n'));
}

// ─── 13. audit_focus_order ───────────────────────────────────────────

async function handleAuditFocusOrder(params, activeEntry) {
  const { maxElements = 50 } = params;
  const page = getPage(activeEntry);

  // Click the body first to ensure no element is focused
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

      // Check for visible focus indicator
      const outline = cs.outline;
      const outlineWidth = parseFloat(cs.outlineWidth) || 0;
      const boxShadow = cs.boxShadow;
      const hasOutline = outlineWidth > 0 && cs.outlineStyle !== 'none';
      const hasBoxShadow = boxShadow && boxShadow !== 'none';
      const hasBorder = (() => {
        // Compare with a non-focused clone would be ideal, but we just check
        // if there's a non-zero border that could serve as indicator
        const bw = parseFloat(cs.borderWidth) || 0;
        return bw > 0;
      })();

      const hasVisibleFocus = hasOutline || hasBoxShadow;

      // Build a readable selector
      let selector = tag;
      if (el.id) selector += `#${el.id}`;
      else if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (cls) selector += `.${cls}`;
      }

      return {
        selector,
        tag,
        role: el.getAttribute('role') || '',
        text: (el.textContent || '').trim().slice(0, 60),
        tabIndex: el.tabIndex,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        hasVisibleFocus,
        focusDetails: {
          outline: cs.outlineStyle !== 'none' ? `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}` : 'none',
          boxShadow: boxShadow || 'none',
        },
      };
    });

    if (!info) break; // Reached end of focusable elements (focus returned to body)

    // Check for cycle: if we've seen this exact selector + position before, we've looped
    const fingerprint = `${info.selector}@${info.rect.x},${info.rect.y}`;
    if (elements.length > 0 && elements[0]._fingerprint === fingerprint) {
      break; // Cycled back to start
    }

    info._fingerprint = fingerprint;
    elements.push(info);
  }

  const missingFocus = elements.filter(e => !e.hasVisibleFocus);

  const lines = [
    `## Focus Order Audit`,
    ``,
    `**Total focusable elements:** ${elements.length}`,
    `**Missing visible focus indicator:** ${missingFocus.length}`,
    ``,
    `### Tab Order`,
    `| # | Element | Text | tabIndex | Visible Focus | Focus Style |`,
    `|---|---------|------|----------|---------------|-------------|`,
  ];

  for (let i = 0; i < elements.length; i++) {
    const e = elements[i];
    const focusIcon = e.hasVisibleFocus ? 'Yes' : 'NO';
    const focusStyle = e.hasVisibleFocus
      ? (e.focusDetails.outline !== 'none' ? `outline: ${e.focusDetails.outline}` : `box-shadow: ${e.focusDetails.boxShadow.slice(0, 40)}`)
      : 'none detected';
    lines.push(`| ${i + 1} | \`${e.selector}\` | ${e.text.slice(0, 30)} | ${e.tabIndex} | ${focusIcon} | ${focusStyle} |`);
  }

  if (missingFocus.length > 0) {
    lines.push(``);
    lines.push(`### Elements Missing Focus Indicator`);
    for (const e of missingFocus) {
      lines.push(`- \`${e.selector}\` — "${e.text.slice(0, 40)}"`);
    }
  }

  return textResult(lines.join('\n'));
}

// ─── 14. audit_interactive_states ────────────────────────────────────

async function handleAuditInteractiveStates(params, activeEntry) {
  const { selector, savePath } = params;
  const page = getPage(activeEntry);

  if (savePath) ensureDir(savePath);

  // Get all interactive elements
  const sel = selector || 'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"]';

  const elementHandles = await page.$$(sel);
  const totalCount = elementHandles.length;
  let missingHover = 0;
  let missingFocus = 0;
  const details = [];

  // Limit to first 30 to avoid extremely long runs
  const limit = Math.min(totalCount, 30);

  for (let i = 0; i < limit; i++) {
    const handle = elementHandles[i];

    // Check visibility
    const isVisible = await handle.isVisible().catch(() => false);
    if (!isVisible) continue;

    // Get baseline styles
    const baseStyles = await handle.evaluate(el => {
      const cs = window.getComputedStyle(el);
      return {
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        borderColor: cs.borderColor,
        boxShadow: cs.boxShadow,
        outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`,
        textDecoration: cs.textDecoration,
        transform: cs.transform,
        opacity: cs.opacity,
      };
    });

    const elInfo = await handle.evaluate(el => {
      const tag = el.tagName.toLowerCase();
      let sel = tag;
      if (el.id) sel += `#${el.id}`;
      else if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (cls) sel += `.${cls}`;
      }
      return { selector: sel, text: (el.textContent || '').trim().slice(0, 40) };
    });

    // Hover state
    await handle.hover().catch(() => {});
    await page.waitForTimeout(100);

    const hoverStyles = await handle.evaluate(el => {
      const cs = window.getComputedStyle(el);
      return {
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        borderColor: cs.borderColor,
        boxShadow: cs.boxShadow,
        outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`,
        textDecoration: cs.textDecoration,
        transform: cs.transform,
        opacity: cs.opacity,
      };
    });

    const hoverChanged = Object.keys(baseStyles).some(k => baseStyles[k] !== hoverStyles[k]);

    // Save hover screenshot if requested
    if (savePath && hoverChanged) {
      const buf = await handle.screenshot().catch(() => null);
      if (buf) {
        fs.writeFileSync(path.join(savePath, `element-${i}-hover.png`), buf);
      }
    }

    // Move mouse away, then focus
    await page.mouse.move(0, 0);
    await page.waitForTimeout(50);

    await handle.focus().catch(() => {});
    await page.waitForTimeout(100);

    const focusStyles = await handle.evaluate(el => {
      const cs = window.getComputedStyle(el);
      return {
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        borderColor: cs.borderColor,
        boxShadow: cs.boxShadow,
        outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`,
        textDecoration: cs.textDecoration,
        transform: cs.transform,
        opacity: cs.opacity,
      };
    });

    const focusChanged = Object.keys(baseStyles).some(k => baseStyles[k] !== focusStyles[k]);

    // Save focus screenshot if requested
    if (savePath && focusChanged) {
      const buf = await handle.screenshot().catch(() => null);
      if (buf) {
        fs.writeFileSync(path.join(savePath, `element-${i}-focus.png`), buf);
      }
    }

    // Blur to reset
    await handle.evaluate(el => el.blur()).catch(() => {});

    if (!hoverChanged) missingHover++;
    if (!focusChanged) missingFocus++;

    details.push({
      index: i,
      selector: elInfo.selector,
      text: elInfo.text,
      hoverChanged,
      focusChanged,
    });
  }

  const lines = [
    `## Interactive States Audit`,
    ``,
    `**Total interactive elements:** ${totalCount}`,
    `**Checked:** ${details.length} (limit 30)`,
    `**Missing hover style change:** ${missingHover}`,
    `**Missing focus style change:** ${missingFocus}`,
    ``,
    `### Details`,
    `| # | Element | Text | Hover Change | Focus Change |`,
    `|---|---------|------|-------------|-------------|`,
  ];

  for (const d of details) {
    lines.push(`| ${d.index} | \`${d.selector}\` | ${d.text.slice(0, 25)} | ${d.hoverChanged ? 'Yes' : 'NO'} | ${d.focusChanged ? 'Yes' : 'NO'} |`);
  }

  if (savePath) {
    lines.push(``);
    lines.push(`Screenshots saved to: ${savePath}`);
  }

  return textResult(lines.join('\n'));
}

// ─── 15. audit_spacing_consistency ───────────────────────────────────

async function handleAuditSpacingConsistency(params, activeEntry) {
  const { scale } = params;
  const page = getPage(activeEntry);

  const spacingData = await page.evaluate(() => {
    const values = { margin: {}, padding: {} };
    const elements = document.querySelectorAll('body *');

    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      // Skip invisible / zero-size elements
      if (rect.width === 0 && rect.height === 0) continue;

      const cs = window.getComputedStyle(el);

      const sides = ['Top', 'Right', 'Bottom', 'Left'];
      for (const side of sides) {
        const mv = Math.round(parseFloat(cs[`margin${side}`]) || 0);
        const pv = Math.round(parseFloat(cs[`padding${side}`]) || 0);

        if (mv !== 0) values.margin[mv] = (values.margin[mv] || 0) + 1;
        if (pv !== 0) values.padding[pv] = (values.padding[pv] || 0) + 1;
      }
    }

    return values;
  });

  // Build frequency tables
  const allValues = {};
  for (const [val, count] of Object.entries(spacingData.margin)) {
    const v = parseInt(val);
    allValues[v] = (allValues[v] || 0) + count;
  }
  for (const [val, count] of Object.entries(spacingData.padding)) {
    const v = parseInt(val);
    allValues[v] = (allValues[v] || 0) + count;
  }

  // Sort by value
  const sorted = Object.entries(allValues)
    .map(([v, c]) => ({ value: parseInt(v), count: c }))
    .sort((a, b) => a.value - b.value);

  // Determine scale to compare against
  let refScale;
  if (scale && scale.length > 0) {
    refScale = new Set(scale);
  } else {
    // Auto-detect: take the top 8 most frequent values as "the scale"
    const byFreq = [...sorted].sort((a, b) => b.count - a.count);
    refScale = new Set(byFreq.slice(0, 8).map(v => v.value));
  }

  const outliers = sorted.filter(s => !refScale.has(s.value) && Math.abs(s.value) > 1);

  const lines = [
    `## Spacing Consistency Audit`,
    ``,
    `**Reference scale:** [${[...refScale].sort((a, b) => a - b).join(', ')}]`,
    `**Total unique spacing values:** ${sorted.length}`,
    `**Outlier values (not in scale):** ${outliers.length}`,
    ``,
    `### Frequency Table (margin + padding combined)`,
    `| Value (px) | Count | On Scale? |`,
    `|-----------|-------|-----------|`,
  ];

  for (const s of sorted) {
    const onScale = refScale.has(s.value) ? 'Yes' : 'OUTLIER';
    lines.push(`| ${s.value} | ${s.count} | ${onScale} |`);
  }

  if (outliers.length > 0) {
    lines.push(``);
    lines.push(`### Outliers`);
    for (const o of outliers) {
      lines.push(`- **${o.value}px** used ${o.count} time(s) — not on the spacing scale`);
    }
  }

  // Margin-only frequency
  const marginSorted = Object.entries(spacingData.margin)
    .map(([v, c]) => ({ value: parseInt(v), count: c }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const paddingSorted = Object.entries(spacingData.padding)
    .map(([v, c]) => ({ value: parseInt(v), count: c }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  lines.push(``);
  lines.push(`### Top 10 Margin Values`);
  for (const m of marginSorted) lines.push(`- ${m.value}px: ${m.count}`);

  lines.push(``);
  lines.push(`### Top 10 Padding Values`);
  for (const p of paddingSorted) lines.push(`- ${p.value}px: ${p.count}`);

  return textResult(lines.join('\n'));
}

// ─── 16. audit_z_index_map ───────────────────────────────────────────

async function handleAuditZIndexMap(_params, activeEntry) {
  const page = getPage(activeEntry);

  const zData = await page.evaluate(() => {
    const results = [];
    const elements = document.querySelectorAll('body *');

    for (const el of elements) {
      const cs = window.getComputedStyle(el);
      const zIndex = cs.zIndex;
      if (zIndex === 'auto' || zIndex === '0') continue;

      const zi = parseInt(zIndex);
      if (isNaN(zi)) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const tag = el.tagName.toLowerCase();
      let selector = tag;
      if (el.id) selector += `#${el.id}`;
      else if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (cls) selector += `.${cls}`;
      }

      const position = cs.position;
      const stackingContext = cs.isolation === 'isolate' ||
        cs.transform !== 'none' ||
        cs.filter !== 'none' ||
        cs.perspective !== 'none' ||
        cs.willChange === 'transform' ||
        (position !== 'static' && zIndex !== 'auto');

      results.push({
        selector,
        zIndex: zi,
        position,
        createsStackingContext: stackingContext,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        },
      });
    }

    return results;
  });

  // Sort by z-index descending
  zData.sort((a, b) => b.zIndex - a.zIndex);

  // Find conflicts: elements with same z-index whose bounding boxes overlap
  const warnings = [];
  for (let i = 0; i < zData.length; i++) {
    for (let j = i + 1; j < zData.length; j++) {
      if (zData[i].zIndex !== zData[j].zIndex) continue;
      // Check bounding box overlap
      const a = zData[i].rect;
      const b = zData[j].rect;
      const overlapX = a.x < b.x + b.w && a.x + a.w > b.x;
      const overlapY = a.y < b.y + b.h && a.y + a.h > b.y;
      if (overlapX && overlapY) {
        warnings.push(`z-index ${zData[i].zIndex}: \`${zData[i].selector}\` and \`${zData[j].selector}\` overlap spatially`);
      }
    }
  }

  const lines = [
    `## Z-Index Stacking Map`,
    ``,
    `**Elements with z-index:** ${zData.length}`,
    `**Potential conflicts:** ${warnings.length}`,
    ``,
    `### Stacking Order (highest first)`,
    `| z-index | Element | Position | Creates Stacking Ctx | Bounds |`,
    `|---------|---------|----------|---------------------|--------|`,
  ];

  for (const z of zData) {
    lines.push(`| ${z.zIndex} | \`${z.selector}\` | ${z.position} | ${z.createsStackingContext ? 'Yes' : 'No'} | ${z.rect.x},${z.rect.y} ${z.rect.w}x${z.rect.h} |`);
  }

  if (warnings.length > 0) {
    lines.push(``);
    lines.push(`### Warnings`);
    for (const w of warnings) {
      lines.push(`- ${w}`);
    }
  }

  return textResult(lines.join('\n'));
}

// ─── 17. audit_broken_links ──────────────────────────────────────────

async function handleAuditBrokenLinks(params, activeEntry) {
  const { checkExternal = false, timeout = 5000 } = params;
  const page = getPage(activeEntry);

  const linkData = await page.evaluate(() => {
    const pageOrigin = window.location.origin;
    const pageUrl = window.location.href;
    const results = [];

    // Collect <a> hrefs
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      const text = (a.textContent || '').trim().slice(0, 50);
      let type = 'link';
      let resolvedUrl = '';

      if (!href || href === '#') {
        results.push({ type, href: href || '', text, status: 'empty', resolvedUrl: '' });
        continue;
      }
      if (href.startsWith('javascript:')) {
        results.push({ type, href, text, status: 'javascript-href', resolvedUrl: '' });
        continue;
      }
      if (href.startsWith('mailto:') || href.startsWith('tel:')) {
        results.push({ type, href, text, status: 'skip-protocol', resolvedUrl: '' });
        continue;
      }

      // Anchor reference
      if (href.startsWith('#')) {
        const target = document.getElementById(href.slice(1));
        results.push({
          type, href, text,
          status: target ? 'ok-anchor' : 'dead-anchor',
          resolvedUrl: '',
        });
        continue;
      }

      try {
        resolvedUrl = new URL(href, pageUrl).href;
      } catch {
        results.push({ type, href, text, status: 'invalid-url', resolvedUrl: '' });
        continue;
      }

      const isExternal = !resolvedUrl.startsWith(pageOrigin);
      results.push({ type, href, text, status: 'check', resolvedUrl, isExternal });
    }

    // Collect <img> srcs
    for (const img of document.querySelectorAll('img[src]')) {
      const src = img.getAttribute('src');
      const alt = img.getAttribute('alt') || '';
      if (!src) {
        results.push({ type: 'image', href: '', text: alt, status: 'empty-src', resolvedUrl: '' });
        continue;
      }
      if (src.startsWith('data:')) {
        results.push({ type: 'image', href: src.slice(0, 30) + '...', text: alt, status: 'data-uri', resolvedUrl: '' });
        continue;
      }
      let resolvedUrl = '';
      try {
        resolvedUrl = new URL(src, pageUrl).href;
      } catch {
        results.push({ type: 'image', href: src, text: alt, status: 'invalid-url', resolvedUrl: '' });
        continue;
      }
      const isExternal = !resolvedUrl.startsWith(pageOrigin);
      results.push({ type: 'image', href: src, text: alt, status: 'check', resolvedUrl, isExternal });
    }

    return results;
  });

  // Check URLs that need HTTP verification
  const toCheck = linkData.filter(l => l.status === 'check');
  const filtered = checkExternal ? toCheck : toCheck.filter(l => !l.isExternal);

  for (const link of filtered) {
    try {
      const response = await page.request.head(link.resolvedUrl, { timeout });
      link.status = response.status() >= 400 ? `${response.status()}` : 'ok';
    } catch (err) {
      // Try GET as fallback (some servers reject HEAD)
      try {
        const response = await page.request.get(link.resolvedUrl, { timeout });
        link.status = response.status() >= 400 ? `${response.status()}` : 'ok';
      } catch {
        link.status = 'error-network';
      }
    }
  }

  // Mark unchecked external links
  for (const link of toCheck.filter(l => l.isExternal && !checkExternal)) {
    link.status = 'skipped-external';
  }

  const broken = linkData.filter(l =>
    ['empty', 'dead-anchor', 'invalid-url', 'empty-src', 'error-network'].includes(l.status) ||
    (l.status.match(/^\d+$/) && parseInt(l.status) >= 400)
  );

  const lines = [
    `## Broken Links Audit`,
    ``,
    `**Total links/images found:** ${linkData.length}`,
    `**Checked:** ${filtered.length}`,
    `**Broken/problematic:** ${broken.length}`,
    `**External check:** ${checkExternal ? 'ON' : 'OFF'}`,
  ];

  if (broken.length > 0) {
    lines.push(``);
    lines.push(`### Broken/Problematic`);
    lines.push(`| Type | Status | href | Text |`);
    lines.push(`|------|--------|------|------|`);
    for (const b of broken) {
      lines.push(`| ${b.type} | ${b.status} | \`${b.href.slice(0, 60)}\` | ${b.text.slice(0, 30)} |`);
    }
  }

  // Summary of javascript: hrefs
  const jsHrefs = linkData.filter(l => l.status === 'javascript-href');
  if (jsHrefs.length > 0) {
    lines.push(``);
    lines.push(`### javascript: hrefs (${jsHrefs.length})`);
    for (const j of jsHrefs) {
      lines.push(`- \`${j.href.slice(0, 60)}\` — "${j.text}"`);
    }
  }

  return textResult(lines.join('\n'));
}

// ─── 18. audit_loading_states ────────────────────────────────────────

async function handleAuditLoadingStates(params, activeEntry) {
  const { url, intervals = [1, 3, 5], savePath } = params;
  const page = getPage(activeEntry);

  if (savePath) ensureDir(savePath);

  // Get CDP session for network throttling
  const cdp = await page.context().newCDPSession(page);

  // Simulate "Slow 3G"-ish throttling
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: 50 * 1024,      // 50 KB/s
    uploadThroughput: 25 * 1024,         // 25 KB/s
    latency: 400,                        // 400ms RTT
  });

  // Navigate (don't wait for load — we want to capture intermediate states)
  const navPromise = page.goto(url, { waitUntil: 'commit', timeout: 60000 }).catch(() => {});

  const screenshots = [];
  const sortedIntervals = [...intervals].sort((a, b) => a - b);
  const startTime = Date.now();

  for (const sec of sortedIntervals) {
    const elapsed = Date.now() - startTime;
    const waitMs = sec * 1000 - elapsed;
    if (waitMs > 0) {
      await page.waitForTimeout(waitMs);
    }

    const buffer = await page.screenshot({ fullPage: false });
    const actualSec = ((Date.now() - startTime) / 1000).toFixed(1);

    if (savePath) {
      const fileName = `loading-${sec}s.png`;
      fs.writeFileSync(path.join(savePath, fileName), buffer);
    }

    screenshots.push({ targetSec: sec, actualSec, buffer });
  }

  // Wait for navigation to complete
  await navPromise;

  // Take a final "loaded" screenshot
  await page.waitForTimeout(1000);
  const finalBuffer = await page.screenshot({ fullPage: false });
  if (savePath) {
    fs.writeFileSync(path.join(savePath, 'loading-final.png'), finalBuffer);
  }

  // Disable throttling
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: -1,
    uploadThroughput: -1,
    latency: 0,
  });
  await cdp.detach();

  const content = [
    { type: 'text', text: `## Loading States Audit\n\n**URL:** ${url}\n**Throttle:** Slow 3G (50KB/s down, 400ms latency)\n\n### Captured States` },
  ];

  for (const s of screenshots) {
    content.push({ type: 'text', text: `**At ${s.targetSec}s (actual: ${s.actualSec}s):**` });
    content.push({ type: 'image', data: s.buffer.toString('base64'), mimeType: 'image/png' });
  }

  content.push({ type: 'text', text: `**Final (fully loaded):**` });
  content.push({ type: 'image', data: finalBuffer.toString('base64'), mimeType: 'image/png' });

  if (savePath) {
    content.push({ type: 'text', text: `\nScreenshots saved to: ${savePath}` });
  }

  return { content };
}

// ─── 19. audit_form_validation ───────────────────────────────────────

async function handleAuditFormValidation(params, activeEntry) {
  const { formSelector } = params;
  const page = getPage(activeEntry);

  const formHandle = await page.$(formSelector);
  if (!formHandle) {
    return textResult(`Error: No form found matching selector \`${formSelector}\``);
  }

  // Get form info before submission
  const formInfo = await formHandle.evaluate(form => {
    const inputs = form.querySelectorAll('input, select, textarea');
    const fields = [];
    for (const input of inputs) {
      fields.push({
        tag: input.tagName.toLowerCase(),
        type: input.type || '',
        name: input.name || '',
        required: input.required,
        value: input.value || '',
      });
    }
    return {
      action: form.action || '',
      method: form.method || 'get',
      fieldCount: inputs.length,
      fields,
    };
  });

  // Clear all fields to ensure empty submission
  await formHandle.evaluate(form => {
    const inputs = form.querySelectorAll('input, select, textarea');
    for (const input of inputs) {
      if (input.type === 'checkbox' || input.type === 'radio') {
        input.checked = false;
      } else if (input.tagName.toLowerCase() === 'select') {
        input.selectedIndex = 0;
      } else {
        input.value = '';
      }
    }
  });

  // Try to submit the form (via submit button click or form.submit())
  // Use requestSubmit() which triggers validation, unlike submit()
  const submitted = await formHandle.evaluate(form => {
    const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
    if (submitBtn) {
      submitBtn.click();
      return 'click';
    }
    // Try requestSubmit which triggers HTML5 validation
    try {
      form.requestSubmit();
      return 'requestSubmit';
    } catch {
      return 'none';
    }
  });

  await page.waitForTimeout(500);

  // Screenshot the error state
  const screenshot = await page.screenshot({ fullPage: false });

  // Collect validation error messages
  const errors = await page.evaluate((sel) => {
    const form = document.querySelector(sel);
    if (!form) return [];

    const results = [];

    // HTML5 validity API
    const inputs = form.querySelectorAll('input, select, textarea');
    for (const input of inputs) {
      if (!input.validity.valid) {
        results.push({
          field: input.name || input.id || input.type,
          message: input.validationMessage || 'invalid',
          source: 'html5-validity',
        });
      }
    }

    // Look for visible error messages near the form
    const errorSelectors = [
      '.error', '.error-message', '.field-error', '.invalid-feedback',
      '.form-error', '[role="alert"]', '.validation-error', '.help-block',
      '.text-danger', '.text-red-500', '.text-red-600',
    ];

    for (const errSel of errorSelectors) {
      const errorEls = form.querySelectorAll(errSel);
      for (const el of errorEls) {
        const text = el.textContent.trim();
        if (text) {
          results.push({ field: '', message: text, source: `selector: ${errSel}` });
        }
      }
      // Also check siblings of the form
      const parentErrors = form.parentElement?.querySelectorAll(errSel) || [];
      for (const el of parentErrors) {
        const text = el.textContent.trim();
        if (text && !results.some(r => r.message === text)) {
          results.push({ field: '', message: text, source: `parent ${errSel}` });
        }
      }
    }

    return results;
  }, formSelector);

  const lines = [
    `## Form Validation Audit`,
    ``,
    `**Form:** \`${formSelector}\``,
    `**Method:** ${formInfo.method.toUpperCase()}`,
    `**Fields:** ${formInfo.fieldCount}`,
    `**Required fields:** ${formInfo.fields.filter(f => f.required).length}`,
    `**Submission method:** ${submitted}`,
    `**Validation errors found:** ${errors.length}`,
  ];

  if (formInfo.fields.length > 0) {
    lines.push(``);
    lines.push(`### Fields`);
    lines.push(`| Name | Type | Required |`);
    lines.push(`|------|------|----------|`);
    for (const f of formInfo.fields) {
      lines.push(`| ${f.name || '(unnamed)'} | ${f.tag}/${f.type || '-'} | ${f.required ? 'Yes' : 'No'} |`);
    }
  }

  if (errors.length > 0) {
    lines.push(``);
    lines.push(`### Validation Errors`);
    for (const e of errors) {
      lines.push(`- ${e.field ? `**${e.field}:** ` : ''}${e.message} _(${e.source})_`);
    }
  }

  const content = [{ type: 'text', text: lines.join('\n') }];
  content.push({ type: 'text', text: '**Error state screenshot:**' });
  content.push({ type: 'image', data: screenshot.toString('base64'), mimeType: 'image/png' });

  return { content };
}

// ─── 20. audit_print_layout ──────────────────────────────────────────

async function handleAuditPrintLayout(params, activeEntry) {
  const { savePath } = params;
  const page = getPage(activeEntry);

  // Emulate print media
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(500);

  // Take a full-page screenshot in print mode
  const screenshot = await page.screenshot({ fullPage: true });

  if (savePath) {
    ensureDir(path.dirname(savePath));
    fs.writeFileSync(savePath, screenshot);
  }

  // Gather print-specific info
  const printInfo = await page.evaluate(() => {
    // Check for print-specific stylesheets
    const printSheets = [];
    for (const sheet of document.styleSheets) {
      try {
        if (sheet.media && sheet.media.mediaText && sheet.media.mediaText.includes('print')) {
          printSheets.push(sheet.href || '(inline)');
        }
      } catch { /* cross-origin */ }
    }

    // Check for elements hidden in print
    const allEls = document.querySelectorAll('body *');
    let hiddenInPrint = 0;
    for (const el of allEls) {
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') {
        hiddenInPrint++;
      }
    }

    // Check for @page rules via CSSOM (limited)
    const hasPageBreaks = document.querySelector('[style*="page-break"], [style*="break-before"], [style*="break-after"]') !== null;

    return {
      printSheetCount: printSheets.length,
      printSheets,
      hiddenInPrint,
      hasPageBreaks,
      title: document.title,
    };
  });

  // Restore screen media
  await page.emulateMedia({ media: 'screen' });

  const lines = [
    `## Print Layout Audit`,
    ``,
    `**Page:** ${printInfo.title}`,
    `**Print stylesheets:** ${printInfo.printSheetCount}`,
    `**Elements hidden in print mode:** ${printInfo.hiddenInPrint}`,
    `**Has page-break rules:** ${printInfo.hasPageBreaks ? 'Yes' : 'No'}`,
  ];

  if (printInfo.printSheets.length > 0) {
    lines.push(``);
    lines.push(`### Print Stylesheets`);
    for (const s of printInfo.printSheets) lines.push(`- ${s}`);
  }

  if (savePath) {
    lines.push(``);
    lines.push(`Screenshot saved to: ${savePath}`);
  }

  const content = [{ type: 'text', text: lines.join('\n') }];
  content.push({ type: 'text', text: '**Print mode screenshot:**' });
  content.push({ type: 'image', data: screenshot.toString('base64'), mimeType: 'image/png' });

  return { content };
}

// ─── 21. audit_scroll_behavior ───────────────────────────────────────

async function handleAuditScrollBehavior(params, activeEntry) {
  const { steps = 5, scrollDistance = 500 } = params;
  const page = getPage(activeEntry);

  // Scroll to top first
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  const stepResults = [];

  for (let i = 0; i < steps; i++) {
    // Get positions of key elements before scroll (for layout shift detection)
    const beforePositions = await page.evaluate(() => {
      const elements = document.querySelectorAll('h1, h2, h3, nav, header, footer, main, [class*="sticky"], [class*="fixed"]');
      const positions = [];
      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        let selector = tag;
        if (el.id) selector += `#${el.id}`;
        else if (el.className && typeof el.className === 'string') {
          const cls = el.className.trim().split(/\s+/).slice(0, 1).join('.');
          if (cls) selector += `.${cls}`;
        }
        positions.push({
          selector,
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
      return { positions, scrollY: window.scrollY };
    });

    // Scroll
    await page.evaluate((dist) => window.scrollBy(0, dist), scrollDistance);
    await page.waitForTimeout(500);

    // Get positions after scroll
    const afterPositions = await page.evaluate(() => {
      const elements = document.querySelectorAll('h1, h2, h3, nav, header, footer, main, [class*="sticky"], [class*="fixed"]');
      const positions = [];
      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        let selector = tag;
        if (el.id) selector += `#${el.id}`;
        else if (el.className && typeof el.className === 'string') {
          const cls = el.className.trim().split(/\s+/).slice(0, 1).join('.');
          if (cls) selector += `.${cls}`;
        }
        const cs = window.getComputedStyle(el);
        positions.push({
          selector,
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          position: cs.position,
        });
      }
      return { positions, scrollY: window.scrollY };
    });

    // Detect layout shifts: elements that moved horizontally or changed width unexpectedly
    const shifts = [];
    const scrollDelta = afterPositions.scrollY - beforePositions.scrollY;

    for (let j = 0; j < Math.min(beforePositions.positions.length, afterPositions.positions.length); j++) {
      const before = beforePositions.positions[j];
      const after = afterPositions.positions[j];
      if (before.selector !== after.selector) continue;

      // Horizontal shift is unexpected
      const horizontalShift = Math.abs(after.left - before.left);
      // Width change is unexpected
      const widthChange = Math.abs(after.width - before.width);

      if (horizontalShift > 2 || widthChange > 2) {
        shifts.push({
          selector: before.selector,
          horizontalShift,
          widthChange,
          isSticky: after.position === 'sticky' || after.position === 'fixed',
        });
      }
    }

    // Screenshot at this scroll position
    const screenshot = await page.screenshot({ fullPage: false });

    stepResults.push({
      step: i + 1,
      scrollY: afterPositions.scrollY,
      scrollDelta,
      shifts,
      screenshot,
    });
  }

  const totalShifts = stepResults.reduce((sum, s) => sum + s.shifts.length, 0);

  const content = [
    {
      type: 'text',
      text: [
        `## Scroll Behavior Audit`,
        ``,
        `**Steps:** ${steps}`,
        `**Scroll distance per step:** ${scrollDistance}px`,
        `**Total layout shifts detected:** ${totalShifts}`,
      ].join('\n'),
    },
  ];

  for (const step of stepResults) {
    const lines = [
      ``,
      `### Step ${step.step} (scrollY: ${step.scrollY}px, delta: ${step.scrollDelta}px)`,
    ];
    if (step.shifts.length > 0) {
      lines.push(`**Layout shifts:**`);
      for (const s of step.shifts) {
        lines.push(`- \`${s.selector}\`: horiz shift ${s.horizontalShift}px, width change ${s.widthChange}px${s.isSticky ? ' (sticky/fixed)' : ''}`);
      }
    } else {
      lines.push(`No layout shifts detected.`);
    }
    content.push({ type: 'text', text: lines.join('\n') });
    content.push({ type: 'image', data: step.screenshot.toString('base64'), mimeType: 'image/png' });
  }

  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));

  return { content };
}

// ─── 22. audit_element_overlap ───────────────────────────────────────

async function handleAuditElementOverlap(_params, activeEntry) {
  const page = getPage(activeEntry);

  const overlaps = await page.evaluate(() => {
    // Collect visible, non-trivially-sized elements
    // We target semantic/interactive elements to keep the count manageable
    const selectors = 'button, a, input, select, textarea, img, video, iframe, ' +
      'h1, h2, h3, h4, h5, h6, p, li, td, th, label, ' +
      'nav, header, footer, main, aside, section, article, ' +
      '[role="button"], [role="dialog"], [role="alert"], [role="tooltip"], ' +
      'div[class], span[class]';

    const allEls = document.querySelectorAll(selectors);
    const rects = [];

    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      // Skip invisible or trivially small
      if (rect.width < 5 || rect.height < 5) continue;
      // Skip off-screen
      if (rect.bottom < 0 || rect.top > window.innerHeight * 2) continue;
      if (rect.right < 0 || rect.left > window.innerWidth) continue;

      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;

      const tag = el.tagName.toLowerCase();
      let selector = tag;
      if (el.id) selector += `#${el.id}`;
      else if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (cls) selector += `.${cls}`;
      }

      rects.push({
        selector,
        x: rect.x,
        y: rect.y,
        w: rect.width,
        h: rect.height,
        right: rect.right,
        bottom: rect.bottom,
        zIndex: parseInt(cs.zIndex) || 0,
        position: cs.position,
        // Store DOM element reference index to check parent-child
        _index: rects.length,
        _el: el,
      });
    }

    // Check for overlaps (skip parent-child relationships)
    const overlapping = [];
    const limit = Math.min(rects.length, 200); // Cap to avoid O(n^2) explosion

    for (let i = 0; i < limit; i++) {
      for (let j = i + 1; j < limit; j++) {
        const a = rects[i];
        const b = rects[j];

        // Skip if one contains the other (parent-child)
        if (a._el.contains(b._el) || b._el.contains(a._el)) continue;

        // Check bounding box overlap
        const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
        const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
        const overlapArea = overlapX * overlapY;

        if (overlapArea <= 0) continue;

        // Only report significant overlaps (> 10% of the smaller element)
        const smallerArea = Math.min(a.w * a.h, b.w * b.h);
        const overlapPct = (overlapArea / smallerArea) * 100;

        if (overlapPct < 10) continue;

        overlapping.push({
          elementA: a.selector,
          elementB: b.selector,
          overlapArea: Math.round(overlapArea),
          overlapPct: Math.round(overlapPct),
          boundsA: `${Math.round(a.x)},${Math.round(a.y)} ${Math.round(a.w)}x${Math.round(a.h)}`,
          boundsB: `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}`,
          zIndexA: a.zIndex,
          zIndexB: b.zIndex,
        });
      }
    }

    // Sort by overlap percentage descending
    overlapping.sort((a, b) => b.overlapPct - a.overlapPct);

    return { totalChecked: limit, overlapping: overlapping.slice(0, 50) };
  });

  const lines = [
    `## Element Overlap Audit`,
    ``,
    `**Elements checked:** ${overlaps.totalChecked}`,
    `**Overlapping pairs found:** ${overlaps.overlapping.length}`,
  ];

  if (overlaps.overlapping.length > 0) {
    lines.push(``);
    lines.push(`### Overlapping Elements (sorted by overlap %)`);
    lines.push(`| Element A | Element B | Overlap Area | Overlap % | z-index A | z-index B |`);
    lines.push(`|-----------|-----------|-------------|-----------|-----------|-----------|`);

    for (const o of overlaps.overlapping) {
      lines.push(`| \`${o.elementA}\` | \`${o.elementB}\` | ${o.overlapArea}px^2 | ${o.overlapPct}% | ${o.zIndexA} | ${o.zIndexB} |`);
    }

    lines.push(``);
    lines.push(`### Bounding Box Details`);
    for (const o of overlaps.overlapping.slice(0, 10)) {
      lines.push(`- **\`${o.elementA}\`** (${o.boundsA}) overlaps **\`${o.elementB}\`** (${o.boundsB}) by ${o.overlapPct}%`);
    }
  } else {
    lines.push(``);
    lines.push(`No significant element overlaps detected.`);
  }

  return textResult(lines.join('\n'));
}

// ─── 23. audit_security_headers ────────────────────────────────────

async function handleAuditSecurityHeaders(_params, activeEntry) {
  const page = getPage(activeEntry);
  const url = page.url();

  // Re-fetch the current URL to capture response headers
  let headers = {};
  try {
    const response = await page.request.get(url, { timeout: 10000 });
    const allHeaders = await response.headers();
    for (const [k, v] of Object.entries(allHeaders)) {
      headers[k.toLowerCase()] = v;
    }
  } catch {
    // Fallback: navigate again to capture headers
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      if (response) {
        const allHeaders = await response.allHeaders();
        for (const [k, v] of Object.entries(allHeaders)) {
          headers[k.toLowerCase()] = v;
        }
      }
    } catch {
      return textResult(`Error: Could not fetch headers for ${url}`);
    }
  }

  const SECURITY_HEADERS = [
    {
      name: 'content-security-policy',
      display: 'Content-Security-Policy',
      description: 'Controls resources the browser is allowed to load',
      recommendation: "Add a Content-Security-Policy header. Start with: default-src 'self'; script-src 'self'",
      weakCheck: (val) => {
        if (val.includes("'unsafe-inline'") && val.includes("'unsafe-eval'")) return 'weak — allows unsafe-inline AND unsafe-eval';
        if (val.includes("'unsafe-inline'")) return 'weak — allows unsafe-inline';
        if (val.includes("'unsafe-eval'")) return 'weak — allows unsafe-eval';
        if (val.includes('*')) return 'weak — uses wildcard source';
        return null;
      },
    },
    {
      name: 'strict-transport-security',
      display: 'Strict-Transport-Security',
      description: 'Forces HTTPS connections',
      recommendation: 'Add: Strict-Transport-Security: max-age=31536000; includeSubDomains',
      weakCheck: (val) => {
        const match = val.match(/max-age=(\d+)/);
        if (match && parseInt(match[1]) < 31536000) return 'weak — max-age less than 1 year';
        if (!val.includes('includeSubDomains')) return 'weak — missing includeSubDomains';
        return null;
      },
    },
    {
      name: 'x-content-type-options',
      display: 'X-Content-Type-Options',
      description: 'Prevents MIME type sniffing',
      recommendation: 'Add: X-Content-Type-Options: nosniff',
      weakCheck: (val) => {
        if (val.toLowerCase() !== 'nosniff') return 'weak — should be "nosniff"';
        return null;
      },
    },
    {
      name: 'x-frame-options',
      display: 'X-Frame-Options',
      description: 'Prevents clickjacking via iframes',
      recommendation: 'Add: X-Frame-Options: DENY (or SAMEORIGIN if iframing is needed)',
      weakCheck: (val) => {
        const v = val.toUpperCase();
        if (v !== 'DENY' && v !== 'SAMEORIGIN') return `weak — value "${val}" is non-standard`;
        return null;
      },
    },
    {
      name: 'referrer-policy',
      display: 'Referrer-Policy',
      description: 'Controls how much referrer info is sent',
      recommendation: 'Add: Referrer-Policy: strict-origin-when-cross-origin',
      weakCheck: (val) => {
        if (val.toLowerCase() === 'unsafe-url') return 'weak — unsafe-url leaks full URL';
        if (val.toLowerCase() === 'no-referrer-when-downgrade') return 'weak — consider strict-origin-when-cross-origin';
        return null;
      },
    },
    {
      name: 'permissions-policy',
      display: 'Permissions-Policy',
      description: 'Controls browser features (camera, mic, geolocation, etc.)',
      recommendation: 'Add: Permissions-Policy: camera=(), microphone=(), geolocation=()',
      weakCheck: () => null,
    },
    {
      name: 'x-xss-protection',
      display: 'X-XSS-Protection',
      description: 'Legacy XSS filter (deprecated but still checked)',
      recommendation: 'Add: X-XSS-Protection: 0 (modern CSP is preferred instead)',
      weakCheck: (val) => {
        if (val === '0') return null;
        if (!val.includes('mode=block')) return 'weak — if enabled, should include mode=block';
        return null;
      },
    },
  ];

  const results = [];
  let presentCount = 0;
  let missingCount = 0;
  let weakCount = 0;

  for (const header of SECURITY_HEADERS) {
    const value = headers[header.name];
    if (!value) {
      results.push({ header: header.display, status: 'MISSING', value: '', description: header.description, recommendation: header.recommendation });
      missingCount++;
    } else {
      const weakMsg = header.weakCheck(value);
      if (weakMsg) {
        results.push({ header: header.display, status: 'WEAK', value: value.slice(0, 80), description: header.description, recommendation: weakMsg });
        weakCount++;
      } else {
        results.push({ header: header.display, status: 'present', value: value.slice(0, 80), description: header.description, recommendation: '' });
        presentCount++;
      }
    }
  }

  const isHttps = url.startsWith('https://');

  const lines = [
    `## Security Headers Audit`,
    ``,
    `**URL:** ${url}`,
    `**Protocol:** ${isHttps ? 'HTTPS' : 'HTTP (not secure)'}`,
    `**Present:** ${presentCount}/${SECURITY_HEADERS.length}`,
    `**Missing:** ${missingCount}`,
    `**Weak:** ${weakCount}`,
    ``,
    `### Header Details`,
    `| Header | Status | Value |`,
    `|--------|--------|-------|`,
  ];

  for (const r of results) {
    const statusIcon = r.status === 'present' ? 'OK' : r.status;
    lines.push(`| ${r.header} | ${statusIcon} | ${r.value || '—'} |`);
  }

  const issues = results.filter(r => r.status !== 'present');
  if (issues.length > 0) {
    lines.push(``);
    lines.push(`### Recommendations`);
    for (const r of issues) {
      lines.push(`- **${r.header}** (${r.status}): ${r.recommendation}`);
    }
  }

  if (!isHttps) {
    lines.push(``);
    lines.push(`### Warning`);
    lines.push(`Page is served over HTTP. HTTPS is required for most security headers to be effective.`);
  }

  return textResult(lines.join('\n'));
}

// ─── 24. audit_mixed_content ──────────────────────────────────────

async function handleAuditMixedContent(_params, activeEntry) {
  const page = getPage(activeEntry);

  const result = await page.evaluate(() => {
    const pageUrl = window.location.href;
    const isHttps = window.location.protocol === 'https:';
    const mixedItems = [];

    if (!isHttps) {
      return { isHttps: false, pageUrl, mixedItems: [] };
    }

    // Check all elements with src attribute
    const srcElements = document.querySelectorAll('[src]');
    for (const el of srcElements) {
      const src = el.getAttribute('src');
      if (!src) continue;
      try {
        const resolved = new URL(src, pageUrl).href;
        if (resolved.startsWith('http://')) {
          const tag = el.tagName.toLowerCase();
          let selector = tag;
          if (el.id) selector += `#${el.id}`;
          else if (el.className && typeof el.className === 'string') {
            const cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
            if (cls) selector += `.${cls}`;
          }
          mixedItems.push({
            elementType: tag,
            attribute: 'src',
            url: resolved,
            selector,
            isActive: ['script', 'iframe'].includes(tag),
          });
        }
      } catch { /* invalid URL */ }
    }

    // Check all elements with href attribute (link, a pointing to resources)
    const hrefElements = document.querySelectorAll('link[href], a[href]');
    for (const el of hrefElements) {
      const href = el.getAttribute('href');
      if (!href) continue;
      try {
        const resolved = new URL(href, pageUrl).href;
        if (resolved.startsWith('http://')) {
          const tag = el.tagName.toLowerCase();
          const rel = el.getAttribute('rel') || '';
          if (tag === 'link' && !['stylesheet', 'preload', 'prefetch', 'icon'].includes(rel)) continue;

          let selector = tag;
          if (el.id) selector += `#${el.id}`;
          else if (el.className && typeof el.className === 'string') {
            const cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
            if (cls) selector += `.${cls}`;
          }
          if (rel) selector += `[rel="${rel}"]`;

          mixedItems.push({
            elementType: tag,
            attribute: 'href',
            url: resolved,
            selector,
            isActive: tag === 'link' && rel === 'stylesheet',
          });
        }
      } catch { /* invalid URL */ }
    }

    // Check CSS background-image URLs via computed styles
    const visibleElements = document.querySelectorAll('body *');
    for (const el of visibleElements) {
      const cs = window.getComputedStyle(el);
      const bg = cs.backgroundImage;
      if (!bg || bg === 'none') continue;
      const urlMatch = bg.match(/url\(["']?(http:\/\/[^"')]+)["']?\)/);
      if (urlMatch) {
        const tag = el.tagName.toLowerCase();
        let selector = tag;
        if (el.id) selector += `#${el.id}`;
        else if (el.className && typeof el.className === 'string') {
          const cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
          if (cls) selector += `.${cls}`;
        }
        mixedItems.push({
          elementType: tag,
          attribute: 'background-image',
          url: urlMatch[1],
          selector,
          isActive: false,
        });
      }
    }

    return { isHttps, pageUrl, mixedItems };
  });

  const activeContent = result.mixedItems.filter(i => i.isActive);
  const passiveContent = result.mixedItems.filter(i => !i.isActive);

  const lines = [
    `## Mixed Content Audit`,
    ``,
    `**URL:** ${result.pageUrl}`,
    `**Protocol:** ${result.isHttps ? 'HTTPS' : 'HTTP'}`,
  ];

  if (!result.isHttps) {
    lines.push(``, `Page is served over HTTP — mixed content detection is not applicable.`);
    return textResult(lines.join('\n'));
  }

  lines.push(
    `**Total mixed content resources:** ${result.mixedItems.length}`,
    `**Active mixed content (blocks/scripts):** ${activeContent.length}`,
    `**Passive mixed content (images/media):** ${passiveContent.length}`,
  );

  if (result.mixedItems.length === 0) {
    lines.push(``, `No mixed content detected. All resources are loaded over HTTPS.`);
  } else {
    if (activeContent.length > 0) {
      lines.push(``, `### Active Mixed Content (HIGH RISK — may be blocked by browser)`);
      lines.push(`| Element | Attribute | URL | Selector |`);
      lines.push(`|---------|-----------|-----|----------|`);
      for (const item of activeContent) {
        lines.push(`| ${item.elementType} | ${item.attribute} | \`${item.url.slice(0, 70)}\` | \`${item.selector}\` |`);
      }
    }

    if (passiveContent.length > 0) {
      lines.push(``, `### Passive Mixed Content (lower risk — may show warnings)`);
      lines.push(`| Element | Attribute | URL | Selector |`);
      lines.push(`|---------|-----------|-----|----------|`);
      for (const item of passiveContent) {
        lines.push(`| ${item.elementType} | ${item.attribute} | \`${item.url.slice(0, 70)}\` | \`${item.selector}\` |`);
      }
    }

    lines.push(``, `### Recommendations`);
    lines.push(`- Replace all \`http://\` URLs with \`https://\` equivalents`);
    if (activeContent.length > 0) {
      lines.push(`- **URGENT:** Active mixed content (scripts/iframes) is blocked by modern browsers and will break functionality`);
    }
  }

  return textResult(lines.join('\n'));
}

// ─── 25. audit_third_party_scripts ────────────────────────────────

async function handleAuditThirdPartyScripts(_params, activeEntry) {
  const page = getPage(activeEntry);

  const result = await page.evaluate(() => {
    const pageOrigin = window.location.origin;
    const scripts = [];

    const scriptEls = document.querySelectorAll('script');
    for (const el of scriptEls) {
      const src = el.getAttribute('src');
      if (!src) {
        scripts.push({
          type: 'inline',
          domain: '(inline)',
          url: '',
          async: false,
          defer: false,
          size: (el.textContent || '').length,
          isThirdParty: false,
        });
        continue;
      }

      let resolvedUrl = '';
      let domain = '';
      let isThirdParty = false;
      try {
        const parsed = new URL(src, window.location.href);
        resolvedUrl = parsed.href;
        domain = parsed.hostname;
        isThirdParty = parsed.origin !== pageOrigin;
      } catch {
        resolvedUrl = src;
        domain = '(invalid)';
      }

      scripts.push({
        type: isThirdParty ? 'third-party' : 'first-party',
        domain,
        url: resolvedUrl,
        async: el.async,
        defer: el.defer,
        size: 0,
        isThirdParty,
      });
    }

    // Get timing/size data from Performance API
    const perfEntries = performance.getEntriesByType('resource')
      .filter(e => e.initiatorType === 'script');

    for (const script of scripts) {
      if (!script.url) continue;
      const perf = perfEntries.find(e => e.name === script.url);
      if (perf) {
        script.transferSize = perf.transferSize || 0;
        script.encodedBodySize = perf.encodedBodySize || 0;
        script.decodedBodySize = perf.decodedBodySize || 0;
        script.duration = Math.round(perf.duration);
        script.size = perf.decodedBodySize || perf.transferSize || 0;
      }
    }

    return { pageOrigin, scripts };
  });

  const firstParty = result.scripts.filter(s => !s.isThirdParty);
  const thirdParty = result.scripts.filter(s => s.isThirdParty);

  // Group third-party scripts by domain
  const byDomain = {};
  for (const s of thirdParty) {
    if (!byDomain[s.domain]) byDomain[s.domain] = [];
    byDomain[s.domain].push(s);
  }

  const totalThirdPartySize = thirdParty.reduce((sum, s) => sum + (s.size || 0), 0);
  const totalFirstPartySize = firstParty.reduce((sum, s) => sum + (s.size || 0), 0);

  function formatSize(bytes) {
    if (bytes === 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const lines = [
    `## Third-Party Scripts Audit`,
    ``,
    `**Origin:** ${result.pageOrigin}`,
    `**Total scripts:** ${result.scripts.length}`,
    `**First-party:** ${firstParty.length} (${formatSize(totalFirstPartySize)})`,
    `**Third-party:** ${thirdParty.length} (${formatSize(totalThirdPartySize)})`,
    `**Inline scripts:** ${result.scripts.filter(s => s.type === 'inline').length}`,
    `**Third-party domains:** ${Object.keys(byDomain).length}`,
  ];

  if (thirdParty.length > 0) {
    lines.push(``, `### Third-Party Scripts by Domain`);

    for (const [domain, domScripts] of Object.entries(byDomain).sort((a, b) => b[1].length - a[1].length)) {
      const domainSize = domScripts.reduce((sum, s) => sum + (s.size || 0), 0);
      lines.push(``, `**${domain}** (${domScripts.length} script${domScripts.length > 1 ? 's' : ''}, ${formatSize(domainSize)})`);
      for (const s of domScripts) {
        const flags = [];
        if (s.async) flags.push('async');
        if (s.defer) flags.push('defer');
        if (!s.async && !s.defer) flags.push('RENDER-BLOCKING');
        const sizeStr = s.size ? formatSize(s.size) : '—';
        const durationStr = s.duration !== undefined ? `${s.duration}ms` : '—';
        lines.push(`  - \`${s.url.slice(0, 80)}\` [${flags.join(', ')}] ${sizeStr}, ${durationStr}`);
      }
    }

    const renderBlocking = thirdParty.filter(s => !s.async && !s.defer);
    if (renderBlocking.length > 0) {
      lines.push(``, `### Warnings`);
      lines.push(`**${renderBlocking.length} render-blocking third-party script(s)** — add \`async\` or \`defer\` attribute:`);
      for (const s of renderBlocking) {
        lines.push(`- \`${s.url.slice(0, 80)}\` (${s.domain})`);
      }
    }
  } else {
    lines.push(``, `No third-party scripts detected.`);
  }

  if (firstParty.length > 0) {
    lines.push(``, `### First-Party Scripts`);
    lines.push(`| URL | Async | Defer | Size | Duration |`);
    lines.push(`|-----|-------|-------|------|----------|`);
    for (const s of firstParty) {
      if (s.type === 'inline') {
        lines.push(`| (inline, ${formatSize(s.size)}) | — | — | ${formatSize(s.size)} | — |`);
      } else {
        const sizeStr = s.size ? formatSize(s.size) : '—';
        const durationStr = s.duration !== undefined ? `${s.duration}ms` : '—';
        lines.push(`| \`${s.url.slice(0, 60)}\` | ${s.async ? 'Yes' : 'No'} | ${s.defer ? 'Yes' : 'No'} | ${sizeStr} | ${durationStr} |`);
      }
    }
  }

  return textResult(lines.join('\n'));
}

// ─── 26. audit_cookie_compliance ──────────────────────────────────

async function handleAuditCookieCompliance(_params, activeEntry) {
  const page = getPage(activeEntry);
  const url = page.url();

  const cookies = await activeEntry.browserContext.cookies();

  function classifyCookie(name) {
    const n = name.toLowerCase();

    const analyticsPatterns = [
      /^_ga/, /^_gid/, /^_gat/, /^__utm/, /^_hjid/, /^_hjSession/, /^_hj/,
      /^ajs_/, /^mp_/, /^amplitude/, /^_clck/, /^_clsk/, /^__hstc/, /^hubspot/,
      /^_pk_/, /^_paq/, /^plausible/,
    ];
    if (analyticsPatterns.some(p => p.test(n))) return 'analytics';

    const marketingPatterns = [
      /^_fbp/, /^_fbc/, /^fr$/, /^_gcl/, /^IDE$/, /^DSID$/, /^__gads/,
      /^_uet/, /^_ttp/, /^_tt_/, /^_pin_/, /^li_/, /^bcookie/, /^bscookie/,
      /^_rdt_/, /^muc_ads/, /^personalization_id/,
    ];
    if (marketingPatterns.some(p => p.test(n))) return 'marketing';

    const necessaryPatterns = [
      /^session/, /^csrf/, /^xsrf/, /^token/, /^auth/, /^__Host-/, /^__Secure-/,
      /^connect\.sid/, /^PHPSESSID/, /^JSESSIONID/, /^ASP\.NET_SessionId/,
      /^wp-settings/, /^wordpress_logged_in/, /^__cf_bm/, /^cf_clearance/,
      /^__cfruid/, /^_csrf/,
    ];
    if (necessaryPatterns.some(p => p.test(n))) return 'necessary';

    const functionalPatterns = [
      /^lang/, /^locale/, /^theme/, /^dark_?mode/, /^cookie_?consent/,
      /^preferences/, /^timezone/, /^currency/, /^country/,
    ];
    if (functionalPatterns.some(p => p.test(n))) return 'functional';

    return 'unclassified';
  }

  const now = Date.now() / 1000;
  const ONE_YEAR = 365 * 24 * 60 * 60;
  const issues = [];

  const classified = cookies.map(cookie => {
    const category = classifyCookie(cookie.name);
    const cookieIssues = [];

    if (!cookie.secure) {
      cookieIssues.push('Missing Secure flag');
    }

    if (!cookie.httpOnly && category === 'necessary') {
      cookieIssues.push('Missing HttpOnly flag (recommended for session/auth cookies)');
    }

    if (!cookie.sameSite || cookie.sameSite === 'None') {
      if (cookie.sameSite === 'None' && !cookie.secure) {
        cookieIssues.push('SameSite=None requires Secure flag');
      }
      if (!cookie.sameSite) {
        cookieIssues.push('Missing SameSite attribute');
      }
    }

    let expiryInfo = 'Session';
    if (cookie.expires && cookie.expires > 0) {
      const ttl = cookie.expires - now;
      const days = Math.round(ttl / (24 * 60 * 60));
      expiryInfo = `${days} days`;

      if (ttl > ONE_YEAR && (category === 'analytics' || category === 'marketing')) {
        cookieIssues.push(`Expires in ${days} days — GDPR recommends max 13 months for tracking cookies`);
      }
      if (ttl > 2 * ONE_YEAR) {
        cookieIssues.push(`Expires in ${days} days — excessively long lifetime`);
      }
    }

    if (cookieIssues.length > 0) {
      issues.push({ name: cookie.name, category, issues: cookieIssues });
    }

    return {
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
      category,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite || 'None',
      expiry: expiryInfo,
      issues: cookieIssues,
    };
  });

  const counts = { necessary: 0, functional: 0, analytics: 0, marketing: 0, unclassified: 0 };
  for (const c of classified) {
    counts[c.category] = (counts[c.category] || 0) + 1;
  }

  const lines = [
    `## Cookie Compliance Audit`,
    ``,
    `**URL:** ${url}`,
    `**Total cookies:** ${cookies.length}`,
    ``,
    `### Cookies by Category`,
    `| Category | Count |`,
    `|----------|-------|`,
    `| Necessary (session/auth) | ${counts.necessary} |`,
    `| Functional (preferences) | ${counts.functional} |`,
    `| Analytics (tracking) | ${counts.analytics} |`,
    `| Marketing (advertising) | ${counts.marketing} |`,
    `| Unclassified | ${counts.unclassified} |`,
  ];

  if (issues.length > 0) {
    lines.push(``, `### Compliance Issues (${issues.length})`);
    for (const issue of issues) {
      lines.push(`- **${issue.name}** (${issue.category}):`);
      for (const i of issue.issues) {
        lines.push(`  - ${i}`);
      }
    }
  } else {
    lines.push(``, `No compliance issues detected.`);
  }

  lines.push(``, `### All Cookies`);
  lines.push(`| Name | Domain | Category | Secure | HttpOnly | SameSite | Expiry |`);
  lines.push(`|------|--------|----------|--------|----------|----------|--------|`);
  for (const c of classified) {
    lines.push(`| ${c.name} | ${c.domain} | ${c.category} | ${c.secure ? 'Yes' : 'NO'} | ${c.httpOnly ? 'Yes' : 'No'} | ${c.sameSite} | ${c.expiry} |`);
  }

  const hasAnalyticsOrMarketing = counts.analytics > 0 || counts.marketing > 0;
  if (hasAnalyticsOrMarketing) {
    lines.push(``, `### GDPR/CCPA Recommendations`);
    lines.push(`- **Consent required:** ${counts.analytics + counts.marketing} analytics/marketing cookie(s) detected`);
    lines.push(`- Ensure a cookie consent banner is shown before setting non-essential cookies`);
    lines.push(`- Analytics and marketing cookies should only be set after explicit user consent`);
    lines.push(`- Provide a mechanism for users to withdraw consent`);
  }

  return textResult(lines.join('\n'));
}

// ─── 27. audit_lighthouse ─────────────────────────────────────────

async function handleAuditLighthouse(_params, activeEntry) {
  const page = getPage(activeEntry);
  const url = page.url();

  // ── Performance Score (0–100) ──
  const perfData = await page.evaluate(() => {
    const result = { lcp: null, cls: null, fcp: null, imageIssues: 0, totalImages: 0, fontIssues: 0 };

    // LCP
    try {
      const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
      if (lcpEntries.length > 0) {
        result.lcp = lcpEntries[lcpEntries.length - 1].startTime;
      }
    } catch { /* not available */ }

    // CLS via layout-shift entries
    try {
      const clsEntries = performance.getEntriesByType('layout-shift');
      let clsScore = 0;
      for (const entry of clsEntries) {
        if (!entry.hadRecentInput) clsScore += entry.value;
      }
      result.cls = clsScore;
    } catch { /* not available */ }

    // FCP
    try {
      const paintEntries = performance.getEntriesByType('paint');
      const fcp = paintEntries.find(e => e.name === 'first-contentful-paint');
      if (fcp) result.fcp = fcp.startTime;
    } catch { /* not available */ }

    // Image optimization check
    const images = document.querySelectorAll('img');
    result.totalImages = images.length;
    for (const img of images) {
      if (!img.loading) result.imageIssues++;
      if (!img.getAttribute('width') || !img.getAttribute('height')) result.imageIssues++;
      if (!img.hasAttribute('alt')) result.imageIssues++;
    }

    // Font loading check
    const fontEntries = performance.getEntriesByType('resource').filter(e =>
      e.initiatorType === 'css' || e.name.match(/\.(woff2?|ttf|otf|eot)/i)
    );
    const nonPreloaded = fontEntries.filter(e => e.startTime > 500);
    result.fontIssues = nonPreloaded.length;

    return result;
  });

  let perfScore = 100;
  const perfIssues = [];

  if (perfData.lcp !== null) {
    if (perfData.lcp > 4000) { perfScore -= 30; perfIssues.push(`LCP: ${(perfData.lcp / 1000).toFixed(1)}s (poor — target <2.5s)`); }
    else if (perfData.lcp > 2500) { perfScore -= 15; perfIssues.push(`LCP: ${(perfData.lcp / 1000).toFixed(1)}s (needs improvement — target <2.5s)`); }
  } else {
    perfScore -= 5;
  }

  if (perfData.cls !== null) {
    if (perfData.cls > 0.25) { perfScore -= 25; perfIssues.push(`CLS: ${perfData.cls.toFixed(3)} (poor — target <0.1)`); }
    else if (perfData.cls > 0.1) { perfScore -= 10; perfIssues.push(`CLS: ${perfData.cls.toFixed(3)} (needs improvement — target <0.1)`); }
  }

  if (perfData.fcp !== null) {
    if (perfData.fcp > 3000) { perfScore -= 20; perfIssues.push(`FCP: ${(perfData.fcp / 1000).toFixed(1)}s (poor — target <1.8s)`); }
    else if (perfData.fcp > 1800) { perfScore -= 10; perfIssues.push(`FCP: ${(perfData.fcp / 1000).toFixed(1)}s (needs improvement — target <1.8s)`); }
  }

  if (perfData.totalImages > 0) {
    const imgPenalty = Math.min(15, Math.round((perfData.imageIssues / Math.max(1, perfData.totalImages)) * 15));
    if (imgPenalty > 0) { perfScore -= imgPenalty; perfIssues.push(`${perfData.imageIssues} image optimization issue(s) across ${perfData.totalImages} images`); }
  }

  if (perfData.fontIssues > 0) {
    perfScore -= Math.min(5, perfData.fontIssues * 2);
    perfIssues.push(`${perfData.fontIssues} late-loading font resource(s)`);
  }

  perfScore = Math.max(0, Math.min(100, perfScore));

  // ── Accessibility Score (0–100) ──
  const a11yData = await page.evaluate(() => {
    let total = 0;
    let issues = 0;
    const problems = [];

    const imgs = document.querySelectorAll('img');
    total += imgs.length;
    for (const img of imgs) {
      if (!img.hasAttribute('alt')) { issues++; problems.push('Image missing alt attribute'); }
    }

    const inputs = document.querySelectorAll('input:not([type="hidden"]), select, textarea');
    total += inputs.length;
    for (const input of inputs) {
      const hasLabel = input.id && document.querySelector(`label[for="${input.id}"]`);
      const hasAriaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
      const wrappedInLabel = input.closest('label');
      if (!hasLabel && !hasAriaLabel && !wrappedInLabel) { issues++; problems.push('Input missing label/aria-label'); }
    }

    const buttons = document.querySelectorAll('button, [role="button"]');
    total += buttons.length;
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim();
      const ariaLabel = btn.getAttribute('aria-label') || btn.getAttribute('aria-labelledby');
      if (!text && !ariaLabel) { issues++; problems.push('Button missing accessible name'); }
    }

    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let lastLevel = 0;
    let skippedHeadings = 0;
    for (const h of headings) {
      const level = parseInt(h.tagName[1]);
      if (level > lastLevel + 1 && lastLevel > 0) skippedHeadings++;
      lastLevel = level;
    }
    if (skippedHeadings > 0) { issues += skippedHeadings; problems.push(`${skippedHeadings} heading level skip(s)`); }

    const html = document.documentElement;
    const lang = html.getAttribute('lang');
    if (!lang) { issues++; problems.push('Missing lang attribute on <html>'); }

    const landmarks = document.querySelectorAll('main, [role="main"], nav, [role="navigation"], [role="banner"], [role="contentinfo"]');
    if (landmarks.length === 0) { issues++; problems.push('No ARIA landmark roles or semantic landmarks found'); }

    const skipLink = document.querySelector('a[href="#main"], a[href="#content"], .skip-link, .skip-nav, [class*="skip"]');
    if (!skipLink) { issues++; problems.push('No skip navigation link found'); }

    total = Math.max(total, 1);
    return { total, issues, problems: [...new Set(problems)].slice(0, 15) };
  });

  let a11yScore = 100;
  const a11yIssues = a11yData.problems;
  if (a11yData.total > 0) {
    const issueRatio = a11yData.issues / a11yData.total;
    a11yScore = Math.max(0, Math.round(100 - issueRatio * 100 - a11yData.problems.length * 3));
  }
  a11yScore = Math.max(0, Math.min(100, a11yScore));

  // ── SEO Score (0–100) ──
  const seoData = await page.evaluate(() => {
    const issues = [];
    let score = 100;

    const title = document.title;
    if (!title) { score -= 15; issues.push('Missing <title> tag'); }
    else if (title.length < 10) { score -= 5; issues.push(`Title too short: "${title}" (${title.length} chars, recommend 30-60)`); }
    else if (title.length > 70) { score -= 5; issues.push(`Title too long (${title.length} chars, recommend 30-60)`); }

    const desc = document.querySelector('meta[name="description"]');
    if (!desc || !desc.content) { score -= 15; issues.push('Missing meta description'); }
    else if (desc.content.length < 50) { score -= 5; issues.push(`Meta description too short (${desc.content.length} chars, recommend 120-160)`); }
    else if (desc.content.length > 160) { score -= 5; issues.push(`Meta description too long (${desc.content.length} chars, recommend 120-160)`); }

    const canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) { score -= 10; issues.push('Missing canonical URL'); }

    const h1s = document.querySelectorAll('h1');
    if (h1s.length === 0) { score -= 10; issues.push('Missing <h1> tag'); }
    else if (h1s.length > 1) { score -= 5; issues.push(`Multiple <h1> tags (${h1s.length}) — use only one`); }

    const viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) { score -= 10; issues.push('Missing viewport meta tag'); }

    const og = document.querySelector('meta[property="og:title"], meta[property="og:description"]');
    if (!og) { score -= 5; issues.push('Missing Open Graph meta tags'); }

    const jsonLd = document.querySelector('script[type="application/ld+json"]');
    if (!jsonLd) { score -= 5; issues.push('No structured data (JSON-LD) found'); }

    const imgsNoAlt = document.querySelectorAll('img:not([alt])');
    if (imgsNoAlt.length > 0) { score -= 5; issues.push(`${imgsNoAlt.length} image(s) missing alt text`); }

    const robots = document.querySelector('meta[name="robots"]');
    if (robots && robots.content.includes('noindex')) {
      score -= 10; issues.push('Page is set to noindex');
    }

    const lang = document.documentElement.getAttribute('lang');
    if (!lang) { score -= 5; issues.push('Missing lang attribute on <html>'); }

    return { score: Math.max(0, score), issues };
  });

  const seoScore = seoData.score;
  const seoIssues = seoData.issues;

  // ── Best Practices Score (0–100) ──
  let bpScore = 100;
  const bpIssues = [];

  const isHttps = url.startsWith('https://');
  if (!isHttps) { bpScore -= 20; bpIssues.push('Page not served over HTTPS'); }

  // Quick security headers check
  let secHeaderCount = 0;
  try {
    const response = await page.request.get(url, { timeout: 10000 });
    const respHeaders = await response.headers();
    const normalized = {};
    for (const [k, v] of Object.entries(respHeaders)) normalized[k.toLowerCase()] = v;

    const criticalHeaders = ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'x-frame-options'];
    for (const h of criticalHeaders) {
      if (normalized[h]) secHeaderCount++;
    }
    const missing = criticalHeaders.filter(h => !normalized[h]);
    if (missing.length > 0) {
      const penalty = missing.length * 5;
      bpScore -= penalty;
      bpIssues.push(`Missing security headers: ${missing.join(', ')}`);
    }
  } catch {
    bpScore -= 10;
    bpIssues.push('Could not fetch response headers');
  }

  // Check mixed content inline
  const mixedContentCount = await page.evaluate(() => {
    if (window.location.protocol !== 'https:') return 0;
    let count = 0;
    const srcEls = document.querySelectorAll('[src]');
    for (const el of srcEls) {
      const src = el.getAttribute('src');
      if (src) {
        try {
          const resolved = new URL(src, window.location.href).href;
          if (resolved.startsWith('http://')) count++;
        } catch { /* skip */ }
      }
    }
    return count;
  });

  if (mixedContentCount > 0) {
    bpScore -= 15;
    bpIssues.push(`${mixedContentCount} mixed content resource(s) found`);
  }

  // Check for common best-practice issues
  const bpChecks = await page.evaluate(() => {
    const issues = [];

    if (document.querySelector('marquee, blink, center, font, big, strike')) {
      issues.push('Page uses deprecated HTML elements');
    }

    if (!document.doctype) {
      issues.push('Missing DOCTYPE declaration');
    }

    const charset = document.querySelector('meta[charset]');
    if (!charset) {
      issues.push('Missing charset declaration');
    }

    return issues;
  });

  for (const issue of bpChecks) {
    bpScore -= 5;
    bpIssues.push(issue);
  }

  bpScore = Math.max(0, Math.min(100, bpScore));

  // ── Overall Score ──
  const overallScore = Math.round((perfScore + a11yScore + seoScore + bpScore) / 4);

  function scoreColor(score) {
    if (score >= 90) return 'GOOD';
    if (score >= 50) return 'NEEDS IMPROVEMENT';
    return 'POOR';
  }

  const lines = [
    `## Lighthouse-Style Audit`,
    ``,
    `**URL:** ${url}`,
    `**Overall Score:** ${overallScore}/100 (${scoreColor(overallScore)})`,
    ``,
    `### Category Scores`,
    `| Category | Score | Rating |`,
    `|----------|-------|--------|`,
    `| Performance | ${perfScore} | ${scoreColor(perfScore)} |`,
    `| Accessibility | ${a11yScore} | ${scoreColor(a11yScore)} |`,
    `| SEO | ${seoScore} | ${scoreColor(seoScore)} |`,
    `| Best Practices | ${bpScore} | ${scoreColor(bpScore)} |`,
    `| **Overall** | **${overallScore}** | **${scoreColor(overallScore)}** |`,
  ];

  const allIssues = [
    ...perfIssues.map(i => ({ category: 'Performance', issue: i })),
    ...a11yIssues.map(i => ({ category: 'Accessibility', issue: i })),
    ...seoIssues.map(i => ({ category: 'SEO', issue: i })),
    ...bpIssues.map(i => ({ category: 'Best Practices', issue: i })),
  ];

  if (allIssues.length > 0) {
    lines.push(``, `### Top Issues to Fix (${allIssues.length})`);
    for (const item of allIssues.slice(0, 20)) {
      lines.push(`- **[${item.category}]** ${item.issue}`);
    }
  } else {
    lines.push(``, `No issues detected across all categories.`);
  }

  lines.push(``, `### Performance Details`);
  if (perfData.lcp !== null) lines.push(`- LCP: ${(perfData.lcp / 1000).toFixed(2)}s`);
  if (perfData.cls !== null) lines.push(`- CLS: ${perfData.cls.toFixed(3)}`);
  if (perfData.fcp !== null) lines.push(`- FCP: ${(perfData.fcp / 1000).toFixed(2)}s`);
  lines.push(`- Images: ${perfData.totalImages} total, ${perfData.imageIssues} issue(s)`);
  lines.push(`- Late-loading fonts: ${perfData.fontIssues}`);

  lines.push(``, `---`);
  lines.push(`*Note: This is a lightweight approximation, not a full Lighthouse audit. For comprehensive results, run the real Lighthouse CLI or Chrome DevTools audit.*`);

  return textResult(lines.join('\n'));
}
