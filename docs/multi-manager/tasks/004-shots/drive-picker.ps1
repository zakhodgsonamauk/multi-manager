# Drives front-desk-picker.ps1 for screenshots. Never launches a real front desk: PATH starts with a fake
# node.cmd that only records its arguments, and LOCALAPPDATA points into the -Out folder.
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][ValidateSet('cancel', 'bad-folder', 'ok', 'launch-fails', 'missing-tools')][string]$Scenario,
  [string]$Folder = '',
  [switch]$Remote,
  [switch]$ViaBat,
  # Pre-set what the picker remembers ('main' or a folder path) before it opens.
  [string]$Seed = '',
  # Pick "My main team" before pressing the button.
  [switch]$Main,
  # Put a file where the remember folder goes, so remembering the choice fails.
  [switch]$BlockRemember,
  # Use the real node and launcher, with this stand-in wt.exe (copied to <appdata>\Microsoft\WindowsApps) instead of Windows Terminal.
  [string]$FakeWt = '',
  # Run front-desk.bat with these arguments (with -ViaBat), e.g. 'remote'.
  [string]$BatArgs = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
}
'@
[void][W]::SetProcessDPIAware()

$fakeBin = Join-Path $Out 'fake-bin'
$appData = Join-Path $Out 'appdata'
New-Item -ItemType Directory -Force -Path $fakeBin, $appData | Out-Null
$code = if ($Scenario -eq 'launch-fails') { 1 } else { 0 }
Set-Content -LiteralPath (Join-Path $fakeBin 'node.cmd') -Encoding ascii -Value @"
@echo off
echo %* > "$Out\node-args.txt"
if $code==1 echo Could not start Windows Terminal (wt.exe): spawn wt.exe ENOENT 1>&2
exit /b $code
"@
Remove-Item -LiteralPath (Join-Path $Out 'node-args.txt') -ErrorAction SilentlyContinue
if ($FakeWt -eq '') {
  $env:PATH = "$fakeBin;$env:PATH"
} else {
  New-Item -ItemType Directory -Force -Path (Join-Path $appData 'Microsoft\WindowsApps') | Out-Null
  Copy-Item -LiteralPath $FakeWt -Destination (Join-Path $appData 'Microsoft\WindowsApps\wt.exe') -Force
}
$env:LOCALAPPDATA = $appData
Remove-Item -LiteralPath (Join-Path $appData 'multi-manager') -Recurse -Force -ErrorAction SilentlyContinue
if ($BlockRemember) { Set-Content -LiteralPath (Join-Path $appData 'multi-manager') -Value 'not a folder' }
if ($Seed -ne '') {
  New-Item -ItemType Directory -Force -Path (Join-Path $appData 'multi-manager') | Out-Null
  Set-Content -LiteralPath (Join-Path $appData 'multi-manager\last-cluster.txt') -Value $Seed -Encoding UTF8
}
if ($Scenario -eq 'missing-tools') { $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot\System32\WindowsPowerShell\v1.0" }

if ($ViaBat) {
  # As a double-click would: front-desk.bat starts the picker and exits; track the picker it started.
  $before = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | ForEach-Object ProcessId)
  Start-Process cmd -ArgumentList @('/c', "`"`"$Repo\front-desk.bat`" $BatArgs`"")
  for ($i = 0; $i -lt 100 -and -not $p; $i++) {
    $new = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.ProcessId -notin $before -and $_.CommandLine -like '*front-desk-picker.ps1*' }
    if ($new) { $p = Get-Process -Id @($new)[0].ProcessId; "picker command line: $(@($new)[0].CommandLine)" } else { Start-Sleep -Milliseconds 100 }
  }
  if (-not $p) { throw 'front-desk.bat did not start the picker' }
} else {
  $p = Start-Process powershell -PassThru -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$Repo\front-desk-picker.ps1`"", '-PluginDir', "`"$Repo`"")
}

function Find-Window([string]$name, [int]$seconds = 20) {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
  for ($i = 0; $i -lt $seconds * 10; $i++) {
    $w = $root.FindFirst('Children', $cond)
    if ($w) { return $w }
    # A message box owned by the pop-up shows up as the pop-up's child, not the desktop's.
    if ($script:popup) {
      try { $w = $script:popup.FindFirst('Children', $cond); if ($w) { return $w } } catch { }
    }
    Start-Sleep -Milliseconds 100
  }
  throw "window '$name' never appeared"
}
function Find-Child($win, [string]$name) {
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
  $win.FindFirst('Descendants', $cond)
}
function Snap($win, [string]$file) {
  $h = [IntPtr]$win.Current.NativeWindowHandle
  $r = New-Object W+RECT; [void][W]::GetWindowRect($h, [ref]$r)
  $bmp = New-Object System.Drawing.Bitmap(($r.R - $r.L), ($r.B - $r.T))
  $g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
  [void][W]::PrintWindow($h, $dc, 2); $g.ReleaseHdc($dc); $g.Dispose()
  $bmp.Save((Join-Path $Out $file)); $bmp.Dispose()
}
function Click($el) { [void][W]::PostMessage([IntPtr]$el.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) }

$script:popup = $null
if ($Scenario -eq 'missing-tools') {
  $box = Find-Window 'Multi-Manager' 20
  Start-Sleep -Milliseconds 300
  Snap $box 'missing-tools-message.png'
  Click (Find-Child $box 'OK')
  if (-not $p.WaitForExit(15000)) { $p.Kill(); throw 'picker did not exit' }
  "picker exit code: $($p.ExitCode)"
  "node called: $(Test-Path (Join-Path $Out 'node-args.txt'))"
  exit 0
}
$win = Find-Window 'Open a Multi-Manager front desk'
$script:popup = $win
Start-Sleep -Milliseconds 500
if ($Main) { Click (Find-Child $win 'My main team (no folder): the shared roster on this PC') }
if ($Folder -ne '') {
  Click (Find-Child $win 'A cluster folder, its own separate team (browse, or paste a path):')
  Start-Sleep -Milliseconds 300
  $box = $win.FindFirst('Descendants', (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
  $box.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($Folder)
}
if ($Remote) { Click (Find-Child $win 'Reachable from my phone (Remote Control)') }
Start-Sleep -Milliseconds 300
Snap $win "$Scenario-popup.png"

if ($Scenario -eq 'cancel') {
  Click (Find-Child $win 'Cancel')
} else {
  Click (Find-Child $win 'OK')
  if ($Scenario -ne 'ok') {
    $box = Find-Window 'Multi-Manager' 10
    Start-Sleep -Milliseconds 300
    Snap $box "$Scenario-message.png"
    Click (Find-Child $box 'OK')
    if ($Scenario -eq 'bad-folder') {
      # The pop-up must still be open; then cancel it.
      Start-Sleep -Milliseconds 500
      $still = Find-Window 'Open a Multi-Manager front desk' 5
      "pop-up still open after bad folder: $([bool]$still)"
      Click (Find-Child $still 'Cancel')
    }
  }
}
if (-not $p.WaitForExit(15000)) { $p.Kill(); throw 'picker did not exit' }
"picker exit code: $($p.ExitCode)"
$argsFile = Join-Path $Out 'node-args.txt'
"node called: $(Test-Path $argsFile)"
if (Test-Path $argsFile) { "node args: $((Get-Content -Raw $argsFile).Trim())" }
$remember = Join-Path $appData 'multi-manager\last-cluster.txt'
"remembered folder: $(if (Test-Path $remember) { (Get-Content -Raw -Encoding UTF8 $remember).Trim() } else { '(none)' })"
