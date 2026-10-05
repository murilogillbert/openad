# Torna o player Device Owner, que e o que permite o quiosque travar sozinho.
#
# Por que isto e necessario: `CapacitorAndroidKiosk.enterKioskMode()` chama `startLockTask()`.
# Sem Device Owner, o Android trata isso como **screen pinning** e exige confirmacao do
# usuario na tela — ou simplesmente recusa. `MainActivity.configurarLockTaskSeDeviceOwner()`
# reflete isso: ele retorna cedo quando `isDeviceOwnerApp` e falso, e nunca chama
# `setLockTaskPackages`, que e a allowlist que dispensa a confirmacao.
#
# O sintoma era exatamente "o app nao trava sozinho ao abrir": `dpm list-owners` devolvia
# `no owners`, e `isInKioskMode` ficava `false` depois de cada arranque.
#
# Pre-requisitos do `dpm set-device-owner`, todos verificados abaixo:
#   - nenhuma conta no aparelho (nem Google, nem outra). O Android recusa com
#     "Not allowed to set the device owner because there are already some accounts".
#   - o aparelho nao pode ja ter um owner.
#   - o receiver precisa estar declarado no manifesto (ja esta:
#     `OpenAdDeviceAdminReceiver`).
#
# Reverter:  adb shell dpm remove-active-admin com.openad/.OpenAdDeviceAdminReceiver
#
# Atencao: Device Owner **so e removivel por comando** enquanto o aparelho nao for
# reprovisionado. Nao e uma mudanca cosmetica; e o que da ao aplicativo poder de politica
# sobre o aparelho. Em frota isso e o desejado (atualizacao silenciosa e quiosque dependem
# dele), mas num aparelho de uso pessoal nao se faz.

param(
  [string] $Sdk = 'D:\dev\android-sdk',
  [switch] $Reverter
)

$ErrorActionPreference = 'Continue'
$adb = Join-Path $Sdk 'platform-tools\adb.exe'
$componente = 'com.openad/.OpenAdDeviceAdminReceiver'

if (-not (Test-Path $adb)) { throw "adb nao encontrado em $adb" }

$aparelhos = & $adb devices 2>&1 | Select-String -Pattern '\sdevice$'
if (-not $aparelhos) { throw 'nenhum aparelho no adb' }

if ($Reverter) {
  Write-Host '--- removendo o Device Owner'
  & $adb shell dpm remove-active-admin $componente 2>&1 | ForEach-Object { "  $_" }
  & $adb shell dpm list-owners 2>&1 | ForEach-Object { "  $_" }
  exit 0
}

Write-Host '--- estado atual'
$donos = (& $adb shell dpm list-owners 2>&1) -join ' '
Write-Host "  dpm list-owners: $($donos.Trim())"

if ($donos -notmatch 'no owners') {
  Write-Host '  Ja existe um owner. Nada a fazer.' -ForegroundColor Yellow
  exit 0
}

Write-Host ''
Write-Host '--- contas no aparelho (o set-device-owner falha se houver alguma)'
$contas = & $adb shell dumpsys account 2>&1 | Select-String -Pattern 'Account \{'
if ($contas) {
  Write-Host ("  {0} conta(s) encontrada(s):" -f ($contas | Measure-Object).Count) -ForegroundColor Yellow
  $contas | Select-Object -First 6 | ForEach-Object { "    " + $_.Line.Trim() }
  Write-Host ''
  Write-Host '  O Android recusa Device Owner com contas cadastradas.' -ForegroundColor Yellow
  Write-Host '  Remova as contas em Ajustes > Contas e rode de novo.' -ForegroundColor Yellow
} else {
  Write-Host '  nenhuma conta' -ForegroundColor Green
}

Write-Host ''
Write-Host '--- set-device-owner'
$saida = (& $adb shell dpm set-device-owner $componente 2>&1) -join "`n"
Write-Host ("  " + ($saida -replace "`n", "`n  "))

Write-Host ''
Write-Host '--- conferindo'
$donosDepois = (& $adb shell dpm list-owners 2>&1) -join ' '
Write-Host "  dpm list-owners: $($donosDepois.Trim())"

if ($donosDepois -match 'no owners') {
  Write-Host ''
  Write-Host 'NAO provisionado. O quiosque continuara exigindo confirmacao na tela.' -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host 'Device Owner ativo. Reabra o app: o Lock Task entra sem confirmacao.' -ForegroundColor Green
exit 0
