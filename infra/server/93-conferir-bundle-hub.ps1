# Confere se os enderecos de API entraram no bundle publicado do painel do hub.
#
# Por que conferir o bundle e nao a variavel no Coolify: `VITE_*` e embutida em tempo de
# build. A variavel pode estar certa no orquestrador e ainda assim nao estar no arquivo
# servido — basta o build ter reaproveitado camada de cache, ou ter rodado antes da variavel
# existir. O unico lugar onde a resposta e definitiva e o JavaScript que o navegador baixa.
#
# Sem isso, o sintoma em producao seria a tela de compra de credito mostrando "API nao
# configurada" com a variavel aparecendo preenchida na interface do Coolify.
#
# ATENCAO ao modo de buscar, que foi onde a primeira versao errou.
#
# A primeira versao olhava so os `<script src>` do HTML e reprovou dois enderecos — inclusive
# `api-app.opendriver.com.br`, que ja funcionava em producao havia semanas. O erro era meu: o
# Vite divide o codigo por rota, e o pedaco da tela de Admin e carregado por `import()`
# dinamico, cujo nome aparece **dentro** do JavaScript, nao no HTML. Conferencia que reprova
# o que esta funcionando e pior que conferencia nenhuma, porque o proximo passo seria
# "consertar" algo que nao esta quebrado.
#
# Entao aqui a busca **rastreia** os pedacos: parte dos scripts do HTML e segue cada
# `/assets/*.js` citado no conteudo baixado, ate nao achar nome novo.
#
# Uso:  .\infra\server\93-conferir-bundle-hub.ps1

param(
  [string] $Site = 'https://hub.opendriver.com.br',
  [string[]] $Esperados = @('adsapi.opendriver.com.br', 'api-app.opendriver.com.br', 'hubapi.opendriver.com.br'),
  [int] $TetoDeArquivos = 400
)

$ErrorActionPreference = 'Stop'
# A barra de progresso do Invoke-WebRequest escreve em stdout neste host e enterra a saida.
$ProgressPreference = 'SilentlyContinue'

function Baixar { param([string] $Url) (Invoke-WebRequest -Uri $Url -UseBasicParsing).Content }

Write-Output "--- $Site"
$html = Baixar $Site

$fila = [System.Collections.Generic.Queue[string]]::new()
$vistos = [System.Collections.Generic.HashSet[string]]::new()

foreach ($m in [regex]::Matches($html, '/assets/[A-Za-z0-9._\-]+\.js')) {
  if ($vistos.Add($m.Value)) { $fila.Enqueue($m.Value) }
}
if ($fila.Count -eq 0) { throw "nao achei nenhum /assets/*.js no HTML de $Site" }

$achados = @{}
foreach ($e in $Esperados) { $achados[$e] = $null }
$bytes = 0
$lidos = 0

while ($fila.Count -gt 0 -and $lidos -lt $TetoDeArquivos) {
  $caminho = $fila.Dequeue()
  try { $js = Baixar "$Site$caminho" } catch { Write-Output "  (nao baixou $caminho)"; continue }
  $lidos++
  $bytes += $js.Length

  foreach ($e in $Esperados) {
    if (-not $achados[$e] -and $js -match [regex]::Escape($e)) { $achados[$e] = $caminho }
  }

  # Nomes de pedaco citados dentro deste arquivo. E assim que o `import()` dinamico do Vite
  # aparece depois do empacotamento.
  foreach ($m in [regex]::Matches($js, '/assets/[A-Za-z0-9._\-]+\.js')) {
    if ($vistos.Add($m.Value)) { $fila.Enqueue($m.Value) }
  }
  foreach ($m in [regex]::Matches($js, '"\./([A-Za-z0-9._\-]+\.js)"')) {
    $c = '/assets/' + $m.Groups[1].Value
    if ($vistos.Add($c)) { $fila.Enqueue($c) }
  }
}

Write-Output ("arquivos de JavaScript lidos: {0}   bytes: {1:N0}" -f $lidos, $bytes)
Write-Output ''

$falhou = 0
foreach ($e in $Esperados) {
  if ($achados[$e]) {
    Write-Output ("  ok     {0,-28} em {1}" -f $e, $achados[$e])
  } else {
    Write-Output ("  FALTA  {0}" -f $e)
    $falhou++
  }
}

Write-Output ''
if ($falhou -eq 0) {
  Write-Output 'RESULTADO: todos os enderecos de API estao no bundle publicado.'
} else {
  Write-Output "RESULTADO: $falhou endereco(s) fora do bundle. A tela correspondente mostra o aviso de API nao configurada."
  exit 1
}
