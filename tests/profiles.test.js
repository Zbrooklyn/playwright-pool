import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { resolveProfile, listProfiles, profileAccounts, DEFAULT_PROFILE } from '../lib/profiles.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-prof-'));
process.env.PROFILES_DIR = path.join(TMP, 'profiles');
delete process.env.GOLDEN_PROFILE;

test('DEFAULT_PROFILE is "default"', () => {
  assert.equal(DEFAULT_PROFILE, 'default');
});

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

test('profileAccounts reads emails from Preferences account_info', () => {
  const p = path.join(TMP, 'profiles', 'with-accts', 'Default');
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'Preferences'), JSON.stringify({
    account_info: [{ email: 'you@biz-a.com' }, { full_name: 'Personal' }],
  }));
  assert.deepEqual(profileAccounts(path.join(TMP, 'profiles', 'with-accts')), ['you@biz-a.com', 'Personal']);
});
