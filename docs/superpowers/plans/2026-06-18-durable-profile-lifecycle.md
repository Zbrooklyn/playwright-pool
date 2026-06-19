# Durable Golden-Profile Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the golden-profile lifecycle durable and multi-profile: named credential snapshots, raw automation-free login for create+update, and profile selection at launch.

**Architecture:** Add a tiny profile resolver so one base dir holds many named profiles (`default`, `business-A`, …); the existing auth-file overlay reads from the resolved profile instead of a single fixed path. Rewrite `login` to spawn a real browser executable with zero automation (the durability fix) and accept `--profile`. `pool_launch` gains `profileName` and echoes the loaded identity.

**Tech Stack:** Node.js (ESM), Playwright ~1.58 (bundled Chromium), `child_process.spawn` for raw login, `node:test` for unit tests.

## Global Constraints

- Single production dependency: `playwright` (~1.58.0). Do not add dependencies.
- Login browser MUST launch with **zero automation**: no `launchPersistentContext`, no `--remote-debugging-port`, no CDP attach. Raw `child_process.spawn` of the browser exe only.
- Never read, store, or log passwords/cookies/tokens. Account hints come only from non-sensitive `Preferences` display fields.
- Non-destructive migration: never move/delete the existing `golden-profile` without explicit confirmation (CLAUDE.md rule 26). `default` resolves to the existing dir in place.
- Decryption constraint: the login browser engine and the pool's read engine must match so the copied `Local State` key stays decryptable. Engine is a single constant (`LOGIN_ENGINE`) set by Task 6.
- Backward compatibility: no `profileName` / no `--profile` ⇒ profile `default`; existing single-profile flow must keep working unchanged.

---

### Task 1: Profile resolver module

**Files:**
- Create: `lib/profiles.js`
- Test: `tests/profiles.test.js`

**Interfaces:**
- Consumes: env `POOL_BASE` (`~/.playwright-pool`), env `GOLDEN_PROFILE` (legacy default path), env `PROFILES_DIR` (optional override).
- Produces:
  - `resolveProfile(name = 'default') -> { name, path }`
  - `listProfiles() -> Array<{ name, path, exists, hasDefault }>`
  - `profileAccounts(profilePath) -> string[]` (display names/emails from `Default/Preferences` `account_info`, else `[]`)
  - constant `DEFAULT_PROFILE = 'default'`

**Resolution rule:** `default` → `GOLDEN_PROFILE` if that env is set (legacy in-place), else `PROFILES_DIR/default`. Any other name → `PROFILES_DIR/<name>`. `PROFILES_DIR` defaults to `POOL_BASE/profiles`.

- [ ] **Step 1: Write the failing test**

```js
// tests/profiles.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { resolveProfile, listProfiles, profileAccounts, DEFAULT_PROFILE } from '../lib/profiles.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-prof-'));
process.env.PROFILES_DIR = path.join(TMP, 'profiles');
delete process.env.GOLDEN_PROFILE;

test('default resolves under PROFILES_DIR when no GOLDEN_PROFILE', () => {
  const r = resolveProfile();
  assert.equal(r.name, 'default');
  assert.equal(r.path, path.join(TMP, 'profiles', 'default'));
});

test('GOLDEN_PROFILE overrides default path in place', () => {
  process.env.GOLDEN_PROFILE = path.join(TMP, 'legacy-golden');
  assert.equal(resolveProfile('default').path, path.join(TMP, 'legacy-golden'));
  delete process.env.GOLDEN_PROFILE;
});

test('named profile resolves under PROFILES_DIR', () => {
  assert.equal(resolveProfile('business-A').path, path.join(TMP, 'profiles', 'business-A'));
});

test('rejects unsafe names', () => {
  assert.throws(() => resolveProfile('../escape'));
  assert.throws(() => resolveProfile('a/b'));
});

test('listProfiles reports existence and Default/', () => {
  fs.mkdirSync(path.join(TMP, 'profiles', 'business-A', 'Default'), { recursive: true });
  const list = listProfiles();
  const a = list.find((p) => p.name === 'business-A');
  assert.ok(a && a.exists && a.hasDefault);
});

test('profileAccounts returns [] when no Preferences', () => {
  assert.deepEqual(profileAccounts(path.join(TMP, 'profiles', 'nope')), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/profiles.test.js`
