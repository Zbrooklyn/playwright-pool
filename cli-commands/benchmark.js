// cli-commands/benchmark.js — Comprehensive benchmark tool for playwright-pool
//
// Runs a smart matrix of ~800 configurations x N runs, measuring CLI performance
// across different sites, operations, concurrency levels, and network conditions.
//
// Usage:
//   playwright-pool benchmark [options]
//   playwright-pool benchmark compare <baseline.json> <current.json>
//
// Flags:
//   --site <name>        Run only one site (trivial|static|spa|heavy|complex)
//   --operation <name>   Run only one operation
//   --concurrency <n>    Run only one concurrency level
//   --runs <n>           Runs per config (default: 5)
//   --mode <mode>        headless_cli or headed_cli (default: headless_cli)
//   --output <path>      Save results JSON (default: ./benchmark-results-<timestamp>.json)
//   --quick              Quick mode: 1 site, 3 operations, 1 run
//   --timeout <ms>       Per-operation timeout in ms (default: 60000)
//   --warmup <n>         Warmup iterations before measured runs (default: 0)
//   --dry-run            Show matrix without running

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync, spawn } from 'child_process';
import { parseArgs, timestamp } from './shared.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.join(__dirname, '..', 'cli.js');

// ─── Test Sites ──────────────────────────────────────────────────────────

const SITES = [
  { name: 'trivial', url: 'https://example.com' },
  { name: 'static', url: 'https://developer.mozilla.org/en-US/docs/Web/HTML' },
  { name: 'spa', url: 'https://github.com/Zbrooklyn/playwright-pool' },
  { name: 'heavy', url: 'https://www.wikipedia.org' },
  { name: 'complex', url: 'https://news.ycombinator.com' },
];

// ─── Network Profiles ────────────────────────────────────────────────────

