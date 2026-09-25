$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$backupRoot = Join-Path $projectRoot '.backups'

if (-not (Test-Path $backupRoot)) {
  throw 'No existe .backups. Ejecuta npm run db:backup antes de la verificación de liberación.'
}

$dump = Get-ChildItem -LiteralPath $backupRoot -Filter 'database.dump' -File -Recurse |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $dump) {
  throw 'No se encontró database.dump dentro de .backups. Ejecuta npm run db:backup.'
}

$relative = [System.IO.Path]::GetRelativePath($projectRoot, $dump.FullName)
Write-Host "Verificando el respaldo aislado más reciente: $relative"
& node (Join-Path $projectRoot 'backend\verify-isolated-database.js') "--backup=$relative"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
