# Gera os AAB dos tres apps em sequencia, com o mesmo versionCode, e grava um log por app.
#
# Em sequencia e nao em paralelo de proposito: cada `gradlew bundleRelease` sobe um daemon com
# `-Xmx4096m`, e tres ao mesmo tempo nesta maquina (23,9 GB) competem por memoria e disco. O
# daemon morto por falta de memoria nao imprime erro - a saida simplesmente para numa tarefa
# qualquer, e o diagnostico custa mais do que o tempo economizado.
#
# Uso:  .\50-aab-todos.ps1 [-VersionCode 2] [-Apps opendriver,opendriverhub,opendriverads]

param(
  [int] $VersionCode = 2,
  [string[]] $Apps = @('opendriver', 'opendriverhub', 'opendriverads'),

  # `aab` para a loja, `apk` para instalar por cabo e tirar as capturas de tela.
  [ValidateSet('aab', 'apk')]
  [string] $Artefato = 'aab'
)

$ErrorActionPreference = 'Continue'

<#
  Normaliza `-Apps`: no modo `powershell -File`, uma lista separada por virgula chega como
  **uma unica string** ("opendriverhub,opendriverads"), e nao como vetor. Sem isto, o script
  repassava a string inteira para o `-App` do 38-aab.ps1, que a recusa no ValidateSet - e o
  log do app saia vazio, com o erro escondido no arquivo de stderr.
#>
$Apps = $Apps |
  ForEach-Object { $_ -split ',' } |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ }

$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$logs = Join-Path $aqui 'logs-aab'
New-Item -ItemType Directory -Path $logs -Force | Out-Null

$inicio = Get-Date
Write-Host ("inicio: {0}" -f $inicio.ToString('HH:mm:ss'))
Write-Host ("artefato: {0}" -f $Artefato)
Write-Host ("versionCode: {0}" -f $VersionCode)
Write-Host ("apps: {0}" -f ($Apps -join ', '))

$resultados = @()

