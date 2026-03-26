// cli-commands/analyzers.js
// Each analyzer takes DOM data and returns { issues: [], info: {} }

export function analyzeOverflow(domData, breakpointData) {
  const issues = [];
  for (const bp of breakpointData) {
    if (bp.hasOverflow) {
      issues.push({
        severity: 'critical',
        message: `Horizontal overflow at ${bp.width}px — scrollWidth ${bp.scrollWidth}px > viewport ${bp.width}px`,
        offenders: bp.offenders || [],
      });
    }
  }
  return { issues };
}

export function analyzeContrast(domData) {
  // WCAG luminance contrast calculation
  function getLuminance(r, g, b) {
    const [rs, gs, bs] = [r, g, b].map(c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  function parseColor(color) {
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return m ? { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) } : null;
  }

  const issues = [];
  for (const el of domData.elements) {
    if (!el.text || el.text.length === 0) continue;
    const fg = parseColor(el.styles.color);
    const bg = parseColor(el.styles.backgroundColor);
    if (!fg || !bg) continue;
    // Skip transparent backgrounds
    if (el.styles.backgroundColor.includes('rgba') && el.styles.backgroundColor.match(/,\s*0\s*\)/)) continue;

    const fgLum = getLuminance(fg.r, fg.g, fg.b);
    const bgLum = getLuminance(bg.r, bg.g, bg.b);
    const ratio = (Math.max(fgLum, bgLum) + 0.05) / (Math.min(fgLum, bgLum) + 0.05);
    const fontSize = parseFloat(el.styles.fontSize);
    const required = fontSize >= 24 || (fontSize >= 18.66 && parseInt(el.styles.fontWeight) >= 700) ? 3 : 4.5;

    if (ratio < required) {
      issues.push({
        severity: 'serious',
        message: `Low contrast: "${el.text.slice(0, 30)}" — ratio ${ratio.toFixed(1)}:1 (need ${required}:1)`,
        selector: el.selector,
        fg: el.styles.color,
        bg: el.styles.backgroundColor,
      });
    }
  }
  return { issues, info: { checked: domData.elements.filter(e => e.text).length } };
}

export function analyzeTapTargets(domData, minSize = 48) {
  const issues = [];
  for (const el of domData.interactive) {
    if (el.rect.w < minSize || el.rect.h < minSize) {
      issues.push({
        severity: 'serious',
        message: `Tap target too small: "${el.text || el.selector}" — ${el.rect.w}x${el.rect.h}px (need ${minSize}px)`,
        selector: el.selector,
      });
    }
  }
  return { issues, info: { checked: domData.interactive.length } };
}

export function analyzeImages(domData) {
  const issues = [];
  for (const img of domData.images) {
    if (!img.hasAlt) issues.push({ severity: 'critical', message: `Missing alt: ${img.selector}`, selector: img.selector });
    if (img.broken) issues.push({ severity: 'serious', message: `Broken image: ${img.src?.slice(0, 60)}`, selector: img.selector });
    if (img.naturalWidth > img.displayWidth * 2 && img.displayWidth > 0) {
      issues.push({ severity: 'moderate', message: `Oversized: ${img.naturalWidth}px natural, ${img.displayWidth}px displayed`, selector: img.selector });
    }
  }
  return { issues, info: { total: domData.images.length } };
}

export function analyzeHeadings(domData) {
  const issues = [];
  let prevLevel = 0;
  const h1Count = domData.headings.filter(h => h.level === 1).length;
  if (h1Count === 0) issues.push({ severity: 'serious', message: 'No <h1> on page' });
  if (h1Count > 1) issues.push({ severity: 'moderate', message: `Multiple <h1> tags (${h1Count})` });
  for (const h of domData.headings) {
    if (prevLevel > 0 && h.level > prevLevel + 1) {
      issues.push({ severity: 'moderate', message: `Heading skip: h${prevLevel} → h${h.level}` });
    }
    prevLevel = h.level;
  }
  return { issues, info: { headings: domData.headings } };
}

export function analyzeForms(domData) {
  const issues = [];
  for (const input of domData.forms) {
    if (!input.hasLabel && input.type !== 'submit' && input.type !== 'button') {
      issues.push({ severity: 'serious', message: `Missing label: <${input.tag}> ${input.type} ${input.name || ''}`, selector: input.selector });
    }
  }
  return { issues };
}

export function analyzeMeta(domData) {
  const issues = [];
  const m = domData.meta;
  if (!m.title) issues.push({ severity: 'critical', message: 'Missing <title>' });
  if (!m.description) issues.push({ severity: 'serious', message: 'Missing meta description' });
  if (!m.canonical) issues.push({ severity: 'moderate', message: 'No canonical URL' });
  if (!m.viewport) issues.push({ severity: 'serious', message: 'Missing viewport meta' });
  if (!m.lang) issues.push({ severity: 'moderate', message: 'Missing lang attribute' });
  if (!m.ogTitle) issues.push({ severity: 'moderate', message: 'Missing og:title' });
  if (!m.ogDescription) issues.push({ severity: 'moderate', message: 'Missing og:description' });
  if (!m.ogImage) issues.push({ severity: 'moderate', message: 'Missing og:image' });
  return { issues, info: m };
}

export function analyzeTextContent(domData, searchText) {
  if (!searchText) return { issues: [], info: {} };
  const found = domData.elements.some(el => el.text.includes(searchText));
  return {
    issues: found ? [] : [{ severity: 'critical', message: `Text not found: "${searchText}"` }],
    info: { searched: searchText, found },
  };
}

export function analyzeLayout(domData) {
  const issues = [];
  // Check for overflow
  if (domData.hasOverflow) {
    issues.push({ severity: 'critical', message: `Page overflows: scrollWidth ${domData.scrollWidth}px > viewport ${domData.viewport.width}px` });
  }
  return { issues, info: { viewport: domData.viewport, elements: domData.elements.length } };
}