Expected: FAIL — cannot find module `../lib/profiles.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/profiles.js
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const DEFAULT_PROFILE = 'default';
const HOME = os.homedir();
const POOL_BASE = process.env.POOL_BASE || path.join(HOME, '.playwright-pool');

function profilesDir() {
  return process.env.PROFILES_DIR || path.join(POOL_BASE, 'profiles');
}

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export function resolveProfile(name = DEFAULT_PROFILE) {
  if (!SAFE_NAME.test(name)) {
    throw new Error(`Invalid profile name "${name}". Use letters, digits, dot, dash, underscore.`);
  }
  if (name === DEFAULT_PROFILE && process.env.GOLDEN_PROFILE) {
    return { name, path: process.env.GOLDEN_PROFILE };
  }
  return { name, path: path.join(profilesDir(), name) };
}

export function listProfiles() {
  const names = new Set();
  if (process.env.GOLDEN_PROFILE) names.add(DEFAULT_PROFILE);
  const dir = profilesDir();
  if (fs.existsSync(dir)) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.isDirectory() && SAFE_NAME.test(d.name)) names.add(d.name);
    }
  }
  return [...names].sort().map((name) => {
    const { path: p } = resolveProfile(name);
    const exists = fs.existsSync(p);
    return { name, path: p, exists, hasDefault: exists && fs.existsSync(path.join(p, 'Default')) };
  });
}

export function profileAccounts(profilePath) {
  try {
    const prefs = JSON.parse(fs.readFileSync(path.join(profilePath, 'Default', 'Preferences'), 'utf8'));
    const info = prefs.account_info || [];
    return info.map((a) => a.email || a.full_name).filter(Boolean);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/profiles.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/profiles.js tests/profiles.test.js
git commit -m "feat: profile resolver — named profiles + legacy default in place"
```

---

### Task 2: `pool_launch` accepts `profileName` and echoes identity

**Files:**
- Modify: `server.js` — import resolver (top), `ensureTemplate` (85-119), `pool_launch` schema (193-199), `handlePoolLaunch` (1170+), launch response text.
- Test: `tests/profile-launch.test.js`

**Interfaces:**
- Consumes: `resolveProfile`, `profileAccounts` from `lib/profiles.js`.
- Produces: `ensureTemplate(profileName)` keyed per profile; `handlePoolLaunch` honors `params.profileName`; response includes `Profile: <name>` and account hint.

- [ ] **Step 1: Write the failing test** (template keyed by profile, reads resolved path)

```js
// tests/profile-launch.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { resolveProfile } from '../lib/profiles.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-launch-'));
process.env.PROFILES_DIR = path.join(TMP, 'profiles');
delete process.env.GOLDEN_PROFILE;

test('resolveProfile drives where overlay reads from', () => {
  const r = resolveProfile('business-A');
  fs.mkdirSync(path.join(r.path, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(r.path, 'Default', 'Login Data'), 'x');
  assert.ok(fs.existsSync(path.join(r.path, 'Default', 'Login Data')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/profile-launch.test.js`
Expected: PASS for the resolver assertion, but this task's *real* verification is manual (server.js wiring); keep this as the regression anchor. If it errors on import, fix the path first.

- [ ] **Step 3: Edit `server.js` — schema** (add after line 198, before closing `}`)

```js
      profileName: mcpBundle.z.string().optional().describe('Named credential profile to load (default: "default"). E.g. "business-A".'),
```

