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

const TOOL_TIMEOUT = 60_000;  // 60 seconds per tool per page
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

  // Run each page through each tool
  for (const pageName of pageNames) {
    const pageUrl = `http://localhost:${port}/${pageName}`;
    const bugs = answerKey[pageName].bugs;
    const totalBugs = answerKey[pageName].total_bugs;

    console.log(`\nTesting: ${pageName} (${totalBugs} planted bugs)`);
    console.log('-'.repeat(60));

    // 1. playwright-pool
    results['playwright-pool'][pageName] = await runPlaywrightPool(pageName, bugs);

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

// 1. playwright-pool: run our accuracy command with --json
async function runPlaywrightPool(pageName, bugs) {
  const start = performance.now();
  let issues = [];

  try {
    const cliPath = path.resolve(PROJECT_ROOT, 'cli.js');
    const output = execSync(
      `node "${cliPath}" accuracy --page ${pageName} --json`,
      {
        encoding: 'utf8',
        timeout: TOOL_TIMEOUT * 3,  // Our tool runs all audits, give more time
        cwd: PROJECT_ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    // Parse JSON output — may have leading non-JSON lines (errors/warnings)
    const jsonStr = extractJson(output);
    if (jsonStr) {
      const data = JSON.parse(jsonStr);
      // data.pages[0].score.matched contains which bugs were found
      if (data.pages && data.pages.length > 0) {
        const pageData = data.pages[0];
        const elapsed = performance.now() - start;
        const matched = pageData.score?.matched || [];
        const foundBugIds = new Set(matched.map(m => m.bugId));

        const byCategory = categorizeBugs(bugs);
        const categoryResults = {};
        for (const [cat, catBugs] of Object.entries(byCategory)) {
          const catFound = catBugs.filter(b => foundBugIds.has(b.id)).length;
          categoryResults[cat] = { found: catFound, total: catBugs.length };
        }

        return {
          found: pageData.score?.found || 0,
          total: bugs.length,
          time: elapsed / 1000,
          installed: true,
          issues: matched,
          byCategory: categoryResults,
        };
      }
    }
  } catch (err) {
    // If accuracy command fails, try to extract partial data from stderr
    const stderr = err.stderr || '';
    const stdout = err.stdout || '';
    const jsonStr = extractJson(stdout);
    if (jsonStr) {
      try {
        const data = JSON.parse(jsonStr);
        if (data.pages && data.pages.length > 0) {
          const pageData = data.pages[0];
          const elapsed = performance.now() - start;
          const matched = pageData.score?.matched || [];
          const foundBugIds = new Set(matched.map(m => m.bugId));
          const byCategory = categorizeBugs(bugs);
          const categoryResults = {};
          for (const [cat, catBugs] of Object.entries(byCategory)) {
            const catFound = catBugs.filter(b => foundBugIds.has(b.id)).length;
            categoryResults[cat] = { found: catFound, total: catBugs.length };
          }
          return {
            found: pageData.score?.found || 0,
            total: bugs.length,
            time: elapsed / 1000,
            installed: true,
            issues: matched,
            byCategory: categoryResults,
          };
        }
      } catch { /* ignore parse error */ }
    }
    console.error(`  playwright-pool error: ${err.message?.slice(0, 120)}`);
  }

  const elapsed = performance.now() - start;
  const byCategory = categorizeBugs(bugs);
  return {
    found: 0,
    total: bugs.length,
    time: elapsed / 1000,
    installed: true,
    issues: [],
    byCategory: Object.fromEntries(
      Object.entries(byCategory).map(([cat, catBugs]) => [cat, { found: 0, total: catBugs.length }])
    ),
  };
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

    // Threshold: score >= 2 counts as a match
    if (bestIdx >= 0 && bestScore >= 2) {
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
  const issueFull = `${issueDesc} ${issueHelp} ${issueDetails} ${(issue.id || '').toLowerCase()} ${(issue.displayValue || '').toLowerCase()}`;

  // 1. Category match
  const bugCat = bug.category.toLowerCase();
  const issueCat = (issue.category || '').toLowerCase();
  if (bugCat === issueCat) score += 1;
  // accessibility tools can find accessibility bugs
  if (issueCat === 'accessibility' && bugCat === 'accessibility') score += 0.5;

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
    }
  }

  // 3. Description keyword overlap
  const bugWords = new Set(bugDesc.split(/\W+/).filter(w => w.length > 3));
  const issueWords = new Set(issueFull.split(/\W+/).filter(w => w.length > 3));
  let wordOverlap = 0;
  for (const w of bugWords) {
    if (issueWords.has(w)) wordOverlap++;
  }
  if (wordOverlap >= 3) score += 2;
  else if (wordOverlap >= 2) score += 1;
  else if (wordOverlap >= 1) score += 0.5;

  // 4. Key phrase matching for common bug types
  const keyPhrases = [
    { bugPattern: /missing alt/i, issuePattern: /alt|image.*text|img.*alt/i, boost: 2 },
    { bugPattern: /empty button/i, issuePattern: /button.*text|empty.*button|button.*label/i, boost: 2 },
    { bugPattern: /color contrast|contrast/i, issuePattern: /contrast/i, boost: 2 },
    { bugPattern: /no.*label|missing.*label/i, issuePattern: /label|form.*label/i, boost: 1.5 },
    { bugPattern: /missing.*title/i, issuePattern: /title|document.*title/i, boost: 1.5 },
    { bugPattern: /viewport/i, issuePattern: /viewport/i, boost: 2 },
    { bugPattern: /heading.*hierarchy|heading.*skip/i, issuePattern: /heading.*order|heading.*level|heading.*skip/i, boost: 2 },
    { bugPattern: /touch target|tap target/i, issuePattern: /touch|tap|target.*size/i, boost: 1.5 },
    { bugPattern: /anchor.*empty|empty.*href/i, issuePattern: /link.*href|anchor|crawl/i, boost: 1.5 },
    { bugPattern: /focus.*ring|outline.*none/i, issuePattern: /focus|outline/i, boost: 1.5 },
    { bugPattern: /nested interactive/i, issuePattern: /nested|interactive.*control/i, boost: 2 },
    { bugPattern: /tab.*order|tabindex/i, issuePattern: /tab.*order|tabindex|focus.*order/i, boost: 2 },
    { bugPattern: /open graph|og:/i, issuePattern: /open.*graph|og:|meta/i, boost: 1.5 },
    { bugPattern: /canonical/i, issuePattern: /canonical/i, boost: 2 },
    { bugPattern: /user-select.*none/i, issuePattern: /user.*select/i, boost: 2 },
    { bugPattern: /auto.*play|animation.*pause/i, issuePattern: /animation|motion|prefers.*reduced/i, boost: 1.5 },
    { bugPattern: /focus.*trap|modal.*focus/i, issuePattern: /focus.*trap|dialog|modal/i, boost: 2 },
  ];

  for (const { bugPattern, issuePattern, boost } of keyPhrases) {
    if (bugPattern.test(bugDesc) && issuePattern.test(issueFull)) {
      score += boost;
      break;  // Only apply the best match
    }
  }

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
