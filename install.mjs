#!/usr/bin/env node
/**
 * antigravity-zh-cn CLI
 *
 * Subcommands:
 *   node install.mjs install        [--channel auto|stable|insiders] [--repo owner/repo] [--ref main] [--target-dir <dir>] [--sync-user]
 *   node install.mjs uninstall      [--channel auto|stable|insiders] [--target-dir <dir>]
 *   node install.mjs update         [--check] [--repo owner/repo] [--ref main] [--target-dir <dir>]
 *   node install.mjs rollback       [--target-dir <dir>]
 *   node install.mjs relaunch       [--channel auto|stable|insiders]
 *   node install.mjs doctor         [--channel auto|stable|insiders] [--target-dir <dir>]
 *   node install.mjs verify         [--target-dir <dir>]
 *   node install.mjs collect        [--target-dir <dir>]
 *   node install.mjs build-manifest
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  copyDirRecursive,
  getDefaultInstallDir,
  normalizeConfig,
  readJsonSafe,
  writeJsonAtomic
} from './core/shared.mjs';
import { buildManifest, sha256File, verifyCoreIntegrity } from './core/installer/manifest.mjs';
import {
  detectEnvironment,
  ensureArgvRemoteDebugging,
  removeArgvRemoteDebugging
} from './core/installer/env.mjs';
import {
  ensureCdpLaunchers,
  removeCdpLaunchers,
  relaunchAntigravityWithCdp
} from './core/installer/cdp-launch.mjs';
import { registerSystemService, uninstallSystemService } from './core/installer/service.mjs';
import { resolveAntigravityChannel } from './core/daemon/paths.mjs';
import { checkForUpdates, applyPluginUpdate, rollbackPlugin } from './core/daemon/updater.mjs';
import { ZhCnDaemon } from './core/daemon.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const subcommand = args.find((a) => !a.startsWith('-')) || 'help';
const hasFlag = (f) => args.some((a) => a === f || a.startsWith(`${f}=`));
function getArg(flag, fallback = null) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith(`${flag}=`)) return args[i].slice(flag.length + 1);
  }
  return fallback;
}

function resolveTargetDir() {
  const explicit = getArg('--target-dir', null);
  if (explicit) return path.resolve(explicit);
  const installed = getDefaultInstallDir();
  if (fs.existsSync(path.join(installed, 'core', 'daemon.mjs'))) {
    return installed;
  }
  return __dirname;
}

async function runInstall() {
  const channel = getArg('--channel', 'auto');
  const repoArg = getArg('--repo', null);
  const refArg = getArg('--ref', null);
  const syncUser = hasFlag('--sync-user');
  const targetDir = path.resolve(getArg('--target-dir', getDefaultInstallDir()));

  const env = await detectEnvironment(channel);
  if (!env.node.ok) {
    console.error(`[ERROR] 需要 Node.js >= ${env.node.minRequired}（当前：${env.node.version}）`);
    process.exit(1);
  }

  buildManifest(__dirname);

  const srcCore = path.join(__dirname, 'core');
  const srcUser = path.join(__dirname, 'user');
  const targetCore = path.join(targetDir, 'core');
  const targetPrev = path.join(targetDir, 'core.prev');
  const targetUser = path.join(targetDir, 'user');

  if (path.resolve(__dirname) !== targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });
    if (fs.existsSync(targetCore)) {
      const srcMan = path.join(srcCore, 'manifest.json');
      const tgtMan = path.join(targetCore, 'manifest.json');
      if (!fs.existsSync(tgtMan) || sha256File(srcMan) !== sha256File(tgtMan)) {
        fs.rmSync(targetPrev, { recursive: true, force: true });
        copyDirRecursive(targetCore, targetPrev);
      }
    }
    fs.rmSync(targetCore, { recursive: true, force: true });
    copyDirRecursive(srcCore, targetCore);

    fs.mkdirSync(targetUser, { recursive: true });
    for (const item of fs.readdirSync(srcUser)) {
      const s = path.join(srcUser, item);
      const d = path.join(targetUser, item);
      if (syncUser || !fs.existsSync(d)) {
        fs.copyFileSync(s, d);
      }
    }

    for (const rootFile of ['install.mjs', 'package.json', 'LICENSE']) {
      const s = path.join(__dirname, rootFile);
      if (fs.existsSync(s)) fs.copyFileSync(s, path.join(targetDir, rootFile));
    }
  }

  // Apply CLI config overrides if provided
  const cfgPath = path.join(targetUser, 'config.json');
  const cfg = normalizeConfig(readJsonSafe(cfgPath, {}));
  cfg.channel = channel;
  if (repoArg) cfg.updateRepo = repoArg;
  if (refArg) cfg.updateRef = refArg;
  writeJsonAtomic(cfgPath, cfg);

  const channelInfo = resolveAntigravityChannel(channel);
  const argvRes = ensureArgvRemoteDebugging(channelInfo.argvPath);
  const launcherRes = ensureCdpLaunchers(channelInfo);
  const serviceRes = registerSystemService(targetDir);

  console.log(
    JSON.stringify(
      {
        ok: true,
        targetDir,
        channel: channelInfo.channel,
        antigravityVersion: channelInfo.appVersion,
        argvUpdated: argvRes.updated,
        launchersPatched: launcherRes.patched,
        service: serviceRes,
        nextStep: env.live.reachable
          ? '已检测到运行中的 Antigravity CDP 端口，中文汉化将在数秒内自动生效！'
          : '请重启 Antigravity（或运行 `node install.mjs relaunch`）以启用实时中文汉化。'
      },
      null,
      2
    )
  );
}

async function runUninstall() {
  const channel = getArg('--channel', 'auto');
  const targetDir = resolveTargetDir();
  const channelInfo = resolveAntigravityChannel(channel);

  const serviceRes = uninstallSystemService(targetDir);
  const argvRes = removeArgvRemoteDebugging(channelInfo.argvPath);
  const launcherRes = removeCdpLaunchers(channelInfo);

  console.log(
    JSON.stringify(
      {
        ok: true,
        targetDir,
        serviceRemoved: serviceRes,
        argvCleaned: argvRes.updated,
        launchersCleaned: launcherRes.patched,
        note: `如需彻底删除本地配置与词库，请手动移除目录：${targetDir}`
      },
      null,
      2
    )
  );
}

async function runUpdate() {
  const targetDir = resolveTargetDir();
  const checkOnly = hasFlag('--check');
  const cfgPath = path.join(targetDir, 'user', 'config.json');
  const cfg = normalizeConfig(readJsonSafe(cfgPath, {}));
  const repoArg = getArg('--repo', null);
  const refArg = getArg('--ref', null);
  if (repoArg) cfg.updateRepo = repoArg;
  if (refArg) cfg.updateRef = refArg;

  if (checkOnly) {
    const res = await checkForUpdates(targetDir, cfg);
    const { remoteManifest, ...printable } = res;
    console.log(JSON.stringify(printable, null, 2));
    process.exit(res.ok ? 0 : 1);
  }

  const res = await applyPluginUpdate(targetDir, cfg);
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 1);
}

function runRollback() {
  const targetDir = resolveTargetDir();
  const res = rollbackPlugin(targetDir);
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 1);
}

async function runDoctor() {
  const channel = getArg('--channel', 'auto');
  const targetDir = resolveTargetDir();
  const env = await detectEnvironment(channel);
  const integrity = verifyCoreIntegrity(targetDir);
  console.log(
    JSON.stringify(
      {
        ok: env.node.ok && integrity.ok,
        targetDir,
        integrity,
        environment: env
      },
      null,
      2
    )
  );
}

async function runVerify() {
  const targetDir = resolveTargetDir();
  const daemon = new ZhCnDaemon({ targetDir, once: true });
  const res = await daemon.start();
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.portFound && res.attached > 0 ? 0 : 1);
}

function runCollect() {
  const targetDir = resolveTargetDir();
  const store = readJsonSafe(path.join(targetDir, 'untranslated.json'), {});
  const skeleton = {};
  for (const key of Object.keys(store).sort()) {
    skeleton[key] = '';
  }
  console.log(JSON.stringify(skeleton, null, 2));
}

function runRelaunch() {
  const channel = getArg('--channel', 'auto');
  const channelInfo = resolveAntigravityChannel(channel);
  const res = relaunchAntigravityWithCdp(channelInfo);
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 1);
}

function printHelp() {
  console.log(`antigravity-zh-cn · Google Antigravity 2.0 非侵入式中文汉化与自动更新插件

用法：
  node install.mjs install        安装插件、配置启动参数并注册后台自启服务
  node install.mjs uninstall      停止后台服务并清理启动参数
  node install.mjs update         检查并从 GitHub 自动更新词库与插件（加 --check 仅检查）
  node install.mjs rollback       回滚至上一份备份版本
  node install.mjs relaunch       携带 --remote-debugging-port=0 启动 Antigravity
  node install.mjs doctor         检查 Node 环境、CDP 状态与核心文件完整性
  node install.mjs verify         单次注入并验证当前窗口
  node install.mjs collect        导出已采集的未翻译英文词条 JSON
  node install.mjs build-manifest 重新生成 core/manifest.json 哈希清单
`);
}

switch (subcommand) {
  case 'install':
    await runInstall();
    break;
  case 'uninstall':
    await runUninstall();
    break;
  case 'update':
    await runUpdate();
    break;
  case 'rollback':
    runRollback();
    break;
  case 'relaunch':
    runRelaunch();
    break;
  case 'doctor':
    await runDoctor();
    break;
  case 'verify':
    await runVerify();
    break;
  case 'collect':
    runCollect();
    break;
  case 'build-manifest': {
    const manifest = buildManifest(__dirname);
    console.log(
      `Generated core/manifest.json (v${manifest.version}, ${manifest.stats.fileCount} files, ${manifest.stats.exactCount} exact entries, ${manifest.stats.patternCount} patterns)`
    );
    break;
  }
  default:
    printHelp();
    break;
}
