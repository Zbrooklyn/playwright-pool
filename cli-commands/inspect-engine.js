// cli-commands/inspect-engine.js
import { collectDOMData } from './dom-collector.js';
import { mapIntentToChecks } from './intent-map.js';
import * as analyzers from './analyzers.js';
import { AUDIT_HANDLERS } from './audit.js';
import { formatReport } from './report-formatter.js';
import fs from 'fs';
import path from 'path';

// Simple analyzers for quick/lightweight checks (original behavior)
const ANALYZER_MAP = {
  layout: analyzers.analyzeLayout,
  overflow: analyzers.analyzeOverflow,
  contrast: analyzers.analyzeContrast,
  spacing: null,
  images: analyzers.analyzeImages,
  headings: analyzers.analyzeHeadings,
  tap_targets: analyzers.analyzeTapTargets,
  meta: analyzers.analyzeMeta,
  links: null,
  forms: analyzers.analyzeForms,
  text_content: analyzers.analyzeTextContent,
  performance: null,
  describe: null,
};

// Map intent check names to audit.js handler names
const CHECK_TO_AUDIT = {
  a11y: 'accessibility',
  contrast: 'color_contrast',
  focus_order: 'focus_order',
  tap_targets: 'tap_targets',
  images: 'image_sizes',
  meta: 'meta',
  overflow: 'overflow',
  headings: 'accessibility', // headings are part of the accessibility audit
  forms: 'form_validation',
  links: 'broken_links',
  spacing: 'spacing_consistency',
  performance: 'core_web_vitals',
  interactive: 'interactive_states',
  vision: 'vision_review',
};

// Intents that should trigger the full audit.js pipeline instead of simple analyzers
const FULL_AUDIT_INTENTS = [
  'full audit', 'audit', 'check accessibility', 'check a11y', 'wcag',
  'accessibility', 'full', 'everything', 'all issues', 'find all',
];

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
  const intentLower = (intent || '').toLowerCase();

  // Decide: use full audit.js pipeline or simple analyzers?
  const useFullAudit = FULL_AUDIT_INTENTS.some(i => intentLower.includes(i))
    || checks.includes('a11y')
    || checks.length > 5
    || detail === 'deep';

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

  // Restore viewport
  if (originalViewport) await page.setViewportSize(originalViewport);

  let results = {};
  let allIssues = [];
  let auditText = '';

  if (useFullAudit) {
    // ─── Full audit.js pipeline ───────────────────────────────────
    // Run the real audit functions against the live page
    const auditsToRun = new Set();

    // Map intent checks to audit handler names
    for (const check of checks) {
      const auditName = CHECK_TO_AUDIT[check];
      if (auditName && AUDIT_HANDLERS[auditName]) {
        auditsToRun.add(auditName);
      }
    }

    // If intent is broad, run core accessibility audits
    if (auditsToRun.size === 0 || intentLower.includes('full') || intentLower.includes('audit')) {
      ['accessibility', 'color_contrast', 'focus_order', 'tap_targets',
       'interactive_states', 'form_validation', 'vision_review',
       'image_sizes', 'meta', 'overflow'].forEach(a => auditsToRun.add(a));
    }

    const context = { screenshotDir: saveDir };
    const textParts = [];

    for (const auditName of auditsToRun) {
      const handler = AUDIT_HANDLERS[auditName];
      if (!handler) continue;
      try {
        const result = await handler(page, context, {});
        if (result.issues) allIssues.push(...result.issues);
        if (result.text) textParts.push(`--- ${auditName} ---\n${result.text}`);
        results[auditName] = result;
      } catch (err) {
        textParts.push(`--- ${auditName} ---\nError: ${err.message}`);
      }
    }

    auditText = textParts.join('\n\n');

  } else {
    // ─── Simple analyzer pipeline (fast, lightweight) ─────────────
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

    if (originalViewport) await page.setViewportSize(originalViewport);
    const domData = await collectDOMData(page);

    for (const check of checks) {
      const analyzer = ANALYZER_MAP[check];
      if (!analyzer) continue;

      if (check === 'overflow') {
        results[check] = analyzer(domData, breakpointData);
      } else if (check === 'text_content' && intent) {
        const priceMatch = intent.match(/['"]([^'"]+)['"]/);
        const searchText = priceMatch ? priceMatch[1] : null;
        results[check] = analyzer(domData, searchText);
      } else {
        results[check] = analyzer(domData);
      }
    }
  }

  // Format report
  const url = await page.url();
  const report = useFullAudit
    ? formatInspectReport(intent, allIssues, auditText, screenshotPaths, detail, saveDir)
    : formatReport(results.url || url, intent, results, screenshotPaths, detail);

  // Auto-dispatch: write vision-review.json if vision gaps detected
  const visionIssues = allIssues.filter(i =>
    ['color-only-links', 'images-of-text', 'no-audio-description'].includes(i.id));
  const visionData = results.vision_review;

  if (visionIssues.length > 0 || visionData?.visionPrompt) {
    const visionReview = {
      url,
      timestamp: new Date().toISOString(),
      screenshotDir: saveDir,
      screenshots: screenshotPaths.map(p => path.resolve(p)),
      visionIssuesDetected: visionIssues.length,
      visionPrompt: visionData?.visionPrompt || null,
      programmaticSummary: {
        totalIssues: allIssues.length,
        critical: allIssues.filter(i => i.severity === 'critical').length,
        serious: allIssues.filter(i => i.severity === 'serious').length,
        moderate: allIssues.filter(i => i.severity === 'moderate').length,
        topIssues: allIssues
          .sort((a, b) => ({ critical: 0, serious: 1, moderate: 2, minor: 3 }[a.severity] || 2) -
                          ({ critical: 0, serious: 1, moderate: 2, minor: 3 }[b.severity] || 2))
          .slice(0, 10)
          .map(i => `[${i.severity}] ${i.id}: ${i.msg}`),
      },
      fullPrompt: generateFullVisionPrompt(url, allIssues, screenshotPaths, saveDir, report),
    };
    const visionPath = path.join(saveDir, 'vision-review.json');
    fs.writeFileSync(visionPath, JSON.stringify(visionReview, null, 2));
  }

  return {
    report,
    results,
    issues: allIssues,
    screenshots: screenshotPaths,
    screenshotDir: saveDir,
    time: Date.now() - startTime,
    checksRun: checks,
    mode: useFullAudit ? 'full-audit' : 'simple-analyzers',
  };
}

