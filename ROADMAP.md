# Playwright Pool — Roadmap

## Current State (v4.0.0)

### Shipped

| Category | Count | Status |
|----------|-------|--------|
| Pool management tools | 4 | pool_launch, pool_close, pool_list, pool_switch |
| Browser tools (from @playwright/mcp) | 35 | All core, vision, PDF, tracing, testing tools |
| UI audit tools | 27 | Accessibility, contrast, breakpoints, tap targets, web vitals, images, fonts, computed styles, overflow, dark mode, meta/SEO, visual diff, focus order, interactive states, spacing, z-index, broken links, loading states, form validation, print layout, scroll behavior, element overlap, security headers, mixed content, third-party scripts, cookie compliance, lighthouse scoring |
| CLI commands | 42 | 100% MCP parity + benchmark + accuracy + compare |
| `audit visual` | 1 | Comprehensive programmatic UI report |
| **Total MCP tools** | **67** | |

### Accuracy
- 100% on 80 planted bugs across 5 test pages (easy/medium/hard/nuanced/interaction)
- Journey: 78% → 89% → 100% through autoresearch iteration

### Infrastructure
- Benchmark tool with smart matrix, Welch's t-test, regression detection
- Autoresearch Karpathy Loop (`/autoresearch` skill)
- Accuracy scoring tool (planted bugs + answer key)
- Competitor comparison tool (vs Lighthouse, Pa11y, axe-core)
- 210 browser audit scenarios researched and documented

---

## Benchmark Results

### Speed comparison (eval -- navigate to page, get title)

| Tool | Headless | Headed |
|:-----|:--------:|:------:|
| playwright-pool CLI | 1.2s | 1.7s |
| @playwright/mcp (raw Playwright) | 1.2s | 1.8s |
| agent-browser | N/A | 0.6s |

playwright-pool adds zero overhead vs raw Playwright. agent-browser is faster for headed navigation because it reuses an already-running Chrome instance.

### Token usage comparison (GitHub repo page -- complex)

| Approach | Tokens |
|:---------|:------:|
| MCP `browser_navigate` (full snapshot) | ~28,000 tokens (112KB) |
| MCP `snapshot_compact` | ~1,375 tokens (5.5KB) |
| CLI screenshot (file path only) | ~20 tokens |
| CLI snap (file path only) | ~20 tokens |

`snapshot_compact` uses 20x fewer tokens than a full `browser_snapshot`. CLI commands return only a file path, using virtually zero context tokens.

### Recommendations

- **MCP** -- interactive work: clicking, navigating, reacting to page state. Use `snapshot_compact` instead of `browser_snapshot` for 20x fewer tokens.
- **CLI** -- audits, screenshots, bulk operations. One command, minimal context tokens.
- **`snapshot_compact`** -- always prefer over `browser_snapshot` unless you need the full DOM tree.
- First `pool_launch` has ~17s overhead (template creation). Subsequent operations are fast.

---

## Next: Scenario Coverage Expansion

Currently covering ~50 of 210 documented browser audit scenarios. Priority expansion areas:

### High Priority
- **Full Lighthouse integration** — real Lighthouse scores, not our approximation
- **Schema.org / JSON-LD validation** — structured data for rich snippets
- **Design-to-mockup comparison** — overlay implementation against design file
- **Placeholder/debug content detection** — find "Lorem ipsum", "TODO", test data
- **HTML validation** — W3C compliance
- **Console error audit** — zero-error check across all pages

### Medium Priority
- **E-Commerce scenarios** — product schema, price verification, cart testing
- **i18n/L10n** — RTL layout, locale formatting, text expansion
- **Functional QA** — full E2E flow testing, search, pagination
- **DevOps** — analytics tracking verification, CDN checks, SSL monitoring
- **Cross-browser** — Firefox/WebKit rendering comparison

### Lower Priority
- **Progressive enhancement** — works without JS
- **PWA compliance** — manifest, service worker, installable
- **WebSocket inspection** — real-time connection testing
- **Memory leak detection** — heap snapshot comparison
- **Container query behavior** — emerging CSS features

---

## Next: Performance Optimization

- Continue autoresearch speed cycles (2 done, ~45% faster so far)
- Headed vs headless benchmarks across all operations
- Concurrency optimization for 10+ simultaneous browsers
- Network throttling benchmarks (3G, 4G)
- Target: full audit suite in under 10 seconds

---

## Next: Distribution

- [ ] Fix npm package name (remove `@anthropic-tools` scope)
- [ ] npm publish
- [ ] Create GitHub release (v4.0.0)
- [ ] Submit to awesome-mcp-servers directory
- [ ] Submit to mcp.so, mcpservers.org
- [ ] Create social preview image
- [ ] Write DEV.to article
- [ ] Post on Reddit r/ClaudeAI, Hacker News

---

## Competitive Positioning

| Feature | Playwright Pool | @playwright/mcp | Lighthouse | Pa11y | axe-core |
|---------|:-:|:-:|:-:|:-:|:-:|
| MCP integration | Native | Native | None | None | None |
| Browser pooling | Dynamic, unlimited | 1 per config | N/A | N/A | N/A |
| Auth sharing (golden profile) | Yes | No | No | No | No |
| Cross-session isolation | UUID-based | No | N/A | N/A | N/A |
| Accessibility audit | 27 checks | None | ~15 checks | ~50 WCAG rules | ~80 rules |
| Visual audit (spacing, overlap, z-index) | Yes | No | No | No | No |
| Performance audit | Web vitals, fonts, images | No | Full Lighthouse | No | No |
| SEO audit | Meta, headings, OG, links | No | Basic SEO | No | No |
| Security audit | Headers, CSP, mixed content, cookies | No | Basic HTTPS | No | No |
| Interactive state audit | Hover, focus, form validation | No | No | No | No |
| CLI tool | 42 commands | Limited | CLI available | CLI available | CLI available |
| Accuracy on planted bugs | 100% (80/80) | N/A | TBD | TBD | TBD |
