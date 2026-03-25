// cli-commands/quick.js — standalone quick operations
import path from 'path';
import { parseArgs, getViewport, timestamp, ensureDir, getOrLaunchBrowser, launchStandalone, DEVICES } from './shared.js';

export async function handleQuick(command, args) {
  try {
    switch (command) {
      case 'screenshot': await cmdScreenshot(args); break;
      case 'snap':       await cmdSnap(args); break;
      case 'eval':       await cmdEval(args); break;
      case 'pdf':        await cmdPdf(args); break;
      default:
        console.error(`Unknown quick command: ${command}`);
        process.exit(1);
    }
  } finally {
    // Force exit — CDP connections can keep the event loop alive
    process.exit(0);
  }
}

// ─── screenshot ──────────────────────────────────────────────────────────────

async function cmdScreenshot(args) {
  const { flags, positional } = parseArgs(args);
  const url = positional[0];
  if (!url) {
    console.error('Usage: playwright-pool screenshot <url> [filename] [--full-page] [--mobile] [--tablet] [--breakpoints]');
    process.exit(1);
  }

  const fullPage = !!flags['full-page'];

  // --breakpoints: capture at desktop, tablet, and mobile widths
  if (flags.breakpoints) {
    const dir = ensureDir(flags.output || '.');
    const saved = [];

    for (const [label, viewport] of Object.entries(DEVICES)) {
      const { browser, page, reused } = await getOrLaunchBrowser({ ...flags, mobile: false, tablet: false });
      await page.setViewportSize(viewport);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() =>
        page.goto(url, { waitUntil: 'load', timeout: 30000 })
      );
      const filename = path.join(dir, `${label}-${timestamp()}.png`);
      await page.screenshot({ path: filename, fullPage });
      saved.push(filename);
      console.log(`Saved: ${filename}  (${viewport.width}x${viewport.height})`);
      if (reused) { await page.close().catch(() => {}); browser.disconnect(); } else { await browser.close(); }
    }

    return saved;
  }

  // Single viewport screenshot
  const { browser, page, reused } = await getOrLaunchBrowser(flags);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const filename = positional[1] || `screenshot-${timestamp()}.png`;
  await page.screenshot({ path: filename, fullPage });
  console.log(`Saved: ${filename}`);
  if (reused) { await page.close().catch(() => {}); browser.disconnect(); } else { await browser.close(); }
  return filename;
}

// ─── snap (accessibility snapshot) ───────────────────────────────────────────

async function cmdSnap(args) {
  const { flags, positional } = parseArgs(args);
  const url = positional[0];
  if (!url) {
    console.error('Usage: playwright-pool snap <url> [filename] [--interactive] [--compact]');
    process.exit(1);
  }

  const { browser, page, reused } = await getOrLaunchBrowser(flags);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const compactMode = !!flags.compact;

  // --compact: flat interactive-only format (~90% fewer tokens)
  if (compactMode) {
    const result = await collectCompactSnapshot(page);
    const title = await page.title();
    const header = [
      `Compact Snapshot: ${title}`,
      `URL: ${url}`,
      `Captured: ${new Date().toISOString()}`,
      '',
    ];
    const output = header.join('\n') + result;
    const filename = positional[1] || `snap-compact-${timestamp()}.md`;
    const fs = await import('fs');
    fs.writeFileSync(filename, output);
    console.log(`Saved: ${filename}  (compact interactive snapshot)`);
    if (reused) { await page.close().catch(() => {}); browser.disconnect(); } else { await browser.close(); }
    return filename;
  }

  const interactiveOnly = !!flags.interactive;

  // Walk DOM to build an accessible element tree
  const elements = await page.evaluate((filterInteractive) => {
    const INTERACTIVE_ROLES = new Set([
      'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
      'listbox', 'menuitem', 'tab', 'switch', 'slider', 'spinbutton',
      'searchbox', 'option', 'menuitemcheckbox', 'menuitemradio',
    ]);
    const INTERACTIVE_TAGS = new Set([
      'A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'DETAILS', 'SUMMARY',
    ]);

    const results = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      const role = node.getAttribute('role') || node.tagName.toLowerCase();
      const name =
        node.getAttribute('aria-label') ||
        node.getAttribute('alt') ||
        node.getAttribute('title') ||
        node.getAttribute('placeholder') ||
        (node.textContent || '').trim().slice(0, 80);
      const value =
        node.value !== undefined && node.value !== '' ? String(node.value) : undefined;
      const isInteractive =
        INTERACTIVE_ROLES.has(role) ||
        INTERACTIVE_TAGS.has(node.tagName) ||
        node.hasAttribute('tabindex') ||
        node.hasAttribute('onclick');

      if (filterInteractive && !isInteractive) continue;

      const rect = node.getBoundingClientRect();
      // Skip invisible elements
      if (rect.width === 0 && rect.height === 0) continue;

      results.push({
        tag: node.tagName.toLowerCase(),
        role,
        name: name || undefined,
        value,
        interactive: isInteractive,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        },
      });
    }
    return results;
  }, interactiveOnly);

  // Format as markdown
  const title = await page.title();
  const lines = [
    `# Accessibility Snapshot`,
    ``,
    `- **URL:** ${url}`,
    `- **Title:** ${title}`,
    `- **Elements:** ${elements.length}`,
    `- **Filter:** ${interactiveOnly ? 'interactive only' : 'all elements'}`,
    `- **Captured:** ${new Date().toISOString()}`,
    ``,
    `## Elements`,
    ``,
    `| # | Tag | Role | Name | Interactive | Position |`,
    `|---|-----|------|------|-------------|----------|`,
  ];

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const name = (el.name || '').replace(/\|/g, '\\|').slice(0, 60);
    const pos = `${el.rect.x},${el.rect.y} ${el.rect.w}x${el.rect.h}`;
    lines.push(
      `| ${i + 1} | ${el.tag} | ${el.role} | ${name} | ${el.interactive ? 'Yes' : '-'} | ${pos} |`
    );
  }

  const markdown = lines.join('\n') + '\n';
  const filename = positional[1] || `snap-${timestamp()}.md`;

  const fs = await import('fs');
  fs.writeFileSync(filename, markdown);
  console.log(`Saved: ${filename}  (${elements.length} elements)`);
  if (reused) { await page.close().catch(() => {}); browser.disconnect(); } else { await browser.close(); }
  return filename;
}

