# Modular Workflow Architecture — Interact + Inspect

**Date:** 2026-03-25
**Status:** Draft — Pending Review
**Author:** Edward Shamosh + Claude

## Problem Statement

A developer asks the AI to "check if my blog editor looks right on mobile." What happens today:

1. AI calls pool_launch (10s wait)
2. AI reads snapshot, thinks (5s)
3. AI calls browser_navigate (15s wait + huge snapshot)
4. AI reads snapshot, thinks what to click (5s)
5. AI calls browser_click to login (10s wait)
6. AI reads, thinks (5s)
7. AI calls browser_click for Blog tab (10s)
8. AI reads, thinks (5s)
9. AI calls browser_click for Edit (10s)
10. AI reads, thinks (5s)
11. AI calls browser_resize for mobile (5s)
12. AI calls browser_take_screenshot (10s)
13. AI looks at screenshot, thinks about what's wrong (10s)
14. AI writes analysis

**Total: 5-15 minutes. Actual browser work: ~10 seconds.**

The breakdown of wasted time:
- MCP protocol overhead: ~60s across all calls
- AI reading snapshots it doesn't need: ~30s consuming tokens
- AI thinking between steps it already knows: ~60s decision-making
- AI analyzing screenshots with unreliable vision (24.3% error rate): ~30s

**The target: 15-30 seconds for the same task.**

## Who Uses This

This is not just for web developers. Any AI that needs to interact with a browser and understand what it sees:

- QA tester checking if a checkout flow works
- Content manager verifying blog posts published correctly
- Marketing person checking landing page after a deploy
- Support agent reproducing a customer's bug
- Business owner reviewing their site on different devices
- Designer comparing implementation to mockup
- Anyone who needs to look at a web page and understand what's on it

## Design Principles

1. **Zero AI thinking between browser steps** — steps are declared upfront, executed as a batch
2. **Programmatic analysis first, vision second** — measurements over eyeballing
3. **Intent-driven, not checklist-driven** — the user describes what they want to know, the system picks the right checks
4. **Detail level is configurable** — quick (5 lines), standard (30 lines), deep (100+ lines)
5. **Works across MCP and CLI** — same logic, different transports
6. **Composable modules** — interact and inspect are separate, combine as needed
7. **Useful for any task** — not hardcoded for web dev UI auditing

---

## Architecture: Two Modules

### Module A: Interact

**Purpose:** Get to a page state — navigate, click, fill, login, wait.

**Input:**
- `url` — where to start
- `steps` — ordered list of actions: click, fill, wait, scroll
- `auth` — use golden profile (boolean)

**Behavior:**
- Semi-adaptive: declared steps executed in sequence
- Handles obstacles automatically:
  - Login walls → auto-authenticate via golden profile cookies
  - OAuth redirects → follow and wait for completion
  - Loading states → wait for networkidle or domcontentloaded
  - Element not found → retry with alternative selectors (button role, link role, text, CSS)
  - Page redirects → follow and continue
- Reports failures without stopping: "Step 3 failed: 'Blog' not found. Continued with step 4."

**Output:** A browser page in the desired state, ready for inspection.

**Execution:** Single process, zero AI involvement between steps. All steps run in one browser session.

### Module B: Inspect

**Purpose:** Understand what's on a page and answer a question about it.

**Input:**
- `page` — a browser page (from Module A, or the current MCP context)
- `intent` — what the user wants to know (natural language or keyword)
- `detail` — quick / standard / deep
- `breakpoints` — viewport sizes to check (default: desktop/tablet/mobile)
- `systemPrompt` — optional custom instructions for how to analyze

**Behavior:**
1. Reads the intent to determine which checks are relevant
2. Screenshots at requested breakpoints (parallel)
3. Collects ALL DOM data in ONE `page.evaluate()` call:
   - Every element's bounding rect, computed styles
   - All text content, links, images, forms
   - Heading hierarchy, meta tags
   - Interactive elements with states
4. Processes collected data in Node.js (not in the browser):
   - Runs only the checks relevant to the intent
   - Calculates contrast, spacing, tap targets, overflow as needed
   - Matches findings against the intent
5. Formats report at requested detail level

**Output:** Structured text report answering the intent, with supporting measurements and screenshot file paths.

