#Requires -Version 5.1
<#
  Validación local del Railway Cron Pinger: Python, .env, httpx y ejecución opcional de main.py.
  Uso: .\validate_local.ps1  (desde esta carpeta o con ruta completa; no depende del CWD)
#>

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EnvFile     = Join-Path $ProjectRoot '.env'
$MainPy      = Join-Path $ProjectRoot 'main.py'
$ReqFile     = Join-Path $ProjectRoot 'requirements.txt'

$DefaultCronPath  = '/api/cron/leads-pendientes?force=true'
$DefaultTimeoutS   = '90'

function Write-Info { param([string]$Msg) Write-Host $Msg -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host $Msg -ForegroundColor Yellow }
function Write-Err  { param([string]$Msg) Write-Host $Msg -ForegroundColor Red }

Write-Host '=== Railway Cron Pinger — Validación local ===' -ForegroundColor Cyan

# 1) Python 3.9+ (código Python entre comillas simples para no confundir al parser de PS)
& python -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)' 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Err 'Python 3.9+ no está instalado o el comando "python" no está en el PATH.'
    exit 1
}

# 2) .env
if (-not (Test-Path -LiteralPath $EnvFile)) {
    Write-Err ('No se encontró: ' + $EnvFile)
    Write-Warn 'Copiar .env.example como .env y completar los valores.'
    exit 1
}

# 3) Cargar .env (ignorar comentarios # y líneas vacías) y comprobar CRON_*
$envMap = @{}
Get-Content -LiteralPath $EnvFile -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ($line -match '^\s*#' -or [string]::IsNullOrWhiteSpace($line)) { return }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { return }
    $k = $line.Substring(0, $idx).Trim()
    $v = $line.Substring($idx + 1).Trim()
    if ($v.Length -ge 2 -and $v[0] -eq [char]34 -and $v[-1] -eq [char]34) { $v = $v.Substring(1, $v.Length - 2) }
    if ($v.Length -ge 2 -and $v[0] -eq [char]39 -and $v[-1] -eq [char]39) { $v = $v.Substring(1, $v.Length - 2) }
    $envMap[$k] = $v
}

$rawBase = if ($envMap.ContainsKey('CRON_BASE_URL')) { $envMap['CRON_BASE_URL'] } else { '' }
$rawSec  = if ($envMap.ContainsKey('CRON_SECRET')) { $envMap['CRON_SECRET'] } else { '' }
$cronBase = if ($rawBase) { $rawBase.Trim() } else { '' }
$cronSec  = if ($rawSec) { $rawSec.Trim() } else { '' }
if ([string]::IsNullOrWhiteSpace($cronBase) -or [string]::IsNullOrWhiteSpace($cronSec)) {
    Write-Err 'CRON_BASE_URL y CRON_SECRET deben estar definidos y no vacíos en .env'
    exit 1
}

# 4) httpx
& python -c 'import httpx; print(httpx.__version__)' 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Warn 'httpx no disponible. Instalando dependencias...'
    & python -m pip install -r $ReqFile
    if ($LASTEXITCODE -ne 0) {
        Write-Err 'pip install falló.'
        exit 1
    }
}

$rawPath = if ($envMap.ContainsKey('CRON_PATH')) { $envMap['CRON_PATH'] } else { '' }
$rawTo   = if ($envMap.ContainsKey('REQUEST_TIMEOUT_S')) { $envMap['REQUEST_TIMEOUT_S'] } else { '' }
$cronPath = if ($rawPath) { $rawPath.Trim() } else { '' }
$timeoutS = if ($rawTo) { $rawTo.Trim() } else { '' }
if ([string]::IsNullOrWhiteSpace($cronPath)) { $cronPath = $DefaultCronPath }
if ([string]::IsNullOrWhiteSpace($timeoutS)) { $timeoutS = $DefaultTimeoutS }

# 5) Resumen (nunca el secreto real)
Write-Info ('CRON_BASE_URL: ' + $cronBase)
Write-Info ('CRON_PATH: ' + $cronPath)
Write-Info ('REQUEST_TIMEOUT_S: ' + $timeoutS)
Write-Info 'CRON_SECRET: ******'

# 6) Preguntar y ejecutar main.py con variables del .env
$ans = Read-Host '¿Ejecutar main.py ahora? (s/N)'
if ($ans -ne 's' -and $ans -ne 'S') {
    Write-Info 'Listo. No se ejecutó main.py.'
    exit 0
}

foreach ($key in $envMap.Keys) {
    [Environment]::SetEnvironmentVariable($key, $envMap[$key], 'Process')
}
& python $MainPy
exit $LASTEXITCODE
