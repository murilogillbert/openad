# Gera o APK de release localmente e **confere o que saiu**.
#
# Por que um script e não as duas linhas de sempre: o build precisa de JDK 21 e do SDK do
# Android em caminhos que não estão nas variáveis de ambiente desta máquina (`JAVA_HOME` e
# `ANDROID_HOME` vazias; há um JDK 26 no PATH que o Gradle do React Native recusa). Deixar isso
# na memória de quem roda garante um build que falha em dia de pressa.
#
# E, principalmente: o script **inspeciona o APK depois de gerar**. A primeira versão deste
# build saiu com `android.permission.SYSTEM_ALERT_WINDOW` sem ninguém ter pedido — vinha do
# manifesto do `expo-dev-client`, por fusão de manifestos. Nenhuma leitura de configuração
# mostraria isso; só olhar o artefato mostra.
#
# Uso:
#   .\scripts\apk.ps1                      # perfil preview
#   .\scripts\apk.ps1 -Variante production
#   .\scripts\apk.ps1 -PularPrebuild       # reaproveita o android/ existente

param(
  [ValidateSet('preview', 'production')]
  [string] $Variante = 'preview',
  [switch] $PularPrebuild,
  <#
    `--clean` no prebuild apaga `android/` inteiro, **incluindo** `android/build` e
    `android/.gradle`. Com isso, cada build recompila do zero os ~120 módulos nativos do
    React Native: 28 minutos, medidos. Sem `--clean`, o prebuild reescreve os arquivos
    gerados (manifesto, gradle, recursos) e preserva o cache de compilação — o mesmo build
    cai para poucos minutos.

    Só vale limpar quando a dependência nativa muda (acrescentar plugin do Expo, trocar
    versão do SDK), porque aí o cache antigo é que é o problema.
  #>
  [switch] $Limpar,
  [string] $Jdk = 'D:\dev\jdk\jdk-21.0.12.1+1',
  [string] $Sdk = 'D:\dev\android-sdk'
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path "$Jdk\bin\java.exe")) { throw "JDK nao encontrado em $Jdk" }
if (-not (Test-Path "$Sdk\platform-tools")) { throw "SDK do Android nao encontrado em $Sdk" }

$env:JAVA_HOME = $Jdk
$env:ANDROID_HOME = $Sdk
$env:ANDROID_SDK_ROOT = $Sdk
$env:APP_VARIANT = $Variante
$env:EXPO_PUBLIC_HUB_API_URL = 'https://hubapi.opendriver.com.br'
$env:EXPO_PUBLIC_ADS_API_URL = 'https://adsapi.opendriver.com.br'

Write-Output "JDK:      $Jdk"
Write-Output "SDK:      $Sdk"
Write-Output "variante: $Variante"
Write-Output "hub:      $env:EXPO_PUBLIC_HUB_API_URL"
Write-Output "ads:      $env:EXPO_PUBLIC_ADS_API_URL"

