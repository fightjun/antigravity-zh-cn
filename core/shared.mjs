import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const PLUGIN_ID = 'antigravity-zh-cn';
export const MIN_NODE_VERSION = '22.13.0';

export const SERVICE_IDS = Object.freeze({
  installDirName: 'zh-cn',
  serviceName: 'antigravity-zh-cn',
  windowsTaskName: 'AntigravityZhCnDaemon',
  launchAgentLabel: 'com.antigravity.zh-cn.daemon',
  systemdUnit: 'antigravity-zh-cn.service'
});

export const DEFAULT_USER_CONFIG = Object.freeze({
  enabled: true,
  channel: 'auto',
  autoUpdate: true,
  autoUpdateOnAppUpgrade: true,
  updateMode: 'auto', // 'auto' | 'notify' | 'manual'
  updateRepo: 'fightjun/antigravity-zh-cn',
  updateRef: 'main',
  checkIntervalHours: 12,
  collectUntranslated: true,
  translatePlaceholders: true,
  translateTooltips: true,
  debug: false
});

export function stripUtf8Bom(text) {
  if (typeof text !== 'string') return '';
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function readJsonSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = stripUtf8Bom(fs.readFileSync(filePath, 'utf8'));
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return base;
  }
  const result = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (
      val &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], val);
    } else if (val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}

export function normalizeConfig(raw) {
  const merged = deepMerge(DEFAULT_USER_CONFIG, raw || {});
  merged.enabled = Boolean(merged.enabled);
  merged.autoUpdate = Boolean(merged.autoUpdate);
  merged.autoUpdateOnAppUpgrade = Boolean(merged.autoUpdateOnAppUpgrade);
  merged.collectUntranslated = Boolean(merged.collectUntranslated);
  merged.translatePlaceholders = Boolean(merged.translatePlaceholders);
  merged.translateTooltips = Boolean(merged.translateTooltips);
  merged.debug = Boolean(merged.debug);
  if (!['auto', 'stable', 'insiders'].includes(merged.channel)) {
    merged.channel = 'auto';
  }
  if (!['auto', 'notify', 'manual'].includes(merged.updateMode)) {
    merged.updateMode = 'auto';
  }
  const hours = Number(merged.checkIntervalHours);
  merged.checkIntervalHours = Number.isFinite(hours) && hours >= 1 ? Math.min(hours, 720) : 12;
  if (typeof merged.updateRepo !== 'string' || !merged.updateRepo.includes('/')) {
    merged.updateRepo = DEFAULT_USER_CONFIG.updateRepo;
  }
  if (typeof merged.updateRef !== 'string' || !merged.updateRef.trim()) {
    merged.updateRef = DEFAULT_USER_CONFIG.updateRef;
  }
  return merged;
}

export function parseSemver(ver) {
  if (typeof ver !== 'string') return [0, 0, 0];
  const cleaned = ver.trim().replace(/^v/i, '').split(/[-+]/)[0];
  const parts = cleaned.split('.').map((n) => {
    const parsed = Number.parseInt(n, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

export function getDefaultInstallDir() {
  return path.join(os.homedir(), '.gemini', 'antigravity', SERVICE_IDS.installDirName);
}

export function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
