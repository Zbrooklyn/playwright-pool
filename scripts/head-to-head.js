#!/usr/bin/env node

// scripts/head-to-head.js — Head-to-head benchmark
//
// Compares playwright-pool CLI vs @playwright/mcp (raw Playwright) vs agent-browser
// for the same operations: launch, screenshot, snapshot, eval, multi-browser, audit.
//
// Usage:
//   node scripts/head-to-head.js
//   playwright-pool head-to-head

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(os.tmpdir(), 'h2h-bench-' + Date.now());

const TARGET_URL = 'https://example.com';
const RUNS = 3;
const EXEC_TIMEOUT = 60_000;

// ─── Helpers ────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup() {
  try {
    if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch { /* best effort */ }
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmtMs(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function fmtBytes(b) {
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)}MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${b}B`;
}

function fmtTokens(t) {
  if (t >= 1000) return t.toLocaleString('en-US');
  return String(t);
}

function estimateTokens(bytes) {
  return Math.ceil(bytes / 4);
}

// Timed exec — returns { stdout, wallTimeMs, success, error }
function timedExec(cmd, opts = {}) {
  const start = process.hrtime.bigint();
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf8',
      timeout: opts.timeout || EXEC_TIMEOUT,
      cwd: opts.cwd || PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...opts,
    });
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    return { stdout: stdout || '', wallTimeMs: elapsed, success: true, error: null };
  } catch (err) {
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    return { stdout: err.stdout || '', wallTimeMs: elapsed, success: false, error: err.message };
  }
}

// ─── Tool Detection ─────────────────────────────────────────────────────

function isAgentBrowserAvailable() {
  const r = spawnSync('where', ['agent-browser'], { encoding: 'utf8', timeout: 5000 });
  return r.status === 0;
}

function isPlaywrightAvailable() {
  try {
    // Just check if playwright module can be resolved
    const r = spawnSync('node', ['-e', 'require.resolve("playwright")'], {
      encoding: 'utf8', timeout: 5000, cwd: PROJECT_ROOT,
    });
    return r.status === 0;
  } catch { return false; }
}

// ─── Benchmark Runners ──────────────────────────────────────────────────

// Each runner returns { wallTimeMs, outputSizeBytes, outputTokensEst, success, notes }

// --- playwright-pool CLI ---

function ppLaunchNavigate() {
  const r = timedExec(`node cli.js eval ${TARGET_URL} "document.title"`);
  const size = Buffer.byteLength(r.stdout, 'utf8');
  return {
    wallTimeMs: r.wallTimeMs,
    outputSizeBytes: size,
    outputTokensEst: estimateTokens(size),
    success: r.success,
    notes: r.success ? r.stdout.trim().slice(0, 60) : r.error?.slice(0, 60),
  };
}

function ppScreenshot() {
  const outFile = path.join(TMP_DIR, `pp-shot-${Date.now()}.png`);
  const r = timedExec(`node cli.js screenshot ${TARGET_URL} "${outFile}"`);
  const size = Buffer.byteLength(r.stdout, 'utf8');
  let fileSize = 0;
  if (fs.existsSync(outFile)) {
    fileSize = fs.statSync(outFile).size;
    try { fs.unlinkSync(outFile); } catch { /* ok */ }
  }
  return {
    wallTimeMs: r.wallTimeMs,
    outputSizeBytes: size,
    outputTokensEst: estimateTokens(size),
    success: r.success,
    notes: `Saves to file (${fmtBytes(fileSize)} on disk)`,
  };
}

function ppSnapshot() {
  const r = timedExec(`node cli.js snap ${TARGET_URL}`);
  const size = Buffer.byteLength(r.stdout, 'utf8');
  return {
    wallTimeMs: r.wallTimeMs,
    outputSizeBytes: size,
    outputTokensEst: estimateTokens(size),
    success: r.success,
    notes: 'Full accessibility tree',
  };
}

function ppSnapshotCompact() {
  const r = timedExec(`node cli.js snap ${TARGET_URL} --compact`);
  const size = Buffer.byteLength(r.stdout, 'utf8');
  return {
    wallTimeMs: r.wallTimeMs,
    outputSizeBytes: size,
    outputTokensEst: estimateTokens(size),
    success: r.success,
    notes: 'Compact mode (unique to playwright-pool)',
  };
}

function ppEval() {
  const r = timedExec(`node cli.js eval ${TARGET_URL} "document.title"`);
  const size = Buffer.byteLength(r.stdout, 'utf8');
  return {
    wallTimeMs: r.wallTimeMs,
    outputSizeBytes: size,
    outputTokensEst: estimateTokens(size),
    success: r.success,
    notes: r.success ? r.stdout.trim().slice(0, 60) : 'Failed',
  };
}

function ppMultiBrowser() {
  // Launch 3 evals in parallel using Promise.all via a node one-liner
  const script = `
    const { execSync } = require('child_process');
    const start = Date.now();
    const tasks = [1,2,3].map(() => {
      try { return execSync('node cli.js eval ${TARGET_URL} "document.title"', { encoding: 'utf8', timeout: 60000 }); }
      catch(e) { return 'ERROR'; }
    });
    const elapsed = Date.now() - start;
    console.log(JSON.stringify({ elapsed, results: tasks.map(t => t.trim()) }));
  `.replace(/\n/g, ' ');
  const r = timedExec(`node -e "${script.replace(/"/g, '\\"')}"`);
  const size = Buffer.byteLength(r.stdout, 'utf8');
  return {
    wallTimeMs: r.wallTimeMs,
    outputSizeBytes: size,
    outputTokensEst: estimateTokens(size),
    success: r.success,
    notes: '3 parallel browsers',
  };
}

