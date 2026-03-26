// cli-commands/interact.js
// Module A: Navigate, click, fill, wait, scroll with obstacle handling
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

const GOLDEN_PROFILE = process.env.GOLDEN_PROFILE || path.join(os.homedir(), '.playwright-pool', 'golden-profile');
const AUTH_FILES = [
  'Default/Network/Cookies', 'Default/Network/Cookies-journal',
  'Default/Login Data', 'Default/Login Data-journal',
  'Default/Login Data For Account', 'Default/Login Data For Account-journal',
  'Default/Local Storage', 'Default/Session Storage',
  'Default/Web Data', 'Default/Web Data-journal',
  'Default/Preferences', 'Default/Secure Preferences', 'Local State',
];
const LOCK_FILES = new Set(['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile', 'LOCK']);

// Parse step string into action objects
// Supports: "click 'Blog'", "fill '#email' 'test@test.com'", "wait 2", "scroll down"
export function parseSteps(stepsInput) {
  if (!stepsInput) return [];
  const steps = Array.isArray(stepsInput) ? stepsInput : stepsInput.split(',').map(s => s.trim());
  return steps.map(step => {
    const clickMatch = step.match(/^click\s+['"](.+)['"]$/i) || step.match(/^click\s+(.+)$/i);
    if (clickMatch) return { action: 'click', target: clickMatch[1] };

    const fillMatch = step.match(/^fill\s+['"](.+)['"]\s+['"](.+)['"]$/i);
    if (fillMatch) return { action: 'fill', target: fillMatch[1], value: fillMatch[2] };

    const waitMatch = step.match(/^wait\s+(\d+)$/i);
    if (waitMatch) return { action: 'wait', seconds: parseInt(waitMatch[1]) };

    const waitForMatch = step.match(/^wait\s+['"](.+)['"]$/i);
    if (waitForMatch) return { action: 'waitFor', target: waitForMatch[1] };

    const scrollMatch = step.match(/^scroll\s+(down|up|bottom|top)$/i);
    if (scrollMatch) return { action: 'scroll', direction: scrollMatch[1].toLowerCase() };

    // Default: treat as click target
    return { action: 'click', target: step };
  });
}

// Create authenticated browser context using golden profile overlay
export async function launchWithAuth(options = {}) {
  const { headless = true, viewport = { width: 1280, height: 800 } } = options;
  const tempDir = path.join(os.tmpdir(), `pw-interact-${Date.now()}`);

  // Create fresh profile
  const tempCtx = await chromium.launchPersistentContext(tempDir, { headless: true });
  await tempCtx.close();

  // Overlay auth files from golden profile
  if (fs.existsSync(GOLDEN_PROFILE)) {
    for (const f of AUTH_FILES) {
      const src = path.join(GOLDEN_PROFILE, f);
      const dst = path.join(tempDir, f);
      if (fs.existsSync(src)) {
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
          fs.cpSync(src, dst, { recursive: true, force: true });
        } else {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(src, dst);
        }
      }
    }
  }

  // Launch with auth
  const context = await chromium.launchPersistentContext(tempDir, {
    headless,
    viewport,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = context.pages()[0] || await context.newPage();
  return { context, page, tempDir };
}

// Click with multiple selector strategies and obstacle handling
async function adaptiveClick(page, target, timeout = 10000) {
  const strategies = [
    () => page.getByRole('button', { name: target }),
    () => page.getByRole('link', { name: target }),
    () => page.getByRole('tab', { name: target }),
    () => page.getByRole('menuitem', { name: target }),
    () => page.getByText(target, { exact: false }),
    () => page.locator(`text=${target}`),
    () => page.locator(target), // CSS selector fallback
  ];

  for (const strategy of strategies) {
    try {
      const locator = strategy();
      if (await locator.count() > 0) {
        await Promise.all([
          page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}),
          locator.first().click({ timeout }),
        ]);
        // Wait for page to settle (OAuth, SPA navigation, loading)
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(300);
        return { success: true, strategy: strategy.toString().slice(6, 40) };
      }
    } catch { continue; }
  }
  return { success: false, error: `Element not found: "${target}"` };
}

// Launch a standalone browser (no auth overlay)
async function launchStandalone(options = {}) {
  const { headless = true, viewport = { width: 1280, height: 800 } } = options;
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  return { context, page, tempDir: null };
}

// Execute all steps and return the page in desired state
export async function interact(url, steps, options = {}) {
  const { auth = true, headless = true, viewport, headed, timeout = 120000 } = options;
  const log = [];
  const startTime = Date.now();

  // Launch browser with auth if requested
  const { context, page, tempDir } = auth
    ? await launchWithAuth({ headless: headed ? false : headless, viewport })
    : await launchStandalone({ headless: headed ? false : headless, viewport });

  // Auto-dismiss dialogs (alerts, confirms, prompts)
  page.on('dialog', d => d.dismiss());

  // Navigate
  log.push({ step: 'navigate', url, time: Date.now() - startTime });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  // Execute steps
  const parsedSteps = parseSteps(steps);
  for (let i = 0; i < parsedSteps.length; i++) {
    // Overall workflow timeout check
    if (Date.now() - startTime > timeout) {
      log.push({ step: `skipped (timeout after ${timeout}ms)`, remaining: parsedSteps.length - i, success: false, error: 'workflow timeout exceeded', time: Date.now() - startTime });
      break;
    }

    const step = parsedSteps[i];

    switch (step.action) {
      case 'click': {
        const result = await adaptiveClick(page, step.target);
        log.push({ step: `click "${step.target}"`, ...result, time: Date.now() - startTime });
        break;
      }
      case 'fill': {
        await page.fill(step.target, step.value).catch(err =>
          log.push({ step: `fill "${step.target}"`, success: false, error: err.message, time: Date.now() - startTime })
        );
        log.push({ step: `fill "${step.target}"`, success: true, time: Date.now() - startTime });
        break;
      }
      case 'wait': {
        await page.waitForTimeout(step.seconds * 1000);
        log.push({ step: `wait ${step.seconds}s`, success: true, time: Date.now() - startTime });
        break;
      }
      case 'waitFor': {
        try {
          await page.waitForSelector(`text=${step.target}`, { timeout: 15000 });
          log.push({ step: `waitFor "${step.target}"`, success: true, time: Date.now() - startTime });
        } catch {
          log.push({ step: `waitFor "${step.target}"`, success: false, error: 'timeout', time: Date.now() - startTime });
        }
        break;
      }
      case 'scroll': {
        const scrollMap = { down: 500, up: -500, bottom: 99999, top: -99999 };
        await page.evaluate(y => window.scrollBy(0, y), scrollMap[step.direction] || 500);
        log.push({ step: `scroll ${step.direction}`, success: true, time: Date.now() - startTime });
        break;
      }
    }
  }

  return { page, context, tempDir, log, totalTime: Date.now() - startTime };
}