// ─── compact snapshot helper (shared between CLI and MCP) ────────────────────

async function collectCompactSnapshot(page, scopeSelector = 'body') {
  const elements = await page.evaluate((scope) => {
    const root = document.querySelector(scope);
    if (!root) return { error: `Selector "${scope}" not found` };

    const SELECTORS = [
      'a[href]',
      'button', '[role="button"]',
      'input', 'textarea', 'select',
      '[tabindex]:not([tabindex="-1"])',
      '[onclick]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
      '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
      '[role="combobox"]', '[role="listbox"]', '[role="slider"]',
      '[role="searchbox"]', '[role="spinbutton"]',
      '[role="menuitemcheckbox"]', '[role="menuitemradio"]',
    ];

    const selector = SELECTORS.join(', ');
    const nodes = root.querySelectorAll(selector);
    const seen = new Set();
    const results = [];

    for (const node of nodes) {
      if (seen.has(node)) continue;
      seen.add(node);

      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const tag = node.tagName.toLowerCase();
      const role = node.getAttribute('role') || '';
      const type = node.getAttribute('type') || '';
      const href = node.getAttribute('href') || '';
      const disabled = node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true';
      const ariaExpanded = node.getAttribute('aria-expanded');
      const ariaCurrent = node.getAttribute('aria-current');

      let name = '';
      const ariaLabel = node.getAttribute('aria-label');
      const ariaLabelledBy = node.getAttribute('aria-labelledby');
      if (ariaLabel) {
        name = ariaLabel;
      } else if (ariaLabelledBy) {
        const labelEl = document.getElementById(ariaLabelledBy);
        if (labelEl) name = (labelEl.textContent || '').trim();
      } else if (node.getAttribute('alt')) {
        name = node.getAttribute('alt');
      } else if (node.getAttribute('title')) {
        name = node.getAttribute('title');
      } else if (node.getAttribute('placeholder')) {
        name = node.getAttribute('placeholder');
      } else {
        if (node.id) {
          const label = document.querySelector(`label[for="${node.id}"]`);
          if (label) name = (label.textContent || '').trim();
        }
        if (!name) {
          name = (node.textContent || '').trim().replace(/\s+/g, ' ');
        }
      }
      if (name.length > 60) name = name.slice(0, 57) + '...';

      let value = undefined;
      if (tag === 'input' || tag === 'textarea') {
        if (node.value !== undefined && node.value !== '') {
          value = node.value;
          if (value.length > 40) value = value.slice(0, 37) + '...';
        }
      }

      let options = undefined;
      let selectedOption = undefined;
      if (tag === 'select') {
        const opts = Array.from(node.options || []);
        selectedOption = node.options[node.selectedIndex]?.text || '';
        options = opts.slice(0, 5).map(o => o.text);
        if (opts.length > 5) options.push(`+${opts.length - 5} more`);
      }

      results.push({
        tag, role, type, name, href, disabled,
        expanded: ariaExpanded,
        active: ariaCurrent === 'page' || ariaCurrent === 'true',
        value, selectedOption, options,
      });
    }

    return { elements: results };
  }, scopeSelector);

  if (elements.error) return `Error: ${elements.error}`;

  const items = elements.elements;
  const lines = [`Interactive Elements (${items.length} found):`];

  for (let i = 0; i < items.length; i++) {
    const el = items[i];
    const ref = `@${i + 1}`;
    const parts = [ref.padEnd(5)];

    const tag = el.tag;
    const role = el.role;

    if (tag === 'a' || role === 'link') {
      let shortHref = el.href;
      if (shortHref) {
        try {
          const url = new URL(shortHref, 'http://dummy');
          shortHref = url.pathname + (url.search || '');
          if (shortHref.length > 50) shortHref = shortHref.slice(0, 47) + '...';
        } catch {
          if (shortHref.length > 50) shortHref = shortHref.slice(0, 47) + '...';
        }
      }
      let line = `link "${el.name}"`;
      if (shortHref) line += ` \u2192 ${shortHref}`;
      if (el.active) line += ' [active]';
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    } else if (tag === 'button' || role === 'button') {
      let line = `button "${el.name}"`;
      if (el.expanded === 'true' || el.expanded === 'false') line += ' \u25BE';
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    } else if (tag === 'input') {
      const inputType = el.type || 'text';
      let line = `input[${inputType}] "${el.name}"`;
      if (el.value !== undefined) line += ` = "${el.value}"`;
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    } else if (tag === 'textarea') {
      let line = `textarea "${el.name}"`;
      if (el.value !== undefined) line += ` = "${el.value}"`;
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    } else if (tag === 'select') {
      let line = `select "${el.name}"`;
      if (el.selectedOption) line += ` = "${el.selectedOption}"`;
      if (el.options && el.options.length > 0) line += ` [options: ${el.options.join(', ')}]`;
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    } else if (role === 'tab') {
      let line = `tab "${el.name}"`;
      if (el.active) line += ' [active]';
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    } else if (role === 'checkbox') {
      let line = `checkbox "${el.name}"`;
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    } else if (role === 'radio') {
      let line = `radio "${el.name}"`;
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    } else if (role === 'menuitem' || role === 'menuitemcheckbox' || role === 'menuitemradio') {
      let line = `menuitem "${el.name}"`;
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    } else {
      const label = role || tag;
      let line = `${label} "${el.name}"`;
      if (el.href) line += ` \u2192 ${el.href}`;
      if (el.disabled) line += ' [disabled]';
      parts.push(line);
    }

    lines.push('  ' + parts.join(' '));
  }

  return lines.join('\n');
}

