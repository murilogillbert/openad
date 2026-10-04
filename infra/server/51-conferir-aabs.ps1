# Conferencia independente dos tres AAB prontos para upload.
#
# Por que separado do 38-aab.ps1: aquele script confere o que ele mesmo acabou de produzir, e
# imprime o resultado no proprio log. Isto le os tres arquivos que estao em disco **agora**,
# sem ter construido nada, e e o que vale antes de clicar em enviar. Ja aconteceu de uma build
# interrompida apagar o AAB antigo sem gravar o novo, e o estado real so aparece olhando o
# arquivo.
#
# Usa bundletool (le AAB de verdade) e jarsigner. O aapt2 **nao le AAB** e devolvia um falso
# "ok" por comparar com string vazia.

$ErrorActionPreference = 'Continue'

$Jdk = 'D:\dev\jdk\jdk-21.0.12.1+1'
$Bundletool = 'D:\dev\bundletool.jar'
$java = Join-Path $Jdk 'bin\java.exe'
$jarsigner = Join-Path $Jdk 'bin\jarsigner.exe'

$apps = @(
  @{
    Nome   = 'OpenDriver'
    Pacote = 'br.com.opendriver.app'
    Aab    = 'd:\Projetos\opendriver\mobile\android\app\build\outputs\bundle\release\app-release.aab'
    Exigidas = @(
      'android.permission.RECORD_AUDIO',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION'
    )
  },
  @{
    Nome   = 'OpenDriver HUB'
    Pacote = 'br.com.opendriverhub.app'
    Aab    = 'd:\Projetos\hub-mobile\android\app\build\outputs\bundle\release\app-release.aab'
    Exigidas = @()
  },
  @{
    Nome   = 'OpenDriver Anuncios'
    Pacote = 'br.com.opendriver.ads'
    Aab    = 'd:\Projetos\openad\app\openad-advertiser\android\app\build\outputs\bundle\release\app-release.aab'
    Exigidas = @()
  }
)

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

function TemPermissao([string]$texto, [string]$permissao) {
  return $texto -match ('android:name="' + [regex]::Escape($permissao) + '"')
}

$falhas = 0
function ok($t) { Write-Host "    ok    $t" -ForegroundColor Green }
function falha($t) { $script:falhas++; Write-Host "    FALHA $t" -ForegroundColor Red }

foreach ($a in $apps) {
  Write-Host ''
  Write-Host ("=== {0}  ({1})" -f $a.Nome, $a.Pacote)

  if (-not (Test-Path $a.Aab)) {
    falha "AAB nao existe: $($a.Aab)"
    continue
  }
  $info = Get-Item $a.Aab
  Write-Host ("    arquivo: {0}" -f $a.Aab)
  Write-Host ("    tamanho: {0:N1} MB   gravado: {1}" -f ($info.Length / 1MB), $info.LastWriteTime.ToString('dd/MM HH:mm:ss'))
  Write-Host ("    sha256 : {0}" -f (Get-FileHash $a.Aab -Algorithm SHA256).Hash)

  # Assinatura
  $assin = & $jarsigner -verify -verbose:summary -certs $a.Aab 2>&1 | Out-String
  if ($assin -match 'jar verified|jar validado') {
    if ($assin -match 'Android Debug|androiddebugkey') { falha 'assinado com a chave de DEBUG' }
    else { ok 'assinado, e nao com a chave de debug' }
    if ($assin -match 'Heavenbound Systems') { ok 'certificado em nome de Heavenbound Systems LTDA' }
    else { falha 'certificado nao menciona Heavenbound Systems' }
  } else {
    falha 'assinatura nao verificada'
  }

  # Manifesto
  $man = & $java -jar $Bundletool dump manifest --bundle $a.Aab 2>&1 | Out-String

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

  # Servicos em primeiro plano que o formulario do Play vai cobrar.
  $fg = [regex]::Matches($man, 'android:foregroundServiceType="([^"]+)"') |
    ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
  if ($fg) { Write-Host ("    servicos em 1o plano a declarar: {0}" -f ($fg -join ', ')) }
  else { Write-Host '    nenhum servico em primeiro plano' }

  Write-Host ("    permissoes declaradas: {0}" -f ([regex]::Matches($man, 'uses-permission')).Count)
}

Write-Host ''
if ($falhas -eq 0) {
  Write-Host 'Os tres AAB passaram. Pode subir.' -ForegroundColor Green
  exit 0
}
Write-Host ("{0} conferencia(s) falharam. NAO suba." -f $falhas) -ForegroundColor Red
exit 1
