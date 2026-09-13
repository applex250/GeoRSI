# Double-click ../start-workspace.cmd, or run this script from any directory.
[CmdletBinding()]
param([switch]$NoBuild)

$ErrorActionPreference = 'Stop'
$previousDockerConfig = $env:DOCKER_CONFIG
$temporaryDockerConfig = $null
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'Docker is not installed. Install and start Docker Desktop first.'
    }
    docker info --format '{{.OSType}}'
    if ($LASTEXITCODE -ne 0) { throw 'Docker is not ready. Start Docker Desktop and try again.' }

    # Only start the API and website; the standalone CLI agent is a separate service.
    $composeArguments = @('compose', 'up', '-d', '--wait', '--wait-timeout', '120')
    if (-not $NoBuild) { $composeArguments += '--build' }
    $composeArguments += @('georsi-api', 'georsi-web')
    Write-Host '[GeoRSI] Building and starting the research workspace...'

    # Windows PowerShell treats native stderr as an error record. Docker writes
    # normal progress there, so use its exit code instead of stopping on stderr.
    $ErrorActionPreference = 'Continue'
    & docker @composeArguments 2>&1 | Tee-Object -Variable startupOutput | ForEach-Object { Write-Host "$_" }
    $startupExitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'

    if ($startupExitCode -ne 0 -and ($startupOutput -join "`n") -match 'error getting credentials|docker-credential-desktop') {
        Write-Host '[GeoRSI] Credential helper unavailable. Retrying public images with a temporary configuration.'
        $temporaryDockerConfig = Join-Path ([System.IO.Path]::GetTempPath()) ('georsi-docker-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $temporaryDockerConfig | Out-Null
        # Keep any explicitly selected Docker context, but omit the broken helper.
        $fallbackConfig = @{}
        $configRoot = if ($previousDockerConfig) { $previousDockerConfig } else { Join-Path $env:USERPROFILE '.docker' }
        $configFile = Join-Path $configRoot 'config.json'
        if (Test-Path -LiteralPath $configFile) {
            $originalConfig = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
            if ($originalConfig.currentContext) { $fallbackConfig.currentContext = $originalConfig.currentContext }
        }
        $contextsDirectory = Join-Path $configRoot 'contexts'
        if (Test-Path -LiteralPath $contextsDirectory) {
            Copy-Item -LiteralPath $contextsDirectory -Destination $temporaryDockerConfig -Recurse
        }
        $fallbackConfig | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $temporaryDockerConfig 'config.json') -Encoding Ascii
        $env:DOCKER_CONFIG = $temporaryDockerConfig
        & docker @composeArguments
        $startupExitCode = $LASTEXITCODE
    }
    if ($startupExitCode -ne 0) { throw 'Workspace startup failed. See the Docker output above.' }

    foreach ($path in @('/workspace', '/api/research/healthz')) {
        $response = Invoke-WebRequest -UseBasicParsing -Uri ('http://localhost:3000' + $path) -TimeoutSec 20
        if ($response.StatusCode -ne 200) { throw "HTTP check failed: $path" }
    }
    Write-Host ''
    Write-Host 'GeoRSI is ready.' -ForegroundColor Green
    Write-Host 'Workspace: http://localhost:3000/workspace'
    Write-Host 'Homepage:  http://localhost:3000'
    Write-Host 'Containers keep running after this window closes.'
} catch {
    Write-Host "[GeoRSI] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    $env:DOCKER_CONFIG = $previousDockerConfig
    if ($temporaryDockerConfig) {
        # Only remove this invocation's GUID-named directory inside the OS temp root.
        $cleanupPath = [System.IO.Path]::GetFullPath($temporaryDockerConfig)
        $expectedParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/')
        if ((Split-Path -Parent $cleanupPath) -eq $expectedParent -and (Split-Path -Leaf $cleanupPath) -match '^georsi-docker-[a-f0-9]{32}$') {
            Remove-Item -LiteralPath $cleanupPath -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    Pop-Location
}
