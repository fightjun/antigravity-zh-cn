import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readJsonSafe } from '../shared.mjs';

export function getChannelCandidates(channel = 'auto') {
  const home = os.homedir();
  const platform = process.platform;
  const defs = [];

  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    defs.push(
      {
        channel: 'stable',
        appDir: path.join(localAppData, 'Programs', 'Antigravity'),
        executable: path.join(localAppData, 'Programs', 'Antigravity', 'Antigravity.exe'),
        userDataDir: path.join(appData, 'Antigravity'),
        argvPath: path.join(home, '.antigravity', 'argv.json'),
        pkgJsonPath: path.join(localAppData, 'Programs', 'Antigravity', 'resources', 'app', 'package.json')
      },
      {
        channel: 'insiders',
        appDir: path.join(localAppData, 'Programs', 'Antigravity Insiders'),
        executable: path.join(localAppData, 'Programs', 'Antigravity Insiders', 'Antigravity - Insiders.exe'),
        userDataDir: path.join(appData, 'Antigravity - Insiders'),
        argvPath: path.join(home, '.antigravity-insiders', 'argv.json'),
        pkgJsonPath: path.join(localAppData, 'Programs', 'Antigravity Insiders', 'resources', 'app', 'package.json')
      }
    );
  } else if (platform === 'darwin') {
    defs.push(
      {
        channel: 'stable',
        appDir: '/Applications/Antigravity.app',
        executable: '/Applications/Antigravity.app/Contents/MacOS/Antigravity',
        userDataDir: path.join(home, 'Library', 'Application Support', 'Antigravity'),
        argvPath: path.join(home, '.antigravity', 'argv.json'),
        pkgJsonPath: '/Applications/Antigravity.app/Contents/Resources/app/package.json'
      },
      {
        channel: 'insiders',
        appDir: '/Applications/Antigravity - Insiders.app',
        executable: '/Applications/Antigravity - Insiders.app/Contents/MacOS/Antigravity - Insiders',
        userDataDir: path.join(home, 'Library', 'Application Support', 'Antigravity - Insiders'),
        argvPath: path.join(home, '.antigravity-insiders', 'argv.json'),
        pkgJsonPath: '/Applications/Antigravity - Insiders.app/Contents/Resources/app/package.json'
      }
    );
  } else {
    defs.push(
      {
        channel: 'stable',
        appDir: '/usr/share/antigravity',
        executable: '/usr/share/antigravity/antigravity',
        userDataDir: path.join(home, '.config', 'Antigravity'),
        argvPath: path.join(home, '.antigravity', 'argv.json'),
        pkgJsonPath: '/usr/share/antigravity/resources/app/package.json'
      },
      {
        channel: 'insiders',
        appDir: '/usr/share/antigravity-insiders',
        executable: '/usr/share/antigravity-insiders/antigravity-insiders',
        userDataDir: path.join(home, '.config', 'Antigravity - Insiders'),
        argvPath: path.join(home, '.antigravity-insiders', 'argv.json'),
        pkgJsonPath: '/usr/share/antigravity-insiders/resources/app/package.json'
      }
    );
  }

  if (channel === 'stable' || channel === 'insiders') {
    return defs.filter((d) => d.channel === channel);
  }
  return defs;
}

export function resolveAntigravityChannel(channel = 'auto') {
  const candidates = getChannelCandidates(channel);
  for (const item of candidates) {
    const portFile = path.join(item.userDataDir, 'DevToolsActivePort');
    const appExists = fs.existsSync(item.executable) || fs.existsSync(item.appDir);
    const portExists = fs.existsSync(portFile);
    if (appExists || portExists) {
      const pkg = readJsonSafe(item.pkgJsonPath, null);
      return {
        ...item,
        appExists,
        portFile,
        portExists,
        appVersion: pkg?.version || null
      };
    }
  }

  const fallback = candidates[0];
  return {
    ...fallback,
    appExists: false,
    portFile: path.join(fallback.userDataDir, 'DevToolsActivePort'),
    portExists: false,
    appVersion: null
  };
}

export function readDevToolsPort(userDataDir) {
  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  if (!fs.existsSync(portFile)) return null;
  try {
    const lines = fs
      .readFileSync(portFile, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const port = Number.parseInt(lines[0], 10);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
    return {
      port,
      browserWsPath: lines[1] || null,
      portFile
    };
  } catch {
    return null;
  }
}
