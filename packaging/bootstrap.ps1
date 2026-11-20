$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$mode = $env:WYD_MODE
if ($mode -and $mode -ne '--check') { throw 'Unknown option. Use the BAT normally, or --check.' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'This mod requires 64-bit Windows.' }
$launcherMutex = [System.Threading.Mutex]::new($false, 'Local\WaterYouModding.Launcher')
$locked = $false
try {
    try { $locked = $launcherMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { Write-Host 'Another launcher is already running.'; exit 0 }
    $packageRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'WaterYouModding'
    if ($env:WYD_PACKAGE_ROOT) { $packageRoot = [IO.Path]::GetFullPath($env:WYD_PACKAGE_ROOT) }
    $packageRoot = [IO.Path]::GetFullPath($packageRoot)
    $packagesDir = Join-Path $packageRoot 'packages'
    $runtimeDir = Join-Path $packageRoot 'runtime'
    [IO.Directory]::CreateDirectory($packagesDir) | Out-Null
    [IO.Directory]::CreateDirectory($runtimeDir) | Out-Null
    $expectedZipHash = '__ZIP_SHA256__'
    $expectedManifestHash = '__MANIFEST_SHA256__'
    $installDir = Join-Path $packagesDir $expectedZipHash.Substring(0,16)
    function Get-WydHash([string]$path) {
        $stream = [IO.File]::OpenRead($path)
        $hash = [Security.Cryptography.SHA256]::Create()
        try { return ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
        finally { $hash.Dispose(); $stream.Dispose() }
    }
    function Test-WydPackage([string]$folder) {
        $manifestPath = Join-Path $folder 'manifest.json'
        if (-not [IO.File]::Exists($manifestPath)) { return $false }
        if ((Get-WydHash $manifestPath) -ne $expectedManifestHash) { return $false }
        $manifest = [IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
        foreach ($entry in $manifest.files) {
            $file = Join-Path $folder $entry.path
            if (-not [IO.File]::Exists($file)) { return $false }
            if (([IO.FileInfo]::new($file)).Length -ne $entry.bytes) { return $false }
            if ((Get-WydHash $file) -ne $entry.sha256) { return $false }
        }
        return $true
    }
    if (-not (Test-WydPackage $installDir)) {
        Write-Host 'Extracting mod...'
        $payloadMatch = [regex]::Match($bundleText, '(?m)^:__WYD_PAYLOAD__\r?$')
        if (-not $payloadMatch.Success) { throw 'BAT payload is missing.' }
        $payload = [Convert]::FromBase64String($bundleText.Substring($payloadMatch.Index + $payloadMatch.Length))
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { $actualHash = ([BitConverter]::ToString($hasher.ComputeHash($payload))).Replace('-', '').ToLowerInvariant() } finally { $hasher.Dispose() }
        if ($actualHash -ne $expectedZipHash) { throw 'BAT is incomplete or damaged. Copy the original BAT again.' }
        $stagingDir = Join-Path $packagesDir ($expectedZipHash.Substring(0,16) + '-' + [guid]::NewGuid().ToString('N'))
        [IO.Directory]::CreateDirectory($stagingDir) | Out-Null
        Add-Type -AssemblyName System.IO.Compression
        $stream = [IO.MemoryStream]::new($payload, $false)
        $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Read)
        try {
            $bound = [IO.Path]::GetFullPath($stagingDir).TrimEnd('\') + '\'
            foreach ($entry in $archive.Entries) {
                $target = [IO.Path]::GetFullPath((Join-Path $stagingDir $entry.FullName))
                if (-not $target.StartsWith($bound, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid archive path.' }
                if ($entry.FullName.EndsWith('/')) { [IO.Directory]::CreateDirectory($target) | Out-Null; continue }
                [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
                $inputStream = $entry.Open()
                $outputStream = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
                try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
            }
        } finally { $archive.Dispose(); $stream.Dispose() }
        $payload = $null
        if (-not (Test-WydPackage $stagingDir)) { throw 'Package verification failed.' }
        if (-not (Test-Path -LiteralPath $installDir)) {
            Move-Item -LiteralPath $stagingDir -Destination $installDir
        } else {
            # Keep an invalid previous cache untouched; use the verified fresh copy.
            $installDir = $stagingDir
        }
    }
    $bundleText = $null
    $launcherPath = Join-Path $installDir 'WydLauncher.exe'
    if ($mode -eq '--check') { & $launcherPath --check } else { & $launcherPath }
    if ($LASTEXITCODE -ne 0) { throw 'Could not load the mod. See the reason above.' }
    if ($mode -ne '--check') {
        Write-Host 'F8: Menu. F10: Disable.' -ForegroundColor Green
        Write-Host 'Language: F8 > Settings > Language.'
        Start-Sleep -Seconds 3
    }
    exit 0
} catch {
    Write-Host ('Error: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'Requires the supported Water You Doing 1.0.6 Win64 build.'
    exit 1
} finally {
    if ($locked) { $launcherMutex.ReleaseMutex() }
    $launcherMutex.Dispose()
}
