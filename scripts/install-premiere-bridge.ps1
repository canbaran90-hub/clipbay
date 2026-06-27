# Installs the ClipBay Bridge CEP extension into Premiere Pro and enables
# loading of unsigned extensions. Run in normal PowerShell (no admin needed).
$ErrorActionPreference = 'Stop'

$src  = Join-Path $PSScriptRoot '..\premiere-extension\com.clipbay.bridge'
$dest = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.clipbay.bridge'

if (-not (Test-Path $src)) { Write-Error "Quelle nicht gefunden: $src"; exit 1 }

New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
Copy-Item -Recurse -Force $src $dest
Write-Host "Erweiterung kopiert nach: $dest"

# Allow unsigned extensions (PlayerDebugMode) for all relevant CEP versions.
foreach ($v in 9,10,11,12) {
  $k = "HKCU:\Software\Adobe\CSXS.$v"
  if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }
  New-ItemProperty -Path $k -Name 'PlayerDebugMode' -Value '1' -PropertyType String -Force | Out-Null
}
Write-Host "PlayerDebugMode aktiviert (CSXS 9-12)."
Write-Host ""
Write-Host "FERTIG. Jetzt:"
Write-Host "  1. Premiere Pro neu starten."
Write-Host "  2. Fenster > Erweiterungen (Extensions) > 'ClipBay Bridge' oeffnen."
Write-Host "  3. Panel andocken und offen lassen (es zeigt 'Verbunden')."
Write-Host "  4. In ClipBay: Strg + Doppelklick auf einen Clip -> oeffnet im Quellmonitor."
