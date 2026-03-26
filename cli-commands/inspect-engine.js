// cli-commands/inspect-engine.js
import { collectDOMData } from './dom-collector.js';
import { mapIntentToChecks } from './intent-map.js';
import * as analyzers from './analyzers.js';
import { formatReport } from './report-formatter.js';
import fs from 'fs';
import path from 'path';

const ANALYZER_MAP = {
  layout: analyzers.analyzeLayout,
  overflow: analyzers.analyzeOverflow,
  contrast: analyzers.analyzeContrast,
  spacing: null, // TODO: port from accuracy.js
  images: analyzers.analyzeImages,
  headings: analyzers.analyzeHeadings,
  tap_targets: analyzers.analyzeTapTargets,
  meta: analyzers.analyzeMeta,
  links: null, // TODO
  forms: analyzers.analyzeForms,
  text_content: analyzers.analyzeTextContent,
  performance: null, // TODO
  describe: null, // special case
};

export async function inspect(page, options = {}) {
  const {
    intent = null,
    detail = 'standard',
    breakpoints = [
      { width: 1280, height: 800, label: 'desktop' },
      { width: 768, height: 1024, label: 'tablet' },
      { width: 375, height: 812, label: 'mobile' },
    ],
    savePath = null,
    systemPrompt = null,
  } = options;

  const startTime = Date.now();
  const saveDir = savePath || path.join('.', 'playwright-inspect', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));

  // Determine which checks to run
  const checks = mapIntentToChecks(intent);

  // Screenshot at breakpoints
  const originalViewport = page.viewportSize();
  const screenshotPaths = [];

  fs.mkdirSync(saveDir, { recursive: true });
  for (const bp of breakpoints) {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    await page.waitForTimeout(100);
    const filename = `${bp.label}-${bp.width}x${bp.height}.png`;
    const filepath = path.join(saveDir, filename);
    await page.screenshot({ path: filepath });
    screenshotPaths.push(filepath);
  }

  // Collect DOM data at each breakpoint for overflow checks
  const breakpointData = [];
  for (const bp of breakpoints) {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    await page.waitForTimeout(100);
    const bpData = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      hasOverflow: document.documentElement.scrollWidth > window.innerWidth,
    }));
    breakpointData.push({ ...bpData, label: bp.label });
  }

  // Restore viewport and collect full DOM data
  if (originalViewport) await page.setViewportSize(originalViewport);
  const domData = await collectDOMData(page);

  // Run relevant analyzers
  const results = {};
  for (const check of checks) {
    const analyzer = ANALYZER_MAP[check];
    if (!analyzer) continue;

    if (check === 'overflow') {
      results[check] = analyzer(domData, breakpointData);
    } else if (check === 'text_content' && intent) {
      // Extract search text from intent
      const priceMatch = intent.match(/['"]([^'"]+)['"]/);
      const searchText = priceMatch ? priceMatch[1] : null;
      results[check] = analyzer(domData, searchText);
    } else {
      results[check] = analyzer(domData);
    }
  }

  // Format report
  const report = formatReport(domData.url, intent, results, screenshotPaths, detail);

  return {
    report,
    results,
    screenshots: screenshotPaths,
    time: Date.now() - startTime,
    checksRun: checks,
  };
}
