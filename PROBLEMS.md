# PROBLEMS.md — Agent Browser System Issue Log

A running list of **every problem** that occurs with the playwright-pool MCP, the
`browser` skill router, the golden/persistent profiles, the `wmux browser` panel, and the
whole agent-browser situation. Append new problems as they happen — do not delete, mark
RESOLVED instead so we keep the history.

## How to use this file

- **Add an entry the moment a problem occurs** — even if it's transient or you found a
  workaround. The point is the pattern over time.
- Use the next free `P-NN` id. Newest entries go at the **top** of the Open log.
- Move an entry to the **Resolved** section (don't delete) once it's genuinely fixed, with
  the fix and date.
- **Source tags:** `observed` = reproduced/seen directly · `memory` = carried from a saved
  memory/feedback · `docs` = from the project's own docs · `reported` = Edward reported it.

### Entry template

```
### P-NN — <one-line title>
- **Date:** YYYY-MM-DD
- **Status:** Open | Workaround | Resolved
- **Source:** observed | memory | docs | reported
- **Component:** pool MCP | browser skill | profiles | wmux | CLI | server.js | other
- **Symptom:** what you see go wrong
- **Cause:** root cause if known (else "unknown")
- **Workaround:** what to do in the moment
- **Fix:** the real fix (or "none yet")
```

---

## Open / known problems

### P-10 — MCP server defaults to headed (`headless: false`) with no `--headed` toggle
- **Date:** 2026-06-18 (logged) · originally noted 2026-03-26
- **Status:** Open
- **Source:** docs (`docs/PROJECT-STATUS.md` P1 #1)
- **Component:** server.js
- **Symptom:** `server.js` hardcodes `headless: false`; can't run the MCP pool headless for automated pipelines.
- **Cause:** ship-blocker never closed; should default headless with a `--headed` flag.
- **Workaround:** accept headed windows for now.
- **Fix:** none yet — part of the stalled v5 launch backlog.

### P-09 — playwright-pool v5 launch backlog is stalled
- **Date:** 2026-06-18
- **Status:** Open
- **Source:** docs (`docs/PROJECT-STATUS.md`, dated 2026-03-26)
- **Component:** other (project/release)
- **Symptom:** Installed v4.2.2, but docs still target a v5.0.0 public launch with P1–P4 open (headless default, npm publish, GitHub release, directory submissions).
- **Cause:** launch loop paused months ago.
- **Workaround:** n/a — tooling works locally regardless.
- **Fix:** resume the launch checklist when prioritized.

### P-08 — `wmux browser` CLI not reachable from the shell
- **Date:** 2026-06-18
- **Status:** Open
- **Source:** observed
- **Component:** wmux
- **Symptom:** Global CLAUDE.md says use `wmux browser open/snapshot/click` for visible browsing, but `wmux` is not on PATH in the Bash/PowerShell shell — `which wmux` returns nothing. The documented "watch in the panel" path can't be invoked.
- **Cause:** unknown — possibly MCP-only (a `wmux` MCP server is configured in `~/.claude.json`) and never exposed as a CLI binary on this device, or a PATH gap.
- **Workaround:** use the playwright-pool MCP (headed) for browser work; Edward sees pool windows on the desktop, just not in the wmux panel.
- **Fix:** none yet — diagnose whether wmux ships a CLI binary and add it to PATH, or confirm panel control is MCP-only.

### P-07 — Stale `pool-contexts` directories accumulate (no cleanup on crash/kill)
- **Date:** 2026-06-18
- **Status:** Open
- **Source:** observed
- **Component:** pool MCP
- **Symptom:** `~/.playwright-pool/pool-contexts/` holds ~50 UUID-prefixed temp dirs (templates + window dirs) going back weeks (Jun 1 → Jun 18).
- **Cause:** the pool cleans temp dirs on graceful close/session-end, but sessions that crash or are killed leave their dirs behind.
- **Workaround:** periodically delete stale `*-template` / `*-N` dirs (safe — they're disposable clones).
- **Fix:** none yet — consider a startup sweep that removes context dirs with no live process.

### P-06 — `pool_launch` silently drops `persist`/`profileName` after long-session compaction
- **Date:** 2026-06-18 (logged) · observed earlier
- **Status:** Workaround
- **Source:** memory (browser skill §3 GOTCHA)
- **Component:** pool MCP
- **Symptom:** After a context compaction, `pool_launch persist:true profileName:"…"` silently launches a throwaway golden-profile copy that is NOT logged in. Tell: the response has no "Persistent profile: <path>" line.
- **Cause:** the tool schema gets truncated via ToolSearch after compaction, so the `persist`/`profileName` params disappear.
- **Workaround:** check the launch response for the persistent-profile path; if missing, restart Claude Code so MCP tools reload with full schemas.
- **Fix:** none yet.

### P-05 — `window.print()` / native print dialog hangs the whole pool browser
- **Date:** 2026-06-18 (logged) · from memory
- **Status:** Workaround
- **Source:** memory (`feedback-no-windowprint-in-pool`)
- **Component:** pool MCP
- **Symptom:** Clicking any "Print" button that calls `window.print()` opens the native OS print dialog, which hangs the entire browser.
- **Cause:** the OS-level print popup is outside the DOM; Playwright can't dismiss it.
- **Workaround:** NEVER click a real print button in the pool. To verify print/label output, render the markup inline (overlay/iframe) and screenshot. Recovery if it hangs: `pool_close` all contexts.
- **Fix:** none — inherent to native dialogs.

### P-04 — CLI defaults to headless, so Google-authed pages show login prompts
- **Date:** 2026-06-18 (logged)
- **Status:** Workaround
- **Source:** docs (README Known Limitations)
- **Component:** CLI
- **Symptom:** `playwright-pool` CLI commands default to headless; Google-authenticated pages render logged-out even with a valid golden profile.
- **Cause:** Google blocks headless Chromium sessions regardless of valid cookies (see P-03).
- **Workaround:** pass `--headed` for any CLI command that needs Google auth.
- **Fix:** none — Google-side restriction.

### P-03 — Google blocks a FRESH PASSWORD login in any Playwright/CDP-driven browser
- **Date:** 2026-06-18 (logged) · long-standing
- **Status:** Workaround
- **Source:** memory (browser skill §2) + docs
- **Component:** profiles / pool MCP
- **Symptom:** A fresh Google password login in a pool/CDP browser fails with "Couldn't sign you in — this browser or app may not be secure." `channel:"msedge"` is necessary but not sufficient.
- **Cause:** Playwright's CDP debug pipe is detectable by Google's anti-bot.
- **Workaround:** (a) the **passkey** path is NOT blocked — a remembered Google account with a passkey completes the OAuth round-trip in the pool browser (Windows Hello prompt is fine). (b) Use a **persistent Edge profile** already logged into Google (`pool_launch persist:true`). First-time login is done once by hand in raw `msedge.exe` (no Playwright/CDP).
- **Fix:** none — Google-side; do not type fresh passwords in CDP browsers.

### P-02 — MCP tools only load at Claude Code startup
- **Date:** 2026-06-18 (logged) · long-standing
- **Status:** Workaround
- **Source:** memory (browser skill §0 PREFLIGHT)
- **Component:** pool MCP / browser skill
- **Symptom:** If `Brain/.mcp.json` is added/edited after a session starts, `pool_launch` / `browser_*` are missing for the WHOLE session.
- **Cause:** MCP servers register only at startup.
- **Workaround:** restart Claude Code. Do NOT fall back to ad-hoc Playwright scripts (reproduces the Google-block failure).
- **Fix:** none — restart is the path.

### P-01 — `browser` skill symlinked into Dropbox silently failed to load
- **Date:** 2026-06-18 (logged) · root-caused earlier
- **Status:** Resolved (kept here as the canonical first entry)
- **Source:** memory (browser skill "Why this skill is here")
- **Component:** browser skill
- **Symptom:** The original router skill was a symlink into a Dropbox path that wasn't present on this device (moved/online-only), so the skill silently failed to load and its rules got missed.
- **Cause:** Dropbox-symlinked skill target was relocated or online-only (cloud placeholder).
- **Workaround:** n/a.
- **Fix:** copied the skill to local disk (`~/.claude/skills/browser/`) with a committed backup in the Brain repo + a SessionStart preflight that flags any skill symlink whose target is missing/online-only.

---

## Resolved

*(Move entries here when genuinely fixed — keep them, don't delete. P-01 above is logged in
place as the origin entry and also counts as resolved.)*
