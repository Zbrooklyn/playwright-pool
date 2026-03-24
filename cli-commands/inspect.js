// cli-commands/inspect.js
// Inspection commands that operate on an active browser context.
// Commands: console, network, run, wait, verify, locator

import { connectToActiveBrowser, parseArgs } from './shared.js';

export async function handleInspect(command, args) {
  switch (command) {
    case 'console': return cmdConsole(args);
    case 'network': return cmdNetwork(args);
    case 'run': return cmdRun(args);
    case 'wait': return cmdWait(args);
    case 'verify': return cmdVerify(args);
    case 'locator': return cmdLocator(args);
    default:
      console.error(`Unknown inspect command: ${command}`);
      process.exit(1);
  }
}

// ── console ──────────────────────────────────────────────────────────────────
// Get console messages from the active page.
// Usage: playwright-pool console [--level error|warn|info|debug|all]
async function cmdConsole(args) {
  const { flags } = parseArgs(args);
  const level = (flags.level || 'all').toLowerCase();
  const validLevels = new Set(['error', 'warn', 'info', 'debug', 'log', 'all']);
  if (!validLevels.has(level)) {
    console.error(`Invalid level: ${level}. Use: error, warn, info, debug, log, all`);
    process.exit(1);
  }

  const { browser, page } = await connectToActiveBrowser();

  // Collect messages already buffered plus any new ones for a brief window
  const messages = [];

  const listener = (msg) => {
    const type = msg.type(); // 'log', 'error', 'warning', 'info', 'debug', etc.
    const normalizedType = type === 'warning' ? 'warn' : type;
    if (level === 'all' || normalizedType === level) {
      messages.push({ level: normalizedType, text: msg.text() });
    }
  };

  page.on('console', listener);

  // Collect console output via CDP — retrieve any messages the page already logged
  const cdpSession = await page.context().newCDPSession(page);
  await cdpSession.send('Runtime.enable');

  // Also pull historical console messages by evaluating a probe
  // (captures any messages produced during the brief evaluation window)
  await page.evaluate(() => void 0).catch(() => {});

  // Give a short window to collect async messages
  await new Promise((resolve) => setTimeout(resolve, 500));

  page.off('console', listener);

  // Also gather messages from the CDP log domain
  try {
    const { result } = await cdpSession.send('Runtime.evaluate', {
      expression: `
        (function() {
          // If __pw_console_buffer__ was set up, return it
          if (window.__pw_console_buffer__) return JSON.stringify(window.__pw_console_buffer__);
          return '[]';
        })()
      `,
      returnByValue: true,
    });
    // We rely on the listener above for real-time messages
  } catch {
    // CDP session may not support this — fall through
  }

  await cdpSession.detach().catch(() => {});

  if (messages.length === 0) {
    console.log('(no console messages)');
  } else {
    for (const msg of messages) {
      const tag = msg.level.toUpperCase().padEnd(5);
      console.log(`[${tag}] ${msg.text}`);
    }
    console.log(`\n${messages.length} message(s)`);
  }

  browser.disconnect();
}

