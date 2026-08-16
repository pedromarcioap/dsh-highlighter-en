# dsh-highlighter install script.
# Deploys the plugin package to $DSH_HOME\profiles\node_modules\dsh-highlighter and
# registers the loader entry in $DSH_HOME\profiles\web\cordis.patch.yml (idempotent).
$ErrorActionPreference = 'Stop'

$srcDir = $PSScriptRoot
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$pkgDir = Join-Path $dshHome 'profiles\node_modules\dsh-highlighter'
$patchFile = Join-Path $dshHome 'profiles\web\cordis.patch.yml'

if (-not (Test-Path $patchFile)) {
    Write-Error "profile patch file not found: $patchFile (start DeepSeek Harness once first)"
    exit 1
}

Write-Host "==> deploying plugin package to $pkgDir"
New-Item -ItemType Directory -Force -Path $pkgDir | Out-Null
foreach ($f in 'package.json', 'index.js', 'client.js') {
    Copy-Item -Force -Path (Join-Path $srcDir $f) -Destination $pkgDir
    Write-Host "    copied $f"
}

Write-Host "==> registering loader entry ($patchFile)"
$lines = @(Get-Content $patchFile)
if ($lines -match 'dsh-highlighter') {
    Write-Host '    dsh-highlighter entry already present, skipping'
} else {
    while ($lines.Count -gt 0 -and $lines[-1].Trim() -eq '') { $lines = $lines[0..($lines.Count - 2)] }
    if ($lines.Count -gt 0 -and $lines[-1].Trim() -eq '[]') { $lines = $lines[0..($lines.Count - 2)] }
    $lines += '- insert:'
    $lines += '    - id: dsh-highlighter'
    $lines += "      name: 'dsh-highlighter'"
    $lines | Set-Content -Path $patchFile -Encoding UTF8
    Write-Host '    insert entry appended'
}

Write-Host ''
Write-Host 'Done. Fully quit and restart DeepSeek Harness for the plugin to load.'
Write-Host 'After restart, run in the page console: window.__dshHighlighterDiagnostics.health()'