### Composition

```
interact(url, steps) → page → inspect(page, intent, detail) → report
```

One CLI command or one MCP tool call does both:

```bash
# CLI
playwright-pool inspect https://mysite.com/admin \
  --steps "click 'Sign in with Google', click 'Blog', click 'Edit'" \
  --intent "check if mobile layout is correct" \
  --detail standard \
  --breakpoints 375,768,1280

# MCP
workflow_inspect {
  url: "https://mysite.com/admin",
  steps: ["click Sign in with Google", "click Blog", "click Edit"],
  intent: "check if mobile layout is correct",
  detail: "standard",
  breakpoints: [375, 768, 1280]
}
```

---

## Intent System

Instead of "run these 28 audits," the user passes an intent. The system maps intents to relevant checks.

### Example Intents and What Runs

| Intent | Checks that run |
|--------|----------------|
| "does this look right?" | layout, overflow, contrast, spacing, images, heading order |
| "is the price showing $29.99?" | text content search on page, screenshot for evidence |
| "check mobile layout" | overflow at 375px, tap targets, responsive images, text wrap |
| "full audit" | all 28 checks |
| "what changed since last time?" | screenshot diff against baseline |
| "can a user complete checkout?" | interaction steps + form validation + success state |
| "describe everything on this page" | full DOM inventory at requested detail level |
| "check accessibility" | a11y, contrast, focus order, tap targets, alt text, labels, headings |
| "check SEO" | meta, headings, OG tags, canonical, broken links, structured data |
| "check performance" | web vitals, image sizes, font loading, third-party scripts |

### Custom System Prompts

For specialized use cases, a system prompt can be injected:

```bash
playwright-pool inspect https://mysite.com \
  --intent "check brand compliance" \
  --system-prompt "Brand colors are #6366F1 and #1E293B. Font is Inter. All buttons should use the primary color. Logo should be 32px height."
```

The inspect module uses the system prompt to guide its analysis — checking for off-brand colors, wrong fonts, incorrect logo sizes.

---

## Detail Levels

### Quick (5-10 lines)
```
URL: https://mysite.com/admin — Blog Editor (mobile 375px)
Issues: 3 critical, 2 serious
  CRITICAL: Title truncated at 375px — "Ecommerce agency vs in-ho..."
  CRITICAL: Toolbar buttons 32x32px (need 48px minimum)
  CRITICAL: Content overflows — body 412px > viewport 375px
  SERIOUS: No visible focus on active Edit tab
  SERIOUS: SEO score 63% — below 80% threshold
Screenshots: desktop.png, tablet.png, mobile.png
```

### Standard (30-50 lines)
```
URL: https://mysite.com/admin — Blog Editor (mobile 375px)
Intent: "check if mobile layout is correct"

LAYOUT:
  Header: Close button left, mode selector center (Rich Text/Markdown/HTML),
          Edit/Preview tabs, Update button right. Single row at 375px.
  Content: Title field full width, WYSIWYG editor below with toolbar.
  Footer: Status bar — autosave indicator, word count (1716), SEO ring (63%).

ISSUES (3 critical, 2 serious):
  CRITICAL: Title field text truncated — "vs in-ho..." at 375px
    Element: input[name="title"] — width 343px, text 82 chars, no text-overflow: ellipsis
  CRITICAL: Toolbar buttons below touch target minimum
    14 buttons measured: 32x32px each. WCAG 2.5.8 requires 48x48px.
  CRITICAL: Horizontal overflow at 375px
    Body scrollWidth: 412px > viewport 375px. Offender: .toolbar-row (width: 412px)
  SERIOUS: Active tab "Edit" has no visible focus indicator
    No outline, box-shadow, or border-bottom change on :focus
  SERIOUS: SEO score 63%
    Missing: meta description, canonical URL

MEASUREMENTS:
  Title font: 24px Inter, color #1a1a1a on #ffffff (contrast 16.4:1 ✓)
  Toolbar: 48px height, 14 buttons at 32x32px, gap 4px
  Content padding: 16px left/right at mobile
  Footer height: 36px

Screenshots saved: desktop.png, tablet.png, mobile.png
```