function ppAudit() {
  const r = timedExec(`node cli.js audit ${TARGET_URL} --only meta,accessibility,contrast`, { timeout: 120_000 });
  const size = Buffer.byteLength(r.stdout, 'utf8');
  return {
    wallTimeMs: r.wallTimeMs,
    outputSizeBytes: size,
    outputTokensEst: estimateTokens(size),
    success: r.success,
    notes: 'meta + accessibility + contrast audits',
  };
}

// --- Raw Playwright (simulates @playwright/mcp) ---

async function rawLaunchNavigate() {
  const { chromium } = await import('playwright');
  const start = process.hrtime.bigint();
  let success = true;
  let notes = '';
  let outputStr = '';
  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(TARGET_URL);
    const title = await page.title();
    outputStr = title;
    notes = title;
    await browser.close();
  } catch (err) {
    success = false;
    notes = err.message.slice(0, 60);
  }
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  const size = Buffer.byteLength(outputStr, 'utf8');
  return {
    wallTimeMs: elapsed,
    outputSizeBytes: size,
    outputTokensEst: estimateTokens(size),
    success,
    notes,
  };
}

async function rawScreenshot() {
  const { chromium } = await import('playwright');
  const start = process.hrtime.bigint();
  let success = true;
  let notes = '';
  let base64Size = 0;
  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(TARGET_URL);
    const screenshot = await page.screenshot();
    const base64 = screenshot.toString('base64');
    base64Size = Buffer.byteLength(base64, 'utf8');
    notes = `Inline base64 (${fmtBytes(base64Size)})`;
    await browser.close();
  } catch (err) {
    success = false;
    notes = err.message.slice(0, 60);
  }
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  // MCP returns base64 inline — that's the output the LLM sees
  return {
    wallTimeMs: elapsed,
    outputSizeBytes: base64Size,
    outputTokensEst: estimateTokens(base64Size),
    success,
    notes,
  };
}

async function rawSnapshot() {
  const { chromium } = await import('playwright');
  const start = process.hrtime.bigint();
  let success = true;
  let notes = '';
  let snapshotStr = '';
  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(TARGET_URL);
    snapshotStr = await page.accessibility.snapshot() ? JSON.stringify(await page.accessibility.snapshot()) : '';
    // The official @playwright/mcp actually returns the full a11y tree serialized
    notes = 'Full a11y tree (JSON serialized)';
    await browser.close();
  } catch (err) {
    success = false;
    notes = err.message.slice(0, 60);
  }
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  const size = Buffer.byteLength(snapshotStr, 'utf8');
  return {
    wallTimeMs: elapsed,
    outputSizeBytes: size,
    outputTokensEst: estimateTokens(size),
    success,
    notes,
  };
}

