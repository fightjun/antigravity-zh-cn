import fs from 'node:fs';
import path from 'node:path';
import { compareSemver, MIN_NODE_VERSION, readJsonSafe, writeJsonAtomic } from '../shared.mjs';
import { resolveAntigravityChannel, readDevToolsPort } from '../daemon/paths.mjs';
import { listCdpTargets, selectAntigravityTargets } from '../daemon/cdp-bridge.mjs';

export function checkNodeVersion() {
  const current = process.versions.node;
  return {
    version: current,
    minRequired: MIN_NODE_VERSION,
    ok: compareSemver(current, MIN_NODE_VERSION) >= 0
  };
}

export function ensureArgvRemoteDebugging(argvPath) {
  if (!argvPath) return { updated: false };
  const existing = readJsonSafe(argvPath, {});
  const data = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  if (data['remote-debugging-port'] === 0 || data['remote-debugging-port'] === '0') {
    return { updated: false, path: argvPath };
  }
  data['remote-debugging-port'] = 0;
  writeJsonAtomic(argvPath, data);
  return { updated: true, path: argvPath };
}

export function removeArgvRemoteDebugging(argvPath) {
  if (!argvPath || !fs.existsSync(argvPath)) return { updated: false };
  const data = readJsonSafe(argvPath, null);
  if (!data || typeof data !== 'object' || !('remote-debugging-port' in data)) {
    return { updated: false };
  }
  delete data['remote-debugging-port'];
  writeJsonAtomic(argvPath, data);
  return { updated: true, path: argvPath };
}

export async function inspectLiveWindow(channelInfo) {
  const portInfo = readDevToolsPort(channelInfo.userDataDir);
  if (!portInfo) {
    return { reachable: false, port: null, targets: [] };
  }
  const allTargets = await listCdpTargets(portInfo.port);
  const appTargets = selectAntigravityTargets(allTargets);
  return {
    reachable: appTargets.length > 0,
    port: portInfo.port,
    targets: appTargets.map((t) => ({ id: t.id, title: t.title, url: t.url }))
  };
}

export async function detectEnvironment(channel = 'auto') {
  const node = checkNodeVersion();
  const channelInfo = resolveAntigravityChannel(channel);
  const live = await inspectLiveWindow(channelInfo);
  const argv = readJsonSafe(channelInfo.argvPath, {});
  const argvHasFlag = Boolean(
    argv && (argv['remote-debugging-port'] === 0 || argv['remote-debugging-port'] === '0')
  );

  return {
    platform: process.platform,
    arch: process.arch,
    node,
    antigravity: {
      channel: channelInfo.channel,
      appExists: channelInfo.appExists,
      appVersion: channelInfo.appVersion,
      executable: channelInfo.executable,
      userDataDir: channelInfo.userDataDir,
      argvPath: channelInfo.argvPath,
      argvHasFlag,
      portFile: channelInfo.portFile,
      portFileExists: channelInfo.portExists
    },
    live
  };
}
