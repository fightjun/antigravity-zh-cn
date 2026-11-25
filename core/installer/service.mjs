import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { SERVICE_IDS } from '../shared.mjs';

function getDaemonEntryPath(targetDir) {
  return path.join(targetDir, 'core', 'daemon.mjs');
}

function getWindowsVbsPath(targetDir) {
  return path.join(targetDir, 'run-daemon-hidden.vbs');
}

export function registerSystemService(targetDir) {
  const nodeExec = process.execPath;
  const daemonPath = getDaemonEntryPath(targetDir);

  if (process.platform === 'win32') {
    const vbsPath = getWindowsVbsPath(targetDir);
    const vbs = [
      'Set sh = CreateObject("WScript.Shell")',
      `cmd = """${nodeExec}"" ""${daemonPath}"" --target-dir ""${targetDir}"""`,
      'sh.Run cmd, 0, False'
    ].join('\r\n');
    fs.writeFileSync(vbsPath, vbs, 'utf8');

    const res = spawnSync(
      'schtasks',
      [
        '/Create',
        '/F',
        '/SC',
        'ONLOGON',
        '/TN',
        SERVICE_IDS.windowsTaskName,
        '/TR',
        `wscript.exe "${vbsPath}"`
      ],
      { encoding: 'utf8', windowsHide: true }
    );

    // Also launch immediately in background
    const child = spawn('wscript.exe', [vbsPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();

    return {
      ok: res.status === 0,
      platform: 'win32',
      taskName: SERVICE_IDS.windowsTaskName,
      vbsPath,
      output: (res.stdout || res.stderr || '').trim()
    };
  }

  if (process.platform === 'darwin') {
    const agentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    fs.mkdirSync(agentsDir, { recursive: true });
    const plistPath = path.join(agentsDir, `${SERVICE_IDS.launchAgentLabel}.plist`);
    const logPath = path.join(targetDir, 'daemon.log');
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_IDS.launchAgentLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeExec}</string>
    <string>${daemonPath}</string>
    <string>--target-dir</string>
    <string>${targetDir}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
    fs.writeFileSync(plistPath, plist, 'utf8');
    spawnSync('launchctl', ['unload', plistPath], { encoding: 'utf8' });
    const res = spawnSync('launchctl', ['load', plistPath], { encoding: 'utf8' });
    return { ok: res.status === 0, platform: 'darwin', plistPath };
  }

  // Linux systemd --user
  const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  fs.mkdirSync(unitDir, { recursive: true });
  const unitPath = path.join(unitDir, SERVICE_IDS.systemdUnit);
  const unit = `[Unit]
Description=Antigravity Simplified Chinese Localization Daemon
After=default.target

[Service]
Type=simple
ExecStart="${nodeExec}" "${daemonPath}" --target-dir "${targetDir}"
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
`;
  fs.writeFileSync(unitPath, unit, 'utf8');
  spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8' });
  const res = spawnSync('systemctl', ['--user', 'enable', '--now', SERVICE_IDS.systemdUnit], {
    encoding: 'utf8'
  });
  return { ok: res.status === 0, platform: 'linux', unitPath };
}

export function uninstallSystemService(targetDir) {
  if (process.platform === 'win32') {
    spawnSync('schtasks', ['/Delete', '/F', '/TN', SERVICE_IDS.windowsTaskName], {
      encoding: 'utf8',
      windowsHide: true
    });
    const vbsPath = getWindowsVbsPath(targetDir);
    if (fs.existsSync(vbsPath)) fs.rmSync(vbsPath, { force: true });
    return { ok: true, platform: 'win32' };
  }

  if (process.platform === 'darwin') {
    const plistPath = path.join(
      os.homedir(),
      'Library',
      'LaunchAgents',
      `${SERVICE_IDS.launchAgentLabel}.plist`
    );
    if (fs.existsSync(plistPath)) {
      spawnSync('launchctl', ['unload', plistPath], { encoding: 'utf8' });
      fs.rmSync(plistPath, { force: true });
    }
    return { ok: true, platform: 'darwin' };
  }

  const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', SERVICE_IDS.systemdUnit);
  spawnSync('systemctl', ['--user', 'disable', '--now', SERVICE_IDS.systemdUnit], {
    encoding: 'utf8'
  });
  if (fs.existsSync(unitPath)) fs.rmSync(unitPath, { force: true });
  return { ok: true, platform: 'linux' };
}
