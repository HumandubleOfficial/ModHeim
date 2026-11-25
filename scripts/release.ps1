<#
  Bump ModHeim's version everywhere, commit, tag and push. GitHub Actions then builds the
  installer and publishes the release that installed copies update from.

    .\scripts\release.ps1 0.2.0
#>
param([Parameter(Mandatory = $true)][string]$Version)
$ErrorActionPreference = "Stop"
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 1.2.3" }
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if (git status --porcelain) { throw "Commit or stash your changes first." }

$utf8 = New-Object System.Text.UTF8Encoding($false)
function Set-Text($path, $pattern, $replacement) {
  $text = [IO.File]::ReadAllText($path)
  $new = [regex]::Replace($text, $pattern, $replacement, 1)
  if ($new -eq $text) { throw "Couldn't find the version in $path" }
  [IO.File]::WriteAllText($path, $new, $utf8)
}
Set-Text "package.json" '"version":\s*"[^"]+"' "`"version`": `"$Version`""
Set-Text "src-tauri/tauri.conf.json" '"version":\s*"[^"]+"' "`"version`": `"$Version`""
Set-Text "src-tauri/Cargo.toml" '(?m)^version\s*=\s*"[^"]+"' "version = `"$Version`""

# cargo/git write progress to stderr; only exit codes count from here on.
$ErrorActionPreference = "Continue"
Push-Location src-tauri; cargo update -p modheim --quiet; Pop-Location

git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "Release v$Version"
git tag "v$Version"
git push
git push origin "v$Version"
if ($LASTEXITCODE -ne 0) { Write-Error "Push failed"; exit 1 }
Write-Host "Pushed v$Version. GitHub Actions is building the release now."
