# DocDesk launcher. Run through start_all.bat, which just calls this.
#
# Does everything needed to go from a fresh clone to the app open in a browser:
# checks Node, creates server\.env if missing, installs packages when they are
# missing or have changed, prepares the database, starts the API (which also
# runs the AI assistant - there is no separate AI server) and the web app, waits
# until both actually answer, and opens the browser.
#
# Safe to run again while DocDesk is already running: anything already up is
# reused rather than started twice.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Server = Join-Path $Root 'server'
$Client = Join-Path $Root 'client'
$ApiPort = 5000
$WebPort = 5173

function Say($text, $colour = 'Gray') { Write-Host "  $text" -ForegroundColor $colour }
function Ok($text) { Write-Host '  [ok] ' -ForegroundColor Green -NoNewline; Write-Host $text }
function Step($text) { Write-Host '  [..] ' -ForegroundColor Cyan -NoNewline; Write-Host $text }
function Warn($text) { Write-Host '  [!]  ' -ForegroundColor Yellow -NoNewline; Write-Host $text }
function Fail($text) {
  Write-Host ''
  Write-Host '  [X]  ' -ForegroundColor Red -NoNewline
  Write-Host $text
  Write-Host ''
  exit 1
}

function Test-Url($url, $timeoutSec = 2) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec $timeoutSec
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Wait-Url($url, $seconds, $label) {
  for ($i = 0; $i -lt $seconds; $i++) {
    if (Test-Url $url) { return $true }
    if ($i -eq 5) { Say "still waiting for $label..." 'DarkGray' }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Get-PortOwner($port) {
  $connection = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $connection) { return $null }
  $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
  if ($process) { return "$($process.ProcessName) (PID $($process.Id))" }
  return "PID $($connection.OwningProcess)"
}

# Reinstall when node_modules is missing OR the lockfile changed since the last
# install, so pulling code that adds a package doesn't leave you with a crash.
function Ensure-Packages($dir, $label) {
  $lock = Join-Path $dir 'package-lock.json'
  $modules = Join-Path $dir 'node_modules'
  $marker = Join-Path $modules '.docdesk-lock-hash'
  $hash = if (Test-Path $lock) { (Get-FileHash $lock -Algorithm SHA256).Hash } else { 'no-lock' }
  $previous = if (Test-Path $marker) { (Get-Content $marker -Raw).Trim() } else { '' }

  if ((Test-Path $modules) -and $hash -eq $previous) {
    Ok "$label packages up to date"
    return
  }

  Step "Installing $label packages (first run, or packages changed) - this can take a minute..."
  Push-Location $dir
  try {
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Fail "Installing $label packages failed. Check your internet connection and run start_all.bat again." }
  } finally {
    Pop-Location
  }
  Set-Content -Path $marker -Value $hash -Encoding ascii
  Ok "$label packages installed"
}

Clear-Host
Write-Host ''
Write-Host '  DocDesk' -ForegroundColor White
Write-Host '  -------' -ForegroundColor DarkGray
Write-Host ''

# --- 1. Node ------------------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Fail 'Node.js is not installed. Install the LTS version from https://nodejs.org, then run start_all.bat again.'
}
$nodeVersion = (& node -v).Trim()
$nodeMajor = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 18) {
  Fail "DocDesk needs Node.js 18 or newer. This computer has $nodeVersion. Update it from https://nodejs.org."
}
Ok "Node.js $nodeVersion"

# --- 2. Settings file ---------------------------------------------------------
$envFile = Join-Path $Server '.env'
$envExample = Join-Path $Server '.env.example'
if (-not (Test-Path $envFile)) {
  Copy-Item $envExample $envFile
  Warn 'Created server\.env from the template.'
}
$envText = Get-Content $envFile -Raw
if ($envText -match '(?m)^\s*(GROQ_API_KEY|OPENROUTER_API_KEY|TOGETHER_API_KEY)\s*=\s*\S+') {
  Ok 'AI key found in server\.env'
} else {
  Warn 'No AI key in server\.env - the app works, but the assistant stays off.'
  Say  '     Add GROQ_API_KEY=... (free at https://console.groq.com/keys) and restart.' 'DarkGray'
}

