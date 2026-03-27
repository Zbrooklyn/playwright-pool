# Playwright Pool — Milestone Checklist

**Last updated:** 2026-03-26
**Current version:** v4.1.0
**Target version:** v5.0.0 (launch)

---

## Current Scores

| Benchmark | Code Only | Code + Vision | Competitor Best |
|-----------|:---------:|:------------:|:---------------:|
| axe-core top 20 | **100%** | 100% | axe-core: 100% |
| Accessible University (22) | **95.5%** (21/22) | **100%** (22/22) | SortSite: ~40% |
| W3C BAD (19 criteria) | **~75%** | **~90%** | — |
| UK GDS (142 cases) | TBD | TBD | SortSite: 40% |

---

## PHASE A: ACCURACY

### [x] Milestone 1: Fix remaining code gaps
> **Status: COMPLETE** (2026-03-26)

1. [x] Add abbreviation detection
2. [x] Fix nav menu selector (broadened to `#menu ul`, `[id*="menu"] ul ul`, etc.)
3. [ ] Add form submission error testing (deferred — needs Milestone 2)

Moved code-only score from 82% to **95.5%** on AU.

### [x] Milestone 5: Fix inspect-engine.js parity with audit.js
> **Status: COMPLETE** (2026-03-26)

- inspect-engine now uses audit.js functions when intent is "full audit" or "accessibility"
- Went from **0 issues** to **80+ issues** on W3C BAD, **101 issues** on AU
- Falls back to simple analyzers for quick/lightweight intents
- Auto-generates `vision-review.json` with prompt + screenshot paths for vision dispatch
- Tested on fresh site (Space Jam 1996) — 22 issues, 0 false positives

### [ ] Milestone 2: Keyboard simulation testing
> **Status: PENDING** | **Est: ~60 min** | **Blocks: #17**

The biggest remaining lever. Build automated keyboard testing:
1. [ ] Tab cycling — Tab through all interactive elements, track `document.activeElement`, detect keyboard traps (focus doesn't move)
2. [ ] Widget interaction — on nav menus: test Enter/Space opens submenu, Arrow Down navigates items, Escape closes
3. [ ] Modal focus trap — verify focus stays within modal when open, Escape closes
4. [ ] Form keyboard access — verify all form fields reachable by Tab, submit via Enter

This is what Deque charges enterprise prices for. We'd be the first free open-source tool to automate this. Adds ~3% coverage.

### [x] Milestone 3: Finalize vision prompt
> **Status: COMPLETE** (2026-03-26)

A/B tested 5 vision prompt variants on AU (22 known issues):
- **V2 (Broad Categories) WON**: 82% vision-only (18/22)
- V5 Hybrid: 77%, V1 Expert Panel: 73%, V3 WCAG Walk: 50%, V4 Targeted: 18%
- Created V6 production prompt (V2 breadth + V1 authority)
- Updated visual-audit skill with combined programmatic + vision pipeline
- Key insight: "Be exhaustive, flag everything" beats systematic WCAG walk-through by 1.6x

---

## PHASE B: VALIDATION

### [ ] Milestone 4: Complete benchmark validation (6 phases)
> **Status: PENDING** | **Est: ~90 min** | **Blocked by: #10, #12** (now unblocked)

| Phase | Benchmark | Status | Score |
|-------|-----------|--------|-------|
| 1 | W3C BAD (4 pages) | Done (needs re-run with fixes) | ~75% code, ~90% code+vision |
| 2 | Accessible University (22 issues) | Done (needs final confirmation) | 95.5% code, 100% code+vision |
| 3 | axe-core top 20 rules | **DONE** | **100%** |
| 4 | 5 real websites | NOT STARTED | — |
| 5 | VisualWebBench (50 samples) | NOT STARTED | — |
| 6 | UK GDS 142 test cases | Ran once, needs scoring | TBD (beat SortSite's 40%) |

---

## PHASE C: DIFFERENTIATION

### [ ] Milestone 5: Fix inspect-engine.js parity with audit.js
> **Status: PENDING** | **Est: ~30 min** | **Blocks: #17**

Critical gap: inspect-engine.js found 0 issues on W3C BAD while audit.js found 87.

Options:
- A) Port all 35 audit checks from audit.js into analyzers.js (big refactor)
- B) Have inspect-engine call audit.js functions directly (integration)
- **C) Make CLI inspect delegate to audit.js when intent="full audit" (fastest)**

### [ ] Milestone 6: Multi-page audit support
> **Status: PENDING** | **Est: ~60 min**

WCAG criteria requiring cross-page comparison:
- 3.2.4 Consistent Identification
- 2.4.5 Multiple Ways
- 3.2.3 Consistent Navigation

Build multi-page audit mode: accept multiple URLs or sitemap, run audit on each, compare findings across pages. No competitor does this.

---

## PHASE D: OPTIMIZE & SHIP

### [ ] Milestone 7: Performance & optimization
> **Status: PENDING** | **Est: ~45 min** | **Blocked by: #13**

1. [ ] Vision prompt token optimization (4K → 2K output tokens)
2. [ ] Selective vision dispatch (skip if all checks pass programmatically)
3. [ ] Parallel audit execution (27 audits concurrently)
4. [ ] Caching (hash-based, skip unchanged pages)
5. [ ] Target: full audit in <10 seconds (currently ~30s)

### [ ] Milestone 8: Distribution & launch
> **Status: PENDING** | **Blocked by: #10, #11, #12, #13, #14**

1. [ ] Update README with benchmark scores
2. [ ] npm publish (name "playwright-pool" secured)
3. [ ] GitHub release v5.0.0
4. [ ] Submit to awesome-mcp-servers, mcp.so, mcpservers.org
5. [ ] Write DEV.to article: "How we built an accessibility tool that beats axe-core"
6. [ ] Post on Reddit r/ClaudeAI, r/webdev, Hacker News
7. [ ] Create social preview image with benchmark comparison
8. [ ] Record demo video of code+vision pipeline

### [ ] Milestone 9: Known bugs & tech debt
> **Status: PENDING** | **Est: ~30 min**

1. [ ] CLI headless auth doesn't work (Google OAuth blocks headless golden profile)
2. [ ] Competitor benchmark matching still broken (Pa11y/axe show 0%)
3. [ ] 2 remaining stub audits: loading_states, print_layout
4. [ ] ROADMAP.md outdated (still says v4.0.0)
5. [ ] vision-prompt-variants.json needs 5 new WCAG variants added

---

## Dependency Graph

```
#10 Fix code gaps ────────┐
                          ├──→ #13 Benchmark validation ──→ #16 Performance
#12 Finalize vision ──────┘         │
                                    │
#11 Keyboard simulation ────────────┤
                                    │
#14 Inspect-engine parity ──────────┤
                                    │
                                    └──→ #17 Distribution & launch
```

## Research References

- UK GDS tool audit: https://alphagov.github.io/accessibility-tool-audit/
- Deque automated coverage: 57.38% (semi-automated IGT: 80.39%)
- axe-core scored 29% on GDS test, SortSite scored 40%
- 0/13 tools caught "color alone conveys content" — our vision model catches it
- Vision prompt A/B results: `tests/vision-prompt-variants.json` + `tests/vision-prompt-production.md`
