# Changelog

## 4.2.1 — 2026-04-22

### Fixed
- **Pin `playwright` to `~1.58.0`** (was `^1.58.0`). Playwright 1.59.0 removed the internal `lib/mcp/browser/` modules that `server.js` requires. Fresh installs of v4.2.0 picked up 1.59.x and crashed at startup. Caught during cold-install verification — added to release checklist.

## 4.2.0 — 2026-04-22

First documented release after internal v4.x iterations. v2.0.0 through v4.1.0 existed only in commit messages and were never tagged or formally released; this is the first release with proper versioning, documentation, and an automated test suite.

### What's in 4.2.0

**Code consolidation**
- Audit logic consolidated into `cli-commands/audit.js` as the single source of truth (`AUDIT_HANDLERS` export). `audit-tools-b.js` and `server.js` now delegate to it. Removed ~2,850 lines of duplicated audit logic across the three files.

**Screenshot handling**
- Screenshots auto-save to `%TEMP%/playwright-pool-screenshots/` and base64 image data is stripped from MCP responses. Prevents context-window crashes when an agent takes many screenshots in one session.
- Honor absolute paths in screenshot `filename` arg; relative paths join with the screenshots dir.

**Stable branch**
- Removed 4 audit stubs (`loading_states`, `print_layout`, `scroll_behavior`, `computed_styles`) from the `stable` branch. They remain on `master` for development.

**Documentation**
- New: `HANDOFF.md`, `PROJECT.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `docs/BENCHMARKS.md`, `docs/BRANCHING.md`.

**Testing**
- 34 automated tests across three tiers: smoke, regression, unit. Run via `npm test`.

### Carried over from earlier internal versions

- 75 MCP tools (pool management, browser automation, 28 audits, utilities)
- 42 CLI commands (parity with MCP tools)
- Golden profile authentication via auth-file overlay (not full profile copy)
- Vision-model audit pipeline with structured prompt
- 143 device presets
- Compact accessibility snapshots (~90% fewer tokens than full snapshot)

### Benchmarks (this release)

- W3C BAD: 74 violations detected across 13 rules
- Accessible University: 21 of 22 known barriers detected (95.5%)
- Package size: ~143 kB, 30 files, 1 production dependency

### Known Limitations

- Google OAuth requires headed mode. Google detects and blocks headless Chromium sessions even with valid cookies; non-Google services work in headless mode.
- Single-file `server.js` (~67 kB). Will be split if/when contributor friction warrants it.

### Distribution

This release is **not published to the npm registry**. Install via git tag:
```
npm install git+https://github.com/zbrooklyn-claude-labs/playwright-pool.git#v4.2.0
```
