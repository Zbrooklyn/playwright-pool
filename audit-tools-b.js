// audit-tools-b.js — Audit tools 12–27 for playwright-pool
//
// Exports:
//   getSchemas(z) — returns array of MCP tool schemas
//   handleAuditTool(name, params, activeEntry) — dispatches to handler
//
// These tools operate on the active pool entry's browserContext.
// The caller (server.js) is responsible for resolving activeEntry.
//
// 12 of 16 handlers delegate to audit.js (single source of truth).
// Only audit_diff, loading_states, print_layout, scroll_behavior are local.

import fs from 'fs';
import path from 'path';
import { AUDIT_HANDLERS } from './cli-commands/audit.js';

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

// ─── Delegated handlers (use audit.js as single source of truth) ────

async function delegateToAudit(auditName, params, activeEntry) {
  const page = getPage(activeEntry);
  const result = await AUDIT_HANDLERS[auditName](page, null, params);
  return textResult(result.text);
}

async function handleAuditFocusOrder(params, activeEntry) {
  return delegateToAudit('focus_order', params, activeEntry);
}

async function handleAuditInteractiveStates(params, activeEntry) {
  return delegateToAudit('interactive_states', params, activeEntry);
}

async function handleAuditSpacingConsistency(params, activeEntry) {
  return delegateToAudit('spacing_consistency', params, activeEntry);
}

async function handleAuditZIndexMap(params, activeEntry) {
  return delegateToAudit('z_index_map', params, activeEntry);
}

async function handleAuditBrokenLinks(params, activeEntry) {
  return delegateToAudit('broken_links', params, activeEntry);
}

// ─── 18. audit_loading_states (unique — not in audit.js) ────────────
// NOTE: Old duplicated handler bodies removed — now delegated above
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


// ─── Delegated handlers (19, 22-27) — use audit.js single source of truth ──

async function handleAuditFormValidation(params, activeEntry) {
  return delegateToAudit('form_validation', params, activeEntry);
}

async function handleAuditElementOverlap(params, activeEntry) {
  return delegateToAudit('element_overlap', params, activeEntry);
}

async function handleAuditSecurityHeaders(params, activeEntry) {
  return delegateToAudit('security_headers', params, activeEntry);
}

async function handleAuditMixedContent(params, activeEntry) {
  return delegateToAudit('mixed_content', params, activeEntry);
}

async function handleAuditThirdPartyScripts(params, activeEntry) {
  return delegateToAudit('third_party_scripts', params, activeEntry);
}

async function handleAuditCookieCompliance(params, activeEntry) {
  return delegateToAudit('cookie_compliance', params, activeEntry);
}

async function handleAuditLighthouse(params, activeEntry) {
  return delegateToAudit('lighthouse', params, activeEntry);
}