foreach ($app in $Apps) {
  $t0 = Get-Date
  # Nome do log inclui o artefato: sem isso, uma rodada de APK sobrescreve o log da rodada de
  # AAB do mesmo app, e o veredito lido do log passa a se referir ao artefato errado.
  $log = Join-Path $logs "$app.$Artefato.log"
  Write-Host ''
  Write-Host ('=' * 72)
  Write-Host ("[{0}] {1}  ->  {2}" -f $t0.ToString('HH:mm:ss'), $app, $log)
  Write-Host ('=' * 72)

  <#
    `Start-Process -Wait` com redirecionamento para **arquivo**, e nao `& ... | Tee-Object`.

    Com o pipe, a primeira build termina, grava o log inteiro e o laco **nunca** avanca para
    o segundo app: o daemon do Gradle sobrevive ao `gradlew.bat` que o criou e herda o
    descritor de saida padrao. O processo filho sai, mas o pipe nao recebe EOF enquanto o
    daemon o mantiver aberto, e o PowerShell fica lendo um cano que ninguem mais escreve.
    Ficou travado 10 minutos sem nenhuma mensagem de erro - o sintoma e indistinguivel de
    "a build esta demorando".

    Redirecionando para arquivo, o pai espera o **encerramento do processo**, nao o fechamento
    do cano. O preco e nao ver a saida ao vivo; por isso o resumo de cada app sai do log
    depois.
  #>
  $erroLog = Join-Path $logs "$app.$Artefato.err.log"
  $proc = Start-Process -FilePath 'powershell' -PassThru -NoNewWindow `
    -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', (Join-Path $aqui '38-aab.ps1'),
      '-App', $app, '-VersionCode', "$VersionCode", '-Artefato', $Artefato
    ) `
    -RedirectStandardOutput $log -RedirectStandardError $erroLog

  <#
    `WaitForExit()` no objeto do processo, e **nao** `Start-Process -Wait`.

    O `-Wait` do `Start-Process` espera o processo *e todos os descendentes*. O daemon do
    Gradle sobrevive de proposito ao `gradlew.bat` que o criou - e para isso que ele existe,
    manter JVM quente entre builds - e so morre por timeout de inatividade, em horas. Com
    `-Wait`, o laco travava depois da primeira build mesmo com o AAB pronto e conferido: o
    processo filho tinha terminado, o descendente nao.

    `WaitForExit()` olha apenas o processo que foi iniciado aqui. O daemon fica vivo, o que e
    desejavel: a build seguinte o reaproveita.
  #>
  $proc.WaitForExit()

  <#
    `ExitCode` de um objeto vindo de `Start-Process -PassThru` sai **nulo** com frequencia
    quando a saida foi redirecionada: o PowerShell nao reabre o handle do processo depois do
    encerramento. Na primeira versao isto fez o resumo acusar "nao suba este app" para um AAB
    que havia passado em todas as conferencias - alarme falso e tao ruim quanto falta de
    alarme, porque ensina a ignorar o resumo.

    Veredito real: o artefato existe **e** o log traz a linha final do 38-aab.ps1. Codigo de
    saida nulo fica como desconhecido, nao como falha.
  #>
  $codigo = if ($null -ne $proc.ExitCode) { $proc.ExitCode } else { '?' }
  $veredito = (Select-String -Path $log -Pattern 'pronto para upload' -Quiet) -eq $true

  # As linhas que importam: as conferencias e o veredito.
  Get-Content $log -ErrorAction SilentlyContinue |
    Where-Object { $_ -match '^\s*(ok|FALHA|ATENCAO)|^(arquivo|tamanho|app|pacote|versionCode)\s*:|BUILD |pronto para upload|conferencia' } |
    ForEach-Object { Write-Host "  $_" }
  if ((Get-Item $erroLog -ErrorAction SilentlyContinue).Length -gt 0) {
    Write-Host '  --- stderr (ultimas linhas)'
    Get-Content $erroLog -Tail 6 | ForEach-Object { Write-Host "  $_" }
  }

  $dur = [int]((Get-Date) - $t0).TotalSeconds

  # O 38-aab.ps1 lanca excecao quando uma conferencia falha, e nesse caso nao existe artefato
  # confiavel. O estado real, porem, e o arquivo: e ele que vai para o Play.
  $raizes = @{
    opendriver    = 'd:\Projetos\opendriver\mobile'
    opendriverhub = 'd:\Projetos\hub-mobile'
    opendriverads = 'd:\Projetos\openad\app\openad-advertiser'
  }
  $relativo = if ($Artefato -eq 'apk') {
    'android\app\build\outputs\apk\release\app-release.apk'
  } else {
    'android\app\build\outputs\bundle\release\app-release.aab'
  }
  $aab = Join-Path $raizes[$app] $relativo
  $mb = if (Test-Path $aab) { [math]::Round((Get-Item $aab).Length / 1MB, 1) } else { 0 }

  $resultados += [pscustomobject]@{
    App       = $app
    Conferido = if ($veredito) { 'sim' } else { 'NAO' }
    Saida     = $codigo
    Segundos  = $dur
    MB        = $mb
    Arquivo   = if ($mb -gt 0) { $aab } else { 'NAO GERADO' }
  }
}

$total = [int]((Get-Date) - $inicio).TotalSeconds

Write-Host ''
Write-Host ('=' * 72)
Write-Host 'RESUMO'
Write-Host ('=' * 72)
$resultados | Format-Table -AutoSize
Write-Host ("tempo total: {0} min {1} s" -f [int]($total / 60), ($total % 60))

$ruins = $resultados | Where-Object { $_.MB -le 0 -or $_.Conferido -ne 'sim' }
if ($ruins) {
  Write-Host ''
  Write-Host 'ATENCAO: nao suba os apps abaixo. Veja o log de cada um.' -ForegroundColor Red
  $ruins | ForEach-Object { Write-Host ("  {0}  {1}" -f $_.App, (Join-Path $logs "$($_.App).$Artefato.log")) }
  exit 1
}

Write-Host ''
Write-Host 'Todos passaram. Confirme com 51-conferir-aabs.ps1 antes de subir.' -ForegroundColor Green
exit 0