const NETWORK_PROFILES = {
  normal: null,
  slow4g: { downloadThroughput: (1.5 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 300 },
  slow3g: { downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8, latency: 2000 },
};

// ─── Operations ──────────────────────────────────────────────────────────

const OPERATIONS = [
  { name: 'meta_audit', fn: runMetaAudit, concurrency: [1, 3, 5, 10], network: ['normal', 'slow4g'] },
  { name: 'a11y_audit', fn: runA11yAudit, concurrency: [1, 3, 5, 10], network: ['normal', 'slow4g'] },
  { name: 'full_audit', fn: runFullAudit, concurrency: [1, 3, 5], network: ['normal', 'slow4g', 'slow3g'] },
  { name: 'screenshot', fn: runScreenshot, concurrency: [1, 3, 5, 10, 15], network: ['normal'] },
  { name: 'breakpoint_screenshots', fn: runBreakpoints, concurrency: [1, 3, 5, 10, 15], network: ['normal'] },
  { name: 'snapshot', fn: runSnapshot, concurrency: [1, 3, 5, 10], network: ['normal', 'slow4g'] },
  { name: 'js_eval', fn: runEval, concurrency: [1, 3, 5, 10], network: ['normal'] },
  { name: 'navigate_snapshot', fn: runNavSnapshot, concurrency: [1, 3, 5, 10], network: ['normal', 'slow4g'] },
  { name: 'click_chain', fn: runClickChain, concurrency: [1, 2, 3], network: ['normal'] },
  { name: 'network_inspect', fn: runNetworkInspect, concurrency: [1, 3, 5], network: ['normal'] },
  { name: 'pdf_generate', fn: runPdfGenerate, concurrency: [1, 3, 5], network: ['normal'] },
  { name: 'multi_url_audit', fn: runMultiUrlAudit, concurrency: [1, 3], network: ['normal'] },
];

// ─── Entry Point ─────────────────────────────────────────────────────────

export async function handleBenchmark(args) {
  const { flags, positional } = parseArgs(args);

  // Handle 'compare' subcommand before the main benchmark logic
  if (positional[0] === 'compare') {
    return handleCompare(positional.slice(1));
  }

  // Parse options
  const quick = !!flags.quick;
  const dryRun = !!flags['dry-run'];
  const runsPerConfig = quick ? 1 : parseInt(flags.runs || '5', 10);
  const warmupRuns = parseInt(flags.warmup || '0', 10);
  const modeFilter = flags.mode || 'headless_cli';
  const siteFilter = flags.site || null;
  const opFilter = flags.operation || null;
  const concFilter = flags.concurrency ? parseInt(flags.concurrency, 10) : null;
  const opTimeout = parseInt(flags.timeout || '60000', 10);
  const outputPath = flags.output || `benchmark-results-${timestamp()}.json`;

  // Validate mode
  const validModes = ['headless_cli', 'headed_cli'];
  if (!validModes.includes(modeFilter)) {
    console.error(`Invalid mode: ${modeFilter}. Valid modes: ${validModes.join(', ')}`);
    process.exit(1);
  }

  // Build the test matrix
  const matrix = buildMatrix({ quick, siteFilter, opFilter, concFilter, modeFilter });

  const totalRuns = matrix.length * runsPerConfig;
  console.log('');
  console.log('PLAYWRIGHT-POOL BENCHMARK');
  console.log('='.repeat(60));
  console.log(`  Configurations:  ${matrix.length}`);
  console.log(`  Runs per config: ${runsPerConfig}`);
  console.log(`  Total runs:      ${totalRuns}`);
  console.log(`  Mode:            ${modeFilter}`);
  console.log(`  Timeout:         ${opTimeout}ms`);
  console.log(`  Warmup:          ${warmupRuns}`);
  console.log(`  Output:          ${outputPath}`);
  if (quick) console.log('  ** QUICK MODE — reduced matrix **');
  console.log('='.repeat(60));
  console.log('');

  if (dryRun) {
    console.log('DRY RUN — matrix preview:');
    console.log('');
    printMatrixPreview(matrix);
    console.log(`\nTotal: ${matrix.length} configs x ${runsPerConfig} runs = ${totalRuns} runs`);
    return;
  }

  // Run the benchmark
  const benchStart = process.hrtime.bigint();
  const results = [];
  let configIdx = 0;

  for (const config of matrix) {
    configIdx++;
    const configResults = [];

    // Warmup iterations (results discarded)
    for (let w = 1; w <= warmupRuns; w++) {
      const warmupLabel = `${config.operation} | ${config.site} | warmup ${w}/${warmupRuns}`;
      process.stdout.write(`  [warmup] ${warmupLabel} — `);
      try {
        if (config.concurrency > 1) {
          await runConcurrent(config, opTimeout);
        } else {
          await runSingle(config, opTimeout);
        }
        console.log('done');
      } catch {
        console.log('skipped');
      }
    }

    for (let run = 1; run <= runsPerConfig; run++) {
      const progress = `[${((configIdx - 1) * runsPerConfig + run)}/${totalRuns}]`;
      const label = `${config.operation} | ${config.site} | ${config.mode} | c=${config.concurrency} | net=${config.network} | run ${run}/${runsPerConfig}`;

      process.stdout.write(`${progress} ${label} — `);

      let runResult;
      try {
        if (config.concurrency > 1) {
          runResult = await runConcurrent(config, opTimeout);
        } else {
          runResult = await runSingle(config, opTimeout);
        }
        console.log(`${formatMs(runResult.wallTime)} ${runResult.success ? '✓' : '✗'}`);
      } catch (err) {
        runResult = {
          wallTime: -1,
          peakMemory: 0,
          success: false,
          outputSize: 0,
          exitCode: -1,
          error: err.message,
        };
        console.log(`ERROR: ${err.message}`);
      }

      configResults.push(runResult);
    }

    results.push({
      config,
      runs: configResults,
      stats: computeStats(configResults),
    });
  }

  const benchElapsed = Number(process.hrtime.bigint() - benchStart) / 1e6;

  // Print summary
  console.log('');
  printSummary(results);
  console.log('');
  console.log(`Total: ${totalRuns} runs in ${formatDuration(benchElapsed)}`);

  // Save results
  const fullReport = {
    timestamp: new Date().toISOString(),
    totalRuns,
    totalTimeMs: benchElapsed,
    runsPerConfig,
    mode: modeFilter,
    results,
  };

  fs.writeFileSync(outputPath, JSON.stringify(fullReport, null, 2), 'utf8');
  console.log(`Results saved: ${outputPath}`);
}

// ─── Matrix Builder ──────────────────────────────────────────────────────

function buildMatrix({ quick, siteFilter, opFilter, concFilter, modeFilter }) {
  let sites = SITES;
  let operations = OPERATIONS;

  // Quick mode: 1 site, 3 operations
  if (quick) {
    sites = [SITES[0]]; // trivial (example.com)
    operations = [OPERATIONS[0], OPERATIONS[3], OPERATIONS[6]]; // meta_audit, screenshot, js_eval
  }

  // Apply filters
  if (siteFilter) {
    sites = sites.filter(s => s.name === siteFilter);
    if (sites.length === 0) {
      console.error(`Unknown site: ${siteFilter}. Available: ${SITES.map(s => s.name).join(', ')}`);
      process.exit(1);
    }
  }

  if (opFilter) {
    operations = operations.filter(o => o.name === opFilter);
    if (operations.length === 0) {
      console.error(`Unknown operation: ${opFilter}. Available: ${OPERATIONS.map(o => o.name).join(', ')}`);
      process.exit(1);
    }
  }

  const matrix = [];

  for (const op of operations) {
    for (const site of sites) {
      const concLevels = concFilter ? [concFilter] : op.concurrency;
      const networks = op.network;

      for (const conc of concLevels) {
        for (const net of networks) {
          // Network throttling only applies to concurrency=1 (direct Playwright mode)
          // For concurrent CLI subprocess tests, skip throttled network (subprocesses
          // can't share a CDP session for throttling)
          if (net !== 'normal' && conc > 1) continue;

          matrix.push({
            operation: op.name,
            site: site.name,
            url: site.url,
            mode: modeFilter,
            concurrency: conc,
            network: net,
            fn: op.fn,
          });
        }
      }
    }
  }

  return matrix;
}

// ─── Single Run ──────────────────────────────────────────────────────────

async function runSingle(config, timeout) {
  const { fn, url, mode, network } = config;
  const headed = mode === 'headed_cli';

  // If network throttling required, use the Playwright-direct path
  if (network !== 'normal') {
    return await runWithThrottling(config, timeout);
  }

  return await fn({ url }, { headed, timeout });
}

// ─── Concurrent Runs ────────────────────────────────────────────────────

async function runConcurrent(config, timeout) {
  const { fn, url, mode, concurrency } = config;
  const headed = mode === 'headed_cli';

  const start = process.hrtime.bigint();
  const promises = Array.from({ length: concurrency }, () =>
    fn({ url }, { headed, timeout })
  );
  const individualResults = await Promise.all(promises);
  const totalTime = Number(process.hrtime.bigint() - start) / 1e6;

  // Aggregate: total wall time is the concurrent elapsed, individual metrics are averaged
  const successCount = individualResults.filter(r => r.success).length;
  const totalOutput = individualResults.reduce((sum, r) => sum + r.outputSize, 0);
  const peakMem = Math.max(...individualResults.map(r => r.peakMemory || 0));

  return {
    wallTime: totalTime,
    peakMemory: peakMem,
    success: successCount === concurrency,
    outputSize: totalOutput,
    exitCode: successCount === concurrency ? 0 : 1,
    concurrencyDetail: {
      total: concurrency,
      succeeded: successCount,
      individualTimes: individualResults.map(r => r.wallTime),
    },
  };
}

// ─── Network-Throttled Run (Playwright-direct) ──────────────────────────

async function runWithThrottling(config, timeout) {
  const { url, network, operation } = config;
  const profile = NETWORK_PROFILES[network];

  const start = process.hrtime.bigint();
  const memBefore = process.memoryUsage().rss;

  let outputSize = 0;
  let success = false;
  let exitCode = -1;

  try {
    // Dynamic import to avoid top-level dependency if not needed
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Apply CDP network throttling
    if (profile) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: profile.downloadThroughput,
        uploadThroughput: profile.uploadThroughput,
        latency: profile.latency,
      });
    }

    // Navigate
    await page.goto(url, { waitUntil: 'load', timeout });

    // Run a simplified version of the operation inline
    let result = '';
    switch (operation) {
      case 'meta_audit':
        result = await page.evaluate(() => {
          const meta = {};
          meta.title = document.title;
          meta.description = document.querySelector('meta[name="description"]')?.content || '';
          meta.charset = document.characterSet;
          meta.viewport = document.querySelector('meta[name="viewport"]')?.content || '';
          meta.ogTags = Array.from(document.querySelectorAll('meta[property^="og:"]'))
            .map(m => ({ property: m.getAttribute('property'), content: m.content }));
          return JSON.stringify(meta);
        });
        break;
      case 'a11y_audit':
        result = await page.evaluate(() => {
          const issues = [];
          document.querySelectorAll('img:not([alt])').forEach(img => {
            issues.push({ type: 'missing-alt', src: img.src });
          });
          document.querySelectorAll('a:not([href]), a[href=""]').forEach(a => {
            issues.push({ type: 'empty-link', text: a.textContent?.trim() });
          });
          return JSON.stringify({ issues, count: issues.length });
        });
        break;
      case 'full_audit':
        result = await page.evaluate(() => {
          const audit = { title: document.title, links: document.querySelectorAll('a').length,
            images: document.querySelectorAll('img').length,
            headings: document.querySelectorAll('h1,h2,h3').length };
          return JSON.stringify(audit);
        });
        break;
      case 'snapshot':
      case 'navigate_snapshot':
        result = await page.content();
        break;
      default:
        result = await page.title();
        break;
    }

    outputSize = Buffer.byteLength(result, 'utf8');
    success = true;
    exitCode = 0;

    await browser.close();
  } catch (err) {
    success = false;
    exitCode = 1;
  }

  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  const peakMemory = (process.memoryUsage().rss - memBefore) / (1024 * 1024);

  return {
    wallTime: elapsed,
    peakMemory: Math.max(0, peakMemory),
    success,
    outputSize,
    exitCode,
  };
}