- [ ] **Step 4: Edit `server.js` — resolver import** (near line 36, replacing the fixed `GOLDEN_PROFILE` read for template use)

```js
import { resolveProfile, profileAccounts } from './lib/profiles.js';
```

- [ ] **Step 5: Edit `ensureTemplate` to be per-profile** (replace body of 85-119)

Make `templateDir` a `Map<profileName, dir>`; resolve the profile path; throw a clear error if the resolved path has no `Default/` ("run `playwright-pool login --profile <name>`"); overlay `AUTH_FILES` from the resolved path. Return the resolved `{ name, path }`.

```js
const templateDirs = new Map();
async function ensureTemplate(profileName = 'default') {
  const prof = resolveProfile(profileName);
  if (templateDirs.has(prof.name) && fs.existsSync(templateDirs.get(prof.name))) return prof;
  if (!fs.existsSync(path.join(prof.path, 'Default'))) {
    throw new Error(`Profile "${prof.name}" has no snapshot at ${prof.path}. Run: playwright-pool login --profile ${prof.name}`);
  }
  const dir = path.join(POOL_DIR, `${SESSION_ID}-${prof.name}-template`);
  ensurePoolDir();
  const tempCtx = await chromium.launchPersistentContext(dir, { headless: true });
  await tempCtx.close();
  for (const f of AUTH_FILES) {
    const src = path.join(prof.path, f);
    const dst = path.join(dir, f);
    if (fs.existsSync(src)) {
      const stat = fs.statSync(src);
      if (stat.isDirectory()) fs.cpSync(src, dst, { recursive: true, force: true });
      else { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
    }
  }
  templateDirs.set(prof.name, dir);
  return prof;
}
```

Update `createAuthProfile(destDir, profileName)` to copy from `templateDirs.get(profileName)`.

- [ ] **Step 6: Edit `handlePoolLaunch`** (line 1170+) to thread the profile

```js
const profileName = params.profileName || 'default';
// ... replace `await ensureTemplate();` with:
const prof = await ensureTemplate(profileName);
// pass profileName into createAuthProfile(contextDir, profileName) / tab path
```

In the success response text, prepend an identity line:

```js
const accts = profileAccounts(prof.path);
const idLine = `Profile: ${prof.name}${accts.length ? ` — signed in as ${accts.join(', ')}` : ''}\n`;
```

- [ ] **Step 7: Manual verify**

Run a real `pool_launch profileName:"default"` (after Task 5 default exists). Expected: response begins with `Profile: default …`. Run `pool_launch` with an unknown name → expected the "no snapshot" error, NOT a silent default.

- [ ] **Step 8: Commit**

```bash
git add server.js tests/profile-launch.test.js
git commit -m "feat: pool_launch profileName + identity echo; per-profile templates"
```

---

### Task 3: Rewrite `login` to raw, automation-free spawn + `--profile`

**Files:**
- Modify: `cli.js` `cmdLogin` (286-322); arg parsing for `--profile`; help text (187).
- Create: writes a non-sensitive `*.activation.md` next to the profile.

**Interfaces:**
- Consumes: `resolveProfile` from `lib/profiles.js`; constant `LOGIN_ENGINE` (Task 6, default bundled Chromium exe path).
- Produces: `playwright-pool login [url] [--profile <name>]` that opens a real browser with no automation.

- [ ] **Step 1: Replace `cmdLogin`**

