# O03 · Registra (o reemplaza) la tarea de Windows que ejecuta el respaldo protegido diario.
# Uso (lo ejecuta el propietario, una sola vez): powershell -ExecutionPolicy Bypass -File scripts\register-backup-task.ps1 -Hora 21:30
# Corre con la cuenta actual, sólo con sesión iniciada; la salida queda en .backups\respaldo-diario.log.
param(
  [string]$Hora = '21:30',
  [string]$Nombre = 'Sistema - respaldo protegido diario'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'node24.ps1'
$log = Join-Path $projectRoot '.backups\respaldo-diario.log'
$command = "Set-Location -LiteralPath '$projectRoot'; & '$runner' run backup:daily *>> '$log'"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"$command`""
$trigger = New-ScheduledTaskTrigger -Daily -At $Hora
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $Nombre -Action $action -Trigger $trigger -Settings $settings -Description 'db:backup + cifrado + copia externa + retención + estado (O03)' -Force | Out-Null
Write-Host "Tarea '$Nombre' registrada a las $Hora. Revisa el resultado en $log o con npm run backup:status."
