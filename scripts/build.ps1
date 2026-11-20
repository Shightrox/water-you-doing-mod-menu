param([switch]$SkipTests)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Push-Location $repoRoot
try {
    foreach ($name in @('python', 'cmake')) { Get-Command $name -ErrorAction Stop | Out-Null }
    if (-not $SkipTests) { Get-Command node -ErrorAction Stop | Out-Null }
    & python scripts/fetch_dependencies.py
    if ($LASTEXITCODE) { throw 'Dependency download failed' }
    & python scripts/build_bundle.py
    if ($LASTEXITCODE) { throw 'Bundle generation failed' }
    & python scripts/generate_callback_lifetime_test.py
    if ($LASTEXITCODE) { throw 'Callback test generation failed' }
    & cmake -S . -B build -G 'Visual Studio 17 2022' -A x64
    if ($LASTEXITCODE) { throw 'CMake configuration failed' }
    & cmake --build build --config Release --parallel
    if ($LASTEXITCODE) { throw 'Compilation failed' }
    if (-not $SkipTests) {
        & node tests/movement.test.js
        if ($LASTEXITCODE) { throw 'Movement tests failed' }
        & node tests/repair.test.js
        if ($LASTEXITCODE) { throw 'Repair tests failed' }
        & ctest --test-dir build -C Release --output-on-failure
        if ($LASTEXITCODE) { throw 'Native tests failed' }
    }
    & python scripts/package.py
    if ($LASTEXITCODE) { throw 'Packaging failed' }
    & (Join-Path $repoRoot 'dist/WaterYouModding.bat') --check
    if ($LASTEXITCODE) { throw 'BAT package check failed' }
    Write-Host 'Built dist/WaterYouModding.bat'
} finally { Pop-Location }
