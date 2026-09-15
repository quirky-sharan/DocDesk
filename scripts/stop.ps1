# Stops DocDesk. Run through stop_all.bat.
#
# The API runs as a chain (console window -> npm -> nodemon -> node) and window
# titles get renamed by npm, so windows are found by their command line instead,
# and each is stopped together with everything under it. Anything outside this
# DocDesk folder is left alone.

param([string]$Only = 'all')   # all | api | web

$Root = Split-Path -Parent $PSScriptRoot
$rootPattern = [Regex]::Escape($Root)
$stopped = 0

function Stop-Tree($processId, $label) {
  # taskkill /T takes the whole tree down in one go, children first.
  & taskkill.exe /PID $processId /T /F 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  [ok] Stopped $label" -ForegroundColor Green
    $script:stopped++
  }
}

# Ask the API to close the database cleanly first, so the embedded PostgreSQL
# finishes writing before its process is ended.
if ($Only -in 'all', 'api') {
  try {
    Invoke-RestMethod -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:5000/api/system/shutdown' `
      -Headers @{ 'x-docdesk-stop' = 'yes' } -TimeoutSec 5 | Out-Null
    Write-Host '  [ok] Database closed' -ForegroundColor Green
    for ($i = 0; $i -lt 20; $i++) {
      if (-not (Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Milliseconds 250
    }
  } catch {
    # Not running, or already stopping - the steps below handle both.
  }
}

$targets = @()
if ($Only -in 'all', 'api') { $targets += @{ Title = 'DocDesk API'; Port = 5000; Label = 'the API' } }
if ($Only -in 'all', 'web') { $targets += @{ Title = 'DocDesk Web'; Port = 5173; Label = 'the web app' } }

foreach ($target in $targets) {
  # 1. The launcher's console windows, and everything they started.
  $windows = Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*title $($target.Title) *" }
  foreach ($window in $windows) { Stop-Tree $window.ProcessId "$($target.Label) window" }

  # 2. Anything of ours still holding the port (e.g. started by hand).
  $connections = Get-NetTCPConnection -LocalPort $target.Port -State Listen -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    # Ours only if it, or the watcher that started it, runs from this folder.
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ParentProcessId)" -ErrorAction SilentlyContinue
    $ours = $process.Name -eq 'node.exe' -and (
      $process.CommandLine -match $rootPattern -or
      ($parent -and $parent.CommandLine -match $rootPattern)
    )
    if ($ours) {
      Stop-Tree $process.ProcessId "$($target.Label) on port $($target.Port)"
    } else {
      Write-Host "  [!]  Port $($target.Port) is used by $($process.Name), not DocDesk - left it running." -ForegroundColor Yellow
    }
  }

  # 3. A leftover file watcher from this folder would restart the server on the
  #    next file change, so don't leave one behind.
  $watcher = if ($target.Port -eq 5000) { 'nodemon' } else { 'vite' }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match $rootPattern -and $_.CommandLine -match $watcher } |
    ForEach-Object { Stop-Tree $_.ProcessId "leftover $watcher" }
}

if ($stopped -eq 0) {
  Write-Host '  DocDesk was not running.' -ForegroundColor Gray
} else {
  Write-Host ''
  Write-Host '  DocDesk stopped.' -ForegroundColor Green
}
Write-Host ''
