# Gera o APK de release dos apps Expo do ecossistema que vivem em outros repositorios.
#
# Um script so, em serie, por um motivo aprendido do jeito ruim: dois builds do Gradle ao
# mesmo tempo sobre pastas diferentes ainda disputam o daemon, o cache em `~/.gradle` e a
# memoria da maquina — e quando um deles e iniciado com prebuild `--clean`, apaga `android/`
# debaixo do outro. O sintoma foi um build que parou numa tarefa qualquer, sem erro nenhum.
#
# Os dois apps ja apontam para os dominios da VPS nova (conferido em `eas.json`): nao ha o que
# reconfigurar, so compilar e verificar.
#
# Uso: powershell -File infra/server/32-apks-mobile.ps1

param(
  [string] $Jdk = 'D:\dev\jdk\jdk-21.0.12.1+1',
  [string] $Sdk = 'D:\dev\android-sdk'
)

$ErrorActionPreference = 'Continue'

if (-not (Test-Path "$Jdk\bin\java.exe")) { throw "JDK nao encontrado em $Jdk" }
if (-not (Test-Path "$Sdk\platform-tools")) { throw "SDK do Android nao encontrado em $Sdk" }

$env:JAVA_HOME = $Jdk
$env:ANDROID_HOME = $Sdk
$env:ANDROID_SDK_ROOT = $Sdk
$env:NODE_ENV = 'production'

$apps = @(
  @{
    Nome = 'hub-mobile'
    Raiz = 'd:\Projetos\hub-mobile'
    Env  = @{
      APP_VARIANT          = 'preview'
      EXPO_PUBLIC_API_URL  = 'https://hubapi.opendriver.com.br'
      EXPO_PUBLIC_WEB_URL  = 'https://hub.opendriver.com.br'
    }
    Dominios = @('hubapi.opendriver.com.br')
  },
  @{
    Nome = 'opendriver-mobile'
    Raiz = 'd:\Projetos\opendriver\mobile'
    Env  = @{
      APP_VARIANT                = 'preview'
      EXPO_PUBLIC_API_URL        = 'https://api-app.opendriver.com.br'
      EXPO_PUBLIC_HUB_URL        = 'https://opendriver.com.br'
      EXPO_PUBLIC_MAP_STYLE_URL  = 'https://tiles.opendriver.com.br/style.json'
    }
    Dominios = @('api-app.opendriver.com.br')
  }
)

$resultados = @()

foreach ($app in $apps) {
  Write-Output ''
  Write-Output ('=' * 90)
  Write-Output ("APP: {0}  ({1})" -f $app.Nome, $app.Raiz)
  Write-Output ('=' * 90)

  if (-not (Test-Path $app.Raiz)) {
    Write-Output 'pasta nao existe; pulando'
    $resultados += @{ Nome = $app.Nome; Estado = 'pasta ausente' }
    continue
  }

  foreach ($k in $app.Env.Keys) { Set-Item -Path "env:$k" -Value $app.Env[$k] }

  Push-Location $app.Raiz
  try {
    if (-not (Test-Path 'node_modules')) {
      Write-Output '--- npm install'
      npm install --no-audit --no-fund 2>&1 | Select-Object -Last 2
    }

    Write-Output '--- prebuild'
    npx expo prebuild --platform android 2>&1 | Select-Object -Last 3

    # Mesma correcao do app do anunciante: 512 MB de Metaspace nao bastam, e o daemon morre
    # sem imprimir falha. O arquivo e gerado pelo prebuild, entao o patch vai aqui.
    $props = Join-Path $app.Raiz 'android\gradle.properties'
    if (Test-Path $props) {
      $c = Get-Content $props -Raw
      $n = $c -replace 'org\.gradle\.jvmargs=.*', 'org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1536m -Dfile.encoding=UTF-8'
      if ($n -ne $c) { Set-Content -Path $props -Value $n -NoNewline; Write-Output 'memoria do daemon elevada' }
    }

    Write-Output '--- gradle assembleRelease'
    Push-Location (Join-Path $app.Raiz 'android')
    try {
      & .\gradlew.bat assembleRelease --build-cache 2>&1 | Select-Object -Last 4
      $codigo = $LASTEXITCODE
    } finally {
      Pop-Location
    }

    $apk = Get-ChildItem -Recurse (Join-Path $app.Raiz 'android\app\build\outputs') -Filter '*.apk' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1

    if (-not $apk) {
      Write-Output "FALHA: nenhum APK gerado (gradle devolveu $codigo)"
      $resultados += @{ Nome = $app.Nome; Estado = 'sem APK' }
      continue
    }

    Write-Output ("APK: {0}  ({1} MB)" -f $apk.FullName, [math]::Round($apk.Length / 1MB, 1))

    $aapt = Get-ChildItem "$Sdk\build-tools" -Directory |
      Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName 'aapt2.exe' } |
      Where-Object { Test-Path $_ } | Select-Object -First 1

    $identidade = ''
    if ($aapt) {
      $badging = & $aapt dump badging $apk.FullName 2>&1
      $identidade = ($badging | Select-String -SimpleMatch 'package:' | Select-Object -First 1).Line
      Write-Output "  $identidade"
      $badging | Select-String -SimpleMatch 'uses-permission:' | ForEach-Object { "  $($_.Line)" }
    }

    # Confere que o APK fala com producao.
    $texto = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($apk.FullName))
    foreach ($d in $app.Dominios) {
      if ($texto.Contains($d)) { Write-Output "  ok  $d embutido" } else { Write-Output "  ATENCAO: $d nao encontrado" }
    }

    $resultados += @{
      Nome = $app.Nome
      Estado = 'ok'
      Arquivo = $apk.FullName
      MB = [math]::Round($apk.Length / 1MB, 1)
    }
  } finally {
    Pop-Location
  }
}

Write-Output ''
Write-Output ('=' * 90)
Write-Output 'RESUMO'
foreach ($r in $resultados) {
  if ($r.Estado -eq 'ok') {
    Write-Output ("  {0,-20} {1,8} MB  {2}" -f $r.Nome, $r.MB, $r.Arquivo)
  } else {
    Write-Output ("  {0,-20} {1}" -f $r.Nome, $r.Estado)
  }
}
