# Gera o **AAB de produção assinado** de um dos três apps, e confere o artefato.
#
# Diferenças em relação ao APK de teste que já geramos, e cada uma importa:
#
#  1. **AAB, não APK.** A Play Store exige Android App Bundle desde 2021 para app novo. O AAB
#     também é o que permite a entrega por arquitetura: os 105 a 155 MB do APK universal viram
#     ~30 MB por aparelho.
#  2. **Assinado com a chave de upload, não com a de debug.** O `android/` gerado pelo
#     `expo prebuild` traz `release { signingConfig signingConfigs.debug }`, e o Play recusa
#     upload assinado em modo debug. O patch abaixo substitui isso.
#  3. **Variante `production`**, sem o sufixo `.preview` no pacote: é o identificador que você
#     registrou no Play Console.
#
# O patch de assinatura é reaplicado a cada execução porque `android/app/build.gradle` é
# **gerado** pelo prebuild - editar o arquivo à mão seria desfeito na próxima vez. As senhas
# chegam por `-P` na linha de comando, e não pelo `gradle.properties`, para segredo nenhum
# tocar arquivo dentro do repositório.
#
# Uso:
#   .\infra\server\38-aab.ps1 -App opendriverads
#   .\infra\server\38-aab.ps1 -App opendriver -VersionCode 2

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('opendriver', 'opendriverhub', 'opendriverads')]
  [string] $App,

  [int] $VersionCode = 1,
  [switch] $Limpar,
  [string] $Credenciais = 'd:\Projetos\.credenciais-loja',
  [string] $Jdk = 'D:\dev\jdk\jdk-21.0.12.1+1',
  [string] $Sdk = 'D:\dev\android-sdk'
)

# `Continue` porque gradle e aapt2 escrevem em stderr sem que isso signifique falha; a
# verificação é o artefato existir e passar nas conferências do fim.
$ErrorActionPreference = 'Continue'

$config = @{
  opendriver = @{
    Raiz   = 'd:\Projetos\opendriver\mobile'
    Pacote = 'br.com.opendriver.app'
    Env    = @{
      APP_VARIANT               = 'production'
      EXPO_PUBLIC_API_URL       = 'https://api-app.opendriver.com.br'
      EXPO_PUBLIC_HUB_URL       = 'https://opendriver.com.br'
      EXPO_PUBLIC_MAP_STYLE_URL = 'https://tiles.opendriver.com.br/style.json'
    }
    Dominios = @('api-app.opendriver.com.br')
  }
  opendriverhub = @{
    Raiz   = 'd:\Projetos\hub-mobile'
    Pacote = 'br.com.opendriverhub.app'
    Env    = @{
      APP_VARIANT          = 'production'
      EXPO_PUBLIC_API_URL  = 'https://hubapi.opendriver.com.br'
      EXPO_PUBLIC_WEB_URL  = 'https://hub.opendriver.com.br'
    }
    Dominios = @('hubapi.opendriver.com.br')
  }
  opendriverads = @{
    Raiz   = 'd:\Projetos\openad\app\openad-advertiser'
    Pacote = 'br.com.opendriver.ads'
    Env    = @{
      APP_VARIANT                 = 'production'
      EXPO_PUBLIC_HUB_API_URL     = 'https://hubapi.opendriver.com.br'
      EXPO_PUBLIC_ADS_API_URL     = 'https://adsapi.opendriver.com.br'
    }
    Dominios = @('adsapi.opendriver.com.br', 'hubapi.opendriver.com.br')
  }
}

$c = $config[$App]
$raiz = $c.Raiz
if (-not (Test-Path $raiz)) { throw "pasta do app nao existe: $raiz" }
if (-not (Test-Path "$Jdk\bin\java.exe")) { throw "JDK nao encontrado em $Jdk" }

$keystore = Join-Path $Credenciais "$App-upload.keystore"
if (-not (Test-Path $keystore)) {
  throw "keystore nao encontrado: $keystore`nRode primeiro: .\infra\server\37-keystores.ps1"
}
$senhas = Get-Content (Join-Path $Credenciais 'senhas-keystore.json') -Raw | ConvertFrom-Json
$senha = $senhas.$App.storePassword
$alias = $senhas.$App.keyAlias
if (-not $senha) { throw "senha do keystore de $App nao encontrada" }

$env:JAVA_HOME = $Jdk
$env:ANDROID_HOME = $Sdk
$env:ANDROID_SDK_ROOT = $Sdk
$env:NODE_ENV = 'production'
foreach ($k in $c.Env.Keys) { Set-Item -Path "env:$k" -Value $c.Env[$k] }

Write-Output "app        : $App"
Write-Output "pacote     : $($c.Pacote)"
Write-Output "pasta      : $raiz"
Write-Output "keystore   : $keystore"
Write-Output "versionCode: $VersionCode"
Write-Output ''

