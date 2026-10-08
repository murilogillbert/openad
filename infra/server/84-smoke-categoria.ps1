# Confere que as rotas novas da categoria de veiculo estao no ar.
#
# O criterio e **404 x 401/403**, nao 200: sem token a API recusa, e e isso que se espera. O
# que importa aqui e que ela recuse por falta de autenticacao e nao por rota inexistente —
# 404 significaria que o deploy nao levou o codigo novo, que e exatamente o modo de falha que
# ja aconteceu neste projeto (conteiner commits atras do `main`; empurrar para o git nao basta).
#
# Nenhuma conta de administrador e criada para este teste. Criar credencial de administracao
# em producao para validar um deploy e um preco alto por uma conferencia que o proprio 404 ja
# entrega.
#
# O status vem da **excecao**, e nao de `-SkipHttpErrorCheck`: aquele parametro so existe no
# PowerShell 7, e no 5.1 (que e o que roda aqui) todo 4xx virava excecao e o script reportava
# as sete rotas como ausentes — inclusive a de controle, que era a pista de que o defeito
# estava no script e nao no deploy.

$ErrorActionPreference = 'Stop'
$base = 'https://api-app.opendriver.com.br/api/v1'
"PowerShell $($PSVersionTable.PSVersion)"
''

function Get-Status {
  param([string] $Metodo, [string] $Url, [string] $Corpo)
  try {
    $p = @{ Uri = $Url; Method = $Metodo; TimeoutSec = 30; UseBasicParsing = $true }
    if ($Corpo) {
      $p.Body = $Corpo
      $p.ContentType = 'application/json'
    }
    $r = Invoke-WebRequest @p
    return @{ code = [int] $r.StatusCode; corpo = $r.Content }
  } catch [System.Net.WebException] {
    $resp = $_.Exception.Response
    if (-not $resp) { return @{ code = -1; corpo = $_.Exception.Message } }
    $leitor = New-Object System.IO.StreamReader($resp.GetResponseStream())
    return @{ code = [int] $resp.StatusCode; corpo = $leitor.ReadToEnd() }
  } catch {
    return @{ code = -1; corpo = $_.Exception.Message }
  }
}

$rotas = @(
  @{ m = 'GET';  p = '/admin/vehicles/divergences' }
  @{ m = 'GET';  p = '/admin/vehicle-categories' }
  @{ m = 'GET';  p = '/admin/detran-providers' }
  @{ m = 'POST'; p = '/admin/vehicles/reclassify-batch' }
  @{ m = 'POST'; p = '/admin/vehicle-categories/import' }
  @{ m = 'POST'; p = '/admin/detran-providers/MS/test' }
  # Rota que ja existia, de controle: se esta tambem respondesse 404, o problema seria outro.
  @{ m = 'GET';  p = '/admin/pricing' }
)

$falhas = 0
foreach ($r in $rotas) {
  $res = Get-Status -Metodo $r.m -Url "$base$($r.p)" -Corpo $(if ($r.m -eq 'POST') { '{}' } else { $null })
  $veredito = switch ($res.code) {
    401 { 'ok (recusa por falta de token)' }
    403 { 'ok (recusa por papel)' }
    404 { 'FALHOU: rota inexistente — o deploy nao levou o codigo novo' }
    default { "inesperado: $($res.corpo)" }
  }
  if ($res.code -notin @(401, 403)) { $falhas++ }
  '{0,-5} {1,-45} {2,-4} {3}' -f $r.m, $r.p, $res.code, $veredito
}

''
if ($falhas -gt 0) {
  "RESULTADO: $falhas rota(s) com resposta fora do esperado"
  exit 1
}
'RESULTADO: as 7 rotas respondem, recusando por autenticacao'

''
'--- painel do hub ---'
# O painel e uma SPA e a pagina entra por `lazyPage`, ou seja num chunk proprio. Procurar o
# nome da pagina no entrypoint nao funcionaria; o que funciona e procurar nos chunks.
$painel = Get-Status -Metodo 'GET' -Url 'https://opendriver.com.br/'
"GET /  ->  $($painel.code)"
$entradas = [regex]::Matches($painel.corpo, '/assets/[A-Za-z0-9._-]+\.js') |
  ForEach-Object { $_.Value } | Sort-Object -Unique
"scripts referenciados no index: $($entradas.Count)"

$achou = $null
foreach ($a in $entradas) {
  $js = Get-Status -Metodo 'GET' -Url "https://opendriver.com.br$a"
  # O chunk da pagina e referenciado pelo nome do arquivo dentro do entrypoint.
  foreach ($m in [regex]::Matches($js.corpo, '[A-Za-z0-9._-]*VehicleCategories[A-Za-z0-9._-]*\.js')) {
    $achou = $m.Value
  }
}

if ($achou) {
  "ok: o chunk da tela nova esta publicado ($achou)"
  $chunk = Get-Status -Metodo 'GET' -Url "https://opendriver.com.br/assets/$achou"
  "GET /assets/$achou  ->  $($chunk.code)  ($($chunk.corpo.Length) bytes)"
  if ($chunk.corpo -match 'Categoria dos ve') {
    'ok: o titulo da tela esta no chunk'
  } else {
    'ATENCAO: o chunk carregou mas nao achei o titulo esperado'
  }
} else {
  'nao achei referencia ao chunk da tela nova no index — confira logado no painel, em'
  '/admin/opendriver/categorias-veiculos'
}
