# Guarda, fora das pastas de build, os artefatos de release que estiverem em disco agora.
#
# Por que: `android/app/build/outputs` e descartavel. Gerar o APK apaga o AAB e gerar o AAB
# apaga o APK - as duas tarefas do Gradle reescrevem a mesma arvore de saida. Depois de uma
# rodada de `assembleRelease`, os tres AAB recem-enviados a loja simplesmente nao existiam
# mais em disco, sem ninguem ter chamado `clean`.
#
# O destino fica fora dos repositorios, ao lado de `.credenciais-loja`: arquivo de 100 MB nao
# entra em git, e dentro do repositorio ficaria a um `.gitignore` de distancia de ser
# commitado por engano.
#
# Uso:  .\55-arquivar-artefatos.ps1 [-Destino d:\Projetos\.artefatos-loja]

param(
  [string] $Destino = 'd:\Projetos\.artefatos-loja',
  [int] $VersionCode = 2
)

$ErrorActionPreference = 'Continue'

$apps = @(
  @{ Id = 'opendriver'; Raiz = 'd:\Projetos\opendriver\mobile' },
  @{ Id = 'opendriverhub'; Raiz = 'd:\Projetos\hub-mobile' },
  @{ Id = 'opendriverads'; Raiz = 'd:\Projetos\openad\app\openad-advertiser' }
)

New-Item -ItemType Directory -Path $Destino -Force | Out-Null

$guardados = 0
$ausentes = @()

foreach ($a in $apps) {
  foreach ($tipo in @('aab', 'apk')) {
    $relativo = if ($tipo -eq 'apk') {
      'android\app\build\outputs\apk\release\app-release.apk'
    } else {
      'android\app\build\outputs\bundle\release\app-release.aab'
    }
    $origem = Join-Path $a.Raiz $relativo

    if (-not (Test-Path $origem)) {
      $ausentes += ("{0} {1}" -f $a.Id, $tipo)
      continue
    }

    $alvo = Join-Path $Destino ("{0}-v{1}.{2}" -f $a.Id, $VersionCode, $tipo)
    $hOrigem = (Get-FileHash $origem -Algorithm SHA256).Hash

    if ((Test-Path $alvo) -and (Get-FileHash $alvo -Algorithm SHA256).Hash -eq $hOrigem) {
      Write-Host ("  ja guardado  {0}" -f (Split-Path $alvo -Leaf)) -ForegroundColor DarkGray
      continue
    }

    Copy-Item $origem $alvo -Force
    # Confere a copia, nao a origem: copia truncada por disco cheio e silenciosa.
    $hAlvo = (Get-FileHash $alvo -Algorithm SHA256).Hash
    if ($hAlvo -ne $hOrigem) {
      Write-Host ("  FALHA copia divergente: {0}" -f $alvo) -ForegroundColor Red
      continue
    }

    Add-Content -Path (Join-Path $Destino 'hashes.txt') -Value ("{0}  {1}  {2}" -f (Get-Date -Format 's'), $hAlvo, (Split-Path $alvo -Leaf))
    Write-Host ("  ok  {0,-28} {1,7:N1} MB  {2}" -f (Split-Path $alvo -Leaf), ((Get-Item $alvo).Length / 1MB), $hAlvo.Substring(0, 16)) -ForegroundColor Green
    $guardados++
  }
}

Write-Host ''
Write-Host ("guardados agora: {0}" -f $guardados)
if ($ausentes.Count) {
  Write-Host ("nao estavam em disco: {0}" -f ($ausentes -join ', ')) -ForegroundColor Yellow
}
Write-Host ''
Get-ChildItem $Destino -File | Sort-Object Name |
  ForEach-Object { Write-Host ("  {0,-28} {1,8:N1} MB  {2}" -f $_.Name, ($_.Length / 1MB), $_.LastWriteTime.ToString('dd/MM HH:mm')) }