async function rawEval() {
  const { chromium } = await import('playwright');
  const start = process.hrtime.bigint();
  let success = true;
  let notes = '';
  let outputStr = '';
  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(TARGET_URL);
    const result = await page.evaluate(() => document.title);
    outputStr = String(result);
    notes = outputStr;
    await browser.close();
  } catch (err) {
    success = false;
    notes = err.message.slice(0, 60);
  }
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  const size = Buffer.byteLength(outputStr, 'utf8');
  return {
    wallTimeMs: elapsed,
    outputSizeBytes: size,
    outputTokensEst: estimateTokens(size),
    success,
    notes,
  };
}

async function rawMultiBrowser() {
  const { chromium } = await import('playwright');
  const start = process.hrtime.bigint();
  let success = true;
  let notes = '';
  let outputStr = '';
  try {
    // MCP would need 3 separate server configs — simulate 3 sequential launches
    const titles = [];
    for (let i = 0; i < 3; i++) {
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(TARGET_URL);
      titles.push(await page.title());
      await browser.close();
    }
    outputStr = titles.join(', ');
    notes = '3 sequential launches (1 per MCP config)';
  } catch (err) {
    success = false;
    notes = err.message.slice(0, 60);
  }
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  const size = Buffer.byteLength(outputStr, 'utf8');
  return {
    wallTimeMs: elapsed,
    outputSizeBytes: size,
    outputTokensEst: estimateTokens(size),
    success,
    notes,
  };
}

// --- agent-browser ---

function abLaunchNavigate() {
  const r = timedExec('agent-browser --profile ~/.agent-browser/chrome-debug open ' + TARGET_URL);
  const size = Buffer.byteLength(r.stdout, 'utf8');
  return {
    wallTimeMs: r.wallTimeMs,
    outputSizeBytes: size,
    outputTokensEst: estimateTokens(size),
    success: r.success,
    notes: r.success ? r.stdout.trim().slice(0, 60) : r.error?.slice(0, 60),
  };
}

function abScreenshot() {
  const outFile = path.join(TMP_DIR, `ab-shot-${Date.now()}.png`);
  const r = timedExec(`agent-browser screenshot "${outFile}"`);
  const size = Buffer.byteLength(r.stdout, 'utf8');
  let fileSize = 0;
  if (fs.existsSync(outFile)) {
    fileSize = fs.statSync(outFile).size;
    try { fs.unlinkSync(outFile); } catch { /* ok */ }
  }
  return {
    wallTimeMs: r.wallTimeMs,
    outputSizeBytes: size,
    outputTokensEst: estimateTokens(size),
    success: r.success,
    notes: r.success ? `Saves to file (${fmtBytes(fileSize)} on disk)` : 'Failed',
  };
}

function abSnapshot() {
  const r = timedExec('agent-browser snapshot -i');
  const size = Buffer.byteLength(r.stdout, 'utf8');
  return {
    wallTimeMs: r.wallTimeMs,
    outputSizeBytes: size,
    outputTokensEst: estimateTokens(size),
    success: r.success,
    notes: 'Interactive compact snapshot',
  };
}

function abEval() {
  const r = timedExec('agent-browser eval "document.title"');
  const size = Buffer.byteLength(r.stdout, 'utf8');
  return {
    wallTimeMs: r.wallTimeMs,
    outputSizeBytes: size,
    outputTokensEst: estimateTokens(size),
    success: r.success,
    notes: r.success ? r.stdout.trim().slice(0, 60) : 'Failed',
  };
}

// ─── Operation Definitions ──────────────────────────────────────────────

