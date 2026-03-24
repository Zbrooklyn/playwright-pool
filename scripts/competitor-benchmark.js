#!/usr/bin/env node

// scripts/competitor-benchmark.js — Competitor comparison benchmark
//
// Runs the same test pages through 4 tools and compares detection accuracy:
//   1. playwright-pool (our tool)
//   2. Lighthouse (Google's audit tool)
//   3. Pa11y (accessibility audit)
//   4. axe-core CLI (accessibility audit)
//
// Usage:
//   node scripts/competitor-benchmark.js
//   playwright-pool compare

import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.resolve(PROJECT_ROOT, 'tests', 'fixtures');
const ANSWER_KEY_PATH = path.resolve(FIXTURES_DIR, 'answer-key.json');

// ─── Configuration ──────────────────────────────────────────────────────

const TOOL_TIMEOUT = 180_000; // 180 seconds per tool per page (Lighthouse needs time)
const SERVER_PORT = 0;        // 0 = let OS pick a free port

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  // Load answer key
  if (!fs.existsSync(ANSWER_KEY_PATH)) {
    console.error(`Error: Answer key not found at ${ANSWER_KEY_PATH}`);
    process.exit(1);
  }
  const answerKey = JSON.parse(fs.readFileSync(ANSWER_KEY_PATH, 'utf8'));
  const pageNames = Object.keys(answerKey);

  // Start local HTTP server to serve fixture HTML files
  const { server, port } = await startServer(FIXTURES_DIR);
  console.log(`Local server started on http://localhost:${port}\n`);

  // Check which tools are available
  const tools = detectTools();
  printToolAvailability(tools);

  // Results accumulator: { toolName: { pageName: { found, time, byCategory } } }
  const results = {};
  for (const tool of ['playwright-pool', 'lighthouse', 'pa11y', 'axe-core']) {
    results[tool] = {};
  }

  // Pre-run playwright-pool accuracy for ALL pages in one shot (single browser launch)
  console.log('\nRunning playwright-pool accuracy (all pages, single browser)...');
  const poolCache = await runPlaywrightPoolAll(answerKey);

  // Run each page through each tool
  for (const pageName of pageNames) {
    const pageUrl = `http://localhost:${port}/${pageName}`;
    const bugs = answerKey[pageName].bugs;
    const totalBugs = answerKey[pageName].total_bugs;

    console.log(`\nTesting: ${pageName} (${totalBugs} planted bugs)`);
    console.log('-'.repeat(60));

    // 1. playwright-pool (use pre-computed results)
    results['playwright-pool'][pageName] = poolCache[pageName] || notInstalled(bugs);

    // 2. Lighthouse
    if (tools.lighthouse) {
      results['lighthouse'][pageName] = await runLighthouse(pageUrl, bugs);
    } else {
      results['lighthouse'][pageName] = notInstalled(bugs);
    }

    // 3. Pa11y
    if (tools.pa11y) {
      results['pa11y'][pageName] = await runPa11y(pageUrl, bugs);
    } else {
      results['pa11y'][pageName] = notInstalled(bugs);
    }

    // 4. axe-core
    if (tools['axe-core']) {
      results['axe-core'][pageName] = await runAxeCore(pageUrl, bugs);
    } else {
      results['axe-core'][pageName] = notInstalled(bugs);
    }
  }

  // Print comparison tables
  console.log('\n');
  printResults(answerKey, results);

  // Shut down server
  server.close();
  process.exit(0);
}

// ─── HTTP Server ────────────────────────────────────────────────────────

function startServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.replace(/\?.*$/, ''));
      const filePath = path.join(rootDir, urlPath);

      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
      };

      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      fs.createReadStream(filePath).pipe(res);
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });

    server.on('error', reject);
  });
}

// ─── Tool Detection ─────────────────────────────────────────────────────

