<#
  Publish the installer built by build-local.ps1 as a GitHub release, with the latest.json
  that installed copies of ModHeim read to find and verify updates. Only the signed outputs
  are uploaded; the signing key never leaves this PC.

    .\scripts\build-local.ps1
    .\scripts\publish-local.ps1 -Notes "What's new in this version"
#>
param([string]$Notes = "")
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$repo = "HumandubleOfficial/ModHeim"
$version = (Get-Content "src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json).version
$tag = "v$version"
$bundle = "src-tauri/target/release/bundle/nsis"
$exe = Join-Path $bundle "ModHeim_${version}_x64-setup.exe"
$sig = "$exe.sig"
if (-not (Test-Path $exe) -or -not (Test-Path $sig)) { throw "Build $version first with scripts/build-local.ps1" }

$url = "https://github.com/$repo/releases/download/$tag/ModHeim_${version}_x64-setup.exe"
$entry = @{ signature = (Get-Content $sig -Raw).Trim(); url = $url }
$feed = [ordered]@{
  version   = $version
  notes     = $Notes
  pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{ "windows-x86_64" = $entry; "windows-x86_64-nsis" = $entry }
}
$latest = Join-Path $bundle "latest.json"
[IO.File]::WriteAllText((Resolve-Path $bundle).Path + "\latest.json", ($feed | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))

$body = @"
$Notes

**Install:** download **ModHeim_${version}_x64-setup.exe** below and run it. Windows may show a SmartScreen warning because the installer isn't code-signed. Choose *More info*, then *Run anyway*.

Already have ModHeim? It updates itself. Look for the update button in the title bar.
"@

# gh writes progress to stderr; only its exit code matters.
$ErrorActionPreference = "Continue"
gh release create $tag $exe $sig $latest --repo $repo --title "ModHeim $version" --notes $body --target main
if ($LASTEXITCODE -ne 0) { Write-Error "Release failed"; exit 1 }
Write-Host "Published $tag"
