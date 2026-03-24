// cli-commands/quick.js — standalone quick operations
import path from 'path';
import { parseArgs, getViewport, timestamp, ensureDir, launchStandalone, DEVICES } from './shared.js';

export async function handleQuick(command, args) {
  switch (command) {
    case 'screenshot': return cmdScreenshot(args);
    case 'snap':       return cmdSnap(args);
    case 'eval':       return cmdEval(args);
    case 'pdf':        return cmdPdf(args);
    default:
      console.error(`Unknown quick command: ${command}`);
      process.exit(1);
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
      const { browser, page } = await launchStandalone({ ...flags, mobile: false, tablet: false });
      await page.setViewportSize(viewport);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() =>
        page.goto(url, { waitUntil: 'load', timeout: 30000 })
      );
      const filename = path.join(dir, `${label}-${timestamp()}.png`);
      await page.screenshot({ path: filename, fullPage });
      saved.push(filename);
      console.log(`Saved: ${filename}  (${viewport.width}x${viewport.height})`);
      await browser.close();
    }

    return saved;
  }

  // Single viewport screenshot
  const { browser, page } = await launchStandalone(flags);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() =>
    page.goto(url, { waitUntil: 'load', timeout: 30000 })
  );

  const filename = positional[1] || `screenshot-${timestamp()}.png`;
  await page.screenshot({ path: filename, fullPage });
  console.log(`Saved: ${filename}`);
  await browser.close();
  return filename;
}

// ─── snap (accessibility snapshot) ───────────────────────────────────────────

async function cmdSnap(args) {
  const { flags, positional } = parseArgs(args);
  const url = positional[0];
  if (!url) {
    console.error('Usage: playwright-pool snap <url> [filename] [--interactive]');
    process.exit(1);
  }

  const { browser, page } = await launchStandalone(flags);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() =>
    page.goto(url, { waitUntil: 'load', timeout: 30000 })
  );

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
  await browser.close();
  return filename;
}

// ─── eval ────────────────────────────────────────────────────────────────────

async function cmdEval(args) {
  const { flags, positional } = parseArgs(args);
  const url = positional[0];
  const expression = positional[1];
  if (!url || !expression) {
    console.error('Usage: playwright-pool eval <url> <expression>');
    process.exit(1);
  }

  const { browser, page } = await launchStandalone(flags);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() =>
    page.goto(url, { waitUntil: 'load', timeout: 30000 })
  );

  const result = await page.evaluate(expression);
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
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
  const { browser, page } = await launchStandalone(pdfFlags);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() =>
    page.goto(url, { waitUntil: 'load', timeout: 30000 })
  );

  const filename = positional[1] || `page-${timestamp()}.pdf`;
  await page.pdf({ path: filename });
  console.log(`Saved: ${filename}`);
  await browser.close();
  return filename;
}