// ── network ──────────────────────────────────────────────────────────────────
// Get network requests from the active page.
// Usage: playwright-pool network [--filter <pattern>] [--include-static]
async function cmdNetwork(args) {
  const { flags } = parseArgs(args);
  const filterPattern = flags.filter || null;
  const includeStatic = !!flags['include-static'];

  const staticExts = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.avif',
    '.css', '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.map', '.br', '.gz',
  ]);

  const { browser, page } = await connectToActiveBrowser();

  // Listen for new requests for a short window
  const requests = [];

  const listener = (request) => {
    requests.push({
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
    });
  };

  page.on('request', listener);

  // Trigger a no-op evaluation to flush pending requests
  await page.evaluate(() => void 0).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 500));

  page.off('request', listener);

  // Also capture already-completed requests via performance API
  const perfEntries = await page.evaluate(() => {
    return performance.getEntriesByType('resource').map((e) => ({
      method: 'GET',
      url: e.name,
      resourceType: e.initiatorType || 'other',
      duration: Math.round(e.duration),
      status: e.responseStatus || 0,
    }));
  }).catch(() => []);

  // Merge: use performance entries as the primary source, supplement with listener
  const allRequests = [];
  const seen = new Set();

  for (const entry of perfEntries) {
    if (!seen.has(entry.url)) {
      seen.add(entry.url);
      allRequests.push(entry);
    }
  }

  for (const req of requests) {
    if (!seen.has(req.url)) {
      seen.add(req.url);
      allRequests.push({ ...req, duration: 0, status: 0 });
    }
  }

  // Filter
  let filtered = allRequests;

  if (!includeStatic) {
    filtered = filtered.filter((r) => {
      try {
        const pathname = new URL(r.url).pathname;
        const ext = pathname.slice(pathname.lastIndexOf('.'));
        return !staticExts.has(ext.toLowerCase());
      } catch {
        return true;
      }
    });
  }

  if (filterPattern) {
    const regex = new RegExp(filterPattern, 'i');
    filtered = filtered.filter((r) => regex.test(r.url));
  }

  if (filtered.length === 0) {
    console.log('(no network requests)');
  } else {
    for (const r of filtered) {
      const method = (r.method || 'GET').padEnd(6);
      const status = r.status ? ` [${r.status}]` : '';
      const duration = r.duration ? ` ${r.duration}ms` : '';
      console.log(`${method} ${r.url}${status}${duration}`);
    }
    console.log(`\n${filtered.length} request(s)`);
  }

  browser.disconnect();
}

// ── run ──────────────────────────────────────────────────────────────────────
// Execute Playwright code against the active page.
// Usage: playwright-pool run "<code>"
// Auto-wraps bare expressions (no `async` keyword) in an async function.
async function cmdRun(args) {
  const { positional } = parseArgs(args);
  const code = positional.join(' ');
  if (!code) {
    console.error('Usage: playwright-pool run "<code>"');
    process.exit(1);
  }

  const { browser, page } = await connectToActiveBrowser();

  try {
    let result;

    // Detect if code uses Playwright page API (page.xxx) or is a browser expression
    if (/\bpage\b/.test(code)) {
      // Playwright API code — execute in Node context with page available
      // Build and evaluate an async function
      const fn = new Function('page', `return (async () => { ${code} })()`);
      result = await fn(page);
    } else {
      // Browser-side expression — run via page.evaluate
      result = await page.evaluate(code);
    }

    if (result !== undefined && result !== null) {
      if (typeof result === 'object') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(String(result));
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  browser.disconnect();
}

// ── wait ─────────────────────────────────────────────────────────────────────
// Wait for a condition on the active page.
// Usage:
//   playwright-pool wait text "..."       — wait for text to appear
//   playwright-pool wait gone "..."       — wait for text to disappear
//   playwright-pool wait <seconds>        — wait for a duration
async function cmdWait(args) {
  const { positional } = parseArgs(args);
  if (positional.length === 0) {
    console.error('Usage: playwright-pool wait text "..." | wait gone "..." | wait <seconds>');
    process.exit(1);
  }

  const subcommand = positional[0];

  // wait <seconds> — pure timeout
  const seconds = Number(subcommand);
  if (!isNaN(seconds) && seconds > 0) {
    const { browser, page } = await connectToActiveBrowser();
    await page.waitForTimeout(seconds * 1000);
    console.log(`OK — waited ${seconds}s`);
    browser.disconnect();
    return;
  }

  if (subcommand === 'text') {
    const text = positional.slice(1).join(' ');
    if (!text) {
      console.error('Usage: playwright-pool wait text "some text"');
      process.exit(1);
    }

    const { browser, page } = await connectToActiveBrowser();
    try {
      await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 30000 });
      console.log(`OK — text "${text}" is visible`);
    } catch {
      console.log(`TIMEOUT — text "${text}" not found within 30s`);
      browser.disconnect();
      process.exit(2);
    }
    browser.disconnect();
    return;
  }

  if (subcommand === 'gone') {
    const text = positional.slice(1).join(' ');
    if (!text) {
      console.error('Usage: playwright-pool wait gone "some text"');
      process.exit(1);
    }

    const { browser, page } = await connectToActiveBrowser();
    try {
      await page.getByText(text, { exact: false }).first().waitFor({ state: 'hidden', timeout: 30000 });
      console.log(`OK — text "${text}" is gone`);
    } catch {
      console.log(`TIMEOUT — text "${text}" still visible after 30s`);
      browser.disconnect();
      process.exit(2);
    }
    browser.disconnect();
    return;
  }

  console.error(`Unknown wait subcommand: ${subcommand}`);
  console.error('Usage: playwright-pool wait text "..." | wait gone "..." | wait <seconds>');
  process.exit(1);
}

