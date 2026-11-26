import fs from 'node:fs';
import path from 'node:path';
import {
  compareSemver,
  copyDirRecursive,
  readJsonSafe,
  writeJsonAtomic
} from '../shared.mjs';
import { sha256Buffer, sha256File } from '../installer/manifest.mjs';

export function buildRawGitHubUrl(repo, ref, relPath) {
  const cleanRepo = repo.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  const cleanRef = encodeURIComponent(ref || 'main');
  const cleanPath = relPath.replace(/^\/+/, '');
  return `https://raw.githubusercontent.com/${cleanRepo}/${cleanRef}/${cleanPath}`;
}

export async function fetchBuffer(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'antigravity-zh-cn-updater/1.0',
        'Cache-Control': 'no-cache'
      }
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  } finally {
    clearTimeout(timer);
  }
}

export function diffManifests(localManifest, remoteManifest) {
  const localFiles = localManifest?.files || {};
  const remoteFiles = remoteManifest?.files || {};

  const changed = [];
  const added = [];
  const removed = [];

  for (const [rel, meta] of Object.entries(remoteFiles)) {
    if (!localFiles[rel]) {
      added.push(rel);
    } else if (localFiles[rel].sha256 !== meta.sha256) {
      changed.push(rel);
    }
  }

  for (const rel of Object.keys(localFiles)) {
    if (!remoteFiles[rel]) {
      removed.push(rel);
    }
  }

  const localVer = localManifest?.version || '0.0.0';
  const remoteVer = remoteManifest?.version || '0.0.0';
  const versionCmp = compareSemver(remoteVer, localVer);
  // Never downgrade when local version is newer than remote (e.g. GitHub raw CDN cache lag or local dev)
  const hasUpdates =
    versionCmp > 0 ||
    (versionCmp === 0 && (changed.length > 0 || added.length > 0 || removed.length > 0));

  return {
    hasUpdates,
    localVersion: localVer,
    remoteVersion: remoteVer,
    isVersionBump: versionCmp > 0,
    dictionaryOnly:
      hasUpdates &&
      removed.length === 0 &&
      [...changed, ...added].every((f) => f.startsWith('i18n/')),
    changed,
    added,
    removed,
    remoteStats: remoteManifest?.stats || null
  };
}

export async function checkForUpdates(targetDir, config, { fetcher = fetchBuffer } = {}) {
  const repo = config.updateRepo;
  const ref = config.updateRef || 'main';
  const localManifest = readJsonSafe(path.join(targetDir, 'core', 'manifest.json'), null);

  if (!repo || repo.startsWith('your-org/')) {
    return {
      ok: false,
      configured: false,
      hasUpdates: false,
      localVersion: localManifest?.version || '1.0.0',
      error: '尚未配置 GitHub 仓库地址（请在设置中填写 updateRepo，例如 owner/antigravity-zh-cn）'
    };
  }

  try {
    const manifestUrl = buildRawGitHubUrl(repo, ref, 'core/manifest.json');
    const buf = await fetcher(manifestUrl);
    const remoteManifest = JSON.parse(buf.toString('utf8'));
    if (!remoteManifest || !remoteManifest.files) {
      throw new Error('Remote manifest.json is invalid');
    }

    const diff = diffManifests(localManifest, remoteManifest);
    return {
      ok: true,
      configured: true,
      repo,
      ref,
      checkedAt: new Date().toISOString(),
      ...diff,
      remoteManifest
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      hasUpdates: false,
      localVersion: localManifest?.version || '1.0.0',
      checkedAt: new Date().toISOString(),
      error: err.message || String(err)
    };
  }
}