// ─── Operation Functions (CLI subprocess) ────────────────────────────────

function spawnCli(cliArgs, options = {}) {
  const { headed = false, timeout = 60000 } = options;
  const fullArgs = ['--no-warnings', CLI_PATH, ...cliArgs];
  if (headed) fullArgs.push('--headed');

  const start = process.hrtime.bigint();
  const memBefore = process.memoryUsage().rss;

  const result = spawnSync(process.execPath, fullArgs, {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });

  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  const peakMemory = (process.memoryUsage().rss - memBefore) / (1024 * 1024);

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  return {
    wallTime: elapsed,
    peakMemory: Math.max(0, peakMemory),
    success: result.status !== 1 && result.status !== null,
    outputSize: Buffer.byteLength(stdout + stderr, 'utf8'),
    exitCode: result.status,
  };
}

async function runMetaAudit(site, options) {
  return spawnCli(['audit', site.url, '--only', 'meta'], options);
}

async function runA11yAudit(site, options) {
  return spawnCli(['audit', site.url, '--only', 'accessibility'], options);
}

async function runFullAudit(site, options) {
  return spawnCli(['audit', site.url], options);
}

async function runScreenshot(site, options) {
  const outFile = path.join(os_tmpdir(), `bench-ss-${Date.now()}.png`);
  const result = spawnCli(['screenshot', site.url, outFile], options);
  // Clean up temp file
  try { fs.unlinkSync(outFile); } catch { /* ignore */ }
  return result;
}