```js
import { spawn } from 'node:child_process';
import { resolveProfile } from './lib/profiles.js';

async function cmdLogin(url, profileName = 'default') {
  const targetUrl = url || 'https://accounts.google.com';
  const prof = resolveProfile(profileName);
  fs.mkdirSync(prof.path, { recursive: true });

  // LOGIN_ENGINE resolved in Task 6. Default: bundled Chromium executable.
  const { chromium } = await import('playwright');
  const exe = process.env.LOGIN_ENGINE || chromium.executablePath();

  console.log(`Raw login (NO automation) — profile "${prof.name}"`);
  console.log(`  Browser: ${exe}`);
  console.log(`  Profile: ${prof.path}`);
  console.log(`  URL:     ${targetUrl}`);
  console.log('\nLog in (add multiple Google accounts if you want — all are captured).');
  console.log('Close the browser window when done.\n');

  const child = spawn(exe, [
    `--user-data-dir=${prof.path}`,
    '--no-first-run',
    '--no-default-browser-check',
    targetUrl,
  ], { stdio: 'ignore', detached: false });

  await new Promise((resolve) => child.on('exit', resolve));
  writeActivationLog(prof);
  console.log(`Profile "${prof.name}" snapshot saved.`);
}

function writeActivationLog(prof) {
  const md = `# Profile activation — ${prof.name}\n\n- Path: ${prof.path}\n- Engine: raw spawn, no automation, no CDP\n- NOT recorded: no passwords, cookies, tokens, or secrets read or logged.\n`;
  try { fs.writeFileSync(path.join(prof.path, 'activation.md'), md); } catch {}
}
```

- [ ] **Step 2: Add `--profile` parsing** in the arg dispatch (near case `'login'`, line 54)

```js
case 'login': {
  const pIdx = args.indexOf('--profile');
  const profileName = pIdx !== -1 ? args[pIdx + 1] : 'default';
  const url = args.find((a, i) => i > 0 && !a.startsWith('--') && i !== pIdx + 1);
  await cmdLogin(url, profileName);
  break;
}
```

- [ ] **Step 3: Update help text** (line 187)

```
  login [url] [--profile <name>]   Open a RAW browser (no automation) to create/refresh a profile snapshot
```

- [ ] **Step 4: Manual verify (deferred to Task 6 gate)**

Spawning is verified live in Task 6 with a real Google login. Here, just confirm the command spawns a browser pointed at the profile dir and exits cleanly on close (use a throwaway `--profile _smoke`).

- [ ] **Step 5: Commit**

```bash
git add cli.js
git commit -m "feat: raw automation-free login + --profile (durability fix)"
```

---

### Task 4: `profiles` command + per-profile `status`

**Files:**
- Modify: `cli.js` — new `cmdProfiles`, dispatch case, help; extend `cmdStatus` (370-412).

**Interfaces:**
- Consumes: `listProfiles`, `profileAccounts`.
- Produces: `playwright-pool profiles`.

- [ ] **Step 1: Add `cmdProfiles`**

```js
import { listProfiles, profileAccounts } from './lib/profiles.js';

