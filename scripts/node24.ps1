$NpmArguments = $args
$candidates = @(
  "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64",
  "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
)
$nodeDirectory = $candidates | Where-Object { Test-Path (Join-Path $_ 'node.exe') } | Select-Object -First 1
if (-not $nodeDirectory) { throw 'Node 24 LTS no está instalado. Ejecuta: winget install OpenJS.NodeJS.LTS --scope user' }
$node = Join-Path $nodeDirectory 'node.exe'
if (-not ((& $node -p "process.versions.node.split('.')[0]") -eq '24')) { throw 'La instalación encontrada no corresponde a Node 24.' }
$env:Path = "$nodeDirectory;$env:Path"
$npmCli = Join-Path $nodeDirectory 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path $npmCli)) { throw 'No se encontró npm junto a Node 24.' }
& $node $npmCli @NpmArguments
exit $LASTEXITCODE
