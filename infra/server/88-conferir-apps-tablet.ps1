# Confere, no tablete, se cada aplicativo sobe e carrega o pacote JavaScript sem erro fatal.
#
# Por que existe, e o que esta conferencia NAO prova.
#
# A verificacao por imagem e a melhor, mas depende do aparelho desbloqueado: a tela de
# entrada do PIN tem `FLAG_SECURE`, e enquanto ela esta a frente o `screencap` devolve
# arquivo invalido - nem o aplicativo atras dela aparece. Este script e o que sobra quando o
# aparelho esta bloqueado: prova que o processo sobe, que o pacote JavaScript carrega e que
# nao houve excecao fatal nem erro de rede na partida. NAO prova que a tela esta desenhada
# corretamente - isso continua exigindo o aparelho desbloqueado.
#
# Uso:
#   .\infra\server\88-conferir-apps-tablet.ps1
#   .\infra\server\88-conferir-apps-tablet.ps1 -Espera 25

param(
  [int] $Espera = 18,
  [string] $Serial = '4AH47852E',
  [string] $Adb = 'D:\dev\android-sdk\platform-tools\adb.exe'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Adb)) { throw "adb nao encontrado em $Adb" }

$apps = @(
  @{ pacote = 'br.com.opendriverhub.app.preview'; nome = 'hub-mobile' }
  @{ pacote = 'br.com.opendriver.app.preview';    nome = 'opendriver-mobile' }
  @{ pacote = 'br.com.opendriver.ads.preview';    nome = 'openad-advertiser' }
)

function Adb { param([string] $Cmd) (& $Adb -s $Serial shell $Cmd 2>&1) -join "`n" }

# Estado do bloqueio: entra no relatorio porque muda o que as outras linhas significam.
$janela = Adb 'dumpsys window'
$bloqueado = $janela -match 'mDreamingLockscreen=true'
Write-Output ("bloqueio de tela: {0}" -f ($(if ($bloqueado) { 'ATIVO (sem conferencia visual)' } else { 'liberado' })))
Write-Output ''

$falhas = 0

foreach ($a in $apps) {
  $p = $a.pacote
  Write-Output "=============================================================="
  Write-Output ("{0}  ({1})" -f $a.nome, $p)
  Write-Output "=============================================================="

  Adb "am force-stop $p" | Out-Null
  & $Adb -s $Serial logcat -c 2>&1 | Out-Null
  Start-Sleep -Seconds 1

  $saida = Adb "am start -W -n $p/.MainActivity"
  if ($saida -notmatch 'Status: ok') {
    Write-Output "  FALHOU  am start nao retornou ok"
    Write-Output ($saida -split "`n" | Select-Object -First 4)
    $falhas++
    continue
  }

  Start-Sleep -Seconds $Espera

  # O processo continua vivo? Um travamento na partida derruba o processo, e `pidof` e a
  # forma mais direta de notar sem depender de ler o logcat inteiro.
  $pid_ = (Adb "pidof $p").Trim()
  if (-not $pid_) {
    Write-Output '  FALHOU  o processo nao esta vivo depois da partida'
    $falhas++
  } else {
    Write-Output "  ok      processo vivo (pid $pid_)"
  }

  # Logcat **do processo do aplicativo**, nao o buffer inteiro.
  #
  # Ler o buffer inteiro produz falso alarme: na primeira execucao deste script o
  # `OrchestrationWorker` do Google Play Services registrou `ERR_NAME_NOT_RESOLVED` na
  # janela de partida do hub-mobile, e a conferencia atribuiu a falha ao aplicativo. Eram
  # processos diferentes (9762 contra 9747). Um aviso que acusa o inocente e pior que
  # nenhum aviso, porque treina quem le a ignorar o relatorio.
  if ($pid_) {
    $log = (& $Adb -s $Serial logcat -d --pid=$pid_ 2>&1) -join "`n"
  } else {
    # Sem pid o processo morreu: ai o buffer inteiro e a unica fonte, e a excecao fatal
    # que explica a morte esta nele.
    $log = (& $Adb -s $Serial logcat -d 2>&1) -join "`n"
  }

  $fatal = $log -split "`n" | Where-Object { $_ -match 'FATAL EXCEPTION|AndroidRuntime: .*Exception' }
  if ($fatal) {
    Write-Output '  FALHOU  excecao fatal no logcat:'
    $fatal | Select-Object -First 6 | ForEach-Object { Write-Output "          $_" }
    $falhas++
  } else {
    Write-Output '  ok      nenhuma excecao fatal'
  }

  # Erro vindo do JavaScript. Separado da excecao fatal porque em React Native um erro de
  # renderizacao deixa o processo vivo e a tela em branco - passaria pela conferencia acima.
  $js = $log -split "`n" | Where-Object {
    $_ -match 'ReactNativeJS' -and $_ -match ' E |Error|Unhandled|Warning: Error'
  }
  if ($js) {
    Write-Output '  ATENCAO erro reportado pelo JavaScript:'
    $js | Select-Object -First 6 | ForEach-Object { Write-Output "          $_" }
    $falhas++
  } else {
    Write-Output '  ok      nenhum erro reportado pelo JavaScript'
  }

  $rn = ($log -split "`n" | Where-Object { $_ -match 'ReactNativeJS|ReactNative:' }).Count
  Write-Output "  info    linhas de React Native no logcat: $rn"

  $rede = $log -split "`n" | Where-Object { $_ -match 'Network request failed|ERR_|CLEARTEXT|SSLHandshake' }
  if ($rede) {
    Write-Output '  ATENCAO falha de rede na partida:'
    $rede | Select-Object -First 4 | ForEach-Object { Write-Output "          $_" }
  } else {
    Write-Output '  ok      nenhuma falha de rede na partida'
  }
  Write-Output ''
}

Write-Output "=============================================================="
if ($falhas -eq 0) {
  Write-Output 'RESULTADO: os tres aplicativos sobem sem erro fatal nem erro de JavaScript.'
} else {
  Write-Output "RESULTADO: $falhas conferencia(s) reprovada(s). Ver acima."
}
if ($bloqueado) {
  Write-Output 'A conferencia visual continua pendente: o aparelho esta bloqueado por PIN.'
}
