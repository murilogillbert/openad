# Conferencia independente dos artefatos dos tres apps, AAB ou APK.
#
# Por que separado do 38-aab.ps1: aquele script confere o que ele mesmo acabou de produzir, e
# imprime o resultado no proprio log. Isto le os arquivos que estao em disco **agora**, sem ter
# construido nada, e e o que vale antes de subir na loja ou instalar no aparelho. Ja aconteceu
# de uma build interrompida apagar o artefato antigo sem gravar o novo, e o estado real so
# aparece olhando o arquivo.
#
# Uso:
#   .\51-conferir-aabs.ps1                  # confere os AAB
#   .\51-conferir-aabs.ps1 -Artefato apk    # confere os APK

param(
  [ValidateSet('aab', 'apk')]
  [string] $Artefato = 'aab',

  [string] $Jdk = 'D:\dev\jdk\jdk-21.0.12.1+1',
  [string] $Sdk = 'D:\dev\android-sdk',
  [string] $Bundletool = 'D:\dev\bundletool.jar'
)

$ErrorActionPreference = 'Continue'

$java = Join-Path $Jdk 'bin\java.exe'
$jarsigner = Join-Path $Jdk 'bin\jarsigner.exe'

function FerramentaDoSdk([string]$nome) {
  return Get-ChildItem (Join-Path $Sdk 'build-tools') -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName $nome } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1
}

$VERSION_CODE_ESPERADO = 2

# Proibidas nos tres. MEDIA_PLAYBACK entra porque nenhum deles toca audio, e o Play exige
# demonstracao em video de cada servico em primeiro plano declarado.
$PROIBIDAS = @(
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_CONTACTS',
  'android.permission.READ_SMS',
  'android.permission.QUERY_ALL_PACKAGES',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'
)

$apps = @(
  @{
    Nome   = 'OpenDriver'
    Pacote = 'br.com.opendriver.app'
    Raiz   = 'd:\Projetos\opendriver\mobile'
    Exigidas = @(
      'android.permission.RECORD_AUDIO',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION'
    )
  },
  @{ Nome = 'OpenDriver HUB'; Pacote = 'br.com.opendriverhub.app'; Raiz = 'd:\Projetos\hub-mobile'; Exigidas = @() },
  @{ Nome = 'OpenDriver Anuncios'; Pacote = 'br.com.opendriver.ads'; Raiz = 'd:\Projetos\openad\app\openad-advertiser'; Exigidas = @() }
)

$relativo = if ($Artefato -eq 'apk') {
  'android\app\build\outputs\apk\release\app-release.apk'
} else {
  'android\app\build\outputs\bundle\release\app-release.aab'
}

function TemPermissao([string]$texto, [string]$permissao) {
  # Atributo inteiro, nao substring: procurar `FOREGROUND_SERVICE` casaria com
  # `FOREGROUND_SERVICE_LOCATION` e a conferencia passaria a mentir.
  return $texto -match ('android:name="' + [regex]::Escape($permissao) + '"')
}

<#
  Le o manifesto do artefato e devolve texto na forma `android:name="..."`, igual para os dois
  formatos.

  AAB: `bundletool`. O `aapt2` **nao le AAB** ("could not identify format of APK"); a primeira
  versao deste script usava aapt2 e comparava com string vazia, imprimindo "nenhuma permissao
  proibida" sem ter olhado nada.

  APK: `aapt2`, com duas saidas. `dump badging` da pacote e versionCode em texto limpo (no
  xmltree o inteiro vem tipado, `(type 0x10)0x2`, e comparar "0x2" com "2" falharia); `dump
  xmltree` e o unico que mostra os elementos `<service>`. Os identificadores hexadecimais do
  xmltree sao removidos para a saida ficar na mesma forma do bundletool.
#>
function LerManifesto([string]$arquivo) {
  if ($Artefato -eq 'aab') {
    return & $java -jar $Bundletool dump manifest --bundle $arquivo 2>&1 | Out-String
  }
  $aapt2 = FerramentaDoSdk 'aapt2.exe'
  if (-not $aapt2) { throw "aapt2 nao encontrado em $Sdk\build-tools" }

  $badging = & $aapt2 dump badging $arquivo 2>&1 | Out-String
  $cabecalho = ''
  if ($badging -match "package: name='([^']+)'") { $cabecalho += " package=""$($Matches[1])""" }
  if ($badging -match "versionCode='(\d+)'") { $cabecalho += " android:versionCode=""$($Matches[1])""" }

  $arvore = & $aapt2 dump xmltree --file AndroidManifest.xml $arquivo 2>&1 | Out-String
  return $cabecalho + "`n" + ($arvore -replace '\(0x[0-9a-fA-F]{8}\)', '')
}

