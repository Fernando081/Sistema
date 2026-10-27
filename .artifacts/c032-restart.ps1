$ErrorActionPreference='Stop'
$taskNodePath='C:\Users\refac\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64\node.exe'
$taskMetaPath='C:\Sistema\.runtime\web-metrics-backend-process.json'
$taskMeta=Get-Content -LiteralPath $taskMetaPath -Raw | ConvertFrom-Json
$taskProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$($taskMeta.pid)"
if($taskProcess){
  if($taskProcess.ExecutablePath -ne $taskNodePath -or $taskProcess.CommandLine -notmatch 'C:\\Sistema\\backend\\dist\\main\.js'){throw 'El proceso no coincide con el backend administrado; no se detuvo.'}
  Stop-Process -Id $taskMeta.pid
}
$taskPreviousPort=$env:PORT
try{
  $env:PORT='3100'
  $taskStarted=Start-Process -FilePath $taskNodePath -ArgumentList 'C:\Sistema\backend\dist\main.js' -WorkingDirectory 'C:\Sistema' -WindowStyle Hidden -RedirectStandardOutput 'C:\Sistema\.runtime\c032-backend.out.log' -RedirectStandardError 'C:\Sistema\.runtime\c032-backend.err.log' -PassThru
  $taskMeta.pid=$taskStarted.Id
  $taskMeta.phase='C03.2'
  $taskMeta | ConvertTo-Json | Set-Content -LiteralPath $taskMetaPath -Encoding utf8
  Write-Output "Backend C03.2 iniciado en3100, PID $($taskStarted.Id)."
}finally{$env:PORT=$taskPreviousPort}







