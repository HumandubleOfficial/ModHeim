# Builds ModHeim's BepInEx plugins (GameTheme and Graphics) and copies them into the
# launcher's resources. Reference DLLs are copied from your own Valheim install and a ModHeim
# profile into game-theme/lib (git-ignored); nothing from the game is committed.
param(
    [string]$GameDir = "C:\XboxGames\Valheim\Content",
    [string]$Profile = "Default"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$lib = Join-Path $root "game-theme\lib"
New-Item -ItemType Directory -Force $lib | Out-Null

$managed = Join-Path $GameDir "Valheim_Data\Managed"
$core = Join-Path $env:APPDATA "ModHeim\profiles\$Profile\BepInEx\core"
foreach ($f in "UnityEngine.dll", "UnityEngine.CoreModule.dll", "UnityEngine.UI.dll", "UnityEngine.UIModule.dll",
               "UnityEngine.TextRenderingModule.dll", "Unity.TextMeshPro.dll", "netstandard.dll",
               "UnityEngine.InputLegacyModule.dll", "UnityEngine.IMGUIModule.dll", "assembly_postprocessing.dll") {
    Copy-Item (Join-Path $managed $f) $lib -Force
}
foreach ($f in "BepInEx.dll", "0Harmony.dll") {
    Copy-Item (Join-Path $core $f) $lib -Force
}

$dest = Join-Path $root "src-tauri\resources"
New-Item -ItemType Directory -Force $dest | Out-Null
foreach ($p in @(@{ Dir = "game-theme"; Dll = "ModHeim.GameTheme.dll" }, @{ Dir = "game-graphics"; Dll = "ModHeim.Graphics.dll" })) {
    $dir = Join-Path $root $p.Dir
    dotnet build $dir -c Release --nologo -v quiet
    if ($LASTEXITCODE -ne 0) { throw "Building $($p.Dir) failed" }
    Copy-Item (Join-Path $dir "bin\Release\$($p.Dll)") $dest -Force
    Write-Host "Built $(Join-Path $dest $p.Dll)"
}