### Deep (100+ lines)
Standard output PLUS:
- Every element's computed styles
- Full spacing audit (all margin/padding values)
- Full color inventory
- Complete heading hierarchy
- All interactive elements with states
- All images with alt text and dimensions
- Focus order sequence
- Dark mode comparison
- Print layout check

---

## Testing & Benchmarking Strategy

### Test Scenarios (15 real-world tasks)

**Tier 1 — Common tasks (10 scenarios):**

| # | Scenario | User Type |
|---|----------|-----------|
| 1 | Navigate to URL, screenshot at 3 breakpoints | Any |
| 2 | Login via Google, go to admin, screenshot dashboard | Developer |
| 3 | Check if this page has any broken images | QA |
| 4 | Is the price showing correctly on the product page? | Business owner |
| 5 | Compare staging vs production homepage | Developer |
| 6 | Describe everything visible on this page | Content manager |
| 7 | Check if the mobile menu works | QA |
| 8 | Fill out the contact form and verify success message | QA |
| 9 | Find all accessibility issues on this page | Accessibility consultant |
| 10 | Take a screenshot, tell me what's wrong | Designer |

**Tier 2 — Complex tasks (5 scenarios):**

| # | Scenario | User Type |
|---|----------|-----------|
| 11 | Navigate to blog editor, change to markdown mode, screenshot split view | Developer |
| 12 | Go through checkout flow, verify each step renders correctly | QA |
| 13 | Check dark mode on 5 different pages | Designer |
| 14 | Audit the blog editor at mobile, verify toolbar buttons are tappable | Developer |
| 15 | Compare this page's SEO metadata against a competitor | Marketing |

### Metrics Per Scenario

| Metric | How Measured | Why It Matters |
|--------|-------------|----------------|
| Total wall time | process.hrtime start to finish | Speed |
| AI thinking time | time between tool return and next call | Overhead |
| Token consumption | count input + output tokens | Context cost |
| Accuracy | findings vs known issues | Correctness |
| Completeness | issues found / total real issues | Coverage |
| False positives | reported issues that aren't real | Noise |
| Steps taken | tool calls or CLI commands | Efficiency |
| Human intervention | did AI get stuck? | Reliability |

### Comparison Matrix

Every scenario runs through 5 approaches:

| Approach | Description |
|----------|-------------|
| A. Current MCP (step-by-step) | AI uses pool_launch → navigate → click → screenshot one at a time |
| B. Current CLI (commands) | AI runs bash commands: screenshot, audit, etc. |
| C. New workflow CLI | `playwright-pool inspect` with --steps and --intent |
| D. New MCP workflow_inspect | Single MCP tool call with steps + intent |
| E. Sub-agent dispatch | AI dispatches sub-agent with system prompt, sub-agent uses CLI |

### Expected Results

```
SCENARIO 14: "Audit blog editor at mobile, verify toolbar tappable"

Approach      | Time  | Tokens | Steps | Found | Accuracy | Stuck?
──────────────┼───────┼────────┼───────┼───────┼──────────┼───────
A. MCP step   | 105s  | 28,000 | 7     | 3/5   | 60%      | No
B. CLI cmds   | 18s   | 200    | 6     | 4/5   | 80%      | No
C. Workflow   | 7s    | 150    | 1     | 5/5   | 100%     | No
D. MCP inspect| 12s   | 800    | 1     | 5/5   | 100%     | No
E. Sub-agent  | 25s   | 1,200  | 1     | 5/5   | 100%     | No
```

### Autoresearch Optimization Loop

After baseline benchmarks, use the Karpathy Loop:

1. Run all 15 scenarios, get baseline scores
2. Identify worst-performing scenario per approach
3. Hypothesize one improvement
4. Implement it
5. Re-run benchmarks
6. Keep if improved, revert if not
7. Repeat

**Stopping criteria:**
- All scenarios complete in under 30 seconds (approach C or D)
- Token usage under 500 per scenario (CLI)
- Accuracy at 90%+ on all scenarios
- Zero "stuck" scenarios

### Test Pages Needed

| Scenarios | Test Page |
|-----------|-----------|
| 1-2, 10 | Existing test-page-easy.html |
| 3 | New: page with 5 broken + 5 working images |
| 4 | New: product page with correct and incorrect prices |
| 5 | Same page served at two URLs with differences |
| 6 | Existing test-page-nuanced.html |
| 7 | New: page with hamburger menu that opens/closes |
| 8 | New: contact form with success/error states |
| 9 | Existing test-page-hard.html |
| 11-14 | Real EEG blog editor pages |
| 15 | Two real sites for comparison |