function formatInspectReport(intent, issues, auditText, screenshotPaths, detail, saveDir) {
  const lines = [];
  lines.push(`INSPECT REPORT (full audit mode)`);
  lines.push(`Intent: ${intent || 'general inspection'}`);
  lines.push(`Detail: ${detail}`);
  lines.push('');

  // Summary
  const bySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const issue of issues) {
    const sev = issue.severity || 'moderate';
    if (bySeverity[sev] !== undefined) bySeverity[sev]++;
  }
  lines.push(`Issues found: ${issues.length}`);
  lines.push(`  Critical: ${bySeverity.critical}`);
  lines.push(`  Serious: ${bySeverity.serious}`);
  lines.push(`  Moderate: ${bySeverity.moderate}`);
  lines.push(`  Minor: ${bySeverity.minor}`);
  lines.push('');

  // Top issues
  if (detail !== 'quick') {
    lines.push(`─── TOP ISSUES ───`);
    const sorted = [...issues].sort((a, b) => {
      const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
      return (order[a.severity] || 2) - (order[b.severity] || 2);
    });
    for (const issue of sorted.slice(0, detail === 'deep' ? 50 : 20)) {
      lines.push(`  [${issue.severity}] ${issue.id}: ${issue.msg}`);
    }
    lines.push('');
  }

  // Full audit text for deep detail
  if (detail === 'deep') {
    lines.push(`─── FULL AUDIT DETAILS ───`);
    lines.push(auditText);
    lines.push('');
  }

  // Screenshots
  lines.push(`Screenshots: ${saveDir}`);
  for (const p of screenshotPaths) {
    lines.push(`  ${path.basename(p)}`);
  }

  // Vision prompt (if vision_review was run)
  const visionIssues = issues.filter(i => ['color-only-links', 'images-of-text', 'no-audio-description'].includes(i.id));
  if (visionIssues.length > 0) {
    lines.push('');
    lines.push(`─── VISION REVIEW NEEDED ───`);
    lines.push(`${visionIssues.length} issue(s) need visual confirmation via screenshot analysis.`);
    lines.push(`Run the visual-audit skill or dispatch a vision sub-agent with the screenshots above.`);
    lines.push(`Vision review file: ${saveDir}/vision-review.json`);
  }

  return lines.join('\n');
}

function generateFullVisionPrompt(url, issues, screenshotPaths, saveDir, programmaticReport) {
  const topIssues = issues
    .sort((a, b) => ({ critical: 0, serious: 1, moderate: 2, minor: 3 }[a.severity] || 2) -
                    ({ critical: 0, serious: 1, moderate: 2, minor: 3 }[b.severity] || 2))
    .slice(0, 15)
    .map(i => `[${i.severity}] ${i.id}: ${i.msg}`)
    .join('\n');

  return `You are a senior digital quality auditor with deep expertise in graphic design, frontend development, QA testing, and WCAG 2.1 AA accessibility. You have 15 years of experience and have audited hundreds of websites.

PROGRAMMATIC REPORT (from automated analysis — ${issues.length} issues found):
${topIssues}

SCREENSHOTS TO ANALYZE:
${screenshotPaths.map(p => `- ${path.resolve(p)}`).join('\n')}

Examine every element on this page systematically, section by section, from top to bottom.

Review against these quality dimensions:

**VISUAL DESIGN** — layout balance, typography, colors, spacing, images
**USABILITY** — clickable distinction, tap targets, navigation, forms, mobile
**ACCESSIBILITY** — color-only info, text alternatives, keyboard access, focus indicators, media, images of text
**CONTENT QUALITY** — readability, heading structure, link text, abbreviations
**CROSS-VIEWPORT** — desktop vs mobile adaptation, overflow, missing content

Be exhaustive. Flag everything — even minor issues. Better to over-report than miss something.

Compare your visual findings against the programmatic report above — confirm, add to, or contradict its findings.

For each issue: specific element, why it matters, severity (critical/serious/moderate/minor), WCAG criterion if applicable.

End with a numbered summary list of ALL unique issues found.`;
}
