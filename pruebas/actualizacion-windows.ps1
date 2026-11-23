param(
  [Parameter(Mandatory)][string]$De,
  [Parameter(Mandatory)][string]$A
)
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:47800'
$exe = Join-Path $env:ProgramFiles 'Halcon Pruebas\Halcon Pruebas.exe'
$log = Join-Path $env:APPDATA 'Halcon Pruebas\actualizador.log'

function Fallar($mensaje) {
  Write-Host '--- actualizador.log ---'
  if (Test-Path $log) { Get-Content $log | Write-Host } else { Write-Host '(no existe el archivo)' }
  throw $mensaje
}

# 1. Bajar e instalar la version vieja en silencio
$instalador = Join-Path $env:RUNNER_TEMP "halcon-pruebas-$De.exe"
gh release download "v$De" --pattern "halcon-pruebas-$De.exe" --dir $env:RUNNER_TEMP
$p = Start-Process -FilePath $instalador -ArgumentList '/S' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "El instalador termino con codigo $($p.ExitCode)" }
if (-not (Test-Path $exe)) { throw "No se instalo el programa en $exe" }

# 2. Abrir y esperar que la version llegue a $A (hasta 5 minutos, cada 5 s)
Start-Process -FilePath $exe | Out-Null
$t = [Diagnostics.Stopwatch]::StartNew()
$version = $null
while ($t.Elapsed.TotalMinutes -lt 5) {
  try { $version = (Invoke-RestMethod "$base/hola" -TimeoutSec 2).version } catch { $version = $null }
  if ($version -eq $A) { break }
  Start-Sleep -Seconds 5
}
if ($version -ne $A) { Fallar "La version no llego a $A en 5 minutos (ultima vista: $version)" }

Write-Host "Actualizo de $De a $A en $([math]::Round($t.Elapsed.TotalSeconds)) s"
if (Test-Path $log) { Get-Content $log | Write-Host }
Get-Process -Name 'Halcon Pruebas' -ErrorAction SilentlyContinue | Stop-Process -Force
