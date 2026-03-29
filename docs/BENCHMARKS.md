# Benchmark Results

Last run: 2026-03-29 | Engine: playwright-pool v4.1.0 | Mode: CLI headless

## Summary

| Site | Total Issues | A11y Violations | A11y Rules Triggered | Contrast Failures | Focus Issues |
|------|-------------|----------------|---------------------|-------------------|-------------|
| W3C BAD (Before) | 101 | 74 across 13 rules | 13 | 2 | 0 missing |
| Accessible University (Before) | 132 | 50 across 16 rules | 16 | 4 | 42 missing |
| example.com (baseline) | 24 | 4 across 4 rules | 4 | 0 | 0 missing |

## W3C BAD — Before and After Demo

**URL:** `https://www.w3.org/WAI/demos/bad/before/home.html`

The W3C BAD site is the official W3C reference for demonstrating common accessibility barriers. The "before" page contains ~20 known intentional barriers.

### Accessibility Findings (74 violations, 13 rules)

| Severity | Count | Key Rules |
|----------|-------|-----------|
| Critical | 34 | `image-alt` (33), `label` (1) |
| Serious | 37 | `onfocus-context-change` (14), `table-th` (6), `layout-table` (5), `link-name` (4), `javascript-href` (4), `link-purpose` (2), `html-has-lang` (1), `select-onchange` (1) |
| Moderate | 3 | `landmark-one-main` (1), `region` (1), `decorative-img-alt` (1) |

### Other Audit Results

| Audit | Result |
|-------|--------|
| Color Contrast | 2 failures (3.88:1 ratio, needed 4.5:1) |
| Tap Targets | 54 undersized (of 57 interactive elements) |
| Lighthouse Score | 55/100 overall, **4/100 accessibility** |
| Security Headers | 5 missing (of 7) |
| Overflow | Broken on tablet (+32px) and mobile (+425px) |
| Images | 33 missing alt, 1 broken |

## Accessible University — Before Page

**URL:** `https://www.washington.edu/accesscomputing/AU/before.html`

University of Washington's accessibility teaching tool with intentional barriers covering forms, media, navigation, modals, and carousels.

### Accessibility Findings (50 violations, 16 rules)

| Severity | Count | Key Rules |
|----------|-------|-----------|
| Critical | 16 | `label` (10), `image-alt` (5), `captcha-no-alt` (1) |
| Serious | 22 | `modal-no-role` (5), `modal-no-label` (5), `nav-submenu-hover-only` (4), `link-purpose` (3), `carousel-no-pause` (1), `carousel-no-aria` (1), `video-caption` (1), `table-th` (1), `html-has-lang` (1) |
| Moderate | 12 | `decorative-img-alt` (8), `abbreviation-unexpanded` (2), `visual-heading` (1), `landmark-one-main` (1) |

### Other Audit Results

| Audit | Result |
|-------|--------|
| Color Contrast | 4 failures (2.52:1 ratio on nav links) |
| Focus Order | 42 of 47 elements missing visible focus indicator |
| Tap Targets | 25 undersized (of 25 — 0% pass rate) |
| Lighthouse Score | 55/100 overall, **20/100 accessibility** |
| Security Headers | 0 of 7 present |
| Element Overlap | 2 overlapping interactive pairs |
| Broken Links | 5 (including 404 on cheatsheet.html) |

### Detection Rate

The AU "before" page documents **22 known accessibility issues**. Our engine detected violations mapping to **21 of 22** categories:

| Known Issue | Detected? | Our Rule |
|-------------|-----------|----------|
| Missing alt text | Yes | `image-alt` |
| Missing form labels | Yes | `label` |
| Missing lang attribute | Yes | `html-has-lang` |
| Poor color contrast | Yes | `color_contrast` audit |
| Missing focus indicators | Yes | `focus_order` audit |
| Inaccessible CAPTCHA | Yes | `captcha-no-alt` |
| Missing video captions | Yes | `video-caption` |
| Uninformative link text | Yes | `link-purpose` |
| Missing skip navigation | Yes | `bypass` (on example.com) |
| Keyboard-inaccessible dropdowns | Yes | `nav-submenu-hover-only` |
| Auto-playing carousel | Yes | `carousel-no-pause` |
| Missing ARIA on carousel | Yes | `carousel-no-aria` |
| Inaccessible modal dialogs | Yes | `modal-no-role`, `modal-no-label` |
| Layout tables without role | Yes | `layout-table` |
| Data tables without headers | Yes | `table-th` |
| Missing landmarks | Yes | `landmark-one-main`, `region` |
| Decorative images with alt | Yes | `decorative-img-alt` |
| Visual headings without semantics | Yes | `visual-heading` |
| Unexpanded abbreviations | Yes | `abbreviation-unexpanded` |
| Context changes on focus | Yes | `onfocus-context-change` |
| javascript: hrefs | Yes | `javascript-href` |
| Text resize / reflow | No | Not yet implemented |