Push-Location $raiz
try {
  if (-not $PularPrebuild) {
    Write-Output "`n=== prebuild (gera android/) ==="
    if ($Limpar) {
      npx expo prebuild --platform android --clean
    } else {
      npx expo prebuild --platform android
    }
    if ($LASTEXITCODE -ne 0) { throw 'prebuild falhou' }
  }

  <#
    Eleva a memória do daemon **no arquivo gerado**, logo depois do prebuild.

    O `gradle.properties` que o prebuild escreve traz `-Xmx2048m -XX:MaxMetaspaceSize=512m`,
    e 512 MB de Metaspace não bastam: o daemon morre com "running out of JVM Metaspace" no
    meio do build, sem produzir APK e **sem imprimir BUILD FAILED** — a saída simplesmente
    para numa tarefa qualquer, o que faz parecer travamento.

    Passar `-Dorg.gradle.jvmargs=...` na linha de comando não resolveu de forma confiável
    (a seleção de daemon por argumentos de JVM é sensível à ordem e ao formato). Patch no
    arquivo é determinístico, e como o arquivo é regerado pelo prebuild a cada execução, o
    patch precisa ser reaplicado aqui — é por isso que ele vive no script e não no repositório.
  #>
  $props = Join-Path $raiz 'android\gradle.properties'
  if (Test-Path $props) {
    $conteudo = Get-Content $props -Raw
    $novo = $conteudo -replace 'org\.gradle\.jvmargs=.*', 'org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1536m -Dfile.encoding=UTF-8'
    if ($novo -ne $conteudo) {
      Set-Content -Path $props -Value $novo -NoNewline
      Write-Output 'gradle.properties: memoria do daemon elevada (4 GB heap / 1,5 GB metaspace)'
    }
  }

  Write-Output "`n=== gradle assembleRelease ==="
  Push-Location (Join-Path $raiz 'android')
  try {
    <#
      Daemon **ligado** e cache de build ligado.

      A versão anterior usava `--no-daemon`, pelo medo de o daemon reaproveitar variável de
      ambiente de um build anterior e embutir a URL errada. O medo é legítimo, mas a defesa
      certa não é desligar o daemon: é conferir o artefato. Este script faz isso no fim —
      procura o domínio esperado dentro do APK e avisa se `10.0.2.2` aparecer. Com a
      verificação no lugar, desligar o daemon só compra lentidão.

      `--build-cache` reaproveita saída de tarefa entre builds; é o que torna a segunda
      execução minutos em vez de meia hora.
    #>
    <#
      Memória do daemon elevada na linha de comando.

      O `gradle.properties` que o `expo prebuild` gera traz
      `-Xmx2048m -XX:MaxMetaspaceSize=512m`, e 512 MB de Metaspace **não bastam** para este
      build: o daemon morre com "running out of JVM Metaspace" depois de uns 20 minutos, sem
      produzir APK e sem dizer que falhou por memória num lugar óbvio.

      A definição vai aqui e não no arquivo porque `android/gradle.properties` é **gerado**
      pelo prebuild: editá-lo seria desfeito na próxima execução. `expo-build-properties` não
      expõe `jvmargs`, então a linha de comando é o único ponto estável.

      4 GB de heap e 1 GB de Metaspace numa máquina com ~11 GB livres deixa folga para o
      resto do trabalho acontecer em paralelo.
    #>
    # `NODE_ENV` definido porque o `expo-constants:createExpoConfig` invoca o CLI do Expo, que
    # avisa "NODE_ENV is required but was not specified" e passa a ignorar `.env.production`.
    # Não é fatal, mas é a diferença entre carregar o arquivo de ambiente certo e não carregar.
    $env:NODE_ENV = 'production'
    & .\gradlew.bat assembleRelease --build-cache --stacktrace
    if ($LASTEXITCODE -ne 0) { throw "gradle assembleRelease falhou (codigo $LASTEXITCODE)" }
  } finally {
    Pop-Location
  }

  $apk = Get-ChildItem -Recurse (Join-Path $raiz 'android\app\build\outputs') -Filter '*.apk' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $apk) { throw 'gradle terminou mas nenhum APK foi encontrado' }

  Write-Output "`n=== APK ==="
  Write-Output ("arquivo: {0}" -f $apk.FullName)
  Write-Output ("tamanho: {0} MB" -f [math]::Round($apk.Length / 1MB, 1))

  $aapt = Get-ChildItem "$Sdk\build-tools" -Directory |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName 'aapt2.exe' } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1

  if (-not $aapt) {
    Write-Output 'aapt2 nao encontrado: conferencia do manifesto nao executada'
    return
  }

  $badging = & $aapt dump badging $apk.FullName 2>&1

  Write-Output "`n--- identidade"
  $badging | Select-String -SimpleMatch 'package:', "application-label:'", 'targetSdkVersion', 'minSdkVersion' |
    ForEach-Object { "  $($_.Line)" }

  Write-Output "`n--- permissoes declaradas"
  $permissoes = $badging | Select-String -SimpleMatch 'uses-permission:' | ForEach-Object { $_.Line }
  $permissoes | ForEach-Object { "  $_" }

  # Permissões que este app não deve ter em nenhuma circunstância. A verificação é no
  # artefato, não na configuração, porque a fusão de manifestos acrescenta permissão vinda de
  # dependência.
  $proibidas = @(
    'android.permission.SYSTEM_ALERT_WINDOW',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.ACCESS_BACKGROUND_LOCATION',
    'android.permission.RECORD_AUDIO',
    'android.permission.READ_CONTACTS'
  )
  $encontradas = $proibidas | Where-Object { $permissoes -match [regex]::Escape($_) }

  Write-Output "`n--- conferencia"
  if ($encontradas) {
    foreach ($p in $encontradas) { Write-Output "  FALHA: $p esta no APK e nao deveria" }
    throw "APK com $($encontradas.Count) permissao(oes) proibida(s)"
  }
  Write-Output '  ok  nenhuma permissao proibida'

  # A URL embutida: o Hermes preserva literais de string, então o domínio aparece no bytecode.
  # Confirma que o APK fala com produção, e não com `10.0.2.2` por uma variável esquecida.
  $bytes = [System.IO.File]::ReadAllBytes($apk.FullName)
  $texto = [System.Text.Encoding]::ASCII.GetString($bytes)
  foreach ($dominio in @('adsapi.opendriver.com.br', 'hubapi.opendriver.com.br')) {
    if ($texto.Contains($dominio)) {
      Write-Output "  ok  $dominio embutido no APK"
    } else {
      Write-Output "  ATENCAO: $dominio nao encontrado no APK"
    }
  }
  if ($texto.Contains('10.0.2.2')) {
    Write-Output '  ATENCAO: 10.0.2.2 (host do emulador) aparece no APK'
  }
} finally {
  Pop-Location
}
