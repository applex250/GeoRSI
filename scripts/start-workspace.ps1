# Start only the web workspace and its API; no unattended CLI research job.
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    docker compose up -d --build georsi-api georsi-web
    if ($LASTEXITCODE -ne 0) { throw 'Workspace startup failed.' }
    Write-Host 'GeoRSI workspace: http://localhost:3000/workspace'
} finally {
    Pop-Location
}
