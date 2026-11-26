import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

const CDP_FLAG = '--remote-debugging-port=0';

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

function getWindowsShortcutDirs() {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const publicDir = process.env.PUBLIC || 'C:\\Users\\Public';
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  return [
    path.join(home, 'Desktop'),
    path.join(publicDir, 'Desktop'),
    path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar')
  ].filter((d) => fs.existsSync(d));
}

function patchWindowsShortcuts(executable, mode = 'add') {
  if (process.platform !== 'win32' || !executable) return { patched: [] };
  const dirs = getWindowsShortcutDirs();
  if (!dirs.length) return { patched: [] };

  const targetLower = executable.toLowerCase();
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$wsh = New-Object -ComObject WScript.Shell
$target = ${psQuote(targetLower)}
$flag = '${CDP_FLAG}'
$mode = '${mode}'
$dirs = @(${dirs.map((d) => psQuote(d)).join(', ')})
$patched = @()
foreach ($d in $dirs) {
  Get-ChildItem -Path $d -Filter '*.lnk' -Recurse | ForEach-Object {
    $sc = $wsh.CreateShortcut($_.FullName)
    if ($sc.TargetPath -and $sc.TargetPath.ToLower() -eq $target) {
      $argsStr = [string]$sc.Arguments
      if ($mode -eq 'add' -and ($argsStr -notmatch '--remote-debugging-port=')) {
        $sc.Arguments = ($argsStr.Trim() + ' ' + $flag).Trim()
        $sc.Save()
        $patched += $_.FullName
      } elseif ($mode -eq 'remove' -and ($argsStr -match '--remote-debugging-port=0')) {
        $sc.Arguments = ($argsStr -replace '\\s*--remote-debugging-port=0\\s*', ' ').Trim()
        $sc.Save()
        $patched += $_.FullName
      }
    }
  }
}
$patched | ConvertTo-Json -Compress
`;
  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
    encoding: 'utf8',
    windowsHide: true
  });
  let patched = [];
  if (res.status === 0 && res.stdout.trim()) {
    try {
      const parsed = JSON.parse(res.stdout.trim());
      patched = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      patched = [];
    }
  }
  return { patched };
}

function patchLinuxDesktopEntry(channelInfo, mode = 'add') {
  if (process.platform !== 'linux') return { patched: [] };
  const localApps = path.join(os.homedir(), '.local', 'share', 'applications');
  const desktopFile = path.join(localApps, 'antigravity.desktop');
  const systemFile = '/usr/share/applications/antigravity.desktop';

  if (mode === 'add') {
    const src = fs.existsSync(desktopFile) ? desktopFile : fs.existsSync(systemFile) ? systemFile : null;
    if (!src) return { patched: [] };
    let content = fs.readFileSync(src, 'utf8');
    if (!content.includes('--remote-debugging-port=')) {
      content = content.replace(/^(Exec=.*)$/gm, `$1 ${CDP_FLAG}`);
      fs.mkdirSync(localApps, { recursive: true });
      fs.writeFileSync(desktopFile, content, 'utf8');
      return { patched: [desktopFile] };
    }
  } else if (mode === 'remove' && fs.existsSync(desktopFile)) {
    let content = fs.readFileSync(desktopFile, 'utf8');
    if (content.includes(CDP_FLAG)) {
      content = content.replace(new RegExp(`\\s*${CDP_FLAG}`, 'g'), '');
      fs.writeFileSync(desktopFile, content, 'utf8');
      return { patched: [desktopFile] };
    }
  }
  return { patched: [] };
}

export function ensureCdpLaunchers(channelInfo) {
  if (process.platform === 'win32') {
    return patchWindowsShortcuts(channelInfo.executable, 'add');
  }
  if (process.platform === 'linux') {
    return patchLinuxDesktopEntry(channelInfo, 'add');
  }
  return { patched: [] };
}

export function removeCdpLaunchers(channelInfo) {
  if (process.platform === 'win32') {
    return patchWindowsShortcuts(channelInfo.executable, 'remove');
  }
  if (process.platform === 'linux') {
    return patchLinuxDesktopEntry(channelInfo, 'remove');
  }
  return { patched: [] };
}

export function relaunchAntigravityWithCdp(channelInfo) {
  if (!channelInfo?.executable || !fs.existsSync(channelInfo.executable)) {
    return { ok: false, error: `Antigravity executable not found: ${channelInfo?.executable}` };
  }

  // Close existing Antigravity instance first; otherwise Electron single-instance lock ignores --remote-debugging-port=0
  if (process.platform === 'win32') {
    const exeName = path.basename(channelInfo.executable);
    spawnSync('taskkill', ['/IM', exeName, '/T'], { encoding: 'utf8', windowsHide: true });
    // Brief wait for graceful exit, then force if still alive
    spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 1500'], {
      windowsHide: true
    });
    spawnSync('taskkill', ['/F', '/IM', exeName, '/T'], { encoding: 'utf8', windowsHide: true });
    spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 800'], {
      windowsHide: true
    });
  } else if (process.platform === 'darwin') {
    const appName = path.basename(channelInfo.appDir, '.app');
    spawnSync('osascript', ['-e', `tell application "${appName}" to quit`], { encoding: 'utf8' });
    spawnSync('sleep', ['1.5']);
  } else {
    const exeName = path.basename(channelInfo.executable);
    spawnSync('pkill', ['-f', exeName], { encoding: 'utf8' });
    spawnSync('sleep', ['1.5']);
  }

  if (process.platform === 'darwin') {
    const child = spawn('open', ['-a', channelInfo.appDir, '--args', CDP_FLAG], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return { ok: true, executable: channelInfo.appDir };
  }

  const child = spawn(channelInfo.executable, [CDP_FLAG], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();
  return { ok: true, executable: channelInfo.executable, pid: child.pid || null };
}

/**
 * Checks if Antigravity just cold-started (within maxAgeSeconds) without --remote-debugging-port=.
 * Used by the background daemon to seamlessly relay-relaunch after app upgrades or unpatched launches
 * without ever interrupting an already-running session.
 */
export function detectFreshNonCdpAntigravity(channelInfo, maxAgeSeconds = 18) {
  if (process.platform !== 'win32' || !channelInfo?.executable) {
    return { needsRelay: false };
  }
  const exeName = path.basename(channelInfo.executable);
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$now = Get-Date
$procs = Get-CimInstance Win32_Process -Filter ${psQuote(`Name='${exeName}'`)} | Where-Object {
  $_.CommandLine -and ($_.CommandLine -notmatch '--type=') -and ($_.CommandLine -notmatch 'sidecar_sdk')
}
foreach ($p in $procs) {
  $hasFlag = $p.CommandLine -match '--remote-debugging-port='
  $age = ($now - $p.CreationDate).TotalSeconds
  if (-not $hasFlag -and $age -ge 1 -and $age -le ${maxAgeSeconds}) {
    [PSCustomObject]@{ needsRelay = $true; pid = $p.ProcessId; age = [Math]::Round($age, 1) } | ConvertTo-Json -Compress
    exit 0
  }
}
'{"needsRelay":false}'
`;
  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (res.status !== 0 || !res.stdout.trim()) return { needsRelay: false };
  try {
    return JSON.parse(res.stdout.trim());
  } catch {
    return { needsRelay: false };
  }
}