async function runBreakpoints(site, options) {
  const outDir = path.join(os_tmpdir(), `bench-bp-${Date.now()}`);
  const result = spawnCli(['screenshot', site.url, '--breakpoints', '--output', outDir], options);
  // Clean up temp files
  try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
  return result;
}

async function runSnapshot(site, options) {
  return spawnCli(['snap', site.url], options);
}

async function runEval(site, options) {
  return spawnCli(['eval', site.url, 'document.title'], options);
}

async function runNavSnapshot(site, options) {
  // Navigate then snapshot — use snap which does both
  return spawnCli(['snap', site.url, '--interactive'], options);
}

async function runClickChain(site, options) {
  // Simulate a click chain by evaluating a click-like script
  return spawnCli(['eval', site.url, 'document.querySelectorAll("a").length'], options);
}

async function runNetworkInspect(site, options) {
  // Use eval to capture network-like info (resource count)
  return spawnCli(['eval', site.url, 'performance.getEntriesByType("resource").length'], options);
}

async function runPdfGenerate(site, options) {
  const outFile = path.join(os_tmpdir(), `bench-pdf-${Date.now()}.pdf`);
  const result = spawnCli(['pdf', site.url, outFile], options);
  // Clean up temp file
  try { fs.unlinkSync(outFile); } catch { /* ignore */ }
  return result;
}