export { collectCompactSnapshot };

// ─── eval ────────────────────────────────────────────────────────────────────

async function cmdEval(args) {
  const { flags, positional } = parseArgs(args);
  const url = positional[0];
  const expression = positional[1];
  if (!url || !expression) {
    console.error('Usage: playwright-pool eval <url> <expression>');
    process.exit(1);
  }

  const { browser, page, reused } = await getOrLaunchBrowser(flags);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const result = await page.evaluate(expression);
  console.log(JSON.stringify(result, null, 2));
  if (reused) { await page.close().catch(() => {}); browser.disconnect(); } else { await browser.close(); }
  return result;
}

// ─── pdf ─────────────────────────────────────────────────────────────────────

async function cmdPdf(args) {
  const { flags, positional } = parseArgs(args);
  const url = positional[0];
  if (!url) {
    console.error('Usage: playwright-pool pdf <url> [filename]');
    process.exit(1);
  }

  // PDF generation requires headless mode (Chromium limitation)
  const pdfFlags = { ...flags, headed: false, mobile: false, tablet: false };
  const { browser, page, reused } = await getOrLaunchBrowser(pdfFlags);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const filename = positional[1] || `page-${timestamp()}.pdf`;
  await page.pdf({ path: filename });
  console.log(`Saved: ${filename}`);
  if (reused) { await page.close().catch(() => {}); browser.disconnect(); } else { await browser.close(); }
  return filename;
}
