# Playwright Pool — Handoff

**As of:** 2026-04-22
**Current branch:** `stable`
**Version:** `v4.2.1` (tagged on GitHub — NOT published to npm; internal-first release)

---

## Current State (One Line)

**v4.2.1 tagged and pushed to GitHub. Cold-install verified end-to-end. Globally installed via `npm install -g git+https://github.com/zbrooklyn-claude-labs/playwright-pool.git#v4.2.1`. Other agents should use this same install command.**

---

## What's Done

### Architecture & Code
- **Audit code consolidation complete** — 2,850 lines of duplicated audit logic eliminated
  - `audit-tools-b.js`: 12 handlers now delegate to `cli-commands/audit.js` (was 2497 lines, now 738)
  - `server.js`: 10 inline handlers replaced with delegates (~1,055 lines removed)
  - Single source of truth: `cli-commands/audit.js` `AUDIT_HANDLERS` export
- **Screenshot crash fix** — base64 stripped from MCP responses, images saved to `%TEMP%/playwright-pool-screenshots/`
  - Torture tested: 100 screenshots = 13.4 KB context vs 34.7 MB without fix
  - Without fix crashes at screenshot #56; with fix would need ~153,000
- **Auto-save screenshots on disk** — prevents 20MB+ MCP context bloat

### Testing
- **34 automated tests, 3 tiers, all passing** (run via `npm test` — ~106 seconds)
  - Tier 1 smoke (6 tests): CLI + MCP core loop verification
  - Tier 2 regression (5 tests): Screenshot stripping, no stubs, npm pack cleanliness, SSL
  - Tier 3 unit (23 tests): All 21 audit handlers against example.com
- Test helpers at `tests/helpers.js` — reusable `runCli()` and `runMcpServer()` functions

### Documentation
- `docs/BENCHMARKS.md` — W3C BAD scores, AU 95.5% detection
- `docs/PROJECT-STATUS.md` — comprehensive inventory
- `docs/MILESTONES.md` — milestone tracking
- `CHANGELOG.md` — v4.2.1 release notes
- `README.md` — installation, benchmarks, 4-mode matrix, Known Limitations

### Packaging
- Version bumped `4.1.0` → `1.0.0` for first public release
- `.npmignore` clean — 136KB package, 24 files, no junk
- Global install verified: `playwright-pool --version` → `1.0.0`
- MCP server verified: responds to initialize with tool list

### MCP Configuration
Three servers configured in workspace `.mcp.json`:
- `playwright-browser` — vanilla Microsoft MCP (stable fallback for other agents)
- `playwright-browser-pool` — our globally installed stable version
- `playwright-browser-pool-dev` — live `server.js` from this project (dev)

---

## What's Pending

### Task 9: npm publish (blocked — needs CEO approval)
```bash
cd projects/playwright-pool
npm pack && npm install -g playwright-pool-1.0.0.tgz && rm playwright-pool-1.0.0.tgz
npm publish
git tag v4.2.1
git push origin stable --tags
```

### Task 10: Launch materials
- GitHub release
- Verify public install for new users
- Final README tweaks

---

## Key Decisions

- **Version reset to 1.0.0** (was 4.1.0) — honest first public release
- **Headed mode is default** — users should watch AI work before trusting it headless
- **Google OAuth requires headed** — documented as known limitation; other services work headless
- **Vision model is a CORE feature** — not optional; code+vision verification layer
- **One stable branch + dev branches** — stable is what ships, other work on feature branches
- **audit.js is the single source of truth** — MCP and CLI both delegate to it
- **Node built-in `node:test`** — zero test dependencies
- **Pre-commit hook fixed** — backend `.js` files no longer trigger visual screenshot requirement (only `.html`, `.css`, `.tsx`, `.jsx`, `.vue`, `.svelte` do)

---

## Recent Bugs Fixed (Regression-Tested)

1. CDP reconnection after disconnect — switched from `launchServer()` to raw Chrome spawn with `--remote-debugging-port`
2. Tab isolation — `connectOverCDP` now shares contexts across connections
3. Screenshot 20MB context crashes — base64 stripped from response
4. SSL certificate errors — `ignoreHTTPSErrors: true` on all new contexts
5. `process.exit(0)` vs `browser.close()` — prevents killing shared server
6. Audit stubs on stable branch — 4 "Not yet implemented" responses removed (kept on master for dev)

---

## Session Artifacts

- **Spec:** `docs/superpowers/specs/2026-03-29-playwright-pool-stabilize-ship-design.md`
- **Plan:** `docs/superpowers/plans/2026-03-29-playwright-pool-stabilize-ship.md` (10 tasks)
- **Recent commits:** `git log --oneline -10` on `stable` branch

---

## Known Gotchas

- **MCP servers don't hot-reload** — agents must start new conversations after server changes
- **Running tests on flaky network may show 1 timeout failure** — re-run shows 34/34 pass
- **`master` branch still has 4 audit stubs** (loading_states, print_layout, scroll_behavior, computed_styles) — stable branch has them removed
- **Golden profile auth** — works headed, Google blocks headless (anti-bot detection)

---

## Next Session Entry Points

**If resuming to publish:**
```bash
cd projects/playwright-pool
git branch --show-current   # should be: stable
npm test                    # should pass 34/34
npm publish                 # push to registry
```

**If debugging:**
- Run `npm test` first — passes if nothing is broken
- Check `docs/BENCHMARKS.md` for expected scores
- See `docs/PROJECT-STATUS.md` for full inventory

**If adding features:**
- Branch from `master` (dev), not `stable`
- Add regression test for any bug fix
- Add unit test for any new audit handler
