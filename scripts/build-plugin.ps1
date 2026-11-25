# Builds the ModHeim.GameTheme BepInEx plugin and copies it into the launcher's resources.
# Reference DLLs are copied from your own Valheim install and a ModHeim profile into
# game-theme/lib (git-ignored); nothing from the game is committed.
param(
    [string]$GameDir = "C:\XboxGames\Valheim\Content",
    [string]$Profile = "Default"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$proj = Join-Path $root "game-theme"
$lib = Join-Path $proj "lib"
New-Item -ItemType Directory -Force $lib | Out-Null

$managed = Join-Path $GameDir "Valheim_Data\Managed"
$core = Join-Path $env:APPDATA "ModHeim\profiles\$Profile\BepInEx\core"
foreach ($f in "UnityEngine.dll", "UnityEngine.CoreModule.dll", "UnityEngine.UI.dll", "UnityEngine.UIModule.dll",
               "UnityEngine.TextRenderingModule.dll", "Unity.TextMeshPro.dll", "netstandard.dll") {
    Copy-Item (Join-Path $managed $f) $lib -Force
}
foreach ($f in "BepInEx.dll", "0Harmony.dll") {
    Copy-Item (Join-Path $core $f) $lib -Force
}

dotnet build $proj -c Release --nologo -v quiet
if ($LASTEXITCODE -ne 0) { throw "Plugin build failed" }

$out = Join-Path $proj "bin\Release\ModHeim.GameTheme.dll"
$dest = Join-Path $root "src-tauri\resources"
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item $out $dest -Force
Write-Host "Built $(Join-Path $dest 'ModHeim.GameTheme.dll')"