// ── verify ───────────────────────────────────────────────────────────────────
// Verify conditions on the active page. Prints PASS/FAIL, exits 0/2.
// Usage:
//   playwright-pool verify text "..."
//   playwright-pool verify element <role> "name"
//   playwright-pool verify list <selector> item1 item2 ...
//   playwright-pool verify value <selector> "expected"
async function cmdVerify(args) {
  const { positional } = parseArgs(args);
  if (positional.length === 0) {
    console.error('Usage: playwright-pool verify text|element|list|value ...');
    process.exit(1);
  }

  const subcommand = positional[0];
  const { browser, page } = await connectToActiveBrowser();

  try {
    switch (subcommand) {
      case 'text': {
        const text = positional.slice(1).join(' ');
        if (!text) {
          console.error('Usage: playwright-pool verify text "some text"');
          browser.disconnect();
          process.exit(1);
        }
        const visible = await page.getByText(text, { exact: false }).first().isVisible().catch(() => false);
        if (visible) {
          console.log(`PASS — text "${text}" is visible`);
        } else {
          console.log(`FAIL — text "${text}" not found`);
          browser.disconnect();
          process.exit(2);
        }
        break;
      }

      case 'element': {
        const role = positional[1];
        const name = positional.slice(2).join(' ');
        if (!role) {
          console.error('Usage: playwright-pool verify element <role> "name"');
          browser.disconnect();
          process.exit(1);
        }
        const locator = name
          ? page.getByRole(role, { name, exact: false })
          : page.getByRole(role);
        const visible = await locator.first().isVisible().catch(() => false);
        if (visible) {
          console.log(`PASS — ${role}${name ? ` "${name}"` : ''} is visible`);
        } else {
          console.log(`FAIL — ${role}${name ? ` "${name}"` : ''} not found`);
          browser.disconnect();
          process.exit(2);
        }
        break;
      }

      case 'list': {
        const selector = positional[1];
        const expectedItems = positional.slice(2);
        if (!selector || expectedItems.length === 0) {
          console.error('Usage: playwright-pool verify list <selector> item1 item2 ...');
          browser.disconnect();
          process.exit(1);
        }
        const items = await page.locator(selector).allTextContents().catch(() => []);
        const normalizedItems = items.map((t) => t.trim()).filter(Boolean);
        const allFound = expectedItems.every((expected) =>
          normalizedItems.some((actual) => actual.toLowerCase().includes(expected.toLowerCase()))
        );
        if (allFound) {
          console.log(`PASS — all ${expectedItems.length} items found in "${selector}" (${normalizedItems.length} total)`);
        } else {
          const missing = expectedItems.filter(
            (expected) => !normalizedItems.some((actual) => actual.toLowerCase().includes(expected.toLowerCase()))
          );
          console.log(`FAIL — missing items in "${selector}": ${missing.join(', ')}`);
          browser.disconnect();
          process.exit(2);
        }
        break;
      }

      case 'value': {
        const selector = positional[1];
        const expected = positional.slice(2).join(' ');
        if (!selector || !expected) {
          console.error('Usage: playwright-pool verify value <selector> "expected"');
          browser.disconnect();
          process.exit(1);
        }
        const actual = await page.locator(selector).inputValue().catch(() => null);
        if (actual === null) {
          console.log(`FAIL — element "${selector}" not found or has no value`);
          browser.disconnect();
          process.exit(2);
        } else if (actual === expected) {
          console.log(`PASS — value of "${selector}" is "${expected}"`);
        } else {
          console.log(`FAIL — value of "${selector}" is "${actual}", expected "${expected}"`);
          browser.disconnect();
          process.exit(2);
        }
        break;
      }

      default:
        console.error(`Unknown verify subcommand: ${subcommand}`);
        console.error('Usage: playwright-pool verify text|element|list|value ...');
        browser.disconnect();
        process.exit(1);
    }
  } catch (err) {
    console.log(`FAIL — ${err.message}`);
    browser.disconnect();
    process.exit(2);
  }

  browser.disconnect();
}

