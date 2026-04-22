# Contributing to Playwright Pool

Thanks for your interest in contributing. This project is MIT-licensed and welcomes pull requests.

## Quick Start

```bash
git clone https://github.com/zbrooklyn-claude-labs/playwright-pool.git
cd playwright-pool
npm install
npx playwright install chromium
npm test
```

## How to Contribute

### Reporting Bugs

Open a GitHub issue with:
1. Reproducible steps (URL, command, expected vs actual)
2. Your OS, Node version (`node --version`), Playwright version (`npm list playwright`)
3. Relevant log output (stderr from `playwright-pool-server` or CLI output)
4. Screenshot path if visual

For security vulnerabilities, see [SECURITY.md](SECURITY.md) — do not open a public issue.

### Suggesting Features

Open a GitHub issue tagged `enhancement`. Include:
- The problem you're trying to solve
- Why existing tools don't solve it
- Rough sketch of the API or behavior

### Submitting Pull Requests

1. **Fork** the repo and create a branch off `master` (not `stable`)
2. **Add tests first** — every bug fix needs a regression test, every new audit needs a unit test
3. **Run the full suite locally:** `npm test` — must pass 34/34 before requesting review
4. **Keep PRs focused** — one logical change per PR
5. **Match the existing code style** — ES modules, no TypeScript, no new runtime dependencies

## Repository Layout

```
playwright-pool/
├── server.js              # MCP server entry point
├── cli.js                 # CLI entry point
├── cli-commands/
│   ├── audit.js           # AUDIT_HANDLERS — single source of truth for audits
│   ├── browser.js         # browser launch/navigate/click/etc
│   ├── shared.js          # CDP connection helpers
│   └── ...
├── audit-tools-b.js       # MCP audit schemas, delegates to audit.js
├── tests/
│   ├── smoke.test.js      # Tier 1: core loop in CLI + MCP
│   ├── regression.test.js # Tier 2: bugs that must stay fixed
│   ├── unit-audits.test.js# Tier 3: each AUDIT_HANDLER against example.com
│   └── helpers.js         # runCli, runMcpServer test utilities
├── docs/
│   ├── BENCHMARKS.md      # measured scores
│   ├── PROJECT-STATUS.md  # full inventory
│   └── MILESTONES.md      # roadmap progress
└── PROJECT.md             # project overview
```

## Adding a New Audit

1. Add the handler function to `cli-commands/audit.js`. It must accept `(page, context, opts)` and return `{ issues: [], text: '...' }`.
2. Register it in the `AUDIT_HANDLERS` export and the appropriate `AUDIT_CATEGORIES` list.
3. Add an MCP tool schema in `audit-tools-b.js` (or `server.js` for the first 11 tools) and a 1-line delegate handler.
4. Add a unit test to `tests/unit-audits.test.js` — just include the handler name in `TESTABLE_HANDLERS`.
5. Run `npm test` — all tests must pass.

## Branch Strategy

- **`master`** — active development. PRs land here.
- **`stable`** — what ships to npm. Maintainer cherry-picks or merges from master after verification.
- **Don't push directly to `stable`** — go through `master` first.

## Code Style

- ES modules (`import` / `export`), Node 18+
- 2-space indent, single quotes, semicolons
- No TypeScript (keeps install simple — only one dependency)
- Match the surrounding file's style if it differs from above

## Testing Philosophy

- **Smoke tests** prove the system works end-to-end
- **Regression tests** lock in fixes for bugs we've already hit
- **Unit tests** prove individual handlers don't crash and return the expected shape

If you fix a bug, add a regression test that would have caught it. If you add a feature, add at least one test that proves it works.

## Questions

Open a GitHub Discussion or tag the maintainer in an issue. Response time is typically within a few days.