function cmdProfiles() {
  const list = listProfiles();
  if (!list.length) { console.log('No profiles. Run: playwright-pool login --profile default'); return; }
  for (const p of list) {
    const accts = p.hasDefault ? profileAccounts(p.path) : [];
    const state = p.hasDefault ? (accts.length ? accts.join(', ') : 'ready (no account hint)') : 'EMPTY — run login';
    console.log(`${p.name.padEnd(16)} ${state}`);
  }
}
```

- [ ] **Step 2: Wire dispatch + help** (`case 'profiles': cmdProfiles(); break;`; help line `profiles   List credential profiles and their accounts`).

- [ ] **Step 3: Extend `cmdStatus`** to loop `listProfiles()` instead of the single golden block (replace 376-386 with a per-profile listing using the same fields).

- [ ] **Step 4: Manual verify**

Run `playwright-pool profiles` and `playwright-pool status`. Expected: `default` listed (after Task 5), plus any named profiles, with account hints.

- [ ] **Step 5: Commit**

```bash
git add cli.js
git commit -m "feat: profiles command + per-profile status"
```

---

### Task 5: Migration + config (non-destructive)

**Files:**
- Modify: `Brain/.mcp.json` (env), `cli.js` `cmdConfig` (326-366) to document `PROFILES_DIR`.

**Interfaces:** none new — wiring only.

- [ ] **Step 1: Confirm in-place default**

The existing `~/.playwright-pool/golden-profile` already resolves as `default` via the `GOLDEN_PROFILE` env branch (Task 1). No file move. Verify: `playwright-pool profiles` shows `default` backed by the existing dir.

- [ ] **Step 2: Add `PROFILES_DIR` to `Brain/.mcp.json`** under `playwright-pool.env`

```json
"GOLDEN_PROFILE": "C:\\Users\\EDWAR\\.playwright-pool\\golden-profile",
"PROFILES_DIR": "C:\\Users\\EDWAR\\.playwright-pool\\profiles"
```

- [ ] **Step 3: Update `cmdConfig`** to emit both env vars in its sample JSON.

- [ ] **Step 4: Commit (two repos)**

```bash
git add cli.js && git commit -m "chore: document PROFILES_DIR in config"
# Brain/.mcp.json committed separately in the Brain repo
```

Note: editing `.mcp.json` requires a Claude Code restart to take effect (PROBLEMS.md P-02). Flag this to Edward.

---

### Task 6: Engine validation gate (HUMAN-IN-THE-LOOP)

**Files:** none (decision task); may set `LOGIN_ENGINE` default in `cli.js` / `.mcp.json`.

**Goal:** Decide the login+read engine so `Local State` decryption holds.

- [ ] **Step 1:** Build Tasks 1–5. Run `playwright-pool login --profile _probe` — Edward attempts a real Google sign-in in the raw-spawned **bundled Chromium**.
- [ ] **Step 2:** Observe: does Google show "this browser may not be secure," or does login complete (password or passkey)?
- [ ] **Step 3a (login completes):** Bundled Chromium is the engine. Keep `LOGIN_ENGINE` default = `chromium.executablePath()`. Read path unchanged. Done.
- [ ] **Step 3b (Google blocks):** Set `LOGIN_ENGINE` to system Edge/Chrome path AND make window-mode read pass `channel` so the read engine matches (extend `handlePoolLaunch` window options with `channel: process.env.READ_CHANNEL`). Re-test decryption (cookies present after `pool_launch`).
- [ ] **Step 4:** Log the outcome in `PROBLEMS.md` (new entry) and update the `browser` skill's engine note.
- [ ] **Step 5: Commit** any engine-constant change.

---

### Task 7: Teach the `browser` skill the full cycle

**Files:**
- Modify: `~/.claude/skills/browser/SKILL.md` (+ committed backup in Brain repo).
- Modify: `playwright-pool/PROBLEMS.md` (cross-links), project `CLAUDE.md` if needed.

- [ ] **Step 1:** Add a "Profile lifecycle (3 phases)" section: create/use/update, the named-profile model, multi-account-is-free, raw-no-automation rule, `default` fallback, identity-echo expectation, unknown-name = stop+offer-create, sticky-within-task.
- [ ] **Step 2:** Add the resolved engine decision (from Task 6) to §2/§3.
- [ ] **Step 3:** Cross-link PROBLEMS.md P-02 / P-03 / P-06.
- [ ] **Step 4: Commit** the skill backup in the Brain repo.

---

## Self-Review

- **Spec coverage:** resolver (T1), `profileName`+echo (T2), raw login+`--profile` (T3), `profiles`/`status` (T4), migration+config (T5), engine validation (T6), skill (T7). All spec sections covered.
- **Placeholders:** none — Task 2 steps 5/6 describe edits to existing large functions with the exact replacement code blocks; remaining work is mechanical wiring shown inline.
- **Type consistency:** `resolveProfile`→`{name,path}`, `profileAccounts(path)→string[]`, `listProfiles()→[{name,path,exists,hasDefault}]`, `ensureTemplate(name)→{name,path}` used consistently across T1/T2/T4.
- **Human gates:** T6 (Google login) and the `.mcp.json` restart (T5) are explicitly flagged.
