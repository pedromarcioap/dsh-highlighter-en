# dsh-highlighter uninstall script: removes the loader entry and the plugin
# package. Existing annotation data (localStorage) is kept.
$ErrorActionPreference = 'Stop'

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$pkgDir = Join-Path $dshHome 'profiles\node_modules\dsh-highlighter'
$patchFile = Join-Path $dshHome 'profiles\web\cordis.patch.yml'

if (Test-Path $patchFile) {
    $lines = @(Get-Content $patchFile)
    $kept = New-Object System.Collections.Generic.List[string]
    $skip = 0
    foreach ($line in $lines) {
        if ($line -match '^\s*- id:\s*dsh-highlighter\s*$') {
            $skip = 2
            continue
        }
        if ($skip -gt 0) {
            if ($line -match '^\s+name:') { $skip = 0; continue }
            if ($line -match '^\s*#') { continue }
        }
        $kept.Add($line)
    }
    $kept | Set-Content -Path $patchFile -Encoding UTF8
    Write-Host "==> removed dsh-highlighter entry from $patchFile"
}

if (Test-Path $pkgDir) {
    Remove-Item -Recurse -Force $pkgDir
    Write-Host "==> removed $pkgDir"
}

Write-Host 'Done. Restart DeepSeek Harness. Annotation data stays in localStorage (dshhl_highlights).'
