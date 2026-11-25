<#
  Build the signed installer on this PC (no release). The updater signing key lives outside
  the repo in %USERPROFILE%\.tauri\modheim.key.

    .\scripts\build-local.ps1
#>
$ErrorActionPreference = "Stop"
$key = Join-Path $env:USERPROFILE ".tauri\modheim.key"
if (-not (Test-Path $key)) { throw "Signing key not found at $key" }
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
Set-Location (Split-Path $PSScriptRoot -Parent)
# Tauri writes progress to stderr; don't let PowerShell 5 treat that as a failure.
$ErrorActionPreference = "Continue"
npm run tauri build
if ($LASTEXITCODE -ne 0) { Write-Error "Build failed"; exit $LASTEXITCODE }
Get-ChildItem "src-tauri\target\release\bundle\nsis" | Format-Table Name, Length
