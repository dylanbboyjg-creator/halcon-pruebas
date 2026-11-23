param(
  [Parameter(Mandatory)][string]$Instalador,
  [Parameter(Mandatory)][string]$Version
)
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:47800'
$exe = Join-Path $env:ProgramFiles 'Halcon Pruebas\Halcon Pruebas.exe'
$token = Join-Path $env:APPDATA 'Halcon Pruebas\token.txt'

function Abrir { Start-Process -FilePath $exe | Out-Null }
function Cerrar {
  Get-Process -Name 'Halcon Pruebas' -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 3
}
function EsperarHola {
  $t = [Diagnostics.Stopwatch]::StartNew()
  while ($t.Elapsed.TotalSeconds -lt 60) {
    try { return @{ Respuesta = Invoke-RestMethod "$base/hola" -TimeoutSec 2; Segundos = [math]::Round($t.Elapsed.TotalSeconds, 1) } }
    catch { Start-Sleep -Milliseconds 500 }
  }
  throw 'El programa no respondio en /hola dentro de 60 segundos'
}

# 1. Instalar en silencio
$p = Start-Process -FilePath $Instalador -ArgumentList '/S' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "El instalador termino con codigo $($p.ExitCode)" }
if (-not (Test-Path $exe)) { throw "No se instalo el programa en $exe" }

# 2. Arranque y version
Abrir
$hola = EsperarHola
if ($hola.Respuesta.version -ne $Version) { throw "Version esperada $Version, recibida $($hola.Respuesta.version)" }
Write-Host "Responde /hola en $($hola.Segundos) s, version $Version"

# 3. Regla del firewall
$regla = netsh advfirewall firewall show rule name="Halcon Pruebas" | Out-String
if ($LASTEXITCODE -ne 0) { throw "No existe la regla de firewall 'Halcon Pruebas'" }
Write-Host 'Regla de firewall presente'

# 4. Escaneo con token
$cabecera = @{ Authorization = "Bearer $((Get-Content $token -Raw).Trim())" }
$r = Invoke-RestMethod "$base/escaneos" -Method Post -Headers $cabecera -ContentType 'application/json' -Body '{"codigo":"7790001000019"}'
if ($r.seq -ne 1) { throw "Se esperaba seq 1 y llego $($r.seq)" }

# 5. Persistencia tras reiniciar
Cerrar
Abrir
EsperarHola | Out-Null
$c = Invoke-RestMethod "$base/cambios?desde=0" -Headers $cabecera
if (-not ($c.escaneos | Where-Object { $_.codigo -eq '7790001000019' })) { throw 'El escaneo no sobrevivio al reinicio' }
Write-Host 'Escaneo conservado tras reiniciar'
Cerrar

# 6. Resumen
$mb = [math]::Round((Get-Item $Instalador).Length / 1MB, 1)
if ($env:GITHUB_STEP_SUMMARY) {
  "### Prueba de humo`n- Instalador: $mb MB`n- Segundos hasta /hola: $($hola.Segundos)" | Out-File -FilePath $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8
}
Write-Host "Instalador $mb MB, $($hola.Segundos) s hasta /hola"
