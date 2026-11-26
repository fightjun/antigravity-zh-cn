import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { SERVICE_IDS } from '../shared.mjs';

const WIN_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

function getDaemonEntryPath(targetDir) {
  return path.join(targetDir, 'core', 'daemon-entry.mjs');
}

function getWindowsVbsPath(targetDir) {
  return path.join(targetDir, 'run-daemon-hidden.vbs');
}

export function stopExistingDaemon(targetDir) {
  const pidPath = path.join(targetDir, 'daemon.pid');
  if (!fs.existsSync(pidPath)) return false;
  try {
    const pid = Number.parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
    if (Number.isFinite(pid) && pid > 0) {
      process.kill(pid);
    }
  } catch {
    // Process already exited
  }
  try {
    fs.rmSync(pidPath, { force: true });
  } catch {}
  return true;
}

export function isDaemonRunning(targetDir) {
  const pidPath = path.join(targetDir, 'daemon.pid');
  if (!fs.existsSync(pidPath)) return { running: false, pid: null };
  try {
    const pid = Number.parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) return { running: false, pid: null };
    process.kill(pid, 0);
    return { running: true, pid };
  } catch {
    return { running: false, pid: null };
  }
}

export function registerSystemService(targetDir) {
  const nodeExec = process.execPath;
  const daemonPath = getDaemonEntryPath(targetDir);

  if (process.platform === 'win32') {
    stopExistingDaemon(targetDir);

    const vbsPath = getWindowsVbsPath(targetDir);
    const vbs = [
      'Set sh = CreateObject("WScript.Shell")',
      `cmd = """${nodeExec}"" ""${daemonPath}"" --target-dir ""${targetDir}"""`,
      'sh.Run cmd, 0, False'
    ].join('\r\n');
    fs.writeFileSync(vbsPath, vbs, 'utf8');

    // Register in HKCU\...\Run (no Admin required)
    const regRes = spawnSync(
      'reg',
      ['add', WIN_RUN_KEY, '/v', SERVICE_IDS.windowsTaskName, '/t', 'REG_SZ', '/d', `wscript.exe "${vbsPath}"`, '/f'],
      { encoding: 'utf8', windowsHide: true }
    );

    // Register & start a user-level Scheduled Task (no Admin required, survives terminal exit & app upgrades)
    const taskPs = [
      `$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument ${JSON.stringify(`"${vbsPath}"`)}`,
      `$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME`,
      `Register-ScheduledTask -TaskName ${JSON.stringify(SERVICE_IDS.windowsTaskName)} -Action $action -Trigger $trigger -Force | Out-Null`,
      `Start-ScheduledTask -TaskName ${JSON.stringify(SERVICE_IDS.windowsTaskName)}`,
      'Start-Sleep -Milliseconds 1500'
    ].join('; ');
    const taskRes = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', taskPs], {
      encoding: 'utf8',
      windowsHide: true
    });

    let status = isDaemonRunning(targetDir);
    if (!status.running) {
      const child = spawn(nodeExec, [daemonPath, '--target-dir', targetDir], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();
      status = { running: Boolean(child.pid), pid: child.pid || null };
    }

    return {
      ok: (taskRes.status === 0 || regRes.status === 0) && status.running,
      platform: 'win32',
      autostart: taskRes.status === 0 ? 'ScheduledTask+HKCU\\Run' : 'HKCU\\Run',
      valueName: SERVICE_IDS.windowsTaskName,
      daemonRunning: status.running,
      pid: status.pid,
      vbsPath
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
  stopExistingDaemon(targetDir);

  if (process.platform === 'win32') {
    spawnSync('reg', ['delete', WIN_RUN_KEY, '/v', SERVICE_IDS.windowsTaskName, '/f'], {
      encoding: 'utf8',
      windowsHide: true
    });
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
