import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeConfig,
  readJsonSafe,
  writeJsonAtomic,
  getDefaultInstallDir,
  sleep
} from './shared.mjs';
import { resolveAntigravityChannel, readDevToolsPort } from './daemon/paths.mjs';
import { listCdpTargets, selectAntigravityTargets, CdpPageSession } from './daemon/cdp-bridge.mjs';
import {
  checkForUpdates,
  applyPluginUpdate,
  rollbackPlugin,
  detectAntigravityVersionChange
} from './daemon/updater.mjs';
import { ensureArgvRemoteDebugging } from './installer/env.mjs';
import {
  ensureCdpLaunchers,
  detectFreshNonCdpAntigravity,
  relaunchAntigravityWithCdp
} from './installer/cdp-launch.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..');

export class ZhCnDaemon {
  constructor({ targetDir = DEFAULT_ROOT, once = false } = {}) {
    this.targetDir = path.resolve(targetDir);
    this.once = once;
    this.sessions = new Map(); // targetId -> CdpPageSession
    this.lastUpdateCheckAt = 0;
    this.lastUpdateResult = null;
    this.lastAppUpgradeInfo = null;
    this.lastRelayAt = 0;
    this.running = false;
    this.config = this.loadConfig();
  }

  log(...args) {
    const stamp = new Date().toISOString();
    const line = `[antigravity-zh-cn ${stamp}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
    console.log(line);
    try {
      const logPath = path.join(this.targetDir, 'daemon.log');
      fs.appendFileSync(logPath, line + '\n', 'utf8');
    } catch {
      // Ignore log file errors
    }
  }

  getConfigPath() {
    return path.join(this.targetDir, 'user', 'config.json');
  }

  getOverridesPath() {
    return path.join(this.targetDir, 'user', 'overrides.json');
  }

  getUntranslatedPath() {
    return path.join(this.targetDir, 'untranslated.json');
  }

  loadConfig() {
    const raw = readJsonSafe(this.getConfigPath(), {});
    return normalizeConfig(raw);
  }

  loadOverrides() {
    const raw = readJsonSafe(this.getOverridesPath(), { exact: {}, patterns: [] });
    return {
      exact: raw && typeof raw.exact === 'object' && !Array.isArray(raw.exact) ? raw.exact : {},
      patterns: Array.isArray(raw?.patterns) ? raw.patterns : []
    };
  }

  loadDictionary() {
    const coreDir = path.join(this.targetDir, 'core');
    const exactRaw = readJsonSafe(path.join(coreDir, 'i18n', 'zh-CN.json'), {});
    const patternsRaw = readJsonSafe(path.join(coreDir, 'i18n', 'patterns.json'), []);
    const overrides = this.loadOverrides();

    const exact = {};
    for (const [k, v] of Object.entries(exactRaw)) {
      if (!k.startsWith('_') && typeof v === 'string') {
        exact[k] = v;
      }
    }
    for (const [k, v] of Object.entries(overrides.exact)) {
      if (!k.startsWith('_') && typeof v === 'string') {
        exact[k] = v;
      }
    }

    const patterns = [
      ...(Array.isArray(overrides.patterns) ? overrides.patterns : []),
      ...(Array.isArray(patternsRaw) ? patternsRaw : [])
    ];

    return {
      exact,
      patterns,
      overrideCount: Object.keys(overrides.exact).length
    };
  }

  buildStatusSnapshot() {
    const manifest = readJsonSafe(path.join(this.targetDir, 'core', 'manifest.json'), {});
    const channelInfo = resolveAntigravityChannel(this.config.channel);
    const dict = this.loadDictionary();
    const untranslated = readJsonSafe(this.getUntranslatedPath(), {});
    const hasRollback = fs.existsSync(path.join(this.targetDir, 'core.prev', 'manifest.json'));

    return {
      pluginVersion: manifest?.version || '1.0.0',
      antigravityVersion: channelInfo.appVersion || 'unknown',
      channel: channelInfo.channel,
      exactCount: Object.keys(dict.exact).length,
      patternCount: dict.patterns.length,
      overrideCount: dict.overrideCount,
      untranslatedCount: Object.keys(untranslated).length,
      hasRollback,
      config: this.config,
      lastUpdateResult: this.lastUpdateResult,
      lastAppUpgradeInfo: this.lastAppUpgradeInfo,
      targetDir: this.targetDir
    };
  }

  buildInjectionScript() {
    const coreDir = path.join(this.targetDir, 'core');
    const cssPath = path.join(coreDir, 'styles', 'settings-panel.css');
    const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
    const dict = this.loadDictionary();
    const status = this.buildStatusSnapshot();

    const runtimeDir = path.join(coreDir, 'runtime');
    const runtimeFiles = fs
      .readdirSync(runtimeDir)
      .filter((f) => f.endsWith('.js'))
      .sort();
    const runtimeSource = runtimeFiles
      .map((f) => `/* === ${f} === */\n${fs.readFileSync(path.join(runtimeDir, f), 'utf8')}`)
      .join('\n\n');

    const bootPayload = {
      status,
      css,
      dictionary: {
        exact: dict.exact,
        patterns: dict.patterns
      }
    };

    return `(() => {\nconst __AG_ZH_BOOT__ = ${JSON.stringify(bootPayload)};\n${runtimeSource}\n})();`;
  }

  async injectSession(session) {
    const script = this.buildInjectionScript();
    await session.setupBridge();
    const result = await session.evaluate(script, { returnByValue: true });
    return result;
  }

  async reloadAllSessions(reason = 'manual') {
    this.config = this.loadConfig();
    const script = this.buildInjectionScript();
    let count = 0;
    for (const [targetId, session] of this.sessions.entries()) {
      if (session.closed) {
        this.sessions.delete(targetId);
        continue;
      }
      try {
        await session.evaluate(script, { returnByValue: true });
        count++;
      } catch (err) {
        this.log(`Hot-reload failed for target ${targetId}:`, err.message);
      }
    }
    this.log(`Hot-reloaded ${count} window(s) (reason: ${reason})`);
    return count;
  }

  async broadcast(event, payload) {
    for (const [targetId, session] of this.sessions.entries()) {
      if (session.closed) {
        this.sessions.delete(targetId);
        continue;
      }
      try {
        await session.pushToPage({ type: 'event', event, payload });
      } catch {
        // Ignore stale windows
      }
    }
  }

  async handleRpc(msg, session) {
    const { id, action, payload } = msg || {};
    const reply = async (ok, data, error = null) => {
      if (id === undefined) return;
      try {
        await session.pushToPage({ type: 'response', id, ok, data, error });
      } catch {
        // Ignore disconnected window
      }
    };

    try {
      switch (action) {
        case 'getStatus': {
          await reply(true, this.buildStatusSnapshot());
          break;
        }
        case 'saveConfig': {
          const next = normalizeConfig({ ...this.config, ...(payload || {}) });
          writeJsonAtomic(this.getConfigPath(), next);
          this.config = next;
          const snap = this.buildStatusSnapshot();
          await reply(true, snap);
          setTimeout(() => this.reloadAllSessions('config-update'), 50);
          break;
        }
        case 'checkUpdate': {
          const res = await checkForUpdates(this.targetDir, this.config);
          this.lastUpdateCheckAt = Date.now();
          this.lastUpdateResult = {
            ...res,
            remoteManifest: undefined
          };
          await reply(true, this.lastUpdateResult);
          break;
        }
        case 'applyUpdate': {
          const res = await applyPluginUpdate(this.targetDir, this.config);
          this.lastUpdateResult = res;
          const snap = this.buildStatusSnapshot();
          await reply(
            res.ok,
            {
              update: res,
              status: snap
            },
            res.ok ? null : res.error
          );
          if (res.ok && res.updated) {
            setTimeout(() => this.reloadAllSessions('plugin-updated'), 150);
          }
          break;
        }
        case 'rollback': {
          const res = rollbackPlugin(this.targetDir);
          const snap = this.buildStatusSnapshot();
          await reply(
            res.ok,
            {
              rollback: res,
              status: snap
            },
            res.ok ? null : res.error
          );
          if (res.ok) {
            setTimeout(() => this.reloadAllSessions('rollback'), 150);
          }
          break;
        }
        case 'reloadRuntime': {
          const snap = this.buildStatusSnapshot();
          await reply(true, { reloaded: this.sessions.size, status: snap });
          setTimeout(() => this.reloadAllSessions('user-refresh'), 50);
          break;
        }
        case 'reportUntranslated': {
          const items = Array.isArray(payload?.items) ? payload.items : [];
          const count = this.mergeUntranslated(items);
          await reply(true, { total: count });
          break;
        }
        case 'getUntranslated': {
          const data = readJsonSafe(this.getUntranslatedPath(), {});
          const sorted = Object.entries(data)
            .map(([text, meta]) => ({ text, ...(typeof meta === 'object' ? meta : { count: 1 }) }))
            .sort((a, b) => (b.count || 0) - (a.count || 0));
          await reply(true, { items: sorted });
          break;
        }
        case 'clearUntranslated': {
          writeJsonAtomic(this.getUntranslatedPath(), {});
          await reply(true, { total: 0 });
          break;
        }
        case 'addOverride': {
          const en = typeof payload?.en === 'string' ? payload.en.trim() : '';
          const zh = typeof payload?.zh === 'string' ? payload.zh.trim() : '';
          if (!en || !zh) {
            await reply(false, null, '英文原文和中文译文均不能为空');
            break;
          }
          const overrides = this.loadOverrides();
          overrides.exact[en] = zh;
          writeJsonAtomic(this.getOverridesPath(), overrides);

          // Remove from untranslated list
          const untranslated = readJsonSafe(this.getUntranslatedPath(), {});
          if (untranslated[en]) {
            delete untranslated[en];
            writeJsonAtomic(this.getUntranslatedPath(), untranslated);
          }

          await this.reloadAllSessions('override-added');
          await reply(true, this.buildStatusSnapshot());
          break;
        }
        default:
          await reply(false, null, `Unknown action: ${action}`);
      }
    } catch (err) {
      await reply(false, null, err.message || String(err));
    }
  }

  mergeUntranslated(items) {
    if (!items.length) return Object.keys(readJsonSafe(this.getUntranslatedPath(), {})).length;
    const dict = this.loadDictionary();
    const store = readJsonSafe(this.getUntranslatedPath(), {});
    const now = new Date().toISOString();

    for (const raw of items) {
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text || dict.exact[text]) continue;
      if (!store[text]) {
        store[text] = { count: 1, firstSeen: now, lastSeen: now };
      } else {
        store[text].count = (store[text].count || 1) + 1;
        store[text].lastSeen = now;
      }
    }

    // Cap stored entries at 500 to keep file tidy
    const keys = Object.keys(store);
    if (keys.length > 500) {
      const trimmed = {};
      keys
        .sort((a, b) => (store[b].count || 0) - (store[a].count || 0))
        .slice(0, 500)
        .forEach((k) => {
          trimmed[k] = store[k];
        });
      writeJsonAtomic(this.getUntranslatedPath(), trimmed);
      return 500;
    }

    writeJsonAtomic(this.getUntranslatedPath(), store);
    return keys.length;
  }

  async checkAppUpgradeAndAutoUpdate() {
    this.config = this.loadConfig();
    const channelInfo = resolveAntigravityChannel(this.config.channel);
    const upgrade = detectAntigravityVersionChange(this.targetDir, channelInfo.appVersion);

    if (upgrade.upgraded) {
      this.log(
        `Detected Antigravity upgrade: ${upgrade.previousVersion} -> ${upgrade.currentVersion}`
      );
      this.lastAppUpgradeInfo = upgrade;

      // Re-ensure non-invasive CDP launcher & argv.json after Antigravity updates itself
      try {
        ensureArgvRemoteDebugging(channelInfo.argvPath);
        ensureCdpLaunchers(channelInfo);
      } catch (err) {
        this.log('Post-upgrade launcher re-check warning:', err.message);
      }

      if (this.config.autoUpdate && this.config.autoUpdateOnAppUpgrade) {
        await this.performAutoUpdateCheck('antigravity-upgraded');
      }
      return;
    }

    // Periodic scheduled update check
    if (this.config.autoUpdate) {
      const intervalMs = this.config.checkIntervalHours * 3600 * 1000;
      if (Date.now() - this.lastUpdateCheckAt >= intervalMs) {
        await this.performAutoUpdateCheck('scheduled');
      }
    }
  }

  async performAutoUpdateCheck(trigger = 'scheduled') {
    this.lastUpdateCheckAt = Date.now();
    const check = await checkForUpdates(this.targetDir, this.config);
    this.lastUpdateResult = { ...check, remoteManifest: undefined, trigger };

    if (!check.ok || !check.hasUpdates) return;

    this.log(
      `Update available (${trigger}): ${check.localVersion} -> ${check.remoteVersion} (${check.changed.length + check.added.length} files)`
    );

    if (this.config.updateMode === 'auto') {
      const applied = await applyPluginUpdate(this.targetDir, this.config, { prechecked: check });
      this.lastUpdateResult = { ...applied, trigger };
      if (applied.ok && applied.updated) {
        this.log(`Auto-updated plugin to v${applied.toVersion}. Hot-reloading windows...`);
        await this.reloadAllSessions('auto-update');
        await this.broadcast('auto-updated', applied);
      }
    } else if (this.config.updateMode === 'notify') {
      await this.broadcast('update-available', this.lastUpdateResult);
    }
  }

  async scanAndAttach() {
    this.config = this.loadConfig();
    const channelInfo = resolveAntigravityChannel(this.config.channel);
    const portInfo = readDevToolsPort(channelInfo.userDataDir);
    if (!portInfo) {
      // If Antigravity just cold-started without --remote-debugging-port=0 (e.g. after auto-update or unpatched shortcut),
      // re-patch shortcuts and seamlessly relay-relaunch once (never interrupts already-running sessions >18s old).
      if (!this.once && Date.now() - this.lastRelayAt > 60000) {
        const probe = detectFreshNonCdpAntigravity(channelInfo, 18);
        if (probe.needsRelay) {
          this.lastRelayAt = Date.now();
          this.log(
            `Detected fresh Antigravity launch without CDP (pid=${probe.pid}, age=${probe.age}s); patching shortcuts & relaying with --remote-debugging-port=0`
          );
          try {
            ensureArgvRemoteDebugging(channelInfo.argvPath);
            ensureCdpLaunchers(channelInfo);
            relaunchAntigravityWithCdp(channelInfo);
          } catch (err) {
            this.log('Auto-relay warning:', err.message);
          }
        }
      }
      return { attached: 0, portFound: false };
    }

    const targets = selectAntigravityTargets(await listCdpTargets(portInfo.port));
    let attachedNow = 0;

    for (const target of targets) {
      if (this.sessions.has(target.id)) {
        const existing = this.sessions.get(target.id);
        if (!existing.closed) continue;
        this.sessions.delete(target.id);
      }

      const session = new CdpPageSession(target, {
        onBindingCall: (msg, sess) => this.handleRpc(msg, sess),
        onClose: () => {
          this.sessions.delete(target.id);
        },
        logger: (...a) => this.log(...a)
      });

      try {
        await session.connect();
        await this.injectSession(session);
        this.sessions.set(target.id, session);
        attachedNow++;
        this.log(`Injected zh-CN runtime into window: ${target.title || target.id}`);
      } catch (err) {
        session.close();
        if (this.config.debug) {
          this.log(`Attach failed for ${target.id}:`, err.message);
        }
      }
    }

    return { attached: attachedNow, total: this.sessions.size, portFound: true, port: portInfo.port };
  }

  async start() {
    this.running = true;
    this.log(`Daemon starting (targetDir=${this.targetDir}, once=${this.once})`);

    if (this.once) {
      const result = await this.scanAndAttach();
      for (const s of this.sessions.values()) s.close();
      return result;
    }

    // Attach to live Antigravity windows FIRST so UI RPC bridge is ready immediately
    try {
      await this.scanAndAttach();
    } catch (err) {
      this.log('Initial attach error:', err.message);
    }

    // Run upgrade/update check in background so network latency never blocks CDP attachment
    let updateCheckInFlight = false;
    const triggerBackgroundUpdateCheck = () => {
      if (updateCheckInFlight) return;
      updateCheckInFlight = true;
      this.checkAppUpgradeAndAutoUpdate()
        .catch((err) => this.log('Update check error:', err.message))
        .finally(() => {
          updateCheckInFlight = false;
        });
    };
    triggerBackgroundUpdateCheck();

    let ticks = 0;
    while (this.running) {
      try {
        await this.scanAndAttach();
        if (ticks > 0 && ticks % 30 === 0) {
          triggerBackgroundUpdateCheck();
        }
      } catch (err) {
        this.log('Loop error:', err.message);
      }
      ticks++;
      await sleep(2000);
    }
  }

  stop() {
    this.running = false;
    for (const session of this.sessions.values()) {
      session.close();
    }
    this.sessions.clear();
  }
}

export function startDaemonCli(argv = process.argv.slice(2)) {
  const once = argv.includes('--once');
  const dirIdx = argv.indexOf('--target-dir');
  const targetDir =
    dirIdx !== -1 && argv[dirIdx + 1]
      ? argv[dirIdx + 1]
      : fs.existsSync(path.join(DEFAULT_ROOT, 'core', 'daemon.mjs'))
        ? DEFAULT_ROOT
        : getDefaultInstallDir();

  const pidPath = path.join(path.resolve(targetDir), 'daemon.pid');
  if (!once) {
    try {
      fs.writeFileSync(pidPath, String(process.pid), 'utf8');
    } catch {}
  }

  const daemon = new ZhCnDaemon({ targetDir, once });
  const cleanup = () => {
    daemon.stop();
    if (!once) {
      try {
        if (fs.existsSync(pidPath) && fs.readFileSync(pidPath, 'utf8').trim() === String(process.pid)) {
          fs.rmSync(pidPath, { force: true });
        }
      } catch {}
    }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return daemon.start().then((res) => {
    if (once) {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.portFound && res.attached > 0 ? 0 : 1);
    }
    return res;
  });
}

// CLI entrypoint when run directly (symlink-safe via realpathSync)
const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try {
    const a = fs.realpathSync(process.argv[1]);
    const b = fs.realpathSync(__filename);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    const a = path.resolve(process.argv[1]);
    const b = path.resolve(__filename);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  }
})();

if (isDirectRun) {
  startDaemonCli();
}
