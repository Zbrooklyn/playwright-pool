import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright';
import { AUDIT_HANDLERS } from '../cli-commands/audit.js';

let browser, context, page;

before(async () => {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await context.newPage();
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
});

after(async () => {
  if (browser) await browser.close();
});

const TESTABLE_HANDLERS = [
  'meta', 'accessibility', 'color_contrast', 'breakpoints', 'overflow',
  'image_sizes', 'tap_targets', 'core_web_vitals', 'fonts', 'dark_mode',
  'security_headers', 'broken_links', 'focus_order', 'interactive_states',
  'spacing_consistency', 'z_index_map', 'form_validation', 'element_overlap',
  'mixed_content', 'third_party_scripts', 'cookie_compliance',
];

describe('Audit Handler Unit Tests', () => {
  for (const name of TESTABLE_HANDLERS) {
    it(name + ' returns { issues, text } without throwing', { timeout: 60000 }, async () => {
      const handler = AUDIT_HANDLERS[name];
      assert.ok(handler, 'Handler should exist');
      assert.ok(typeof handler === 'function', 'Handler should be a function');

      const result = await handler(page, context, {});
      assert.ok(result, 'Handler should return a result');
      assert.ok(typeof result.text === 'string', 'Should return .text as string');
      assert.ok(Array.isArray(result.issues), 'Should return .issues as array');
    });
  }

  it('meta audit detects title on example.com', { timeout: 60000 }, async () => {
    const result = await AUDIT_HANDLERS.meta(page, context, {});
    assert.ok(result.text.includes('Example Domain'), 'Should find page title');
  });

  it('accessibility audit runs without crash on example.com', { timeout: 60000 }, async () => {
    const result = await AUDIT_HANDLERS.accessibility(page, context, {});
    assert.ok(result.text.length > 50, 'Should return substantial text');
  });
});
