// cli-commands/intent-map.js

const INTENT_KEYWORDS = {
  layout: ['layout', 'look', 'right', 'correct', 'broken', 'wrong', 'display'],
  overflow: ['overflow', 'scroll', 'horizontal', 'mobile', 'responsive', 'breakpoint'],
  contrast: ['contrast', 'color', 'readable', 'text', 'accessibility', 'a11y', 'wcag'],
  spacing: ['spacing', 'padding', 'margin', 'alignment', 'aligned', 'consistent'],
  images: ['image', 'img', 'photo', 'picture', 'alt', 'broken image'],
  headings: ['heading', 'h1', 'h2', 'hierarchy', 'seo', 'structure'],
  tap_targets: ['tap', 'touch', 'button', 'click', 'mobile', 'target', 'size'],
  meta: ['seo', 'meta', 'title', 'description', 'og', 'social', 'search'],
  links: ['link', 'broken', 'href', '404', 'dead'],
  forms: ['form', 'input', 'label', 'validation', 'submit', 'field'],
  text_content: ['text', 'content', 'price', 'showing', 'display', 'says'],
  performance: ['performance', 'speed', 'fast', 'slow', 'load', 'vitals'],
  all: ['full', 'audit', 'everything', 'complete', 'all'],
  describe: ['describe', 'what', 'everything', 'inventory', 'list'],
};

const CATEGORY_CHECKS = {
  'check mobile': ['overflow', 'tap_targets', 'images', 'text_content'],
  'check accessibility': ['contrast', 'forms', 'headings', 'tap_targets', 'images'],
  'check seo': ['meta', 'headings', 'links', 'images'],
  'check performance': ['images', 'text_content'],
  'full audit': ['all'],
};

export function mapIntentToChecks(intent) {
  if (!intent) return ['layout', 'overflow', 'contrast', 'images', 'headings', 'tap_targets'];

  const lower = intent.toLowerCase();

  // Check category shortcuts first
  for (const [category, checks] of Object.entries(CATEGORY_CHECKS)) {
    if (lower.includes(category.replace('check ', ''))) return checks;
  }

  // Fuzzy match keywords
  const matched = new Set();
  for (const [check, keywords] of Object.entries(INTENT_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) { matched.add(check); break; }
    }
  }

  // If "all" matched, return everything
  if (matched.has('all')) return Object.keys(INTENT_KEYWORDS).filter(k => k !== 'all');

  // Default if nothing matched
  if (matched.size === 0) return ['layout', 'overflow', 'contrast', 'images', 'headings', 'tap_targets'];

  return [...matched];
}
