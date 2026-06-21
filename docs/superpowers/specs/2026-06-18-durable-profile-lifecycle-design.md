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

## Full journey (end-to-end) — the reliability target

The mission is bigger than create/use/update: **people depend on AI to log into their web
software, and it must be dependable and clean.** "Messy" is two tangled problems — **auth
durability** (stay logged in) and **session reliability** (the browser doesn't wedge/zombie).
The journey below accounts for both. Tag: `[built]` exists today, `[gap]` is future work.

**Stage 0 — Onboard a new login.** A human logs in once by hand (raw browser, no automation).
Capture in that single sitting: the **session** (cookies/tokens → profile snapshot) `[built]`,
and the **credentials** — handled by the **browser's own built-in password manager**, which
saves into `Login Data`/`Web Data` (already in the overlay) `[built]`. Decision: which profile
(`default`/`business-A`) `[built]`.

**Stage 1 — Open & use.** Pick a profile → overlay its snapshot → browser boots authenticated
→ identity echo confirms account → AI works, no login act. `[built]`

**Stage 2 — Verify auth is live.** Cheap freshness check before depending on it: are we really
logged in, or did the session silently expire? Live → proceed; stale → Stage 3. Kills the
"looks logged in but isn't" failure. `[gap]`

**Stage 3 — Re-auth when stale.** Decision tree:
- Bot-detecting site (Google/banks) → use the saved password but hand submit/MFA to the human
  (notify), or the persistent-profile passkey path. Cannot fully automate — stated honestly.
- Normal site → browser autofills saved username/password → submit. If TOTP is prompted, the
  built-in manager **cannot** supply it (see decision below).
- **Re-capture**: write the fresh session back into the profile snapshot → next time is reuse
  again. This is the self-healing step — without it every expiry needs a human. `[gap]`

**Stage 4 — Session reliability (pillar 2).** Detect a frozen/wedged/dead browser → recover
(relaunch + re-overlay) instead of leaving a zombie; reap orphaned contexts. This is the
modular-crane class of failure (mass-freeze, 18 zombie sessions). `[gap]`

**Stage 5 — Maintenance.** Add another account, proactively refresh a login nearing expiry,
rotate creds. (create/update `[built]`; proactive refresh `[gap]`.)

**Cross-cutting (all stages):** identity & scoping (never cross profiles/accounts); blast
radius (per-profile credential scoping; audit what the agent touched); human gates named
explicitly (first login, passkey/push MFA, bot-detected re-login — everything else automatic);
loud-not-silent state reporting.

## Credential layer decision — browser built-in first, external vault deferred

**Decision: the credential store is the browser's own built-in password manager**, not an
external vault. Rationale:
- It is **already captured** — `Login Data`/`Web Data` are in the overlay; zero new infra.
- It is **naturally scoped per profile** — each profile only holds the logins saved in it.
- Simplest thing that works (rule 14); no separate vault, no separate unlock secret.

**The one capability it lacks: TOTP 2FA autofill.** The browser built-in does not store TOTP
seeds, so it cannot auto-supply a 2FA code to skip an MFA prompt. An external vault (1Password
— SDK/service-accounts/TOTP; or Bitwarden — CLI/self-host) is the **only** reason to add one,
and only for that capability. Treated as an **optional later enhancement**, not a foundational
dependency. Until then, TOTP-gated re-logins fall under the human-assisted branch of Stage 3.

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
- **No external password manager in v1** — browser built-in only; 1Password/Bitwarden TOTP is a
  deferred optional enhancement (Stage 3), not a foundational dependency.
- Stages 2–4 (freshness check, automated re-auth, session-health recovery) are the **next**
  build phase, scoped separately from this profile-lifecycle plan.

## Open validation items (resolved during the plan, not now)
1. Does a raw-spawned **bundled Chromium** Google login avoid the flag? If yes → primary path.
   If no → Edge/Chrome channel path with matching read engine.
2. Exact non-sensitive source for the account-hint display (Preferences `account_info`).
