import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSemver, normalizeConfig, stripUtf8Bom, deepMerge } from '../core/shared.mjs';

test('compareSemver orders semantic versions correctly', () => {
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
  assert.equal(compareSemver('v1.2.0', '1.1.9'), 1);
  assert.equal(compareSemver('1.0.0', '2.0.0'), -1);
  assert.equal(compareSemver('2.34.1', '2.34.0'), 1);
});

test('stripUtf8Bom removes leading BOM if present', () => {
  assert.equal(stripUtf8Bom('\uFEFF{"a":1}'), '{"a":1}');
  assert.equal(stripUtf8Bom('{"a":1}'), '{"a":1}');
});

test('normalizeConfig enforces valid defaults and bounds', () => {
  const cfg = normalizeConfig({
    enabled: false,
    channel: 'invalid-channel',
    updateMode: 'bogus',
    checkIntervalHours: 0,
    updateRepo: 'not-a-repo'
  });
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.channel, 'auto');
  assert.equal(cfg.updateMode, 'auto');
  assert.equal(cfg.checkIntervalHours, 12);
  assert.equal(cfg.updateRepo, 'fightjun/antigravity-zh-cn');
});

test('deepMerge merges nested plain objects without mutating base', () => {
  const base = { a: 1, nested: { x: 1, y: 2 } };
  const merged = deepMerge(base, { nested: { y: 99 } });
  assert.deepEqual(merged, { a: 1, nested: { x: 1, y: 99 } });
  assert.equal(base.nested.y, 2);
});
