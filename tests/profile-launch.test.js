import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { resolveProfile } from '../lib/profiles.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-launch-'));
process.env.PROFILES_DIR = path.join(TMP, 'profiles');
delete process.env.GOLDEN_PROFILE;

// Regression anchor: resolveProfile is what drives where the overlay reads from in
// server.js ensureTemplate(). If this contract changes, the launch wiring breaks.
test('resolveProfile drives where the overlay reads from', () => {
  const r = resolveProfile('business-A');
  fs.mkdirSync(path.join(r.path, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(r.path, 'Default', 'Login Data'), 'x');
  assert.equal(r.name, 'business-A');
  assert.ok(fs.existsSync(path.join(r.path, 'Default', 'Login Data')));
});

test('unknown profile resolves to a path with no Default/ (ensureTemplate will reject)', () => {
  const r = resolveProfile('does-not-exist');
  assert.equal(fs.existsSync(path.join(r.path, 'Default')), false);
});
