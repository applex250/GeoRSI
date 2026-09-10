# GeoRSI Lab - One-click update (Windows PowerShell 5.1+)
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\deploy.ps1
#   .\deploy.ps1 -Clean        # full rebuild no cache
#   .\deploy.ps1 -Logs         # follow logs after build
#   .\deploy.ps1 -SelfTest     # run selftest after build
#   .\deploy.ps1 -Smoke        # run smoke episode after build (needs API key)

param(
    [switch]$Clean,
    [switch]$Logs,
    [switch]$SelfTest,
    [switch]$Smoke,
    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Help) {
    Write-Host "Usage: .\deploy.ps1 [-Clean] [-Logs] [-SelfTest] [-Smoke]"
    exit 0
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root
Write-Host "[deploy] workdir: $Root" -ForegroundColor Cyan

# 1) Prerequisites
try { $null = Get-Command docker -ErrorAction Stop } catch {
    Write-Host "[deploy] ERROR: docker not found. Install Docker Desktop" -ForegroundColor Red
    exit 1
}

$Compose = $null
try {
    docker compose version 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $Compose = "docker compose" }
} catch {}
if (-not $Compose) {
    try { $null = Get-Command docker-compose -ErrorAction Stop; $Compose = "docker-compose" } catch {
        Write-Host "[deploy] ERROR: docker compose not found" -ForegroundColor Red
        exit 1
    }
}

function Invoke-Compose {
    param([string[]]$ComposeArgs)
    if ($Compose -eq "docker compose") {
        & docker compose @ComposeArgs
    } else {
        & docker-compose @ComposeArgs
    }
    if ($LASTEXITCODE -ne 0) { throw "compose failed: $ComposeArgs (exit $LASTEXITCODE)" }
}

Write-Host "[deploy] using: $Compose" -ForegroundColor Cyan
try { docker compose version | Select-Object -First 1 | Write-Host } catch {}

# 2) Ensure runtime dirs and .env
foreach ($d in @("runs","knowledge","rag")) {
    $p = Join-Path $Root $d
    if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}
if (-not (Test-Path -LiteralPath "$Root\.env") -and (Test-Path -LiteralPath "$Root\.env.example")) {
    Write-Host "[deploy] WARN: .env not found, copied from .env.example - please fill API keys" -ForegroundColor Yellow
    Copy-Item -LiteralPath "$Root\.env.example" -Destination "$Root\.env"
}
$privateDir = Join-Path (Split-Path $Root -Parent) "rsi-lab-private"
if (-not (Test-Path -LiteralPath $privateDir)) {
    try { New-Item -ItemType Directory -Path $privateDir | Out-Null } catch {}
}

# 3) Pull base image (best-effort)
Write-Host "[deploy] pulling base image updates (best-effort)..." -ForegroundColor Gray
try { docker pull node:22-bookworm-slim | Out-Null } catch { Write-Host "[deploy] pull skipped: $_" -ForegroundColor Yellow }

# 4) Build
Write-Host "[deploy] building image georsi:latest ..." -ForegroundColor Cyan
if ($Clean) {
    Invoke-Compose @("build", "--no-cache", "--pull")
} else {
    Invoke-Compose @("build", "--pull")
}

# 5) Recreate
Write-Host "[deploy] recreating containers ..." -ForegroundColor Cyan
try { Invoke-Compose @("down", "--remove-orphans") } catch { Write-Host "[deploy] down: $_" -ForegroundColor Yellow }

# 6) Up
Write-Host "[deploy] starting georsi ..." -ForegroundColor Cyan
Invoke-Compose @("up", "-d")

# 7) Status
Write-Host "[deploy] waiting for container ..." -ForegroundColor Gray
Start-Sleep -Seconds 3
Invoke-Compose @("ps")
Write-Host ""
try { docker images georsi:latest --format "table {{.Repository}}`t{{.Tag}}`t{{.Size}}`t{{.CreatedAt}}" } catch {}

# 8) Optional verify
if ($SelfTest) {
    Write-Host ""
    Write-Host "[deploy] running selftest inside container ..." -ForegroundColor Cyan
    Invoke-Compose @("run", "--rm", "georsi", "npx", "tsx", "src/run.ts", "selftest")
    Write-Host "[deploy] selftest done" -ForegroundColor Green
}

if ($Smoke) {
    Write-Host ""
    Write-Host "[deploy] running smoke (needs API key) ..." -ForegroundColor Cyan
    try {
        Invoke-Compose @("run", "--rm", "georsi", "npx", "tsx", "src/run.ts", "smoke")
    } catch {
        Write-Host "[deploy] smoke finished with error (maybe no API key): $_" -ForegroundColor Yellow
    }
}

# 9) Prune
Write-Host "[deploy] pruning dangling images ..." -ForegroundColor Gray
try { docker image prune -f 2>$null | Out-Null } catch {}

Write-Host ""
Write-Host "[deploy] DONE. Useful commands:" -ForegroundColor Green
Write-Host "  $Compose logs -f georsi          # logs"
Write-Host "  $Compose exec georsi sh          # shell"
Write-Host "  $Compose run --rm georsi npx tsx src/run.ts selftest"
Write-Host "  $Compose run --rm georsi npx tsx src/run.ts smoke"
Write-Host "  $Compose down                    # stop"

if ($Logs) {
    Write-Host ""
    Write-Host "[deploy] following logs (Ctrl+C to exit)..." -ForegroundColor Cyan
    Invoke-Compose @("logs", "-f", "georsi")
}
