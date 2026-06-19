// Profile resolver — named credential profiles for the playwright-pool golden-profile model.
//
// One base dir holds many named profiles (`default`, `business-A`, ...). Each is a Chromium
// user-data-dir whose `Default/` auth files are the durable snapshot the pool overlays.
//
// Resolution:
//   - `default` → GOLDEN_PROFILE env if set (legacy, in-place), else PROFILES_DIR/default
//   - any other name → PROFILES_DIR/<name>
// PROFILES_DIR defaults to POOL_BASE/profiles (POOL_BASE = ~/.playwright-pool).

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const DEFAULT_PROFILE = 'default';

const HOME = os.homedir();
const POOL_BASE = process.env.POOL_BASE || path.join(HOME, '.playwright-pool');
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

function profilesDir() {
  return process.env.PROFILES_DIR || path.join(POOL_BASE, 'profiles');
}

function assertSafe(name) {
  if (typeof name !== 'string' || !SAFE_NAME.test(name) || name === '.' || name === '..') {
    throw new Error(`Invalid profile name "${name}". Use letters, digits, dot, dash, underscore.`);
  }
}

export function resolveProfile(name = DEFAULT_PROFILE) {
  assertSafe(name);
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
