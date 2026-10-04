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

  # Chega ao build por `ANDROID_VERSION_CODE`, que o `app.config.ts` le e o prebuild grava em
  # `android/app/build.gradle`. A primeira versao passava `-PversionCode` ao gradle, o que
  # **nao funciona**: o template do Expo nao le essa propriedade, e o AAB saia sempre com
  # versionCode 1 - o Play recusa reenvio do mesmo numero.
  [int] $VersionCode = 2,

  <#
    `aab` para a loja, `apk` para instalar por cabo.

    O APK aqui sai assinado com a **chave de upload**, nao com a de debug. Isso importa na
    hora de instalar: o Android recusa atualizar por cima de um pacote assinado com chave
    diferente (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`), entao qualquer build anterior precisa
    ser desinstalado antes. Em troca, o que se instala e o mesmo codigo do artefato que foi
    para a loja.
  #>
  [ValidateSet('aab', 'apk')]
  [string] $Artefato = 'aab',

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
    # Permissoes que **precisam** estar no artefato. RECORD_AUDIO entra nesta lista porque ela
    # ja foi removida silenciosamente uma vez, por conflito entre o plugin do expo-audio (que
    # a pede) e o do expo-image-picker (que a bloqueava com microphonePermission: false). O
    # AAB saiu com FOREGROUND_SERVICE_MICROPHONE e o servico de gravacao, e sem a permissao
    # que os faz funcionar.
    Exigidas = @(
      'android.permission.RECORD_AUDIO',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION'
    )
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
$env:ANDROID_VERSION_CODE = "$VersionCode"
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
  $tarefa = if ($Artefato -eq 'apk') { 'assembleRelease' } else { 'bundleRelease' }
  $pastaSaida = if ($Artefato -eq 'apk') { 'android\app\build\outputs\apk' } else { 'android\app\build\outputs\bundle' }

  Write-Output ''
  Write-Output "--- gradle $tarefa"
  Push-Location (Join-Path $raiz 'android')
  try {
    & .\gradlew.bat $tarefa --build-cache `
      "-PRELEASE_STORE_FILE=$keystore" `
      "-PRELEASE_STORE_PASSWORD=$senha" `
      "-PRELEASE_KEY_ALIAS=$alias" `
      "-PRELEASE_KEY_PASSWORD=$senha" 2>&1 | Select-Object -Last 6
  } finally {
    Pop-Location
  }

  $aab = Get-ChildItem -Recurse (Join-Path $raiz $pastaSaida) -Filter "*.$Artefato" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $aab) { throw "gradle terminou mas nenhum $($Artefato.ToUpper()) foi encontrado" }

  # ----------------------------------------------------------------- conferencias
  Write-Output ''
  Write-Output ("=== {0} ===" -f $Artefato.ToUpper())
  Write-Output ("arquivo: {0}" -f $aab.FullName)
  Write-Output ("tamanho: {0} MB" -f [math]::Round($aab.Length / 1MB, 1))

  $falhas = 0

  <#
    1) Assinatura: o teste que importa. Artefato assinado em debug e recusado no upload,
       depois de minutos de envio.

    Ferramenta diferente para cada formato, e isto nao e detalhe:

    - AAB e um JAR, e `jarsigner` o verifica.
    - APK de release do Android Gradle Plugin e assinado **so** com os esquemas v2/v3 quando
      o minSdk permite, sem a assinatura v1 (JAR). O `jarsigner` entende apenas v1, entao
      devolvia "assinatura nao verificada" para um APK perfeitamente assinado - um falso
      negativo que, repetido, ensina a ignorar a conferencia. `apksigner`, do build-tools, e
      o verificador oficial de APK e entende os tres esquemas.
  #>
  if ($Artefato -eq 'apk') {
    $apksigner = Get-ChildItem (Join-Path $Sdk 'build-tools') -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName 'apksigner.bat' } |
      Where-Object { Test-Path $_ } |
      Select-Object -First 1
    if (-not $apksigner) { throw "apksigner nao encontrado em $Sdk\build-tools" }
    $env:JAVA_HOME = $Jdk
    $assinatura = & $apksigner verify --print-certs --verbose $aab.FullName 2>&1 | Out-String
    # `apksigner` nao imprime "jar verified"; o sinal de sucesso e algum esquema validado.
    if ($assinatura -match 'Verified using v\d.*: true') {
      $assinatura += "`njar verified"
    }
  } else {
    $jarsigner = Join-Path $Jdk 'bin\jarsigner.exe'
    $assinatura = & $jarsigner -verify -verbose:summary -certs $aab.FullName 2>&1 | Out-String
  }

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

  if ($Artefato -eq 'aab') {
    $manifesto = & $java -jar $bundletool dump manifest --bundle $aab.FullName 2>&1 | Out-String
  } else {
    <#
      APK se le com aapt2 (o bundletool e para AAB). Duas saidas, por motivos diferentes:

      - `dump badging` da nome do pacote e versionCode em texto limpo. No `xmltree`, inteiro
        vem tipado (`android:versionCode(0x0101021b)=(type 0x10)0x2`), e comparar "0x2" com
        "2" daria falso negativo.
      - `dump xmltree` e o unico que mostra os elementos `<service>`, necessario para flagrar
        o `AudioControlsService`.

      Os identificadores hexadecimais do xmltree sao removidos para a saida ficar na mesma
      forma do bundletool (`android:name="..."`), e as conferencias abaixo servirem aos dois
      formatos sem duplicacao.
    #>
    $aapt2 = Get-ChildItem (Join-Path $Sdk 'build-tools') -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName 'aapt2.exe' } |
      Where-Object { Test-Path $_ } |
      Select-Object -First 1
    if (-not $aapt2) { throw "aapt2 nao encontrado em $Sdk\build-tools" }

    $badging = & $aapt2 dump badging $aab.FullName 2>&1 | Out-String
    $cabecalho = ''
    if ($badging -match "package: name='([^']+)'") { $cabecalho += " package=""$($Matches[1])""" }
    if ($badging -match "versionCode='(\d+)'") { $cabecalho += " android:versionCode=""$($Matches[1])""" }

    $arvore = & $aapt2 dump xmltree --file AndroidManifest.xml $aab.FullName 2>&1 | Out-String
    $manifesto = $cabecalho + "`n" + ($arvore -replace '\(0x[0-9a-fA-F]{8}\)', '')
  }

  if ($manifesto -notmatch 'package="([^"]+)"') {
    Write-Output ("  FALHA nao consegui ler o manifesto do {0}" -f $Artefato.ToUpper())
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

    <#
      Permissoes proibidas e exigidas, conferidas no artefato: a fusao de manifestos
      acrescenta e **remove** permissao por conta de dependencia, e nenhuma leitura de
      configuracao mostra isso. Foi assim que o `SYSTEM_ALERT_WINDOW` do `expo-dev-client`
      apareceu nos APKs, e foi assim que o `RECORD_AUDIO` desapareceu do AAB do opendriver.

      `FOREGROUND_SERVICE_MEDIA_PLAYBACK` esta proibida nos tres: nenhum deles toca audio. O
      Play exige justificar cada permissao de servico em primeiro plano com demonstracao em
      video, e nao ha o que demonstrar - foi um erro de upload no primeiro envio.

      Comparacao pelo atributo inteiro (`android:name="..."`), e nao por substring: com
      substring, procurar `FOREGROUND_SERVICE` casa com `FOREGROUND_SERVICE_LOCATION` e a
      conferencia passa a mentir.
    #>
    function TemPermissao([string]$texto, [string]$permissao) {
      return $texto -match ('android:name="' + [regex]::Escape($permissao) + '"')
    }

    $proibidas = @(
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_CONTACTS',
      'android.permission.READ_SMS',
      'android.permission.QUERY_ALL_PACKAGES',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'
    )
    $achadas = $proibidas | Where-Object { TemPermissao $manifesto $_ }
    if ($achadas) {
      foreach ($p in $achadas) { Write-Output "  FALHA permissao proibida no AAB: $p" }
      $falhas += $achadas.Count
    } else {
      Write-Output '  ok    nenhuma permissao proibida'
    }

    # Sem `??`: este script roda no Windows PowerShell 5.1, que nao tem o operador.
    $exigidas = if ($c.ContainsKey('Exigidas')) { $c.Exigidas } else { @() }
    foreach ($p in $exigidas) {
      if (TemPermissao $manifesto $p) {
        Write-Output "  ok    permissao exigida presente: $($p -replace '^android\.permission\.', '')"
      } else {
        Write-Output "  FALHA permissao exigida AUSENTE no AAB: $p"
        $falhas++
      }
    }

    # Servico de reproducao de midia: o Play olha o manifesto, nao so as permissoes.
    if ($manifesto -match 'AudioControlsService') {
      Write-Output '  FALHA AudioControlsService presente (reproducao de midia em 1o plano nao usada)'
      $falhas++
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
  if ($falhas -gt 0) { throw "$falhas conferencia(s) falharam. NAO use este $($Artefato.ToUpper())" }

  <#
    Copia o artefato aprovado para fora da pasta de build.

    `android/app/build/outputs` nao sobrevive: gerar o APK apaga o AAB e gerar o AAB apaga o
    APK, porque as duas tarefas reescrevem a mesma arvore de saida. Depois de uma rodada de
    `assembleRelease`, os tres AAB que tinham acabado de ser enviados a loja nao existiam mais
    em disco - e nem `gradlew clean` tinha sido chamado.

    Fora dos repositorios de proposito, ao lado de `.credenciais-loja`: artefato de 100 MB nao
    entra em git, e dentro do repositorio ficaria a um `.gitignore` de distancia de ser
    commitado por engano.
  #>
  $arquivo_destino = $null
  try {
    $acervo = 'd:\Projetos\.artefatos-loja'
    New-Item -ItemType Directory -Path $acervo -Force | Out-Null
    $arquivo_destino = Join-Path $acervo ("{0}-v{1}.{2}" -f $App, $VersionCode, $Artefato)
    Copy-Item $aab.FullName $arquivo_destino -Force
    $h = (Get-FileHash $arquivo_destino -Algorithm SHA256).Hash
    Add-Content -Path (Join-Path $acervo 'hashes.txt') -Value ("{0}  {1}  {2}" -f (Get-Date -Format 's'), $h, (Split-Path $arquivo_destino -Leaf))
    Write-Output ("  ok    copia guardada em {0}" -f $arquivo_destino)
  } catch {
    Write-Output ("  ATENCAO nao consegui guardar a copia: {0}" -f $_.Exception.Message)
  }

  # A frase "pronto para upload" e o veredito que o `50-aab-todos.ps1` procura no log; mudar o
  # texto quebraria o resumo dele em silencio.
  if ($Artefato -eq 'aab') {
    Write-Output 'AAB pronto para upload.'
    Write-Output ("  node infra\server\39-subir-play.mjs {0} ""{1}"" internal" -f $App, $aab.FullName)
  } else {
    Write-Output 'APK pronto para upload.'
    Write-Output '  Assinado com a chave de upload: desinstale builds anteriores antes de instalar.'
    Write-Output ("  adb install -r ""{0}""" -f $aab.FullName)
  }
} finally {
  Pop-Location
}