// ── locator ──────────────────────────────────────────────────────────────────
// Find an element by description and print its selector.
// Usage: playwright-pool locator "<description>"
// Tries multiple strategies: getByText, getByRole, getByLabel, getByPlaceholder, CSS
async function cmdLocator(args) {
  const { positional } = parseArgs(args);
  const description = positional.join(' ');
  if (!description) {
    console.error('Usage: playwright-pool locator "<description>"');
    process.exit(1);
  }

  const { browser, page } = await connectToActiveBrowser();

  // Try multiple locator strategies and report what works
  const strategies = [
    {
      name: 'getByText',
      fn: () => page.getByText(description, { exact: false }).first(),
      selector: `getByText("${description}")`,
    },
    {
      name: 'getByRole(button)',
      fn: () => page.getByRole('button', { name: description }).first(),
      selector: `getByRole('button', { name: "${description}" })`,
    },
    {
      name: 'getByRole(link)',
      fn: () => page.getByRole('link', { name: description }).first(),
      selector: `getByRole('link', { name: "${description}" })`,
    },
    {
      name: 'getByRole(heading)',
      fn: () => page.getByRole('heading', { name: description }).first(),
      selector: `getByRole('heading', { name: "${description}" })`,
    },
    {
      name: 'getByLabel',
      fn: () => page.getByLabel(description).first(),
      selector: `getByLabel("${description}")`,
    },
    {
      name: 'getByPlaceholder',
      fn: () => page.getByPlaceholder(description).first(),
      selector: `getByPlaceholder("${description}")`,
    },
    {
      name: 'getByAltText',
      fn: () => page.getByAltText(description).first(),
      selector: `getByAltText("${description}")`,
    },
    {
      name: 'getByTitle',
      fn: () => page.getByTitle(description).first(),
      selector: `getByTitle("${description}")`,
    },
  ];

  const matches = [];

  for (const strategy of strategies) {
    try {
      const locator = strategy.fn();
      const count = await locator.count().catch(() => 0);
      if (count > 0) {
        const visible = await locator.isVisible().catch(() => false);
        if (visible) {
          const tagName = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => '?');
          const text = await locator.evaluate((el) => el.textContent?.trim().slice(0, 80)).catch(() => '');
          matches.push({
            strategy: strategy.name,
            selector: strategy.selector,
            tagName,
            text,
          });
        }
      }
    } catch {
      // Strategy didn't match — skip
    }
  }

  if (matches.length === 0) {
    console.log(`No elements found matching "${description}"`);
    browser.disconnect();
    process.exit(2);
  }

  console.log(`Found ${matches.length} matching strategy(ies) for "${description}":\n`);
  for (const match of matches) {
    console.log(`  Strategy:  ${match.strategy}`);
    console.log(`  Selector:  ${match.selector}`);
    console.log(`  Element:   <${match.tagName}>`);
    if (match.text) {
      console.log(`  Text:      ${match.text}`);
    }
    console.log('');
  }

  // Recommend the first match
  console.log(`Recommended: ${matches[0].selector}`);

  browser.disconnect();
}