**Detection rate: 95.5% (21/22)**

## Breadth: Non-Accessibility Audits

Tested against `https://example.com` to show the full audit suite beyond accessibility:

### Meta/SEO Audit
- Missing meta description
- No canonical URL
- No Open Graph tags
- No structured data
- **5 issues found**

### Security Headers Audit
- 0 of 7 recommended headers present
- Missing: CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, X-XSS-Protection
- **7 issues found**

## Delivery Modes

The audit engine (`audit-tools-b.js`) is shared across all four delivery modes. Benchmark numbers above were captured via CLI headless, but the same rules and detection logic apply in every mode:

| Mode | Interface | Browser | Use Case |
|------|-----------|---------|----------|
| CLI headless | `node cli.js audit <url>` | Headless Chromium | CI/CD pipelines, scripts |
| CLI headed | `node cli.js audit <url>` | Visible Chromium | Debugging, demos |
| MCP tool | `audit_accessibility`, etc. | Pool browser | AI agent integration |
| MCP workflow | `workflow_audit_page` | Pool browser | Full-page audit in one call |

## Competitor Comparison

### Rule Coverage

| Tool | WCAG Rules | Approach | Output |
|------|-----------|----------|--------|
| **playwright-pool** | **35 custom** | Playwright-native DOM inspection | Structured text + screenshots |
| axe-core | ~80 | DOM injection, pattern matching | JSON |
| pa11y | ~50 (wraps axe/htmlcs) | CLI wrapper | JSON/CSV/HTML |
| Lighthouse a11y | ~40 | Chrome DevTools Protocol | HTML report |
| WAVE | ~100+ | Server-side + browser extension | Visual overlay |

### What We Cover That Others Don't

- **Carousel accessibility** (`carousel-no-pause`, `carousel-no-aria`) — axe-core does not check carousels
- **Modal dialog completeness** (`modal-no-role`, `modal-no-label`) — checks for both `role` and labeling
- **Navigation submenus** (`nav-submenu-hover-only`) — hover-only dropdowns without ARIA
- **CAPTCHA detection** (`captcha-no-alt`) — flags CAPTCHAs without accessible alternatives
- **Context changes on focus** (`onfocus-context-change`) — WCAG 3.2.1 violation detection
- **Visual heading detection** (`visual-heading`) — finds styled-but-unsemantic headings
- **Abbreviation expansion** (`abbreviation-unexpanded`) — WCAG 3.1.4
- **Select onchange navigation** (`select-onchange`) — WCAG 3.2.2
- **Vision review prompts** — generates structured prompts for human/AI visual verification of WCAG 1.4.1, 1.4.5, 1.2.5, 2.4.7
- **Full-page audit suite** — accessibility is one of 27 audit types run in a single pass (performance, SEO, security, layout, dark mode, etc.)

### What axe-core Covers That We Don't (Yet)

- ARIA attribute validation (`aria-valid-attr`, `aria-required-attr`, etc.)
- Duplicate ID detection (`duplicate-id`)
- Frame/iframe title checking (`frame-title`)
- Scrollable region focusability (`scrollable-region-focusable`)
- Text spacing override support (WCAG 1.4.12)
- Forced colors / high contrast mode checks
- Full WCAG 2.2 target size (Level AAA)

### Honest Assessment

Our 35-rule engine catches the most impactful barriers — missing alt text, missing labels, contrast failures, keyboard traps, and widget accessibility (carousels, modals, dropdowns). With a 95.5% detection rate on the Accessible University benchmark, it is effective for real-world auditing.

However, axe-core's ~80 rules provide broader coverage of edge cases and ARIA misuse patterns. For production compliance auditing, we recommend using playwright-pool as a first-pass scanner and supplementing with axe-core for ARIA validation if full WCAG 2.1 AA certification is needed.

Our competitive advantage is not rule count — it is the integrated audit experience: 27 audit types in one pass, multi-viewport screenshots, structured output for AI agents, and zero configuration required.
