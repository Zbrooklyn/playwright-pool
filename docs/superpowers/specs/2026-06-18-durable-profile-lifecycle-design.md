# Durable Golden-Profile Lifecycle — Design Spec

**Date:** 2026-06-18
**Status:** Approved (design) — pending spec review → implementation plan
**Component:** playwright-pool (server.js, cli.js, cli-commands/), `browser` skill, `.mcp.json`

---

## Problem

The golden-profile model was meant to be durable: log in **once by hand in a non-automated
browser**, snapshot the auth files, and have every pool session boot from that pure snapshot.
The *use* path works. The *create/update* path is broken:

- `cli.js` `login` opens the profile via `chromium.launchPersistentContext(GOLDEN_PROFILE)`
  — **Playwright automation**, which is exactly what Google flags ("this browser may not be
  secure"). So the one door used to create *or* refresh the snapshot is automation-tainted.
- There is **no way to add credentials** to an existing snapshot. Adding a 2nd/3rd Google
  account, or a separate business identity, has no durable path.
- There is **one** golden profile. Edward needs a **default (personal)** profile *and*
  separate **business** profiles, and within personal he sometimes needs to **stack extra
  accounts**.

## Goal

A complete, durable three-phase lifecycle the `browser` skill fully understands and
communicates:

1. **Create** a named credential snapshot via a raw, automation-free browser login.
2. **Use** a chosen snapshot when launching pool browsers (default when unnamed).
3. **Update** a snapshot — add/refresh accounts — through the same raw login door, touching
   only that one snapshot.

## The model (settled)

**Named profiles for isolation; multi-account inside any profile for free.**

- Each named profile (`default`, `business-A`, …) is its own Chromium user-data-dir with its
  own snapshot (the 13 auth files incl. `Local State`).
- Multiple Google accounts inside one profile need **no new mechanism** — the overlay already
  copies the entire cookie jar, so Google's native "add account" is captured automatically.
- You pick a profile at launch; no name = `default`. Identity is echoed back every launch.

This is "B as structure, A's multi-account happening naturally inside any profile."

---

## The core fix: raw, automation-free login door

`login` must **spawn the real browser executable directly** against the profile's
user-data-dir with **zero automation** — no `launchPersistentContext`, no CDP / remote
debugging port, no `--enable-automation`. The browser is just Chromium pointed at a profile
dir; the human logs in; we close it; the snapshot is whatever is on disk.

**Engine / decryption constraint (the one real risk to validate):** the snapshot is decrypted
at *read* time by the pool's browser. Cookie encryption keys live in `Local State` and, on
modern Chromium, can be bound to the specific browser binary (App-Bound Encryption).
Therefore the **login browser and the pool's read browser must be the same engine** so the
copied `Local State` key stays decryptable.

- **Primary approach:** raw-spawn the **pool's bundled Chromium executable**
  (`chromium.executablePath()` launched via `child_process.spawn`, no CDP) for login. This
  guarantees the pool can decrypt what was written. Validate that a Google login in this
  raw-spawned Chromium is **not** flagged (no automation is attached, so it should pass).
- **Fallback if Google flags bundled Chromium:** log in with system **Edge/Chrome** raw, and
  make the pool **read with that same channel** (`channel` already supported per the persist
  path) so encryption stays consistent. Decision deferred to a validation step in the plan.

This raw door serves **both** create and update — they are the same action.

---

## Components & interfaces

### 1. Profile resolver (new, small — `server.js` + shared)
- Base dir: `~/.playwright-pool/profiles/<name>/` (configurable via env).
- `resolveProfile(name = "default") -> absolute path`.
- `listProfiles() -> [{ name, path, exists, hasDefault }]`.
- Backward-compat: `GOLDEN_PROFILE` env still honored as the `default` profile's path.

### 2. `pool_launch` gains `profileName` (server.js)
- New optional param `profileName` (default `"default"`).
- Template/overlay reads from the resolved profile dir instead of the fixed `GOLDEN_PROFILE`.
- **Launch response must state the loaded profile name and its path** (identity echo; also
  the tell for the silent-throwaway bug, PROBLEMS.md P-06). Where feasible, surface the
  signed-in account(s).

### 3. `login --profile <name>` (cli.js) — rewritten
- Resolves/creates the named profile dir.
- Raw-spawns the browser exe (no automation) at `https://accounts.google.com` (or `[url]`).
- Prints the raw-no-automation guarantee + "add accounts via Google's add-account, then close
  this window." Writes a non-sensitive activation log (like `edge-golden.activation.md`): no
  passwords/cookies/tokens ever read or stored.

### 4. `profiles` / `status` (cli.js)
- `playwright-pool profiles` → lists named profiles + per-profile account hint (derived from
  non-sensitive `Preferences` `account_info` display names/emails only).
- `status` reports per-profile presence.

### 5. Migration
- Move/adopt existing `~/.playwright-pool/golden-profile` as profile `default` (non-destructive:
  prefer in-place adoption or copy; never delete the original without confirmation —
  CLAUDE.md rule 26).
- Update `Brain/.mcp.json` env so the resolver base is set; keep `GOLDEN_PROFILE` working.

### 6. `browser` skill update
- New section: the three-phase lifecycle + the named-profile model.
- Rules: raw-no-automation for create/update; `default` when unnamed; **echo identity every
  launch**; unknown profile = stop and offer to create, never fall back to wrong identity;
  sticky profile within a task.
- Cross-links to `PROBLEMS.md` (P-02 restart, P-03 Google block, P-06 silent throwaway).

---

## Data flow

```
CREATE/UPDATE                          USE
login --profile business-A             pool_launch profileName:"business-A"
  → resolveProfile("business-A")         → resolveProfile("business-A")
  → raw-spawn browser exe (NO CDP)       → ensureTemplate() (one headless scaffold)
  → human logs in / adds accounts        → overlay 13 auth files FROM that profile
  → close                                → file-copy clones per context
  → snapshot = files on disk             → echo: "loaded business-A as you@business-a.com"
```

## Error handling
- Unknown profile name → clear error + offer to create; never silent-fallback to `default`.
- Missing/empty snapshot (no `Default/`) → tell user to run `login --profile <name>`.
- Login browser launched with any automation flag → guard/abort (defeats the whole purpose).
- Decryption failure on read (engine mismatch) → surface explicitly, point to engine constraint.

## Testing
- Unit: resolver (default, named, unknown, env override); `listProfiles`; AUTH_FILES overlay
  reads from resolved path.
- Integration (manual, by design — login is human): create `default` + one `business-*`,
  verify `pool_launch profileName` loads the right jar, verify add-account is captured after a
  second `login`, verify the other profile is untouched.
- Regression: existing single-profile flow still works with no `profileName` (→ `default`).

## YAGNI / out of scope
- No Chrome sub-profiles (`Profile 1/2`) inside one user-data-dir — separate user-data-dirs only.
- No automated/headless login (Google blocks it; human-in-the-loop is the design).
- No per-account selection at launch beyond Google's in-browser switcher.
- No cloud sync / encryption-at-rest changes to snapshots.

## Open validation items (resolved during the plan, not now)
1. Does a raw-spawned **bundled Chromium** Google login avoid the flag? If yes → primary path.
   If no → Edge/Chrome channel path with matching read engine.
2. Exact non-sensitive source for the account-hint display (Preferences `account_info`).
