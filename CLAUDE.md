# Playwright Pool — Project Rules

## Overview
MCP server that dynamically manages authenticated Playwright browser pools from a single golden profile.

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

## Architecture Decisions
- **Auth overlay, not full profile copy** — copying entire Chromium profiles causes crashes due to cache/GPU data tied to specific Chromium builds. We create a fresh profile and overlay only the 13 auth-critical files.
- **Template caching** — the first `pool_launch` creates a template profile (one headless Chromium launch). Subsequent launches just copy the template (filesystem only, no Chromium launch).
- **UUID session isolation** — each MCP server process gets a random UUID prefix. Concurrent sessions never collide on disk.
