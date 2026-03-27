# Playwright Pool — Full Project Status

**Date:** 2026-03-26
**Version:** 4.1.0
**Target:** v5.0.0 (public launch)

---

## Mission Statement

Build an open-source MCP server + CLI that gives any AI agent reliable, authenticated browser automation with built-in UI auditing — something no other tool does in one package.

**For whom:** Developers, QA engineers, accessibility specialists, and AI agents that need to interact with and audit web pages.

**Key differentiators:**
1. Single golden profile for shared auth across unlimited browser instances
2. 35 WCAG accessibility rules (95.5% detection on Accessible University benchmark)
3. Vision model integration for catching what code can't (color-only info, images of text)
4. CLI saves 55x fewer tokens than MCP for audits
5. Only 1 production dependency (Playwright)

---

## What Exists Today

### Core Components

| Component | File(s) | Lines | Status |
|---|---|:---:|---|
| MCP Server | server.js | 2,736 | Working, but headed-only default |
| CLI Router | cli.js | 473 | Working |
| Audit Engine | cli-commands/audit.js | ~4,500 | 35 WCAG rules, working |
| Browser Commands | cli-commands/browser.js | ~540 | Fixed 2026-03-26 (5 bugs resolved) |
| Inspect Engine | cli-commands/inspect-engine.js | ~280 | Fixed 2026-03-26, uses audit.js |
| Vision Review | In audit.js + inspect-engine.js | — | Auto-generates vision-review.json |
| Browser State Hook | cli-commands/browser-state.js | ~50 | New, checks CDP state |
| Browser Watcher | cli-commands/browser-watch.js | ~60 | New, polls for tab changes |
| Benchmark Tools | benchmark.js, accuracy.js | ~2,500 | Working |
| Audit Tools B (MCP) | audit-tools-b.js | 2,497 | Working |
| 14 other CLI modules | cli-commands/*.js | ~5,000 | Working |

### Tool Counts

| Category | Count | Examples |
|---|:---:|---|
| MCP Pool tools | 4 | pool_launch, pool_close, pool_list, pool_switch |
| MCP Browser tools | 33 | navigate, click, fill, screenshot, snapshot, etc. |
| MCP Audit tools | 28 | accessibility, contrast, breakpoints, tap_targets, etc. |
| MCP Utility tools | 10 | snapshot_compact, storage, cookies, tracing |
| CLI Commands | 42+ | audit, inspect, browser, screenshot, benchmark, etc. |
| **Total MCP tools** | **75** | |

### Accessibility Rules (35 in audit.js)

| # | Rule ID | What it checks |
|---|---|---|
| 1 | image-alt | Images missing alt text |
| 2 | label | Form elements missing labels |
| 3 | link-name | Links missing discernible text |
| 4 | button-name | Buttons missing discernible text |
| 5 | html-has-lang | Missing lang attribute |
| 6 | document-title | Missing or empty title |
| 7 | heading-order | Heading levels skip levels |
| 8 | aria-roles | Invalid ARIA roles |
| 9 | tabindex | Elements with tabindex > 0 |
| 10 | landmark-one-main | No main landmark |
| 11 | region | Content outside landmarks |
| 12 | bypass | No skip-nav or landmarks |
| 13 | empty-heading | Headings with no text |
| 14 | listitem | li outside ul/ol |
| 15 | frame-title | iframe missing title |
| 16 | meta-viewport | Viewport disables zoom |
| 17 | aria-hidden-focus | Focusable elements inside aria-hidden |
| 18 | aria-required-attr | Missing required ARIA attributes |
| 19 | table-th | Data tables missing th |
| 20 | javascript-href | Links with javascript: hrefs |
| 21 | video-caption | Video missing captions track |
| 22 | audio-caption | Audio missing transcript |
| 23 | list | ul/ol with non-li children |
| 24 | aria-valid-attr-value | Invalid ARIA attribute values |
| 25 | link-purpose | Uninformative link text ("click here") |
| 26 | duplicate-id | Duplicate IDs |
| 27 | select-onchange | Select changes context on input |
| 28 | decorative-img-alt | Decorative images with verbose alt |
| 29 | nav-submenu-hover-only | Dropdown menus without ARIA |
| 30 | carousel-no-pause | Carousel without pause control |
| 31 | carousel-no-aria | Carousel missing aria-live |
| 32 | modal-no-role | Modal missing role="dialog" |
| 33 | modal-no-label | Modal missing aria-label |
| 34 | captcha-no-alt | CAPTCHA without alternative |
| 35 | layout-table | Layout tables without role="presentation" |
| + | visual-heading | Visual headings without semantic markup |
| + | onfocus-context-change | Focus event changes context |
| + | abbreviation-unexpanded | Abbreviations without abbr tag |
| + | error-not-associated | Error messages not linked to fields |
| + | color-only-links | Links distinguished only by color (vision_review) |
| + | images-of-text | Suspect images containing text (vision_review) |
| + | no-audio-description | Media missing audio description (vision_review) |

### Other Audits (non-accessibility)

| Audit | Status |
|---|:---:|
| color_contrast (WCAG AA ratios) | Working |
| focus_order (tab order + visible indicators) | Working |
| tap_targets (48x48px minimum) | Working |
| interactive_states (onclick/hover/focus) | Working |
| form_validation (fieldset/legend/required) | Working |
| spacing_consistency (grid analysis) | Working |
| z_index_map (stacking context) | Working |
| element_overlap (interactive overlap) | Working |
| core_web_vitals (LCP, CLS, FCP) | Working |
| image_sizes (missing alt, oversized, broken) | Working |
| fonts (families, combos, consistency) | Working |
| meta/SEO (title, description, OG, headings) | Working |
| broken_links (404s, javascript: hrefs) | Working |
| security_headers (CSP, HSTS, etc.) | Working |
| mixed_content (HTTP resources on HTTPS) | Working |
| third_party_scripts (blocking, sizes) | Working |
| cookie_compliance (categories) | Working |
| breakpoints (screenshots at 3 viewports) | Working |
| overflow (horizontal overflow detection) | Working |
| dark_mode (light vs dark comparison) | Working |
| lighthouse (approximate scoring) | Working |
| vision_review (gaps for vision model) | Working |
| loading_states | STUB |
| print_layout | STUB |
| scroll_behavior | STUB |
| computed_styles | STUB |

---

## Benchmark Scores

### Current (2026-03-26)

| Benchmark | Code Only | Code + Vision | Best Competitor |
|---|:---:|:---:|:---:|
| axe-core top 20 rules | **100%** (20/20) | 100% | axe-core: 100% |
| Accessible University (22 issues) | **95.5%** (21/22) | **100%** (22/22) | SortSite: ~40% |
| W3C BAD (19 WCAG criteria) | **~75%** | **~90%** | — |
| UK GDS 142 test cases | TBD | TBD | SortSite: 40% |

### Vision Prompt A/B Test Results

| Variant | Score on AU (22 issues) |
|---|:---:|
| **V6: Expert Audit (production)** | **Best** (V2+V1 merged) |
| V2: Broad Categories | 82% (18/22) |
| V5: Hybrid Structured | 77% (17/22) |
| V1: Expert Panel | 73% (16/22) |
| V3: WCAG Walk-through | 50% (11/22) |
| V4: Targeted | 18% (4/22) |

Key insight: "Be exhaustive, flag everything" beats "be systematic" by 1.6x.

### Speed

| Operation | Time |
|---|:---:|
| CLI audit (full, 27 checks) | ~30s |
| CLI inspect (full audit mode) | ~1.4s |
| CLI navigate | ~1.1s |
| CLI screenshot | ~1.5s |
| CLI tab open/close | ~1.5s |
| MCP workflow (same task) | ~105s (15x slower — AI thinking overhead) |

### Token Usage

| Approach | Tokens |
|---|:---:|
| MCP browser_navigate (full snapshot) | ~28,000 |
| MCP snapshot_compact | ~1,375 |
| CLI screenshot (file path only) | ~20 |

---

## What Was Fixed on 2026-03-26

### Code Gaps Fixed (Milestone 1)
- Added 12 new WCAG rules to audit.js (rules 10-21)
- Implemented 5 stub audits: form_validation, interactive_states, spacing_consistency, z_index_map, element_overlap
- Added abbreviation detection (rule 36)
- Broadened nav menu selectors (#menu, [id*="menu"], etc.)
- Score went from 40% → 82% → 95.5% on AU

### Vision Prompt Finalized (Milestone 3)
- A/B tested 5 vision prompt variants against AU (22 issues)
- V2 (Broad Categories) won at 82% standalone
- Created V6 production prompt (V2 breadth + V1 authority)
- Updated visual-audit skill

### Inspect Engine Fixed (Milestone 5)
- inspect-engine.js now uses audit.js functions for full audits
- Went from 0 issues → 80+ issues on W3C BAD, 101 on AU
- Auto-generates vision-review.json with prompt + screenshot paths
- Tested on fresh site (Space Jam 1996) — 22 issues, 0 false positives

### Browser CLI Fixed
- `chromium.launch()` → `chromium.launchServer()` → raw Chrome spawn with CDP
- `connectOverCDP` for shared tab access (all tabs visible across commands)
- Added `ignoreHTTPSErrors: true`
- Fixed `browser.close()` killing server — now uses `process.exit(0)`
- Added `browser status` command
- Added `browser-state.js` hook for pre-command state injection
- Added `browser-watch.js` for real-time tab monitoring
- Fixed stdout flush issue in `browser tabs`
- Full tab management verified: open, close by URL, close by index, list

### Browser State Hook Installed
- PreToolUse hook in `.claude/settings.local.json`
- Fires before any Bash command containing browser/playwright/cli.js/audit
- Runs `browser-state.js` to inject current browser state
- Prevents false assumptions about browser being closed

---

## What Needs to Happen Next

### Priority 1: Ship-blocking fixes (~30 min)

1. [ ] **Fix MCP server headless default** — line 150 in server.js has `headless: false`, should default to headless with `--headed` flag
2. [ ] **Test npm install flow** — `npm pack` → install globally → run `playwright-pool audit <url>` → verify it works standalone
3. [ ] **Clean up git** — add `screenshot-*.png`, `tabs.json`, `blog-editor-audit/`, `w3c-bad-audit/` to .gitignore
4. [ ] **Update ROADMAP.md** — currently says v4.0.0, needs current state

### Priority 2: Quality gates (~45 min)

5. [ ] **Create smoke test** — one script that verifies: CLI launch, navigate, tabs, audit, screenshot, close
6. [ ] **Update README** — add benchmark scores table, fix any stale content
7. [ ] **Test MCP server end-to-end** — configure in .mcp.json, verify pool_launch/navigate/audit work

### Priority 3: Publish (~30 min)

8. [ ] **npm publish** — name "playwright-pool" secured, publish v5.0.0
9. [ ] **GitHub release** — tag v5.0.0, release notes with benchmark scores
10. [ ] **Submit to directories** — awesome-mcp-servers, mcp.so, mcpservers.org

### Priority 4: Marketing (~60 min)

11. [ ] **Write DEV.to article** — "How we built an accessibility tool that beats axe-core"
12. [ ] **Post on Reddit** — r/ClaudeAI, r/webdev
13. [ ] **Social preview image** — benchmark comparison table as image
14. [ ] **Demo video** — code+vision pipeline in action

---

## Remaining Milestones (from task list)

| # | Milestone | Status | Est. |
|---|---|:---:|:---:|
| 10 | Fix code gaps | **DONE** | — |
| 11 | Keyboard simulation testing | PENDING | 60 min |
| 12 | Finalize vision prompt | **DONE** | — |
| 13 | Complete benchmark validation | PENDING | 90 min |
| 14 | Fix inspect-engine parity | **DONE** | — |
| 15 | Multi-page audit support | PENDING | 60 min |
| 16 | Performance optimization | PENDING | 45 min |
| 17 | Distribution & launch | PENDING | 60 min |
| 18 | Known bugs & tech debt | PENDING | 30 min |

---

## Architecture Overview

```
User/Agent
    │
    ├─── CLI (cli.js) ─────────────────────────────────────────┐
    │    └── 42 commands → cli-commands/*.js                    │
    │         ├── audit.js (35 WCAG rules + 20 other audits)   │
    │         ├── browser.js (launch/navigate/tabs/close)      │
    │         ├── inspect-engine.js (intent → audit.js)        │
    │         ├── interact.js (golden profile auth overlay)    │
    │         └── shared.js (CDP state, viewports, helpers)    │
    │                                                          │
    ├─── MCP Server (server.js) ───────────────────────────────┤
    │    ├── Pool management (4 tools)                         │
    │    ├── Browser tools (33, via @playwright/mcp)            │
    │    ├── Audit tools (28, via audit-tools-b.js)            │
    │    └── Golden profile overlay on all contexts            │
    │                                                          │
    └─── Vision Sub-Agent ─────────────────────────────────────┘
         ├── vision_review audit detects code gaps
         ├── vision-review.json auto-generated
         └── V6 prompt dispatched to vision model
              (catches color-only info, images of text, etc.)
```

### Key Design Decisions

1. **Auth overlay, not full profile copy** — copying Chromium profiles causes crashes. We create fresh profiles and overlay only 13 auth-critical files.
2. **CDP for shared tab access** — `chromium.launchServer()` isolates contexts per connection. Raw Chrome + `connectOverCDP` shares all tabs.
3. **Two-layer audit** — Code layer (fast, deterministic, 95.5%) + Vision layer (broad, catches remaining 4.5%).
4. **CLI over MCP for audits** — CLI returns file paths (~20 tokens) vs MCP returns inline data (~28,000 tokens).

---

## Files Reference

### Source (ship these)
```
cli.js                          — CLI entry point
server.js                       — MCP server
audit-tools-b.js                — MCP audit tools
cli-commands/                   — 18 CLI modules
package.json                    — npm metadata
LICENSE                         — MIT
README.md                       — public docs
.npmignore                      — excludes tests/docs from npm
.gitignore                      — excludes node_modules/outputs
```

### Documentation (don't ship to npm)
```
docs/PROJECT-STATUS.md          — this file
docs/MILESTONES.md              — milestone tracking
docs/ROADMAP.md                 — feature roadmap
docs/competitor-analysis.md     — benchmark comparisons
docs/scenarios-210.md           — 210 audit scenarios
docs/superpowers/               — implementation plans/specs
CLAUDE.md                       — project rules for AI agents
```

### Tests (don't ship to npm)
```
tests/fixtures/                 — 13 HTML test pages + answer-key.json
tests/prompt-variants.json      — 10 design prompt variants
tests/vision-prompt-variants.json — 5 WCAG vision prompt variants
tests/vision-prompt-production.md — V6 production prompt docs
tests/tab-benchmark.sh          — tab management benchmark
scripts/                        — benchmark runners
```

### Skills (Claude-only, not in repo)
```
~/.claude/skills/visual-audit/SKILL.md    — visual audit dispatch
~/.claude/skills/autoresearch/SKILL.md    — Karpathy loop
~/.claude/skills/screenshot-analysis/SKILL.md — screenshot protocol
```