Push-Location $raiz
try {
  if (-not (Test-Path 'node_modules')) {
    Write-Output '--- npm install'
    npm install --no-audit --no-fund 2>&1 | Select-Object -Last 2
  }

  Write-Output '--- prebuild'
  if ($Limpar) {
    npx expo prebuild --platform android --clean 2>&1 | Select-Object -Last 2
  } else {
    npx expo prebuild --platform android 2>&1 | Select-Object -Last 2
  }

  $gradleApp = Join-Path $raiz 'android\app\build.gradle'
  if (-not (Test-Path $gradleApp)) { throw 'prebuild nao gerou android/app/build.gradle' }

  # ----------------------------------------------------------------- patch de assinatura
  $g = Get-Content $gradleApp -Raw

  if ($g -notmatch 'RELEASE_STORE_FILE') {
    # Acrescenta um signingConfig `release` que lê das propriedades do projeto, e aponta o
    # buildType de release para ele. O bloco é inserido **dentro** de `signingConfigs`, logo
    # depois do `debug`.
    $blocoRelease = @'
        release {
            // Injetado por infra/server/38-aab.ps1. As propriedades chegam por -P na linha
            // de comando: senha de keystore nao entra em arquivo dentro do repositorio.
            if (project.hasProperty('RELEASE_STORE_FILE')) {
                storeFile file(project.property('RELEASE_STORE_FILE'))
                storePassword project.property('RELEASE_STORE_PASSWORD')
                keyAlias project.property('RELEASE_KEY_ALIAS')
                keyPassword project.property('RELEASE_KEY_PASSWORD')
            }
        }
'@
    $g = $g -replace "(?s)(signingConfigs \{.*?\n        \}\n)", "`$1$blocoRelease`n"

    # O template aponta release para a chave de debug; é isso que faz o Play recusar.
    $g = $g -replace '(?m)^(\s*)signingConfig signingConfigs\.debug(\s*)$', '$1signingConfig project.hasProperty("RELEASE_STORE_FILE") ? signingConfigs.release : signingConfigs.debug$2'

    Set-Content -Path $gradleApp -Value $g -NoNewline
    Write-Output 'build.gradle: signingConfig de release injetado'
  } else {
    Write-Output 'build.gradle: signingConfig de release ja presente'
  }

  # Memória do daemon: 512 MB de Metaspace (padrão do template) não bastam, e o daemon morre
  # sem imprimir falha - a saída simplesmente para numa tarefa qualquer.
  $props = Join-Path $raiz 'android\gradle.properties'
  $p = Get-Content $props -Raw
  $pn = $p -replace 'org\.gradle\.jvmargs=.*', 'org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1536m -Dfile.encoding=UTF-8'
  if ($pn -ne $p) { Set-Content -Path $props -Value $pn -NoNewline; Write-Output 'gradle.properties: memoria elevada' }

  # ----------------------------------------------------------------- build
  Write-Output ''
  Write-Output '--- gradle bundleRelease'
  Push-Location (Join-Path $raiz 'android')
  try {
    & .\gradlew.bat bundleRelease --build-cache `
      "-PRELEASE_STORE_FILE=$keystore" `
      "-PRELEASE_STORE_PASSWORD=$senha" `
      "-PRELEASE_KEY_ALIAS=$alias" `
      "-PRELEASE_KEY_PASSWORD=$senha" `
      "-PversionCode=$VersionCode" 2>&1 | Select-Object -Last 6
  } finally {
    Pop-Location
  }

  $aab = Get-ChildItem -Recurse (Join-Path $raiz 'android\app\build\outputs\bundle') -Filter '*.aab' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $aab) { throw 'gradle terminou mas nenhum AAB foi encontrado' }

  # ----------------------------------------------------------------- conferencias
  Write-Output ''
  Write-Output '=== AAB ==='
  Write-Output ("arquivo: {0}" -f $aab.FullName)
  Write-Output ("tamanho: {0} MB" -f [math]::Round($aab.Length / 1MB, 1))

  $falhas = 0

  # 1) Assinatura: o teste que importa. AAB assinado em debug e recusado no upload, depois de
  #    minutos de envio.
  $jarsigner = Join-Path $Jdk 'bin\jarsigner.exe'
  $assinatura = & $jarsigner -verify -verbose:summary -certs $aab.FullName 2>&1 | Out-String
  if ($assinatura -match 'jar verified|jar validado') {
    if ($assinatura -match 'Android Debug|androiddebugkey|CN=Android Debug') {
      Write-Output '  FALHA assinado com a chave de DEBUG - o Play recusa'
      $falhas++
    } else {
      Write-Output '  ok    assinado, e nao com a chave de debug'
    }
    if ($assinatura -match 'Heavenbound Systems') {
      Write-Output '  ok    certificado em nome de Heavenbound Systems LTDA'
    } else {
      Write-Output '  ATENCAO: o certificado nao menciona Heavenbound Systems'
    }
  } else {
    Write-Output '  FALHA assinatura nao verificada'
    $falhas++
  }

  <#
    2) Identidade e permissoes, pelo `bundletool`.

    A primeira versao usava `aapt2 dump xmltree --file AndroidManifest.xml <aab>`. O aapt2
    **nao le AAB** ("could not identify format of APK"), entao a saida vinha vazia e o laco
    `if ($dump -match $proibida)` comparava com string vazia: nunca casava, e o script
    imprimia "nenhuma permissao proibida" sem ter olhado nada. Um falso "ok" numa conferencia
    de seguranca e pior que conferencia nenhuma, porque cria confianca.

    `bundletool` e a ferramenta do Google para AAB e le o manifesto de verdade. Baixado uma
    vez para D:\dev\bundletool.jar.
  #>
  $bundletool = 'D:\dev\bundletool.jar'
  if (-not (Test-Path $bundletool)) {
    Write-Output '  baixando bundletool...'
    $ProgressPreference = 'SilentlyContinue'
    $rel = Invoke-RestMethod 'https://api.github.com/repos/google/bundletool/releases/latest'
    $url = ($rel.assets | Where-Object { $_.name -like 'bundletool-all-*.jar' }).browser_download_url
    Invoke-WebRequest $url -OutFile $bundletool
  }

  $java = Join-Path $Jdk 'bin\java.exe'
  $manifesto = & $java -jar $bundletool dump manifest --bundle $aab.FullName 2>&1 | Out-String

  if ($manifesto -notmatch 'package="([^"]+)"') {
    Write-Output '  FALHA nao consegui ler o manifesto do AAB'
    $falhas++
  } else {
    $pacoteAab = $Matches[1]
    if ($pacoteAab -eq $c.Pacote) {
      Write-Output "  ok    pacote $pacoteAab"
    } else {
      # Pegaria, por exemplo, um build que saiu com `.preview` por APP_VARIANT esquecida.
      Write-Output "  FALHA pacote $pacoteAab (esperado $($c.Pacote))"
      $falhas++
    }

    if ($manifesto -match 'android:versionCode="(\d+)"') {
      Write-Output "  ok    versionCode $($Matches[1])"
    }

    # Permissoes proibidas, conferidas no artefato: a fusao de manifestos acrescenta permissao
    # vinda de dependencia, e nenhuma leitura de configuracao mostra isso. Foi assim que o
    # `SYSTEM_ALERT_WINDOW` do `expo-dev-client` apareceu nos APKs.
    $proibidas = @('SYSTEM_ALERT_WINDOW', 'READ_CONTACTS', 'READ_SMS', 'QUERY_ALL_PACKAGES')
    $achadas = $proibidas | Where-Object { $manifesto -match "android.permission.$_" }
    if ($achadas) {
      foreach ($p in $achadas) { Write-Output "  FALHA permissao proibida no AAB: $p" }
      $falhas += $achadas.Count
    } else {
      Write-Output '  ok    nenhuma permissao proibida'
    }

    $n = ([regex]::Matches($manifesto, 'uses-permission')).Count
    Write-Output "  ok    $n permissoes declaradas no total"
  }

  <#
    3) Aponta para producao?

    Buscar o dominio em texto puro dentro do AAB **nao funciona**: o bundle Hermes vai
    comprimido, e o literal nao aparece. A versao anterior imprimia "nao localizei" em toda
    execucao, o que e pior que nao verificar -- ensina a ignorar o aviso.

    `expo config --type public` resolve `app.config.ts` com as mesmas variaveis de ambiente
    deste build e devolve o `extra` que o app le em tempo de execucao
    (`Constants.expoConfig.extra`). E a mesma fonte, entao conferir aqui prova a URL embutida
    sem descomprimir bytecode.
  #>
  $saidaCfg = npx expo config --type public --json 2>&1 | Out-String
  $iJson = $saidaCfg.IndexOf('{')
  if ($iJson -lt 0) {
    Write-Output '  FALHA expo config nao devolveu JSON'
    $falhas++
  } else {
    $cfg = $saidaCfg.Substring($iJson) | ConvertFrom-Json

    if ($cfg.extra.variant -ne 'production') {
      Write-Output "  FALHA variant = $($cfg.extra.variant) (esperado production)"
      $falhas++
    }

    foreach ($prop in $cfg.extra.PSObject.Properties) {
      if ($prop.Value -isnot [string] -or $prop.Value -notmatch '^https?://') { continue }
      $v = $prop.Value
      if ($v -match '^http://') {
        Write-Output "  FALHA $($prop.Name) usa http: $v"
        $falhas++
      } elseif ($v -match '10\.0\.2\.2|localhost|127\.0\.0\.1') {
        Write-Output "  FALHA $($prop.Name) aponta para a maquina local: $v"
        $falhas++
      } else {
        Write-Output "  ok    $($prop.Name) = $v"
      }
    }
  }

  Write-Output ''
  if ($falhas -gt 0) { throw "$falhas conferencia(s) falharam. NAO suba este AAB" }
  Write-Output 'AAB pronto para upload.'
  Write-Output ("  node infra\server\39-subir-play.mjs {0} ""{1}"" internal" -f $App, $aab.FullName)
} finally {
  Pop-Location
}