# --- 3. Packages --------------------------------------------------------------
Ensure-Packages $Server 'server'
Ensure-Packages $Client 'web app'

# --- 4. Database --------------------------------------------------------------
# DocDesk runs on PostgreSQL. Without DATABASE_URL it uses the embedded engine
# in server\db\pgdata - nothing to install. The API opens it, applies any new
# migrations and (once) carries over an old SQLite database when it starts.
if ($envText -match '(?m)^\s*DATABASE_URL\s*=\s*\S+') {
  Ok 'Database: hosted PostgreSQL (DATABASE_URL)'
} else {
  Ok 'Database: embedded PostgreSQL (server\db\pgdata)'
}

# --- 5. API (also runs the AI assistant) -------------------------------------
$apiHealth = "http://127.0.0.1:$ApiPort/api/health"
if (Test-Url $apiHealth) {
  Ok "API already running on port $ApiPort - reusing it"
} else {
  # Clear any dead DocDesk API window from an earlier run before starting fresh.
  & (Join-Path $PSScriptRoot 'stop.ps1') -Only api | Out-Null
  Start-Sleep -Milliseconds 500
  $owner = Get-PortOwner $ApiPort
  if ($owner) {
    Fail "Port $ApiPort is taken by $owner, which isn't DocDesk. Close that program and run start_all.bat again."
  }
  Step 'Starting the API and opening the database (the very first start takes a little longer)...'
  Start-Process -FilePath 'cmd.exe' -WorkingDirectory $Server -WindowStyle Minimized `
    -ArgumentList '/k', 'title DocDesk API && npm run dev'
  if (-not (Wait-Url $apiHealth 150 'the API')) {
    Fail 'The API did not start. Open the "DocDesk API" window to see why.'
  }
  Ok "API running on http://localhost:$ApiPort"
}

try {
  $health = Invoke-RestMethod -UseBasicParsing -Uri $apiHealth -TimeoutSec 20
  Ok "$($health.database.engine) $($health.database.version) - $($health.database.tables) tables"
} catch {
  Warn 'Could not read the database status.'
}

# --- 6. AI status -------------------------------------------------------------
try {
  $ai = Invoke-RestMethod -UseBasicParsing -Uri "http://127.0.0.1:$ApiPort/api/ai/status?probe=1" -TimeoutSec 20
  if ($ai.configured -and $ai.reachable -ne $false) {
    Ok "AI assistant connected ($($ai.label), $($ai.model))"
  } elseif ($ai.configured) {
    Warn 'AI key found, but Groq could not be reached. Check the internet connection.'
  } else {
    Warn 'AI assistant is off (no key). Everything else works.'
  }
} catch {
  Warn 'Could not check the AI assistant status.'
}

# --- 7. Web app ---------------------------------------------------------------
$webUrl = "http://localhost:$WebPort"
if (Test-Url $webUrl) {
  Ok "Web app already running on port $WebPort - reusing it"
} else {
  & (Join-Path $PSScriptRoot 'stop.ps1') -Only web | Out-Null
  Start-Sleep -Milliseconds 500
  $owner = Get-PortOwner $WebPort
  if ($owner) {
    Fail "Port $WebPort is taken by $owner, which isn't DocDesk. Close that program and run start_all.bat again."
  }
  Step 'Starting the web app...'
  Start-Process -FilePath 'cmd.exe' -WorkingDirectory $Client -WindowStyle Minimized `
    -ArgumentList '/k', 'title DocDesk Web && npm run dev -- --strictPort'
  # Vite may listen on IPv6 localhost only, so check by name rather than 127.0.0.1.
  if (-not (Wait-Url $webUrl 60 'the web app')) {
    Fail 'The web app did not start. Open the "DocDesk Web" window to see why.'
  }
  Ok "Web app running on $webUrl"
}

# --- 8. Open it ---------------------------------------------------------------
if ($env:DOCDESK_NO_BROWSER -ne '1') {
  Start-Process $webUrl
}

Write-Host ''
Write-Host '  DocDesk is running.' -ForegroundColor Green
Write-Host ''
Say "Open:       $webUrl"
Say 'Assistant:  press Ctrl+K on any page'
Say 'Stop:       run stop_all.bat (or close the two minimised DocDesk windows)'
Write-Host ''
