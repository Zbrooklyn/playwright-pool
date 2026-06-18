# Playwright Pool — Project Rules

## Overview
MCP server that dynamically manages authenticated Playwright browser pools from a single golden profile.

## Issue Log — `PROBLEMS.md`
Every problem with this software or the agent-browser system (pool MCP, `browser` skill,
profiles, `wmux` panel, CLI) gets logged in **`PROBLEMS.md`**. When any browser/pool issue
bites — even transient or worked-around — append an entry (next `P-NN` id, newest on top)
the moment it happens; never let it evaporate. Move fixed entries to Resolved, don't delete.
Read it before debugging a browser issue — it's likely already in there.

## Branch Rules
- `main` is the default branch
- Feature work on feature branches, merge via PR

## Key Files
- `server.js` — the entire MCP server (single file)
- `package.json` — dependencies and metadata
- `README.md` — public documentation

## Testing
No automated tests yet. Manual testing:
1. Configure in `.mcp.json`
2. Launch windows via `pool_launch`
3. Verify auth with `pool_navigate` to authenticated pages
4. Verify cleanup with `pool_close all`

## Core Design Principle: Visual Truth

The rendered UI is the source of truth, not the source code. All audit tools must prioritize what the user actually sees over what the code says should happen.

**Three-Layer Audit Rule** — all three must agree before any UI claim:
1. Code check (what the CSS/HTML says)
2. Programmatic measurement (what the browser computed — `getComputedStyle`, `getBoundingClientRect`)
3. Visual verification (screenshot — what the user actually sees)

Code saying `padding: 16px` means nothing if a conflicting style makes the visual result wrong. When building audit tools, always verify against the rendered output, not just the DOM/CSS.

## Performance Guidelines
- Prefer CLI for audits and screenshots — saves context tokens (~20 tokens for a file path vs ~28,000 for a full snapshot)
- Use MCP for interactive browser sessions (clicking, navigating, reacting to page state)
- Always use `snapshot_compact` over `browser_snapshot` — 20x fewer tokens (~1,375 vs ~28,000)
- First `pool_launch` has ~17s overhead (template creation); subsequent operations are fast (<2s)

## Architecture Decisions
- **Auth overlay, not full profile copy** — copying entire Chromium profiles causes crashes due to cache/GPU data tied to specific Chromium builds. We create a fresh profile and overlay only the 13 auth-critical files.
- **Template caching** — the first `pool_launch` creates a template profile (one headless Chromium launch). Subsequent launches just copy the template (filesystem only, no Chromium launch).
- **UUID session isolation** — each MCP server process gets a random UUID prefix. Concurrent sessions never collide on disk.
- **Headed mode required for Google auth** — Google OAuth detects headless Chromium and blocks cookie-based sessions. The MCP server always uses `headless: false` so this is a non-issue there. CLI commands default to headless and need `--headed` for Google services. Non-Google services generally work fine in headless mode. This is a Google-side restriction, not fixable in our code.
