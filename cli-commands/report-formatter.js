// cli-commands/report-formatter.js

export function formatReport(url, intent, analysisResults, screenshotPaths, detail = 'standard') {
  const allIssues = [];
  for (const [check, result] of Object.entries(analysisResults)) {
    for (const issue of result.issues || []) {
      allIssues.push({ ...issue, check });
    }
  }

  const critical = allIssues.filter(i => i.severity === 'critical').length;
  const serious = allIssues.filter(i => i.severity === 'serious').length;
  const moderate = allIssues.filter(i => i.severity === 'moderate').length;
  const minor = allIssues.filter(i => i.severity === 'minor').length;

  if (detail === 'quick') return formatQuick(url, intent, allIssues, screenshotPaths, { critical, serious, moderate, minor });
  if (detail === 'deep') return formatDeep(url, intent, allIssues, analysisResults, screenshotPaths, { critical, serious, moderate, minor });
  return formatStandard(url, intent, allIssues, analysisResults, screenshotPaths, { critical, serious, moderate, minor });
}

function formatQuick(url, intent, issues, screenshots, counts) {
  const lines = [];
  lines.push(`URL: ${url}`);
  if (intent) lines.push(`Intent: ${intent}`);
  lines.push(`Issues: ${counts.critical} critical, ${counts.serious} serious, ${counts.moderate} moderate`);
  for (const issue of issues.slice(0, 10)) {
    lines.push(`  ${issue.severity.toUpperCase()}: ${issue.message}`);
  }
  if (issues.length > 10) lines.push(`  ... and ${issues.length - 10} more`);
  if (screenshots.length) lines.push(`Screenshots: ${screenshots.join(', ')}`);
  return lines.join('\n');
}

function formatStandard(url, intent, issues, results, screenshots, counts) {
  const lines = [];
  lines.push(`URL: ${url}`);
  if (intent) lines.push(`Intent: "${intent}"`);
  lines.push('');

  // Group issues by check
  const grouped = {};
  for (const issue of issues) {
    if (!grouped[issue.check]) grouped[issue.check] = [];
    grouped[issue.check].push(issue);
  }

  for (const [check, checkIssues] of Object.entries(grouped)) {
    const label = check.toUpperCase();
    lines.push(`${label}:`);
    for (const issue of checkIssues) {
      lines.push(`  ${issue.severity.toUpperCase()}: ${issue.message}`);
      if (issue.selector) lines.push(`    Element: ${issue.selector}`);
    }
    lines.push('');
  }

  // Measurements from results
  if (results.layout?.info) {
    lines.push('MEASUREMENTS:');
    lines.push(`  Viewport: ${results.layout.info.viewport?.width}x${results.layout.info.viewport?.height}`);
    lines.push(`  Elements analyzed: ${results.layout.info.elements}`);
  }
  if (results.contrast?.info) lines.push(`  Text elements checked: ${results.contrast.info.checked}`);
  if (results.tap_targets?.info) lines.push(`  Interactive elements: ${results.tap_targets.info.checked}`);
  if (results.images?.info) lines.push(`  Images: ${results.images.info.total}`);

  lines.push('');
  lines.push(`SUMMARY: ${issues.length} issues (${counts.critical} critical, ${counts.serious} serious, ${counts.moderate} moderate)`);
  if (screenshots.length) lines.push(`Screenshots: ${screenshots.join(', ')}`);
  return lines.join('\n');
}

function formatDeep(url, intent, issues, results, screenshots, counts) {
  // Standard output plus full element data
  let output = formatStandard(url, intent, issues, results, screenshots, counts);
  output += '\n\nDETAILED DATA:\n';

  // Add headings hierarchy
  if (results.headings?.info?.headings) {
    output += '\nHeading Hierarchy:\n';
    for (const h of results.headings.info.headings) {
      output += `  ${'  '.repeat(h.level - 1)}H${h.level}: ${h.text}\n`;
    }
  }

  // Add meta details
  if (results.meta?.info) {
    output += '\nMeta Tags:\n';
    for (const [key, value] of Object.entries(results.meta.info)) {
      output += `  ${key}: ${value || '(missing)'}\n`;
    }
  }

  return output;
}