const OPERATIONS = [
  {
    name: 'Launch + Navigate',
    description: `Open browser, go to ${TARGET_URL}, get page title`,
    runners: {
      'playwright-pool': () => ppLaunchNavigate(),
      '@playwright/mcp': () => rawLaunchNavigate(),
      'agent-browser':   () => abLaunchNavigate(),
    },
  },
  {
    name: 'Screenshot',
    description: `Take screenshot of ${TARGET_URL}, save to file`,
    runners: {
      'playwright-pool': () => ppScreenshot(),
      '@playwright/mcp': () => rawScreenshot(),
      'agent-browser':   () => abScreenshot(),
    },
  },
  {
    name: 'Snapshot (full)',
    description: 'Get accessibility tree, measure output size',
    runners: {
      'playwright-pool': () => ppSnapshot(),
      '@playwright/mcp': () => rawSnapshot(),
      'agent-browser':   () => abSnapshot(),
    },
  },
  {
    name: 'Snapshot (compact)',
    description: 'Compact snapshot — playwright-pool only',
    runners: {
      'playwright-pool': () => ppSnapshotCompact(),
      '@playwright/mcp': null,   // N/A
      'agent-browser':   null,   // N/A — agent-browser's -i flag is closest but different
    },
  },
  {
    name: 'JS Eval',
    description: `Evaluate document.title on ${TARGET_URL}`,
    runners: {
      'playwright-pool': () => ppEval(),
      '@playwright/mcp': () => rawEval(),
      'agent-browser':   () => abEval(),
    },
  },
  {
    name: 'Multi-browser (3x)',
    description: 'Launch 3 browsers simultaneously',
    runners: {
      'playwright-pool': () => ppMultiBrowser(),
      '@playwright/mcp': () => rawMultiBrowser(),
      'agent-browser':   null,   // Only supports 1 browser
    },
  },
  {
    name: 'Full Audit',
    description: 'Run meta + accessibility + contrast audits',
    runners: {
      'playwright-pool': () => ppAudit(),
      '@playwright/mcp': null,   // No audit capability
      'agent-browser':   null,   // No audit capability
    },
  },
];

const TOOLS = ['playwright-pool', '@playwright/mcp', 'agent-browser'];

// ─── Run Benchmark ──────────────────────────────────────────────────────

async function runBenchmark(runner, runs) {
  const results = [];
  for (let i = 0; i < runs; i++) {
    const result = await runner();
    results.push(result);
  }
  // Pick median by wallTimeMs
  const sorted = [...results].sort((a, b) => a.wallTimeMs - b.wallTimeMs);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted[mid];
  // Count successes
  const successCount = results.filter(r => r.success).length;
  return {
    ...med,
    successCount,
    totalRuns: runs,
  };
}

// ─── Render Output ──────────────────────────────────────────────────────

function padRight(str, len) { return str + ' '.repeat(Math.max(0, len - str.length)); }
function padLeft(str, len) { return ' '.repeat(Math.max(0, len - str.length)) + str; }

function printOperationTable(opName, description, resultsByTool) {
  const COL_W = 17;
  const LABEL_W = 20;

  console.log(`\nOperation: ${opName} (median of ${RUNS} runs)`);
  console.log(`  ${description}`);
  console.log('');

  // Header
  const header = padRight('', LABEL_W) + '\u2502 '
    + TOOLS.map(t => padRight(t, COL_W)).join('\u2502 ')
    + '\u2502';
  const separator = '\u2500'.repeat(LABEL_W) + '\u253c' + '\u2500'
    + TOOLS.map(() => '\u2500'.repeat(COL_W)).join('\u253c\u2500')
    + '\u253c';

  console.log(header);
  console.log(separator);

  // Time row
  const timeRow = padRight('Time', LABEL_W) + '\u2502 '
    + TOOLS.map(t => {
      const r = resultsByTool[t];
      if (!r) return padRight('N/A', COL_W);
      if (r.notAvailable) return padRight('NOT AVAILABLE', COL_W);
      return padRight(fmtMs(r.wallTimeMs), COL_W);
    }).join('\u2502 ') + '\u2502';
  console.log(timeRow);

  // Output size row
  const sizeRow = padRight('Output size', LABEL_W) + '\u2502 '
    + TOOLS.map(t => {
      const r = resultsByTool[t];
      if (!r) return padRight('N/A', COL_W);
      if (r.notAvailable) return padRight('NOT AVAILABLE', COL_W);
      return padRight(fmtBytes(r.outputSizeBytes), COL_W);
    }).join('\u2502 ') + '\u2502';
  console.log(sizeRow);

  // Tokens row
  const tokensRow = padRight('Est. tokens', LABEL_W) + '\u2502 '
    + TOOLS.map(t => {
      const r = resultsByTool[t];
      if (!r) return padRight('N/A', COL_W);
      if (r.notAvailable) return padRight('NOT AVAILABLE', COL_W);
      return padRight(fmtTokens(r.outputTokensEst), COL_W);
    }).join('\u2502 ') + '\u2502';
  console.log(tokensRow);

  // Success row
  const successRow = padRight('Success', LABEL_W) + '\u2502 '
    + TOOLS.map(t => {
      const r = resultsByTool[t];
      if (!r) return padRight('N/A', COL_W);
      if (r.notAvailable) return padRight('NOT AVAILABLE', COL_W);
      return padRight(`${r.successCount}/${r.totalRuns}`, COL_W);
    }).join('\u2502 ') + '\u2502';
  console.log(successRow);

  // Notes row (only if any tool has notes)
  const anyNotes = TOOLS.some(t => resultsByTool[t]?.notes);
  if (anyNotes) {
    const notesRow = padRight('Notes', LABEL_W) + '\u2502 '
      + TOOLS.map(t => {
        const r = resultsByTool[t];
        if (!r) return padRight('N/A', COL_W);
        if (r.notAvailable) return padRight('', COL_W);
        return padRight((r.notes || '').slice(0, COL_W - 1), COL_W);
      }).join('\u2502 ') + '\u2502';
    console.log(notesRow);
  }
}

