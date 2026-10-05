# Constroi o APK do player (openad-ad-client) e, se houver tablete no adb, instala e verifica
# que o aplicativo sobrevive.
#
# Por que um script e nao comandos soltos: a verificacao que importa nao e "compilou", e
# "continua vivo depois de um minuto". O travamento que este caminho ja teve matava o processo
# numa thread Java alguns segundos depois do pareamento - um `gradlew` com BUILD SUCCESSFUL
# nao dizia nada sobre isso.
#
# APK de depuracao de proposito: o player e instalado por cabo, nao pela loja, e a chave de
# depuracao permite substituir a versao instalada sem desinstalar. O que vai para a Play Store
# sao os outros tres aplicativos.
#
# Uso:
#   .\62-apk-player.ps1                  # constroi, instala e verifica
#   .\62-apk-player.ps1 -SemInstalar     # so constroi
#   .\62-apk-player.ps1 -Limpar          # limpa antes de construir

param(
  [switch] $SemInstalar,
  [switch] $Limpar,
  [int] $SegundosDeObservacao = 60,
  [string] $Jdk = 'D:\dev\jdk\jdk-21.0.12.1+1',
  [string] $Sdk = 'D:\dev\android-sdk'
)

# `Continue` porque gradle e adb escrevem em stderr sem que isso signifique falha.
$ErrorActionPreference = 'Continue'

$raiz = 'd:\Projetos\openad'
$projeto = Join-Path $raiz 'app\openad-ad-client'
$android = Join-Path $projeto 'android'
$apk = Join-Path $android 'app\build\outputs\apk\debug\app-debug.apk'
$adb = Join-Path $Sdk 'platform-tools\adb.exe'
$pacote = 'com.openad'

$env:JAVA_HOME = $Jdk
$env:ANDROID_HOME = $Sdk
$env:ANDROID_SDK_ROOT = $Sdk

if (-not (Test-Path (Join-Path $Jdk 'bin\java.exe'))) { throw "JDK nao encontrado em $Jdk" }
if (-not (Test-Path $android)) { throw "projeto Android nao encontrado em $android" }

Write-Host '--- sincronizando o bundle web no projeto Android'
Push-Location $raiz
try {
  node tools/cap-sync.mjs --configuration=production 2>&1 |
    Select-String -Pattern 'Found \d+ Capacitor plugins|Sync finished|sincronizado|ERR' |
    ForEach-Object { "  $($_.Line)" }
} finally {
  Pop-Location
}

# Conferencia de regressao: o plugin nativo de MQTT foi removido porque o Paho que ele embute
# depende da Support Library antiga e derrubava o processo em projeto AndroidX. Se ele voltar
# ao projeto Gradle, volta o travamento.
$voltou = (Select-String -Path (Join-Path $android 'capacitor.settings.gradle') -Pattern 'mqtt' -ErrorAction SilentlyContinue | Measure-Object).Count
if ($voltou -gt 0) {
  throw 'capgo-capacitor-mqtt voltou ao projeto Android. O Paho derruba o app em AndroidX; o transporte do player e mqtt.js sobre WebSocket.'
}
Write-Host '  ok  nenhum plugin nativo de MQTT no projeto Android'

Write-Host ''
Write-Host '--- gradle assembleDebug'
Push-Location $android
try {
  if ($Limpar) { & .\gradlew.bat clean 2>&1 | Select-Object -Last 2 }
  & .\gradlew.bat assembleDebug 2>&1 | Select-Object -Last 4
} finally {
  Pop-Location
}

if (-not (Test-Path $apk)) { throw "gradle terminou mas o APK nao foi gerado: $apk" }
$info = Get-Item $apk
Write-Host ''
Write-Host ("APK: {0}" -f $apk)
Write-Host ("     {0:N1} MB   {1}" -f ($info.Length / 1MB), $info.LastWriteTime.ToString('dd/MM HH:mm:ss'))
Write-Host ("     sha256 {0}" -f (Get-FileHash $apk -Algorithm SHA256).Hash)

if ($SemInstalar) { exit 0 }

# ----------------------------------------------------------------- aparelho

$dispositivos = & $adb devices 2>&1 | Select-String -Pattern '\sdevice$'
if (-not $dispositivos) {
  Write-Host ''
  Write-Host 'Nenhum aparelho no adb. Para instalar depois:' -ForegroundColor Yellow
  Write-Host ("  $adb install -r ""$apk""")
  exit 0
}
Write-Host ''
Write-Host '--- aparelho'
& $adb devices -l 2>&1 | Select-String -Pattern 'device ' | ForEach-Object { "  $($_.Line)" }

Write-Host ''
Write-Host '--- instalando'
& $adb install -r $apk 2>&1 | Select-Object -Last 2 | ForEach-Object { "  $_" }

Write-Host ''
Write-Host '--- limpando o log e abrindo o app'
& $adb logcat -c 2>&1 | Out-Null
& $adb shell am force-stop $pacote 2>&1 | Out-Null
Start-Sleep -Seconds 1
& $adb shell am start -n "$pacote/.MainActivity" 2>&1 | Select-Object -Last 1 | ForEach-Object { "  $_" }

Write-Host ''
Write-Host ("--- observando por {0}s (o travamento antigo aparecia em poucos segundos)" -f $SegundosDeObservacao)
$pidInicial = ''
$morreu = $false
for ($i = 5; $i -le $SegundosDeObservacao; $i += 5) {
  Start-Sleep -Seconds 5
  $p = (& $adb shell pidof $pacote 2>&1) -join ''
  $p = $p.Trim()
  if (-not $p) {
    Write-Host ("  {0,3}s  MORTO" -f $i) -ForegroundColor Red
    $morreu = $true
    break
  }
  if (-not $pidInicial) { $pidInicial = $p }
  $marca = if ($p -ne $pidInicial) { " (reiniciou: era $pidInicial)" } else { '' }
  Write-Host ("  {0,3}s  vivo {1}{2}" -f $i, $p, $marca)
  if ($p -ne $pidInicial) { $morreu = $true; break }
}

Write-Host ''
Write-Host '--- FATAL no log?'
$fatais = & $adb logcat -d 2>&1 | Select-String -Pattern 'FATAL EXCEPTION'
if ($fatais) {
  Write-Host ("  {0} travamento(s):" -f ($fatais | Measure-Object).Count) -ForegroundColor Red
  & $adb logcat -d 2>&1 | Select-String -Pattern 'AndroidRuntime' |
    Select-Object -First 14 | ForEach-Object { "    " + ($_.Line -replace '^.*AndroidRuntime: ', '') }
} else {
  Write-Host '  nenhum' -ForegroundColor Green
}

Write-Host ''
Write-Host '--- MQTT e manifesto no log do app'
& $adb logcat -d 2>&1 |
  Select-String -Pattern 'mqtt\.|manifest|Capacitor/Console|openad' |
  Select-Object -Last 20 | ForEach-Object { "    " + $_.Line.Trim() }

Write-Host ''
if ($fatais -or $morreu) {
  Write-Host 'O app nao sobreviveu limpo. Veja o log acima.' -ForegroundColor Red
  exit 1
}
Write-Host ("App vivo e sem travamento por {0}s." -f $SegundosDeObservacao) -ForegroundColor Green
exit 0
