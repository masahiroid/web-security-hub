$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $root
$config = Get-Content -LiteralPath (Join-Path $root 'desktop/node-runtime.json') -Raw | ConvertFrom-Json
$arch = if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -eq 'Arm64') { 'arm64' } else { 'x64' }
$version = $config.version
$private = Join-Path $root ".runtime/node-v$version-win-$arch"
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
$useSystem = $false
if ($nodeCommand -and $npmCommand -and $env:WSH_FORCE_PRIVATE_NODE -ne '1') {
    & $nodeCommand.Source -e 'process.exit(+process.versions.node.split(".")[0]>=22?0:1)'
    $useSystem = $LASTEXITCODE -eq 0
}
if (-not $useSystem) {
    $node = Join-Path $private 'node.exe'
    if (-not (Test-Path -LiteralPath $node)) {
        Write-Host "Preparing private Node.js $version..."
        $cache = Join-Path $root '.runtime'
        New-Item -ItemType Directory -Force -Path $cache | Out-Null
        $archive = Join-Path $cache ('download-' + [Guid]::NewGuid().ToString() + '.zip')
        try {
            Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$version/node-v$version-win-$arch.zip" -OutFile $archive
            $expected = $config.sha256."win32-$arch"
            $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actual -ne $expected) { throw 'Node checksum mismatch; refusing installation.' }
            Expand-Archive -LiteralPath $archive -DestinationPath $cache -Force
        } finally { Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue }
    }
    $env:PATH = "$private;$env:PATH"
    $npm = Join-Path $private 'npm.cmd'
} else { $node = $nodeCommand.Source; $npm = $npmCommand.Source }
$stamp = Join-Path $root '.runtime/dependencies.sha256'
New-Item -ItemType Directory -Force -Path (Join-Path $root '.runtime') | Out-Null
$hash = (Get-FileHash -LiteralPath (Join-Path $root 'package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
if (-not (Test-Path node_modules) -or -not (Test-Path -LiteralPath $stamp) -or (Get-Content -LiteralPath $stamp -Raw) -ne $hash) {
    Write-Host 'Installing locked dependencies...'
    $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
    & $npm ci --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Fix the network or filesystem error and retry.' }
    [IO.File]::WriteAllText($stamp, $hash)
}
if ($args -contains '--doctor') { & $node (Join-Path $root 'desktop/environment.js') }
else {
    foreach ($configuration in @('tsconfig.verifier.json', 'tsconfig.verifier-ui.json')) {
        & $node (Join-Path $root 'node_modules/typescript/bin/tsc') -p (Join-Path $root $configuration)
        if ($LASTEXITCODE -ne 0) { throw 'TypeScript build failed.' }
    }
    & $node (Join-Path $root 'scripts/launch.js') @args
}
exit $LASTEXITCODE