function detectTools() {
  const tools = { lighthouse: false, pa11y: false, 'axe-core': false };

  // Lighthouse
  try {
    const result = spawnSync('npx', ['lighthouse', '--version'], {
      encoding: 'utf8',
      timeout: 15000,
      cwd: PROJECT_ROOT,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    tools.lighthouse = result.status === 0;
  } catch { /* not installed */ }

  // Pa11y
  try {
    const result = spawnSync('npx', ['pa11y', '--version'], {
      encoding: 'utf8',
      timeout: 15000,
      cwd: PROJECT_ROOT,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    tools.pa11y = result.status === 0;
  } catch { /* not installed */ }

  // axe-core CLI
  try {
    const result = spawnSync('npx', ['axe', '--version'], {
      encoding: 'utf8',
      timeout: 15000,
      cwd: PROJECT_ROOT,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    tools['axe-core'] = result.status === 0;
  } catch { /* not installed */ }

  return tools;
}

function printToolAvailability(tools) {
  console.log('Tool Availability:');
  console.log(`  playwright-pool: INSTALLED (local)`);
  for (const [name, available] of Object.entries(tools)) {
    console.log(`  ${name}: ${available ? 'INSTALLED' : 'NOT INSTALLED (will skip)'}`);
  }
}

// ─── Tool Runners ───────────────────────────────────────────────────────

function notInstalled(bugs) {
  const byCategory = categorizeBugs(bugs);
  return {
    found: 0,
    total: bugs.length,
    time: 0,
    installed: false,
    issues: [],
    byCategory: Object.fromEntries(
      Object.entries(byCategory).map(([cat, catBugs]) => [cat, { found: 0, total: catBugs.length }])
    ),
  };
}

function categorizeBugs(bugs) {
  const cats = {};
  for (const bug of bugs) {
    const cat = bug.category;
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(bug);
  }
  return cats;
}

// 1. playwright-pool: run accuracy for ALL pages in a single invocation (one browser launch)
//    Returns { pageName: result } for each page in the answer key.
async function runPlaywrightPoolAll(answerKey) {
  const start = performance.now();
  const cache = {};

  try {
    const cliPath = path.resolve(PROJECT_ROOT, 'cli.js');
    // Run accuracy without --page to test ALL pages in one browser session
    const output = execSync(
      `node "${cliPath}" accuracy --json`,
      {
        encoding: 'utf8',
        timeout: TOOL_TIMEOUT * 5,  // All pages in one shot — give plenty of time
        cwd: PROJECT_ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    const elapsed = performance.now() - start;
    const timePer = elapsed / Math.max(Object.keys(answerKey).length, 1) / 1000;

    // Parse JSON output — may have leading non-JSON lines (errors/warnings)
    const jsonStr = extractJson(output);
    if (!jsonStr) {
      console.error('  playwright-pool: could not extract JSON from output');
      console.error('  First 200 chars:', output.slice(0, 200));
      return cache;
    }

    const data = JSON.parse(jsonStr);
    // data.pages is an object keyed by page name
    // Each page has: { knownBugs, found, missed, falsePositives, percentage, matched[], unmatched[] }
    // matched[] items: { bugId, bugDescription, findingId, findingDescription, matchScore }
    const pagesObj = data.pages || data;

    for (const [pageName, pageData] of Object.entries(pagesObj)) {
      if (!answerKey[pageName]) continue;
      const bugs = answerKey[pageName].bugs;
      const matched = pageData.matched || [];
      const foundBugIds = new Set(matched.map(m => m.bugId));

      const byCategory = categorizeBugs(bugs);
      const categoryResults = {};
      for (const [cat, catBugs] of Object.entries(byCategory)) {
        const catFound = catBugs.filter(b => foundBugIds.has(b.id)).length;
        categoryResults[cat] = { found: catFound, total: catBugs.length };
      }

      cache[pageName] = {
        found: pageData.found ?? matched.length ?? 0,
        total: bugs.length,
        time: timePer,
        installed: true,
        issues: matched,
        byCategory: categoryResults,
      };
      console.log(`  playwright-pool: ${pageName} — ${cache[pageName].found}/${bugs.length} bugs found`);
    }
  } catch (err) {
    // If accuracy command exits non-zero, stdout may still have valid JSON
    const stdout = err.stdout || '';
    const jsonStr = extractJson(stdout);
    if (jsonStr) {
      try {
        const data = JSON.parse(jsonStr);
        const elapsed = performance.now() - start;
        const pagesObj = data.pages || data;
        const timePer = elapsed / Math.max(Object.keys(answerKey).length, 1) / 1000;

        for (const [pageName, pageData] of Object.entries(pagesObj)) {
          if (!answerKey[pageName]) continue;
          const bugs = answerKey[pageName].bugs;
          const matched = pageData.matched || [];
          const foundBugIds = new Set(matched.map(m => m.bugId));
          const byCategory = categorizeBugs(bugs);
          const categoryResults = {};
          for (const [cat, catBugs] of Object.entries(byCategory)) {
            const catFound = catBugs.filter(b => foundBugIds.has(b.id)).length;
            categoryResults[cat] = { found: catFound, total: catBugs.length };
          }
          cache[pageName] = {
            found: pageData.found ?? matched.length ?? 0,
            total: bugs.length,
            time: timePer,
            installed: true,
            issues: matched,
            byCategory: categoryResults,
          };
          console.log(`  playwright-pool: ${pageName} — ${cache[pageName].found}/${bugs.length} bugs found`);
        }
      } catch { /* JSON parse failed — results stay empty */ }
    }
    if (Object.keys(cache).length === 0) {
      console.error(`  playwright-pool error: ${err.message?.slice(0, 200)}`);
    }
  }

  const elapsed = performance.now() - start;
  console.log(`  playwright-pool: completed in ${(elapsed / 1000).toFixed(1)}s`);

  // Fill in any missing pages with zero results
  for (const pageName of Object.keys(answerKey)) {
    if (!cache[pageName]) {
      const bugs = answerKey[pageName].bugs;
      const byCategory = categorizeBugs(bugs);
      cache[pageName] = {
        found: 0,
        total: bugs.length,
        time: elapsed / Object.keys(answerKey).length / 1000,
        installed: true,
        issues: [],
        byCategory: Object.fromEntries(
          Object.entries(byCategory).map(([cat, catBugs]) => [cat, { found: 0, total: catBugs.length }])
        ),
      };
    }
  }

  return cache;
}

// 2. Lighthouse: run via npx, parse JSON report
async function runLighthouse(pageUrl, bugs) {
  const start = performance.now();
  let issues = [];

  try {
    const output = execSync(
      `npx lighthouse "${pageUrl}" --output json --chrome-flags="--headless --no-sandbox --disable-gpu" --quiet`,
      {
        encoding: 'utf8',
        timeout: TOOL_TIMEOUT,
        cwd: PROJECT_ROOT,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    const jsonStr = extractJson(output);
    if (jsonStr) {
      const report = JSON.parse(jsonStr);
      issues = parseLighthouseFindings(report);
    }
  } catch (err) {
    const stdout = err.stdout || '';
    const jsonStr = extractJson(stdout);
    if (jsonStr) {
      try {
        const report = JSON.parse(jsonStr);
        issues = parseLighthouseFindings(report);
      } catch { /* ignore */ }
    }
    if (issues.length === 0) {
      console.error(`  Lighthouse error: ${(err.message || '').slice(0, 120)}`);
    }
  }

  const elapsed = performance.now() - start;
  return matchIssuesToBugs(issues, bugs, elapsed / 1000, true);
}

function parseLighthouseFindings(report) {
  const findings = [];
  const audits = report.audits || {};

  for (const [auditId, audit] of Object.entries(audits)) {
    // score === null means N/A, score === 1 means pass
    if (audit.score !== null && audit.score !== undefined && audit.score < 1) {
      // Determine category based on which lighthouse category references this audit
      let category = 'other';
      const cats = report.categories || {};
      for (const [catId, catData] of Object.entries(cats)) {
        const refs = catData.auditRefs || [];
        if (refs.some(ref => ref.id === auditId)) {
          if (catId === 'accessibility') category = 'accessibility';
          else if (catId === 'seo') category = 'seo';
          else if (catId === 'performance') category = 'performance';
          else if (catId === 'best-practices') category = 'best-practices';
          break;
        }
      }

      findings.push({
        id: auditId,
        category,
        description: audit.title || auditId,
        details: audit.description || '',
        displayValue: audit.displayValue || '',
        score: audit.score,
      });
    }
  }

  return findings;
}

// 3. Pa11y: run via npx, parse JSON output
async function runPa11y(pageUrl, bugs) {
  const start = performance.now();
  let issues = [];

  try {
    // Pa11y exits with non-zero if it finds issues, so we handle that
    const result = spawnSync(
      'npx',
      ['pa11y', pageUrl, '--reporter', 'json', '--timeout', '30000'],
      {
        encoding: 'utf8',
        timeout: TOOL_TIMEOUT,
        cwd: PROJECT_ROOT,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    const output = result.stdout || '';
    const jsonStr = extractJson(output);
    if (jsonStr) {
      const data = JSON.parse(jsonStr);
      // Pa11y returns an array of issues
      const arr = Array.isArray(data) ? data : (data.issues || []);
      issues = arr.map(issue => ({
        id: issue.code || 'pa11y-issue',
        code: issue.code || '',  // Preserve full WCAG code (e.g. "WCAG2AA.1_1_1.H37")
        category: 'accessibility',
        description: issue.message || issue.msg || '',
        selector: issue.selector || issue.context || '',
        type: issue.type || 'error',
      }));
    }
  } catch (err) {
    console.error(`  Pa11y error: ${(err.message || '').slice(0, 120)}`);
  }

  const elapsed = performance.now() - start;
  return matchIssuesToBugs(issues, bugs, elapsed / 1000, true);
}

// 4. axe-core CLI: run via npx, parse JSON output
async function runAxeCore(pageUrl, bugs) {
  const start = performance.now();
  let issues = [];

  try {
    const result = spawnSync(
      'npx',
      ['axe', pageUrl, '--stdout'],
      {
        encoding: 'utf8',
        timeout: TOOL_TIMEOUT,
        cwd: PROJECT_ROOT,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    const output = result.stdout || '';
    const jsonStr = extractJson(output);
    if (jsonStr) {
      const data = JSON.parse(jsonStr);
      // axe returns an array with one entry per page, each has .violations
      const pages = Array.isArray(data) ? data : [data];
      for (const pageResult of pages) {
        const violations = pageResult.violations || [];
        for (const v of violations) {
          const selectors = (v.nodes || []).map(n => {
            const target = n.target || [];
            return Array.isArray(target) ? target.join(', ') : String(target);
          });

          issues.push({
            id: v.id || 'axe-violation',
            category: 'accessibility',
            description: v.description || v.help || '',
            help: v.help || '',
            selector: selectors.join('; ') || '',
            impact: v.impact || 'moderate',
          });
        }
      }
    }
  } catch (err) {
    console.error(`  axe-core error: ${(err.message || '').slice(0, 120)}`);
  }

  const elapsed = performance.now() - start;
  return matchIssuesToBugs(issues, bugs, elapsed / 1000, true);
}

// ─── Fuzzy Matching Engine ──────────────────────────────────────────────

function matchIssuesToBugs(issues, bugs, timeSec, installed) {
  const foundBugIds = new Set();
  const issueUsed = new Set();

  for (const bug of bugs) {
    let bestScore = 0;
    let bestIdx = -1;

    for (let i = 0; i < issues.length; i++) {
      if (issueUsed.has(i)) continue;
      const score = fuzzyMatch(bug, issues[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    // Threshold: score >= 1.0 counts as a match — generous enough that
    // category match + single keyword overlap (or a key phrase hit) qualifies
    if (bestIdx >= 0 && bestScore >= 1.0) {
      foundBugIds.add(bug.id);
      issueUsed.add(bestIdx);
    }
  }

  // Category breakdown
  const byCategory = categorizeBugs(bugs);
  const categoryResults = {};
  for (const [cat, catBugs] of Object.entries(byCategory)) {
    const catFound = catBugs.filter(b => foundBugIds.has(b.id)).length;
    categoryResults[cat] = { found: catFound, total: catBugs.length };
  }

  return {
    found: foundBugIds.size,
    total: bugs.length,
    time: timeSec,
    installed,
    issues,
    byCategory: categoryResults,
  };
}

function fuzzyMatch(bug, issue) {
  let score = 0;
  const bugDesc = (bug.description || '').toLowerCase();
  const issueDesc = (issue.description || '').toLowerCase();
  const issueHelp = (issue.help || '').toLowerCase();
  const issueDetails = (issue.details || '').toLowerCase();
  const issueSelector = (issue.selector || '').toLowerCase();
  const issueCode = (issue.code || '').toLowerCase();
  const issueFull = `${issueDesc} ${issueHelp} ${issueDetails} ${(issue.id || '').toLowerCase()} ${(issue.displayValue || '').toLowerCase()} ${issueSelector} ${issueCode}`;

  // 1. Category match
  const bugCat = bug.category.toLowerCase();
  const issueCat = (issue.category || '').toLowerCase();
  if (bugCat === issueCat) score += 1;
  // accessibility tools can find accessibility bugs even when reported as general category
  if (issueCat === 'accessibility' && bugCat === 'accessibility') score += 0.5;
  // Accessibility tools may report SEO-adjacent issues (title, lang, etc.)
  if (issueCat === 'accessibility' && (bugCat === 'seo' || bugCat === 'accessibility')) score += 0.25;

  // 2. Selector overlap
  if (bug.selector && issue.selector) {
    const bugSel = bug.selector.toLowerCase();
    const issueSel = issue.selector.toLowerCase();
    if (issueSel.includes(bugSel) || bugSel.includes(issueSel)) {
      score += 2;
    } else {
      // Check class name overlap
      const bugClasses = bugSel.match(/\.[\w-]+/g) || [];
      const issueClasses = issueSel.match(/\.[\w-]+/g) || [];
      const overlap = bugClasses.filter(c => issueClasses.some(ic => ic.includes(c) || c.includes(ic)));
      if (overlap.length > 0) score += 1.5;
      // Also check tag name overlap (e.g. "img", "button", "input")
      const bugTag = bugSel.match(/^[a-z]+/)?.[0];
      const issueTag = issueSel.match(/^[a-z]+/)?.[0];
      if (bugTag && issueTag && bugTag === issueTag) score += 0.5;
    }
  }

  // 3. Description keyword overlap (lowered min word length from 4 to 3 so
  //    short but meaningful terms like "alt", "tab", "img", "seo" are counted)
  const bugWords = new Set(bugDesc.split(/\W+/).filter(w => w.length > 2));
  const issueWords = new Set(issueFull.split(/\W+/).filter(w => w.length > 2));
  let wordOverlap = 0;
  for (const w of bugWords) {
    if (issueWords.has(w)) wordOverlap++;
  }
  if (wordOverlap >= 3) score += 2;
  else if (wordOverlap >= 2) score += 1;
  else if (wordOverlap >= 1) score += 0.5;

  // 4. Key phrase matching for common bug types
  //    Includes WCAG technique codes (Pa11y uses H37, H44, etc.) and WCAG SC numbers.
  //    Pa11y codes follow the pattern: WCAG2AA.Principle.Guideline.Technique
  //    e.g. "WCAG2AA.1_1_1.H37" = missing alt text (Technique H37, SC 1.1.1)
  const keyPhrases = [
    // Image alt text — Pa11y: H37, WCAG 1.1.1; axe: image-alt
    { bugPattern: /alt|image.*missing/i, issuePattern: /alt|H37|1_1_1|1\.1\.1|image-alt|non-text/i, boost: 2 },
    // Empty button — Pa11y: H91; axe: button-name
    { bugPattern: /empty button|button.*text|button.*label/i, issuePattern: /button.*text|empty.*button|button.*label|button-name|H91/i, boost: 2 },
    // Color contrast — Pa11y: G18/G145, WCAG 1.4.3; axe: color-contrast
    { bugPattern: /color contrast|contrast|insufficient.*contrast/i, issuePattern: /contrast|1_4_3|1\.4\.3|color-contrast|G18|G145/i, boost: 2 },
    // Form labels — Pa11y: H44/H65, WCAG 1.3.1/4.1.2; axe: label
    { bugPattern: /label|input.*name|form.*associated/i, issuePattern: /label|H44|H65|1_3_1|1\.3\.1|4_1_2|4\.1\.2|input.*name|form-field/i, boost: 1.5 },
    // Document title — Pa11y: H25, WCAG 2.4.2; axe: document-title
    { bugPattern: /title/i, issuePattern: /title|H25|2_4_2|2\.4\.2|document-title/i, boost: 1.5 },
    // Viewport — Lighthouse/axe: viewport
    { bugPattern: /viewport/i, issuePattern: /viewport|meta.*viewport/i, boost: 2 },
    // Heading hierarchy — Pa11y: G141, WCAG 1.3.1; axe: heading-order
    { bugPattern: /heading|h[1-6].*skip|h[1-6].*order/i, issuePattern: /heading|heading.*order|heading.*level|heading.*skip|1_3_1|G141|heading-order/i, boost: 2 },
    // Tap/touch targets — Lighthouse: tap-target
    { bugPattern: /touch target|tap target|target.*small/i, issuePattern: /touch|tap|target.*size|tap-target/i, boost: 1.5 },
    // Empty href / anchor links — Pa11y: H30; Lighthouse: crawlable-anchors
    { bugPattern: /anchor|empty.*href|href.*empty/i, issuePattern: /link.*href|anchor|crawl|empty.*href|H30|crawlable/i, boost: 1.5 },
    // Focus ring / outline — axe: focus-visible
    { bugPattern: /focus.*ring|outline.*none|focus.*visible/i, issuePattern: /focus|outline|focus-visible/i, boost: 1.5 },
    // Nested interactive elements — axe: nested-interactive
    { bugPattern: /nested interactive|interactive.*inside/i, issuePattern: /nested|interactive.*control|nested-interactive/i, boost: 2 },
    // Tab order / tabindex — axe: tabindex
    { bugPattern: /tab.*order|tabindex/i, issuePattern: /tab.*order|tabindex|focus.*order/i, boost: 2 },
    // Open Graph / meta tags — Lighthouse: structured-data
    { bugPattern: /open graph|og:|meta.*description/i, issuePattern: /open.*graph|og:|meta|structured/i, boost: 1.5 },
    // Canonical link — Lighthouse: canonical
    { bugPattern: /canonical/i, issuePattern: /canonical/i, boost: 2 },
    // User-select
    { bugPattern: /user-select.*none|text.*select/i, issuePattern: /user.*select/i, boost: 2 },
    // Animation / motion — axe: no-autoplay-audio
    { bugPattern: /auto.*play|animation.*pause|motion/i, issuePattern: /animation|motion|prefers.*reduced|autoplay/i, boost: 1.5 },
    // Focus trap / modal — axe: focus-trap
    { bugPattern: /focus.*trap|modal.*focus|dialog.*focus/i, issuePattern: /focus.*trap|dialog|modal|focus-trap/i, boost: 2 },
    // Language attribute — Pa11y: H57, WCAG 3.1.1; axe: html-has-lang
    { bugPattern: /lang|language/i, issuePattern: /lang|H57|3_1_1|3\.1\.1|html-has-lang|html-lang/i, boost: 2 },
    // ARIA roles / attributes — axe: aria-*
    { bugPattern: /aria|role/i, issuePattern: /aria|role|aria-allowed|aria-required|aria-valid/i, boost: 1.5 },
    // Link text / purpose — Pa11y: H30, WCAG 2.4.4; axe: link-name
    { bugPattern: /link.*text|link.*purpose|descriptive.*link/i, issuePattern: /link.*text|link.*name|H30|2_4_4|2\.4\.4|link-name/i, boost: 1.5 },
    // Overflow / scrolling — visual bug
    { bugPattern: /overflow|horizontal.*scroll/i, issuePattern: /overflow|scroll|wider/i, boost: 1.5 },
    // Image size / dimensions — Lighthouse: uses-responsive-images
    { bugPattern: /image.*size|image.*dimension|aspect.*ratio/i, issuePattern: /image|responsive.*image|uses-responsive|aspect/i, boost: 1.5 },
    // Skip link / navigation — Pa11y: G1, WCAG 2.4.1; axe: bypass
    { bugPattern: /skip.*link|bypass|navigation/i, issuePattern: /skip|bypass|G1|2_4_1|2\.4\.1/i, boost: 1.5 },
    // Table structure — Pa11y: H43/H63; axe: td-headers-attr
    { bugPattern: /table.*header|table.*structure/i, issuePattern: /table|header|H43|H63|td-headers/i, boost: 1.5 },
    // Autocomplete — Pa11y: H98; axe: autocomplete-valid
    { bugPattern: /autocomplete/i, issuePattern: /autocomplete|H98/i, boost: 2 },
  ];

  // Apply the BEST matching key phrase (not just the first)
  let bestPhraseBoost = 0;
  for (const { bugPattern, issuePattern, boost } of keyPhrases) {
    if (bugPattern.test(bugDesc) && issuePattern.test(issueFull)) {
      if (boost > bestPhraseBoost) bestPhraseBoost = boost;
    }
  }
  score += bestPhraseBoost;

  return score;
}

// ─── JSON Extraction Helper ─────────────────────────────────────────────

function extractJson(text) {
  if (!text) return null;

  // Try to find the outermost JSON object or array
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');

  let start = -1;
  let endChar = '';

  if (firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)) {
    start = firstBrace;
    endChar = '}';
  } else if (firstBracket >= 0) {
    start = firstBracket;
    endChar = ']';
  }

  if (start < 0) return null;

  // Find matching close brace/bracket from the end
  const lastEnd = text.lastIndexOf(endChar);
  if (lastEnd <= start) return null;

  const candidate = text.slice(start, lastEnd + 1);
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
}

// ─── Output Formatting ─────────────────────────────────────────────────

function printResults(answerKey, results) {
  const pageNames = Object.keys(answerKey);
  const tools = ['playwright-pool', 'lighthouse', 'pa11y', 'axe-core'];
  const toolHeaders = ['playwright-pool', 'Lighthouse', 'Pa11y', 'axe-core'];

  console.log('COMPETITOR COMPARISON');
  console.log('\u2550'.repeat(67));

  for (const pageName of pageNames) {
    const totalBugs = answerKey[pageName].total_bugs;
    const bugs = answerKey[pageName].bugs;
    const byCategory = categorizeBugs(bugs);
    const categories = Object.keys(byCategory);

    console.log(`\nTest page: ${pageName} (${totalBugs} planted bugs)\n`);

    // Header row
    const colW = [20, 17, 12, 7, 10];
    const headerLabel = pad('', colW[0]);
    const headers = toolHeaders.map((h, i) => pad(h, colW[i + 1]));
    console.log(`${headerLabel}\u2502 ${headers.join('\u2502 ')}\u2502`);
    console.log('\u2500'.repeat(colW[0]) + '\u253C' +
      colW.slice(1).map(w => '\u2500'.repeat(w + 1)).join('\u253C') + '\u2524');

    // Bugs found row
    const foundCells = tools.map((t, i) => {
      const r = results[t][pageName];
      if (!r.installed) return pad('N/A', colW[i + 1]);
      return pad(`${r.found}`, colW[i + 1]);
    });
    console.log(`${pad('Bugs found (of ' + totalBugs + ')', colW[0])}\u2502 ${foundCells.join('\u2502 ')}\u2502`);

    // Time row
    const timeCells = tools.map((t, i) => {
      const r = results[t][pageName];
      if (!r.installed) return pad('N/A', colW[i + 1]);
      return pad(`${r.time.toFixed(1)}s`, colW[i + 1]);
    });
    console.log(`${pad('Time', colW[0])}\u2502 ${timeCells.join('\u2502 ')}\u2502`);

    // Category rows
    for (const cat of categories) {
      const catBugs = byCategory[cat];
      const catTotal = catBugs.length;
      const label = `${capitalize(cat)} (of ${catTotal})`;
      const cells = tools.map((t, i) => {
        const r = results[t][pageName];
        if (!r.installed) return pad('N/A', colW[i + 1]);
        const catResult = r.byCategory[cat];
        if (!catResult) return pad(`0/${catTotal}`, colW[i + 1]);
        return pad(`${catResult.found}/${catResult.total}`, colW[i + 1]);
      });
      console.log(`${pad(label, colW[0])}\u2502 ${cells.join('\u2502 ')}\u2502`);
    }
  }

  // Summary
  console.log('\n');
  console.log('SUMMARY');
  console.log('\u2550'.repeat(67));

  // Overall accuracy
  let totalBugsAll = 0;
  for (const pageName of pageNames) {
    totalBugsAll += answerKey[pageName].total_bugs;
  }

  console.log(`\nOverall accuracy (${totalBugsAll} bugs):`);
  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i];
    const label = toolHeaders[i];
    let totalFound = 0;
    let installed = true;
    for (const pageName of pageNames) {
      const r = results[tool][pageName];
      if (!r.installed) { installed = false; break; }
      totalFound += r.found;
    }
    if (!installed) {
      console.log(`  ${padRight(label + ':', 20)} NOT INSTALLED`);
    } else {
      const pct = totalBugsAll > 0 ? Math.round((totalFound / totalBugsAll) * 100) : 0;
      console.log(`  ${padRight(label + ':', 20)} ${pct}% (${totalFound}/${totalBugsAll})`);
    }
  }

  // Category breakdown across all pages
  const allCategories = new Set();
  for (const pageName of pageNames) {
    for (const bug of answerKey[pageName].bugs) {
      allCategories.add(bug.category);
    }
  }

  console.log('\nCategory breakdown:');
  for (const cat of allCategories) {
    // Count total bugs in this category across all pages
    let catTotal = 0;
    for (const pageName of pageNames) {
      catTotal += answerKey[pageName].bugs.filter(b => b.category === cat).length;
    }

    const parts = [];
    for (let i = 0; i < tools.length; i++) {
      const tool = tools[i];
      const label = toolHeaders[i];
      let catFound = 0;
      let installed = true;
      for (const pageName of pageNames) {
        const r = results[tool][pageName];
        if (!r.installed) { installed = false; break; }
        const catResult = r.byCategory[cat];
        if (catResult) catFound += catResult.found;
      }
      if (!installed) {
        parts.push(`${label} N/A`);
      } else {
        const pct = catTotal > 0 ? Math.round((catFound / catTotal) * 100) : 0;
        parts.push(`${label} ${pct}%`);
      }
    }
    console.log(`  ${padRight(capitalize(cat) + ':', 16)} ${parts.join(' | ')}`);
  }

  // Speed totals
  console.log('\nSpeed:');
  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i];
    const label = toolHeaders[i];
    let totalTime = 0;
    let installed = true;
    for (const pageName of pageNames) {
      const r = results[tool][pageName];
      if (!r.installed) { installed = false; break; }
      totalTime += r.time;
    }
    if (!installed) {
      console.log(`  ${padRight(label + ':', 20)} NOT INSTALLED`);
    } else {
      console.log(`  ${padRight(label + ':', 20)} ${totalTime.toFixed(1)}s total`);
    }
  }
}

// ─── String Helpers ─────────────────────────────────────────────────────

function pad(str, width) {
  if (str.length >= width) return str.slice(0, width);
  return str + ' '.repeat(width - str.length);
}

function padRight(str, width) {
  if (str.length >= width) return str;
  return str + ' '.repeat(width - str.length);
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─── Run ────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
