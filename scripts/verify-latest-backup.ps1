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

$rootPrefix = $projectRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $dump.FullName.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'El respaldo resuelto quedó fuera del proyecto.'
}
$relative = $dump.FullName.Substring($rootPrefix.Length)
Write-Host "Verificando el respaldo aislado mas reciente: $relative"
& node (Join-Path $projectRoot 'backend\verify-isolated-database.js') "--backup=$relative"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