async function runMultiUrlAudit(site, options) {
  // Audit two URLs: the target site + example.com
  return spawnCli(['audit', site.url, 'https://example.com', '--only', 'meta'], options);
}

// Temp dir helper (avoids top-level import of os just for tmpdir)
function os_tmpdir() {
  return process.env.TEMP || process.env.TMP || '/tmp';
}

// ─── Statistics ──────────────────────────────────────────────────────────

function computeStats(runs) {
  const successful = runs.filter(r => r.success);
  const times = runs.map(r => r.wallTime).filter(t => t >= 0).sort((a, b) => a - b);
  const outputs = runs.map(r => r.outputSize);

  if (times.length === 0) {
    return {
      median: -1, mean: -1, p95: -1, min: -1, max: -1,
      stddev: -1, ci95: [-1, -1], cv: -1, cvUnstable: false,
      outliers: [], successRate: `0/${runs.length}`, avgOutput: 0,
    };
  }

  const n = times.length;
  const median = times[Math.floor(n / 2)];
  const mean = times.reduce((s, v) => s + v, 0) / n;
  const p95idx = Math.min(Math.floor(n * 0.95), n - 1);
  const p95 = times[p95idx];
  const min = times[0];
  const max = times[n - 1];
  const avgOutput = outputs.reduce((a, b) => a + b, 0) / outputs.length;

  // Sample standard deviation
  const variance = n > 1
    ? times.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
    : 0;
  const stddev = Math.sqrt(variance);

  // 95% confidence interval (stderr * 1.96)
  const stderr = stddev / Math.sqrt(n);
  const ci95 = [mean - 1.96 * stderr, mean + 1.96 * stderr];

  // Coefficient of variation (stddev/mean)
  const cv = mean > 0 ? stddev / mean : 0;
  const cvUnstable = cv > 0.10;

  // IQR-based outlier detection
  const q1 = times[Math.floor(n * 0.25)];
  const q3 = times[Math.floor(n * 0.75)];
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const outliers = times
    .map((t, i) => ({ run: i + 1, time: t }))
    .filter(({ time }) => time < lowerFence || time > upperFence);

  return {
    median,
    mean,
    p95,
    min,
    max,
    stddev,
    ci95,
    cv,
    cvUnstable,
    outliers,
    successRate: `${successful.length}/${runs.length}`,
    avgOutput,
  };
}

// ─── Output Formatting ──────────────────────────────────────────────────

