# Windows runtime smoke for the GUI-subsystem assetty.exe.
#
# The app binary ships with subsystem=windows: a double-click opens the window
# with no console at all. CLI launches (`--version`, `help`, `info`) attach
# the parent console inside the exe, but a GUI exe needs a launcher that
# really waits for it — plain `&`/cmd return before it exits and lose the
# exit code. Everything below therefore goes through Start-Process -Wait or
# System.Diagnostics.Process (WaitForExit), which both wait for GUI processes.
# No step opens a window: only CLI args that print and exit are used.

param(
  [string]$Exe = (Join-Path (Split-Path -Parent $PSScriptRoot) "zig-out\bin\assetty.exe")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Exe)) {
  Write-Error "missing exe: $Exe (build first: zig build -Dtarget=x86_64-windows-gnu)"
  exit 1
}
$Exe = (Resolve-Path $Exe).Path
$Root = Split-Path -Parent $PSScriptRoot

# Exercise successful AttachConsole as well as inherited pipes. Hosted CI
# shells may have no console; without this the original overwrite bug could
# pass every redirected-process test simply because AttachConsole failed.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AssettySmokeConsole {
  [DllImport("kernel32.dll")] public static extern uint GetConsoleCP();
  [DllImport("kernel32.dll")] public static extern bool AllocConsole();
  [DllImport("kernel32.dll")] public static extern bool FreeConsole();
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
'@
$ownsConsole = $false
if ([AssettySmokeConsole]::GetConsoleCP() -eq 0) {
  if (-not [AssettySmokeConsole]::AllocConsole()) { throw "cannot create parent console for stream regression test" }
  $ownsConsole = $true
  [void][AssettySmokeConsole]::ShowWindow([AssettySmokeConsole]::GetConsoleWindow(), 0)
}

$script:failed = 0

function Assert($Cond, $Name, $Detail) {
  if ($Cond) {
    Write-Host "PASS $Name"
  } else {
    Write-Host "FAIL $Name -- $Detail"
    $script:failed += 1
  }
}

# Launch a GUI exe and really wait for it, capturing both streams
# (the in-process equivalent of a shell pipe: no console needed).
function Invoke-GuiExe {
  param([string]$ExePath, [string[]]$Arguments)
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $ExePath
  $quoted = foreach ($a in $Arguments) { '"' + ($a -replace '"', '\"') + '"' }
  $psi.Arguments = [string]::Join(' ', $quoted)
  $psi.WorkingDirectory = $Root
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  [void]$p.Start()
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  return @{ ExitCode = $p.ExitCode; Stdout = $stdout; Stderr = $stderr }
}

# 1. --version on stdout (pipe path), exit 0, stderr quiet.
$r = Invoke-GuiExe $Exe @('--version')
Assert ($r.ExitCode -eq 0) "--version exit code" "got $($r.ExitCode), stderr: $($r.Stderr)"
Assert ($r.Stdout -match 'assetty \d+\.\d+') "--version stdout" "got: $($r.Stdout)"

# 2. help channel works (usage goes to stderr via debug print).
$r = Invoke-GuiExe $Exe @('--help')
Assert ($r.ExitCode -eq 0) "--help exit code" "got $($r.ExitCode)"
Assert (($r.Stdout + $r.Stderr) -match 'Usage:') "help text" "no Usage: on either stream"

# 3. errors on stderr with exit 2.
$r = Invoke-GuiExe $Exe @('no-such-cmd-xyz')
Assert ($r.ExitCode -eq 2) "unknown command exit code" "got $($r.ExitCode)"
Assert ($r.Stderr -match 'unknown command') "unknown command stderr" "got: $($r.Stderr)"

# 4. info --json on stdout (exercises the real stdout writer + fixture).
$r = Invoke-GuiExe $Exe @('info', 'test/fixtures/box.glb', '--json')
Assert ($r.ExitCode -eq 0) "info --json exit code" "got $($r.ExitCode), stderr: $($r.Stderr)"
Assert ($r.Stdout -match '"container"') "info --json stdout" "got: $($r.Stdout)"

# 5. info on a missing file: stderr + exit 2 (stderr channel under redirect).
$r = Invoke-GuiExe $Exe @('info', 'test/fixtures/does-not-exist.glb')
Assert ($r.ExitCode -eq 2) "info missing exit code" "got $($r.ExitCode)"
Assert ($r.Stderr -ne '') "info missing stderr" "stderr empty"

# 6. `>` redirect: parent-created file handle must survive AttachConsole.
$outFile = Join-Path ([System.IO.Path]::GetTempPath()) "assetty-smoke-out.txt"
if (Test-Path $outFile) { Remove-Item $outFile -Force }
$proc = Start-Process -FilePath $Exe -ArgumentList '--version' -WorkingDirectory $Root `
  -RedirectStandardOutput $outFile -Wait -PassThru
$body = Get-Content $outFile -Raw
Assert ($proc.ExitCode -eq 0) "redirect `>` exit code" "got $($proc.ExitCode)"
Assert ($body -match 'assetty \d+\.\d+') "redirect `>` body" "got: $body"
Remove-Item $outFile -Force

# 7. `2>` redirect: stderr must land in the file, exit code preserved.
$errFile = Join-Path ([System.IO.Path]::GetTempPath()) "assetty-smoke-err.txt"
if (Test-Path $errFile) { Remove-Item $errFile -Force }
$proc = Start-Process -FilePath $Exe -ArgumentList 'no-such-cmd-xyz' -WorkingDirectory $Root `
  -RedirectStandardError $errFile -Wait -PassThru
$ebody = Get-Content $errFile -Raw
Assert ($proc.ExitCode -eq 2) "redirect `2>` exit code" "got $($proc.ExitCode)"
Assert ($ebody -match 'unknown command') "redirect `2>` body" "got: $ebody"
Remove-Item $errFile -Force

# 8. pipe: stdout must flow into a second stage.
$r = Invoke-GuiExe $Exe @('--version')
$piped = $r.Stdout | Select-String -Pattern 'assetty' | ForEach-Object { $_.Line }
Assert ($piped -ne $null) "pipe to Select-String" "got: $($r.Stdout)"

# 9. subprocess-staged --version: a grandchild exe's output must still arrive.
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$psi.Arguments = "-NoProfile -Command `"& '$Exe' --version`""
$psi.WorkingDirectory = $Root
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
$p = [System.Diagnostics.Process]::Start($psi)
$staged = $p.StandardOutput.ReadToEnd()
$p.WaitForExit()
Assert ($p.ExitCode -eq 0) "subprocess staged exit code" "got $($p.ExitCode)"
Assert ($staged -match 'assetty \d+\.\d+') "subprocess staged --version" "got: $staged"

if ($ownsConsole) { [void][AssettySmokeConsole]::FreeConsole() }
if ($script:failed -gt 0) {
  Write-Error "Windows console smoke: $($script:failed) check(s) failed"
  exit 1
}
Write-Host "Windows console smoke: OK"