export async function applyPluginUpdate(targetDir, config, { fetcher = fetchBuffer, prechecked = null } = {}) {
  const check = prechecked || (await checkForUpdates(targetDir, config, { fetcher }));
  if (!check.ok) {
    return { ok: false, updated: false, error: check.error };
  }
  if (!check.hasUpdates) {
    return {
      ok: true,
      updated: false,
      version: check.localVersion,
      message: '当前已是最新版本'
    };
  }

  const coreDir = path.join(targetDir, 'core');
  const stagingDir = path.join(targetDir, 'core.staging');
  const prevDir = path.join(targetDir, 'core.prev');
  const backupsDir = path.join(targetDir, 'backups');

  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  try {
    const remoteFiles = check.remoteManifest.files;
    const filesToDownload = new Set([...check.changed, ...check.added]);

    // Copy unchanged files from current core/ into staging/
    for (const [rel, meta] of Object.entries(remoteFiles)) {
      const destPath = path.join(stagingDir, rel);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });

      if (!filesToDownload.has(rel)) {
        const localPath = path.join(coreDir, rel);
        if (fs.existsSync(localPath) && sha256File(localPath) === meta.sha256) {
          fs.copyFileSync(localPath, destPath);
          continue;
        }
      }

      const url = buildRawGitHubUrl(check.repo, check.ref, `core/${rel}`);
      const buf = await fetcher(url);
      const actualHash = sha256Buffer(buf);
      if (actualHash !== meta.sha256) {
        throw new Error(`SHA-256 mismatch for core/${rel}: expected ${meta.sha256}, got ${actualHash}`);
      }
      fs.writeFileSync(destPath, buf);
    }

    // Write verified manifest.json into staging/
    writeJsonAtomic(path.join(stagingDir, 'manifest.json'), check.remoteManifest);

    // Create timestamped backup + core.prev/
    if (fs.existsSync(coreDir)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.mkdirSync(backupsDir, { recursive: true });
      copyDirRecursive(coreDir, path.join(backupsDir, stamp));
      fs.rmSync(prevDir, { recursive: true, force: true });
      copyDirRecursive(coreDir, prevDir);

      // Keep at most 5 recent timestamped backups
      const entries = fs.readdirSync(backupsDir).sort();
      while (entries.length > 5) {
        const oldest = entries.shift();
        fs.rmSync(path.join(backupsDir, oldest), { recursive: true, force: true });
      }
    }

    // Atomic swap: replace core/ with verified staging/
    fs.rmSync(coreDir, { recursive: true, force: true });
    fs.renameSync(stagingDir, coreDir);

    // Update package.json version if present
    const pkgPath = path.join(targetDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = readJsonSafe(pkgPath, null);
      if (pkg && check.remoteVersion) {
        pkg.version = check.remoteVersion;
        writeJsonAtomic(pkgPath, pkg);
      }
    }

    return {
      ok: true,
      updated: true,
      fromVersion: check.localVersion,
      toVersion: check.remoteVersion,
      dictionaryOnly: check.dictionaryOnly,
      changedCount: check.changed.length + check.added.length,
      removedCount: check.removed.length,
      updatedAt: new Date().toISOString()
    };
  } catch (err) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    return {
      ok: false,
      updated: false,
      error: err.message || String(err)
    };
  }
}

export function rollbackPlugin(targetDir) {
  const coreDir = path.join(targetDir, 'core');
  const prevDir = path.join(targetDir, 'core.prev');
  if (!fs.existsSync(prevDir)) {
    return { ok: false, error: '没有可回滚的备份版本（未找到 core.prev）' };
  }

  const prevManifest = readJsonSafe(path.join(prevDir, 'manifest.json'), null);
  const tempRollback = path.join(targetDir, 'core.rollback.tmp');
  fs.rmSync(tempRollback, { recursive: true, force: true });
  copyDirRecursive(prevDir, tempRollback);

  fs.rmSync(coreDir, { recursive: true, force: true });
  fs.renameSync(tempRollback, coreDir);

  return {
    ok: true,
    restoredVersion: prevManifest?.version || 'unknown',
    restoredAt: new Date().toISOString()
  };
}

/**
 * Tracks Antigravity app version across restarts.
 * Returns { upgraded: boolean, previousVersion, currentVersion } when Antigravity updates!
 */
export function detectAntigravityVersionChange(targetDir, currentAppVersion) {
  const statePath = path.join(targetDir, 'state.json');
  const state = readJsonSafe(statePath, {});
  const previousVersion = state.lastAntigravityVersion || null;

  if (!currentAppVersion) {
    return { upgraded: false, previousVersion, currentVersion: null };
  }

  const upgraded = Boolean(previousVersion && previousVersion !== currentAppVersion);
  if (previousVersion !== currentAppVersion) {
    state.lastAntigravityVersion = currentAppVersion;
    if (upgraded) {
      state.lastAntigravityUpgradeAt = new Date().toISOString();
      state.previousAntigravityVersion = previousVersion;
    }
    writeJsonAtomic(statePath, state);
  }

  return {
    upgraded,
    previousVersion,
    currentVersion: currentAppVersion
  };
}