function formatMs(ms) {
  if (ms < 0) return 'N/A';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

function padRight(str, len) {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function padLeft(str, len) {
  return str.length >= len ? str.slice(0, len) : ' '.repeat(len - str.length) + str;
}

function printMatrixPreview(matrix) {
  const COL = { op: 22, site: 9, mode: 14, conc: 6, net: 8 };
  const header =
    padRight('Operation', COL.op) + ' | ' +
    padRight('Site', COL.site) + ' | ' +
    padRight('Mode', COL.mode) + ' | ' +
    padLeft('Conc', COL.conc) + ' | ' +
    padRight('Network', COL.net);

  console.log(header);
  console.log('-'.repeat(header.length));

  for (const c of matrix) {
    console.log(
      padRight(c.operation, COL.op) + ' | ' +
      padRight(c.site, COL.site) + ' | ' +
      padRight(c.mode, COL.mode) + ' | ' +
      padLeft(String(c.concurrency), COL.conc) + ' | ' +
      padRight(c.network, COL.net)
    );
  }
}

function printSummary(results) {
  console.log('BENCHMARK RESULTS');
  console.log('='.repeat(140));
  console.log('');

  const COL = { op: 22, site: 9, mode: 14, conc: 6, median: 8, meanCI: 20, stddev: 8, cv: 14, outliers: 8, success: 9, output: 8 };
  const header =
    padRight('Operation', COL.op) + ' | ' +
    padRight('Site', COL.site) + ' | ' +
    padRight('Mode', COL.mode) + ' | ' +
    padLeft('Conc', COL.conc) + ' | ' +
    padLeft('Median', COL.median) + ' | ' +
    padRight('Mean\u00B1CI', COL.meanCI) + ' | ' +
    padLeft('StdDev', COL.stddev) + ' | ' +
    padRight('CV', COL.cv) + ' | ' +
    padLeft('Outliers', COL.outliers) + ' | ' +
    padLeft('Success', COL.success) + ' | ' +
    padLeft('Output', COL.output);

  console.log(header);
  console.log('-'.repeat(header.length));

  for (const { config, stats } of results) {
    // Format Mean±CI
    const meanCI = stats.mean >= 0
      ? `${formatMs(stats.mean)}\u00B1${formatMs(1.96 * stats.stddev / Math.sqrt(parseInt(stats.successRate, 10) || 1))}`
      : 'N/A';

    // Format CV with unstable flag
    const cvStr = stats.cv >= 0
      ? `${(stats.cv * 100).toFixed(1)}%${stats.cvUnstable ? ' (unstable)' : ''}`
      : 'N/A';

    // Format outlier count
    const outlierStr = stats.outliers ? String(stats.outliers.length) : '0';

    console.log(
      padRight(config.operation, COL.op) + ' | ' +
      padRight(config.site, COL.site) + ' | ' +
      padRight(config.mode, COL.mode) + ' | ' +
      padLeft(String(config.concurrency), COL.conc) + ' | ' +
      padLeft(formatMs(stats.median), COL.median) + ' | ' +
      padRight(meanCI, COL.meanCI) + ' | ' +
      padLeft(formatMs(stats.stddev), COL.stddev) + ' | ' +
      padRight(cvStr, COL.cv) + ' | ' +
      padLeft(outlierStr, COL.outliers) + ' | ' +
      padLeft(stats.successRate, COL.success) + ' | ' +
      padLeft(formatBytes(stats.avgOutput), COL.output)
    );
  }
}

// ─── Welch's t-test ──────────────────────────────────────────────────────

function normalCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

function welchTTest(a, b) {
  const n1 = a.length, n2 = b.length;
  const mean1 = a.reduce((s, v) => s + v, 0) / n1;
  const mean2 = b.reduce((s, v) => s + v, 0) / n2;
  const var1 = a.reduce((s, v) => s + (v - mean1) ** 2, 0) / (n1 - 1);
  const var2 = b.reduce((s, v) => s + (v - mean2) ** 2, 0) / (n2 - 1);
  const se = Math.sqrt(var1 / n1 + var2 / n2);
  if (se === 0) return { t: 0, p: 1, significant: false, delta: 0, deltaPct: 0 };
  const t = (mean1 - mean2) / se;
  // Approximate p-value using normal distribution for large samples
  const pVal = 2 * (1 - normalCDF(Math.abs(t)));
  return {
    t,
    p: pVal,
    significant: pVal < 0.05,
    delta: mean2 - mean1,
    deltaPct: ((mean2 - mean1) / mean1) * 100,
  };
}

// ─── Compare Subcommand ──────────────────────────────────────────────────

function handleCompare(args) {
  if (args.length < 2) {
    console.error('Usage: playwright-pool benchmark compare <baseline.json> <current.json>');
    process.exit(1);
  }

  const [baselinePath, currentPath] = args;

  // Load and parse files
  let baseline, current;
  try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  } catch (err) {
    console.error(`Cannot read baseline file: ${baselinePath}`);
    console.error(`  ${err.message}`);
    process.exit(1);
  }
  try {
    current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  } catch (err) {
    console.error(`Cannot read current file: ${currentPath}`);
    console.error(`  ${err.message}`);
    process.exit(1);
  }

  // Build lookup maps: key = "operation|site|mode|concurrency" -> wallTime[]
  function buildMap(report) {
    const map = new Map();
    for (const entry of report.results) {
      const key = `${entry.config.operation}|${entry.config.site}|${entry.config.mode}|${entry.config.concurrency}`;
      const times = entry.runs
        .map(r => r.wallTime)
        .filter(t => t >= 0);
      if (times.length > 0) {
        map.set(key, times);
      }
    }
    return map;
  }

  const baseMap = buildMap(baseline);
  const currMap = buildMap(current);

  // Find common operations
  const commonKeys = [...baseMap.keys()].filter(k => currMap.has(k));

  if (commonKeys.length === 0) {
    console.error('No common operations found between the two result files.');
    process.exit(1);
  }

  console.log('');
  console.log('BENCHMARK COMPARISON');
  console.log('='.repeat(120));
  console.log(`  Baseline: ${baselinePath} (${baseline.timestamp})`);
  console.log(`  Current:  ${currentPath} (${current.timestamp})`);
  console.log(`  Common operations: ${commonKeys.length}`);
  console.log('='.repeat(120));
  console.log('');

  const COL = { op: 22, site: 9, mode: 14, conc: 6, bMedian: 10, cMedian: 10, delta: 10, pVal: 10, verdict: 12 };
  const header =
    padRight('Operation', COL.op) + ' | ' +
    padRight('Site', COL.site) + ' | ' +
    padRight('Mode', COL.mode) + ' | ' +
    padLeft('Conc', COL.conc) + ' | ' +
    padLeft('Base Med', COL.bMedian) + ' | ' +
    padLeft('Curr Med', COL.cMedian) + ' | ' +
    padLeft('Delta%', COL.delta) + ' | ' +
    padLeft('p-value', COL.pVal) + ' | ' +
    padRight('Verdict', COL.verdict);

  console.log(header);
  console.log('-'.repeat(header.length));

  let hasRegression = false;

  for (const key of commonKeys) {
    const [operation, site, mode, conc] = key.split('|');
    const baseTimes = baseMap.get(key);
    const currTimes = currMap.get(key);

    const baseMedian = baseTimes.slice().sort((a, b) => a - b)[Math.floor(baseTimes.length / 2)];
    const currMedian = currTimes.slice().sort((a, b) => a - b)[Math.floor(currTimes.length / 2)];

    // Need at least 2 samples in each for t-test
    let verdict, pStr, deltaStr;
    if (baseTimes.length < 2 || currTimes.length < 2) {
      verdict = 'N/A';
      pStr = 'N/A';
      deltaStr = `${((currMedian - baseMedian) / baseMedian * 100).toFixed(1)}%`;
    } else {
      const result = welchTTest(baseTimes, currTimes);
      pStr = result.p.toFixed(4);
      deltaStr = `${result.deltaPct >= 0 ? '+' : ''}${result.deltaPct.toFixed(1)}%`;

      if (result.significant && result.delta < 0) {
        verdict = 'FASTER';
      } else if (result.significant && result.delta > 0) {
        verdict = 'REGRESSION';
        hasRegression = true;
      } else {
        verdict = 'SAME';
      }
    }

    console.log(
      padRight(operation, COL.op) + ' | ' +
      padRight(site, COL.site) + ' | ' +
      padRight(mode, COL.mode) + ' | ' +
      padLeft(conc, COL.conc) + ' | ' +
      padLeft(formatMs(baseMedian), COL.bMedian) + ' | ' +
      padLeft(formatMs(currMedian), COL.cMedian) + ' | ' +
      padLeft(deltaStr, COL.delta) + ' | ' +
      padLeft(pStr, COL.pVal) + ' | ' +
      padRight(verdict, COL.verdict)
    );
  }

  console.log('');
  if (hasRegression) {
    console.log('RESULT: REGRESSION DETECTED — one or more operations are significantly slower.');
    process.exit(2);
  } else {
    console.log('RESULT: No regressions detected.');
  }
}