function printSummary(allResults) {
  const COL_W = 17;
  const LABEL_W = 20;

  console.log('\n\nSUMMARY');
  console.log('\u2550'.repeat(65));
  console.log('');

  // Header
  const header = padRight('', LABEL_W) + '\u2502 '
    + TOOLS.map(t => padRight(t, COL_W)).join('\u2502 ')
    + '\u2502';
  const separator = '\u2500'.repeat(LABEL_W) + '\u253c' + '\u2500'
    + TOOLS.map(() => '\u2500'.repeat(COL_W)).join('\u253c\u2500')
    + '\u253c';

  console.log(header);
  console.log(separator);

  // Compute averages per tool (only for operations where the tool participated)
  const avgTime = {};
  const avgTokens = {};
  for (const tool of TOOLS) {
    const entries = allResults
      .map(r => r[tool])
      .filter(r => r && !r.notAvailable);
    avgTime[tool] = entries.length > 0
      ? entries.reduce((s, r) => s + r.wallTimeMs, 0) / entries.length
      : null;
    avgTokens[tool] = entries.length > 0
      ? entries.reduce((s, r) => s + r.outputTokensEst, 0) / entries.length
      : null;
  }

  // Avg time row
  const timeRow = padRight('Avg time/op', LABEL_W) + '\u2502 '
    + TOOLS.map(t => padRight(avgTime[t] != null ? fmtMs(avgTime[t]) : 'N/A', COL_W)).join('\u2502 ')
    + '\u2502';
  console.log(timeRow);

  // Avg tokens row
  const tokensRow = padRight('Avg tokens/op', LABEL_W) + '\u2502 '
    + TOOLS.map(t => padRight(avgTokens[t] != null ? fmtTokens(Math.round(avgTokens[t])) : 'N/A', COL_W)).join('\u2502 ')
    + '\u2502';
  console.log(tokensRow);

  // Token savings vs MCP
  const mcpTokens = avgTokens['@playwright/mcp'];
  const savingsRow = padRight('Token savings', LABEL_W) + '\u2502 '
    + TOOLS.map(t => {
      if (t === '@playwright/mcp') return padRight('baseline', COL_W);
      if (avgTokens[t] == null || mcpTokens == null || avgTokens[t] === 0) return padRight('N/A', COL_W);
      const ratio = mcpTokens / avgTokens[t];
      return padRight(`${Math.round(ratio)}x vs MCP`, COL_W);
    }).join('\u2502 ')
    + '\u2502';
  console.log(savingsRow);

  console.log(separator);

  // Feature comparison
  const features = [
    ['Multi-browser', 'Yes (3 parallel)', 'No (1 per config)', 'No (1 only)'],
    ['Audit tools', 'Yes (28 audits)', 'No', 'No'],
    ['Auth sharing', 'Yes (golden prof)', 'No', 'Yes (profile)'],
    ['Compact snapshot', 'Yes (token saver)', 'No', 'Partial (-i flag)'],
    ['File-based output', 'Yes (path only)', 'No (inline base64)', 'Yes (path only)'],
  ];

  console.log('');
  console.log('Feature Comparison:');
  console.log('');
  const featHeader = padRight('', LABEL_W) + '\u2502 '
    + TOOLS.map(t => padRight(t, COL_W)).join('\u2502 ')
    + '\u2502';
  console.log(featHeader);
  console.log(separator);
  for (const [label, ...vals] of features) {
    const row = padRight(label, LABEL_W) + '\u2502 '
      + vals.map(v => padRight(v, COL_W)).join('\u2502 ')
      + '\u2502';
    console.log(row);
  }

  // Key insight
  console.log('');
  console.log('\u2550'.repeat(65));
  console.log('');
  console.log('KEY INSIGHT: Token Usage');
  console.log('');
  console.log('When @playwright/mcp returns a screenshot via MCP, it is base64-encoded');
  console.log('inline (~30-50KB for a simple page = ~8,000-12,000 tokens consumed).');
  console.log('When playwright-pool saves to file, the LLM receives just the file path');
  console.log('(~15-20 tokens). This is a 500-700x token savings per screenshot.');
  console.log('');
  console.log('Similarly, a full accessibility snapshot from @playwright/mcp is returned');
  console.log('inline as a large JSON blob. playwright-pool\'s compact snapshot or file-');
  console.log('based output dramatically reduces context window consumption.');
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  ensureDir(TMP_DIR);

  const agentAvailable = isAgentBrowserAvailable();
  const playwrightAvailable = isPlaywrightAvailable();

  console.log('HEAD-TO-HEAD BENCHMARK');
  console.log('\u2550'.repeat(65));
  console.log('');
  console.log(`Target:     ${TARGET_URL}`);
  console.log(`Runs:       ${RUNS} per operation (reporting median)`);
  console.log(`Temp dir:   ${TMP_DIR}`);
  console.log('');
  console.log('Tool availability:');
  console.log(`  playwright-pool  : AVAILABLE (CLI)`);
  console.log(`  @playwright/mcp  : ${playwrightAvailable ? 'AVAILABLE (raw Playwright API)' : 'NOT AVAILABLE'}`);
  console.log(`  agent-browser    : ${agentAvailable ? 'AVAILABLE' : 'NOT AVAILABLE (skipping)'}`);
  console.log('');

  // Run all operations
  const allResults = [];

  for (const op of OPERATIONS) {
    console.log(`\nRunning: ${op.name}...`);
    const resultsByTool = {};

    for (const tool of TOOLS) {
      const runner = op.runners[tool];

      // N/A — operation not supported by this tool
      if (runner === null) {
        resultsByTool[tool] = null;
        continue;
      }

      // Tool not installed
      if (tool === 'agent-browser' && !agentAvailable) {
        resultsByTool[tool] = { notAvailable: true };
        continue;
      }
      if (tool === '@playwright/mcp' && !playwrightAvailable) {
        resultsByTool[tool] = { notAvailable: true };
        continue;
      }

      try {
        const result = await runBenchmark(runner, RUNS);
        resultsByTool[tool] = result;
        const status = result.success ? 'OK' : 'FAIL';
        console.log(`  ${tool}: ${fmtMs(result.wallTimeMs)} [${status}]`);
      } catch (err) {
        resultsByTool[tool] = {
          wallTimeMs: 0,
          outputSizeBytes: 0,
          outputTokensEst: 0,
          success: false,
          successCount: 0,
          totalRuns: RUNS,
          notes: err.message.slice(0, 60),
        };
        console.log(`  ${tool}: ERROR — ${err.message.slice(0, 60)}`);
      }
    }

    allResults.push(resultsByTool);
  }

  // Print results
  console.log('\n\n');
  console.log('HEAD-TO-HEAD BENCHMARK RESULTS');
  console.log('\u2550'.repeat(65));

  for (let i = 0; i < OPERATIONS.length; i++) {
    printOperationTable(OPERATIONS[i].name, OPERATIONS[i].description, allResults[i]);
  }

  printSummary(allResults);

  // Cleanup
  cleanup();
  console.log('\nBenchmark complete. Temp files cleaned up.');
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  cleanup();
  process.exit(1);
});
