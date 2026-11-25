import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

test('zh-CN.json dictionary is valid and non-empty with no empty translations', () => {
  const dictPath = path.join(rootDir, 'core', 'i18n', 'zh-CN.json');
  const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
  const entries = Object.entries(dict).filter(([k]) => !k.startsWith('_'));
  assert.ok(entries.length >= 150, `Expected at least 150 entries, got ${entries.length}`);

  for (const [en, zh] of entries) {
    assert.equal(typeof zh, 'string', `Translation for "${en}" must be a string`);
    assert.ok(zh.trim().length > 0, `Translation for "${en}" must not be empty`);
  }
});

test('patterns.json regex rules compile cleanly and transform sample UI strings', () => {
  const patternsPath = path.join(rootDir, 'core', 'i18n', 'patterns.json');
  const patterns = JSON.parse(fs.readFileSync(patternsPath, 'utf8'));
  assert.ok(Array.isArray(patterns) && patterns.length >= 10);

  const compiled = patterns.map((p) => ({
    ...p,
    regex: new RegExp(p.pattern, p.flags || '')
  }));

  const translate = (text) => {
    for (const p of compiled) {
      if (p.regex.test(text)) return text.replace(p.regex, p.replace);
    }
    return text;
  };

  assert.equal(translate('3 files changed'), '3 个文件已修改');
  assert.equal(translate('Thought for 4.2s'), '已思考 4.2 秒');
  assert.equal(translate('Step 2 of 5'), '第 2 / 5 步');
  assert.equal(translate('12m ago'), '12 分钟前');
  assert.equal(translate('Version 2.35.0 is available'), '发现新版本 2.35.0');
  assert.equal(translate('Quota resets in 2h 15m'), '配额将在 2h 15m 后重置');
});