<#
  Verifica a assinatura com a ferramenta certa para cada formato.

  APK de release do Android Gradle Plugin leva **so** os esquemas v2/v3 quando o minSdk
  permite, sem a assinatura v1 (JAR). O `jarsigner` entende apenas v1, e devolvia "assinatura
  nao verificada" para um APK corretamente assinado. `apksigner` e o verificador oficial de
  APK e entende os tres esquemas.
#>
function LerAssinatura([string]$arquivo) {
  if ($Artefato -eq 'aab') {
    return & $jarsigner -verify -verbose:summary -certs $arquivo 2>&1 | Out-String
  }
  $apksigner = FerramentaDoSdk 'apksigner.bat'
  if (-not $apksigner) { throw "apksigner nao encontrado em $Sdk\build-tools" }
  $env:JAVA_HOME = $Jdk
  $s = & $apksigner verify --print-certs --verbose $arquivo 2>&1 | Out-String
  if ($s -match 'Verified using v\d.*: true') { $s += "`njar verified" }
  return $s
}

$falhas = 0
function ok($t) { Write-Host "    ok    $t" -ForegroundColor Green }
function falha($t) { $script:falhas++; Write-Host "    FALHA $t" -ForegroundColor Red }

Write-Host ("Conferindo os artefatos do tipo {0}." -f $Artefato.ToUpper())

foreach ($a in $apps) {
  $arquivo = Join-Path $a.Raiz $relativo
  Write-Host ''
  Write-Host ("=== {0}  ({1})" -f $a.Nome, $a.Pacote)

  if (-not (Test-Path $arquivo)) {
    falha "arquivo nao existe: $arquivo"
    continue
  }
  $info = Get-Item $arquivo
  Write-Host ("    arquivo: {0}" -f $arquivo)
  Write-Host ("    tamanho: {0:N1} MB   gravado: {1}" -f ($info.Length / 1MB), $info.LastWriteTime.ToString('dd/MM HH:mm:ss'))
  Write-Host ("    sha256 : {0}" -f (Get-FileHash $arquivo -Algorithm SHA256).Hash)

  $assin = LerAssinatura $arquivo
  if ($assin -match 'jar verified|jar validado') {
    if ($assin -match 'Android Debug|androiddebugkey') { falha 'assinado com a chave de DEBUG' }
    else { ok 'assinado, e nao com a chave de debug' }
    if ($assin -match 'Heavenbound Systems') { ok 'certificado em nome de Heavenbound Systems LTDA' }
    else { falha 'certificado nao menciona Heavenbound Systems' }
  } else {
    falha 'assinatura nao verificada'
  }

  $man = LerManifesto $arquivo

  if ($man -match 'package="([^"]+)"') {
    if ($Matches[1] -eq $a.Pacote) { ok "pacote $($Matches[1])" }
    else { falha "pacote $($Matches[1]) (esperado $($a.Pacote))" }
  } else {
    falha 'nao consegui ler o manifesto'
    continue
  }

  if ($man -match 'android:versionCode="(\d+)"') {
    $vc = [int]$Matches[1]
    if ($vc -eq $VERSION_CODE_ESPERADO) { ok "versionCode $vc" }
    else { falha "versionCode $vc (esperado $VERSION_CODE_ESPERADO)" }
  } else {
    falha 'versionCode nao encontrado'
  }

  $achadas = $PROIBIDAS | Where-Object { TemPermissao $man $_ }
  if ($achadas) { foreach ($p in $achadas) { falha "permissao proibida: $p" } }
  else { ok 'nenhuma permissao proibida' }

  foreach ($p in $a.Exigidas) {
    if (TemPermissao $man $p) { ok "exigida presente: $($p -replace '^android\.permission\.', '')" }
    else { falha "exigida AUSENTE: $p" }
  }

  if ($man -match 'AudioControlsService') { falha 'AudioControlsService presente (midia em 1o plano nao usada)' }

  Write-Host ("    permissoes declaradas: {0}" -f ([regex]::Matches($man, 'uses-permission')).Count)
}

Write-Host ''
if ($falhas -eq 0) {
  if ($Artefato -eq 'apk') {
    Write-Host 'Os tres APK passaram. Desinstale builds anteriores antes de instalar.' -ForegroundColor Green
  } else {
    Write-Host 'Os tres AAB passaram. Pode subir.' -ForegroundColor Green
  }
  exit 0
}
Write-Host ("{0} conferencia(s) falharam." -f $falhas) -ForegroundColor Red
exit 1
