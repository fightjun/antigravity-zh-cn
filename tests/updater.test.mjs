import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  diffManifests,
  checkForUpdates,
  applyPluginUpdate,
  rollbackPlugin,
  detectAntigravityVersionChange
} from '../core/daemon/updater.mjs';
import { buildManifest, sha256Buffer, verifyCoreIntegrity } from '../core/installer/manifest.mjs';

function makeTempPluginDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-zh-test-'));
  fs.mkdirSync(path.join(dir, 'core', 'i18n'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'user'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  fs.writeFileSync(
    path.join(dir, 'core', 'i18n', 'zh-CN.json'),
    JSON.stringify({ Settings: '设置' })
  );
  fs.writeFileSync(path.join(dir, 'core', 'i18n', 'patterns.json'), '[]');
  fs.writeFileSync(
    path.join(dir, 'user', 'overrides.json'),
    JSON.stringify({ exact: { Custom: '自定义' } })
  );
  buildManifest(dir);
  return dir;
}

test('diffManifests detects dictionary-only updates even without version bump', () => {
  const local = {
    version: '1.0.0',
    files: {
      'i18n/zh-CN.json': { sha256: 'aaa' },
      'daemon.mjs': { sha256: 'bbb' }
    }
  };
  const remote = {
    version: '1.0.0',
    files: {
      'i18n/zh-CN.json': { sha256: 'ccc' },
      'daemon.mjs': { sha256: 'bbb' }
    }
  };
  const diff = diffManifests(local, remote);
  assert.equal(diff.hasUpdates, true);
  assert.equal(diff.dictionaryOnly, true);
  assert.deepEqual(diff.changed, ['i18n/zh-CN.json']);

  // Must never downgrade if local version is newer than remote (e.g., CDN cache lag)
  const noDowngrade = diffManifests(
    { version: '1.0.7', files: { 'i18n/zh-CN.json': { sha256: 'new' } } },
    { version: '1.0.5', files: { 'i18n/zh-CN.json': { sha256: 'old' } } }
  );
  assert.equal(noDowngrade.hasUpdates, false);
});

test('applyPluginUpdate verifies SHA-256, preserves user/, and supports rollback', async () => {
  const dir = makeTempPluginDir();
  try {
    const newDictBuf = Buffer.from(JSON.stringify({ Settings: '设置', Projects: '项目' }));
    const patternsBuf = fs.readFileSync(path.join(dir, 'core', 'i18n', 'patterns.json'));

    const remoteManifest = {
      schemaVersion: 1,
      version: '1.1.0',
      files: {
        'i18n/zh-CN.json': { sha256: sha256Buffer(newDictBuf), size: newDictBuf.length },
        'i18n/patterns.json': { sha256: sha256Buffer(patternsBuf), size: patternsBuf.length }
      }
    };

    const mockFetcher = async (url) => {
      if (url.endsWith('core/manifest.json')) return Buffer.from(JSON.stringify(remoteManifest));
      if (url.endsWith('core/i18n/zh-CN.json')) return newDictBuf;
      if (url.endsWith('core/i18n/patterns.json')) return patternsBuf;
      throw new Error(`Unexpected URL: ${url}`);
    };

    const cfg = { updateRepo: 'acme/antigravity-zh-cn', updateRef: 'main' };
    const check = await checkForUpdates(dir, cfg, { fetcher: mockFetcher });
    assert.equal(check.ok, true);
    assert.equal(check.hasUpdates, true);
    assert.equal(check.remoteVersion, '1.1.0');

    const applied = await applyPluginUpdate(dir, cfg, { fetcher: mockFetcher, prechecked: check });
    assert.equal(applied.ok, true);
    assert.equal(applied.updated, true);
    assert.equal(applied.toVersion, '1.1.0');
    assert.equal(verifyCoreIntegrity(dir).ok, true);

    // User overrides must be preserved untouched
    const overrides = JSON.parse(fs.readFileSync(path.join(dir, 'user', 'overrides.json'), 'utf8'));
    assert.equal(overrides.exact.Custom, '自定义');

    // Rollback restores 1.0.0
    const rb = rollbackPlugin(dir);
    assert.equal(rb.ok, true);
    assert.equal(rb.restoredVersion, '1.0.0');
    const restoredDict = JSON.parse(
      fs.readFileSync(path.join(dir, 'core', 'i18n', 'zh-CN.json'), 'utf8')
    );
    assert.equal(restoredDict.Projects, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applyPluginUpdate rejects corrupted downloads on SHA-256 mismatch', async () => {
  const dir = makeTempPluginDir();
  try {
    const remoteManifest = {
      schemaVersion: 1,
      version: '1.2.0',
      files: {
        'i18n/zh-CN.json': { sha256: 'deadbeef', size: 10 }
      }
    };
    const mockFetcher = async (url) => {
      if (url.endsWith('core/manifest.json')) return Buffer.from(JSON.stringify(remoteManifest));
      return Buffer.from('tampered content');
    };

    const cfg = { updateRepo: 'acme/antigravity-zh-cn', updateRef: 'main' };
    const res = await applyPluginUpdate(dir, cfg, { fetcher: mockFetcher });
    assert.equal(res.ok, false);
    assert.match(res.error, /SHA-256 mismatch/);
    // Original core/ remains intact
    assert.equal(verifyCoreIntegrity(dir).ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('detectAntigravityVersionChange detects app upgrades across restarts', () => {
  const dir = makeTempPluginDir();
  try {
    const first = detectAntigravityVersionChange(dir, '2.34.0');
    assert.equal(first.upgraded, false);

    const same = detectAntigravityVersionChange(dir, '2.34.0');
    assert.equal(same.upgraded, false);

    const upgraded = detectAntigravityVersionChange(dir, '2.35.0');
    assert.equal(upgraded.upgraded, true);
    assert.equal(upgraded.previousVersion, '2.34.0');
    assert.equal(upgraded.currentVersion, '2.35.0');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
