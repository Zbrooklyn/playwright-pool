# Playwright Pool

## Purpose

Open-source MCP server + CLI that gives any AI agent reliable, authenticated browser automation with built-in UI auditing — something no other tool does in one package.

## Success Criteria

1. **Anyone can install:** `npm install -g playwright-pool` works on Windows/Mac/Linux
2. **Two surfaces, one engine:** MCP server and CLI share the same audit code (`cli-commands/audit.js` is the single source of truth)
3. **Production-grade:** 95%+ accessibility detection on industry benchmarks (W3C BAD, Accessible University)
4. **Doesn't crash agent contexts:** Screenshots auto-save to disk; base64 stripped from MCP responses
5. **Multi-tier reliability:** stable npm release for production, dev branch for experimentation

## Owner Model

CEO-owned, single-maintainer (Edward Shamosh / @Zbrooklyn). Open-source MIT license — community PRs welcome via CONTRIBUTING.md.

## Architecture

- **`server.js`** — MCP server, exposes 75 tools (pool management, browser automation, 27 audits, utilities)
- **`cli.js` + `cli-commands/`** — CLI router, 42 commands, full parity with MCP
- **`cli-commands/audit.js`** — `AUDIT_HANDLERS` export, single source of truth for all audit logic
- **`audit-tools-b.js`** — MCP audit schemas + thin delegates to audit.js
- **Golden profile auth** — overlay 13 auth files onto fresh contexts (not full profile copy)
- **Template caching** — first launch ~17s, subsequent <2s
- **Three-tier audit pipeline:** code checks → programmatic measurement → vision verification

## Entry Workflow

- [HANDOFF.md](HANDOFF.md) — current state, what's done, what's pending, decisions made
- [README.md](README.md) — public-facing docs, installation, benchmarks
- [docs/PROJECT-STATUS.md](docs/PROJECT-STATUS.md) — comprehensive inventory
- [ROADMAP.md](ROADMAP.md) — milestones and direction

## Where State Lives

- `HANDOFF.md` — session-recovery state (what's done, what's pending, decisions)
- `CHANGELOG.md` — versioned release history
- `docs/BENCHMARKS.md` — measured scores per benchmark per mode
- `docs/MILESTONES.md` — milestone tracking
- `tests/` — automated test suite (smoke, regression, unit) — `npm test`

## Where Artifacts Live

- `tests/fixtures/` — test pages with planted bugs for accuracy validation
- `tests/prompt-results/` — vision prompt A/B testing outputs
- `%TEMP%/playwright-pool-screenshots/` — runtime screenshot output (gitignored)

## Branches

- **`master`** — active development, may contain unreleased features and 4 audit stubs
- **`stable`** — what ships to npm, all stubs removed, all tests pass
- **`feature/*`** — short-lived branches off master for experimental work

## Project Docs

- [HANDOFF.md](HANDOFF.md) — current status, blockers, next actions
- [README.md](README.md) — public installation and usage
- [CHANGELOG.md](CHANGELOG.md) — release notes
- [ROADMAP.md](ROADMAP.md) — direction and milestones
- [CLAUDE.md](CLAUDE.md) — project-specific Claude Code rules
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — community standards
- [SECURITY.md](SECURITY.md) — vulnerability reporting
- [docs/BENCHMARKS.md](docs/BENCHMARKS.md) — accuracy scores
- [docs/PROJECT-STATUS.md](docs/PROJECT-STATUS.md) — full inventory
- [docs/MILESTONES.md](docs/MILESTONES.md) — milestone tracking
