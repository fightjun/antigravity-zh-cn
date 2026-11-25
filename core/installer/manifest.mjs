import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readJsonSafe, writeJsonAtomic } from '../shared.mjs';

export function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function walkRelativeFiles(baseDir, currentDir = baseDir) {
  const results = [];
  if (!fs.existsSync(currentDir)) return results;
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkRelativeFiles(baseDir, full));
    } else {
      const rel = path.relative(baseDir, full).replace(/\\/g, '/');
      if (rel !== 'manifest.json') {
        results.push(rel);
      }
    }
  }
  return results.sort();
}

export function buildManifest(rootDir) {
  const pkg = readJsonSafe(path.join(rootDir, 'package.json'), { version: '1.0.0' });
  const coreDir = path.join(rootDir, 'core');
  const files = {};
  for (const rel of walkRelativeFiles(coreDir)) {
    const fullPath = path.join(coreDir, rel);
    files[rel] = {
      sha256: sha256File(fullPath),
      size: fs.statSync(fullPath).size
    };
  }

  const dict = readJsonSafe(path.join(coreDir, 'i18n', 'zh-CN.json'), {});
  const patterns = readJsonSafe(path.join(coreDir, 'i18n', 'patterns.json'), []);

  const manifest = {
    schemaVersion: 1,
    version: pkg.version || '1.0.0',
    generatedAt: new Date().toISOString(),
    stats: {
      exactCount: Object.keys(dict).filter((k) => !k.startsWith('_')).length,
      patternCount: Array.isArray(patterns) ? patterns.length : 0,
      fileCount: Object.keys(files).length
    },
    files
  };

  writeJsonAtomic(path.join(coreDir, 'manifest.json'), manifest);
  return manifest;
}

export function verifyCoreIntegrity(rootDir) {
  const coreDir = path.join(rootDir, 'core');
  const manifestPath = path.join(coreDir, 'manifest.json');
  const manifest = readJsonSafe(manifestPath, null);
  if (!manifest || !manifest.files || typeof manifest.files !== 'object') {
    return {
      ok: false,
      version: null,
      missing: ['core/manifest.json'],
      modified: [],
      extra: []
    };
  }

  const missing = [];
  const modified = [];
  const expectedSet = new Set(Object.keys(manifest.files));

  for (const [rel, meta] of Object.entries(manifest.files)) {
    const fullPath = path.join(coreDir, rel);
    if (!fs.existsSync(fullPath)) {
      missing.push(rel);
      continue;
    }
    const actualHash = sha256File(fullPath);
    if (actualHash !== meta.sha256) {
      modified.push(rel);
    }
  }

  const actualFiles = walkRelativeFiles(coreDir);
  const extra = actualFiles.filter((rel) => !expectedSet.has(rel));

  return {
    ok: missing.length === 0 && modified.length === 0,
    version: manifest.version || null,
    missing,
    modified,
    extra
  };
}
