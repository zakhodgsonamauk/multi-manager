# Pop-up that opens a Multi-Manager front desk, either on the main team (the shared roster on this PC,
# opened in the plugin folder, as the old front-desk.bat did) or in a chosen "cluster" folder. Each cluster
# folder is its own team: its roster lives in <folder>\.multi-manager\roster.db (see src/launch/front-desk-launch.ts).
# Started by front-desk.bat. Cancel launches nothing. Keep this file ASCII: Windows PowerShell reads it as ANSI.
# -Remote pre-ticks "Reachable from my phone" (front-desk.bat remote); the user can still untick it.
param([Parameter(Mandatory = $true)][string]$PluginDir, [switch]$Remote)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

function Show-Problem([string]$message) {
  [void][System.Windows.Forms.MessageBox]::Show($message, 'Multi-Manager', 'OK', 'Error')
}

try {
  # Both are needed: node runs the launcher, pwsh runs the front desk tab.
  $missing = @('node', 'pwsh') | Where-Object { -not (Get-Command $_ -CommandType Application -ErrorAction SilentlyContinue) }
  if ($missing) {
    Show-Problem("Cannot open the front desk: $($missing -join ' and ') not found.`n`nInstall Node.js (https://nodejs.org) and PowerShell 7 (winget install Microsoft.PowerShell), then try again.")
    exit 1
  }
  $launcher = Join-Path $PluginDir 'scripts\front-desk-launch.ts'
  if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    Show-Problem("Cannot open the front desk: the launcher is missing.`n`n$launcher")
    exit 1
  }

  # Remember the last choice so returning to it is one click: the word 'main', or the cluster folder's full path
  # (always absolute, so it can never be the word 'main'). Nothing remembered means the main team.
  $mainMarker = 'main'
  $rememberDir = Join-Path $env:LOCALAPPDATA 'multi-manager'
  $rememberFile = Join-Path $rememberDir 'last-cluster.txt'
  $last = $mainMarker
  if (Test-Path -LiteralPath $rememberFile) {
    $saved = ([string](Get-Content -LiteralPath $rememberFile -Raw -Encoding UTF8)).Trim()
    if ($saved -ne '') { $last = $saved }
  }

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Open a Multi-Manager front desk'
  $form.Font = New-Object System.Drawing.Font('Segoe UI', 9)
  $form.AutoScaleMode = 'Font'
  $form.ClientSize = New-Object System.Drawing.Size(560, 236)
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.StartPosition = 'CenterScreen'

  $mainRadio = New-Object System.Windows.Forms.RadioButton
  $mainRadio.Location = New-Object System.Drawing.Point(12, 12)
  $mainRadio.Size = New-Object System.Drawing.Size(536, 24)
  $mainRadio.Text = 'My main team (no folder): the shared roster on this PC'
  $form.Controls.Add($mainRadio)

  $clusterRadio = New-Object System.Windows.Forms.RadioButton
  $clusterRadio.Location = New-Object System.Drawing.Point(12, 40)
  $clusterRadio.Size = New-Object System.Drawing.Size(536, 24)
  $clusterRadio.Text = 'A cluster folder, its own separate team (browse, or paste a path):'
  $form.Controls.Add($clusterRadio)

  $folderBox = New-Object System.Windows.Forms.TextBox
  $folderBox.Location = New-Object System.Drawing.Point(30, 70)
  $folderBox.Size = New-Object System.Drawing.Size(422, 24)
  $form.Controls.Add($folderBox)

  $browse = New-Object System.Windows.Forms.Button
  $browse.Location = New-Object System.Drawing.Point(458, 69)
  $browse.Size = New-Object System.Drawing.Size(90, 26)
  $browse.Text = 'Browse...'
  $form.Controls.Add($browse)
  $browse.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = 'Choose the cluster folder for this front desk'
    if ($folderBox.Text.Trim() -ne '' -and (Test-Path -LiteralPath $folderBox.Text.Trim() -PathType Container)) { $dlg.SelectedPath = $folderBox.Text.Trim() }
    if ($dlg.ShowDialog($form) -eq 'OK') { $folderBox.Text = $dlg.SelectedPath }
    $dlg.Dispose()
  })

  $hint = New-Object System.Windows.Forms.Label
  $hint.Location = New-Object System.Drawing.Point(30, 102)
  $hint.Size = New-Object System.Drawing.Size(518, 36)
  $hint.ForeColor = [System.Drawing.SystemColors]::GrayText
  $hint.Text = 'Its roster is kept in .multi-manager\roster.db inside the folder. In Dropbox or another synced folder, use it from one PC only.'
  $form.Controls.Add($hint)

  $remoteBox = New-Object System.Windows.Forms.CheckBox
  $remoteBox.Location = New-Object System.Drawing.Point(12, 148)
  $remoteBox.Size = New-Object System.Drawing.Size(536, 24)
  $remoteBox.Text = 'Reachable from my phone (Remote Control)'
  $remoteBox.Checked = [bool]$Remote
  $form.Controls.Add($remoteBox)

  $ok = New-Object System.Windows.Forms.Button
  $ok.Location = New-Object System.Drawing.Point(356, 192)
  $ok.Size = New-Object System.Drawing.Size(90, 30)
  $ok.Text = 'OK'
  $form.Controls.Add($ok)

  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Location = New-Object System.Drawing.Point(458, 192)
  $cancel.Size = New-Object System.Drawing.Size(90, 30)
  $cancel.Text = 'Cancel'
  $cancel.DialogResult = 'Cancel'
  $form.Controls.Add($cancel)

  $form.AcceptButton = $ok
  $form.CancelButton = $cancel

  # The folder box and Browse only matter for a cluster.
  $syncFolderControls = { $folderBox.Enabled = $clusterRadio.Checked; $browse.Enabled = $clusterRadio.Checked; $hint.Enabled = $clusterRadio.Checked }
  $clusterRadio.Add_CheckedChanged($syncFolderControls)
  if ($last -eq $mainMarker) { $mainRadio.Checked = $true } else { $folderBox.Text = $last; $clusterRadio.Checked = $true }
  & $syncFolderControls

  # Explorer's "Copy as path" wraps the path in quotes; accept that.
  function Get-ChosenFolder { $folderBox.Text.Trim().Trim('"').Trim() }

  # OK only closes the pop-up once a cluster folder exists; the result is the form's DialogResult (no handler-scoped flag).
  $ok.Add_Click({
    if ($clusterRadio.Checked) {
      $chosen = Get-ChosenFolder
      if ($chosen -eq '' -or -not (Test-Path -LiteralPath $chosen -PathType Container)) {
        Show-Problem('That folder does not exist. Browse for it, or paste the full path.')
        return
      }
    }
    $form.DialogResult = 'OK'
  })

  $result = $form.ShowDialog()
  $useMain = $mainRadio.Checked
  $folder = Get-ChosenFolder
  $remote = $remoteBox.Checked
  $form.Dispose()
  if ($result -ne 'OK') { exit 0 }

  # Hand off to the launcher: it opens a new Terminal window whose tab sets its own environment
  # (MM_ROSTER_DB for a cluster; none for the main team, which uses the shared roster).
  if ($useMain) {
    $choice = $mainMarker
    $launchArgs = @('--no-warnings', $launcher, '--main', '--plugin-dir', $PluginDir)
  } else {
    $choice = (Resolve-Path -LiteralPath $folder).ProviderPath
    # Windows PowerShell passes "D:\" to node as D:" (the trailing backslash escapes the closing quote), so drop
    # a trailing backslash, and pass a bare drive root as D:\. instead. The remembered choice stays as resolved.
    $nodeFolder = $choice.TrimEnd('\')
    if ($nodeFolder -match '^[A-Za-z]:$') { $nodeFolder += '\.' }
    $launchArgs = @('--no-warnings', $launcher, '--folder', $nodeFolder, '--plugin-dir', $PluginDir)
  }
  if ($remote) { $launchArgs += '--remote' }
  $ErrorActionPreference = 'Continue'
  # stderr lines arrive as error records; keep only their text so the message box shows the launcher's reason.
  $output = (& node @launchArgs 2>&1 | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" } }) -join "`n"
  $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($code -ne 0) {
    Show-Problem("Could not open the front desk.`n`n$($output.Trim())")
    exit 1
  }
} catch {
  Show-Problem("Could not open the front desk.`n`n$($_.Exception.Message)")
  exit 1
}

# The front desk is open by now. Failing to remember the choice only costs a retype next time, so it is not reported.
try {
  New-Item -ItemType Directory -Force -Path $rememberDir | Out-Null
  Set-Content -LiteralPath $rememberFile -Value $choice -Encoding UTF8
} catch { }