### CI Integration

After each code change:
1. Run Tier 1 scenarios (10) via approach C
2. Compare against baseline (Welch's t-test)
3. Flag regression in time, accuracy, or tokens
4. Block merge if regression detected

---

## Implementation Notes

### File Structure

```
cli-commands/
  interact.js    — Module A: navigate + click + fill + wait
  inspect.js     — Module B: intent-driven analysis + screenshots
  workflow.js    — Composition: interact → inspect (existing, to be refactored)
```

### Intent Mapping

```javascript
const INTENT_MAP = {
  'does this look right': ['layout', 'overflow', 'contrast', 'spacing', 'images', 'headings'],
  'check mobile': ['overflow', 'tap_targets', 'responsive', 'text_wrap'],
  'check accessibility': ['a11y', 'contrast', 'focus_order', 'tap_targets', 'alt_text', 'labels'],
  'check seo': ['meta', 'headings', 'og_tags', 'canonical', 'broken_links'],
  'check performance': ['web_vitals', 'image_sizes', 'fonts', 'third_party'],
  'full audit': ['all'],
  // Fuzzy matching for natural language intents
};
```

### Golden Profile Auth for CLI

The interact module must use the auth overlay pattern from server.js:
1. Create fresh Chromium profile
2. Overlay 13 auth files from golden profile
3. Launch persistent context with overlaid profile
4. This enables headless authenticated workflows

### Single-Pass DOM Collection

Instead of 28 separate `page.evaluate()` calls, ONE call collects everything:

```javascript
const domData = await page.evaluate(() => {
  // Collect ALL data in one pass:
  // - every element's bounding rect
  // - computed styles (color, bg, font, padding, margin, z-index)
  // - all images with alt, src, dimensions
  // - all interactive elements
  // - all headings, meta tags, links
  // - text content
  return { elements, images, headings, meta, links, forms, ... };
});

// Then process in Node.js — fast, no browser round-trips
const issues = analyzeForIntent(domData, intent, systemPrompt);
```

### Parallel Screenshots

```javascript
// Capture all breakpoints in parallel
const breakpoints = [
  { width: 1280, height: 800, label: 'desktop' },
  { width: 768, height: 1024, label: 'tablet' },
  { width: 375, height: 812, label: 'mobile' },
];

// Sequential resize + screenshot (can't truly parallelize on one page)
// But much faster than separate CLI calls
for (const bp of breakpoints) {
  await page.setViewportSize({ width: bp.width, height: bp.height });
  await page.screenshot({ path: `${savePath}/${bp.label}.png` });
}
```

---

## Current Benchmark Data

From head-to-head testing (2026-03-25):

### Speed

| Operation | playwright-pool CLI | @playwright/mcp | agent-browser |
|-----------|:---:|:---:|:---:|
| Headless eval | 1.2s | 1.2s | N/A |
| Headed eval | 1.7s | 1.8s | 0.6s |
| Full workflow (navigate→login→click→screenshot→audit) | **7.1s** | N/A | N/A |
| Same workflow via MCP | **105s** | Similar | N/A |

### Token Usage

| Approach | Tokens per operation |
|----------|:---:|
| MCP browser_navigate (full snapshot) | ~28,000 |
| MCP snapshot_compact | ~1,375 |
| CLI (file path only) | ~20 |

### Accuracy

- 100% on 80 planted UI bugs across 5 test pages
- Journey: 78% → 89% → 100% through autoresearch iteration
- 28 audit checks covering accessibility, visual, SEO, performance, security, interaction

---

## Success Criteria

1. **Speed:** Any scenario completes in under 30 seconds via the new workflow
2. **Tokens:** Under 500 tokens per scenario via CLI, under 2,000 via MCP
3. **Accuracy:** 90%+ on all test scenarios
4. **Reliability:** Zero "stuck" scenarios — the system handles obstacles automatically
5. **Flexibility:** Works for any intent, not just web dev auditing
6. **Competitive:** Faster than @playwright/mcp and agent-browser for equivalent tasks
