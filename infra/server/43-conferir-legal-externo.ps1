# Confere as 9 paginas legais publicas dos tres servicos.
# Valida: HTTP 200, razao social, CNPJ, e-mail de contato visivel em texto puro
# e ausencia da ofuscacao de e-mail do Cloudflare (/cdn-cgi/l/email-protection).

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$hosts = @(
  @{ Nome = 'HUB';        Base = 'https://hubapi.opendriver.com.br' },
  @{ Nome = 'OpenDriver'; Base = 'https://api-app.opendriver.com.br' },
  @{ Nome = 'OpenAD';     Base = 'https://adsapi.opendriver.com.br' }
)
$paginas = @('privacidade', 'termos', 'exclusao-de-conta')

$esperado = @{
  Empresa = 'Heavenbound Systems LTDA'
  Cnpj    = '51.574.461/0001-09'
  Email   = 'murilogillbert@gmail.com'
}

$falhas = 0
$linhas = @()

foreach ($h in $hosts) {
  foreach ($p in $paginas) {
    $url = "$($h.Base)/legal/$p"
    $status = '-'
    $html = ''
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
      $status = [int]$r.StatusCode
      $html = $r.Content
    } catch {
      $status = 'ERRO'
    }

    $okStatus  = ($status -eq 200)
    $okEmpresa = $html.Contains($esperado.Empresa)
    $okCnpj    = $html.Contains($esperado.Cnpj)
    $okEmail   = $html.Contains($esperado.Email)
    $semCf     = -not $html.Contains('email-protection')

    $tudoOk = $okStatus -and $okEmpresa -and $okCnpj -and $okEmail -and $semCf
    if (-not $tudoOk) { $falhas++ }

    $linhas += [pscustomobject]@{
      Servico  = $h.Nome
      Pagina   = $p
      HTTP     = $status
      Empresa  = if ($okEmpresa) { 'ok' } else { 'FALTA' }
      CNPJ     = if ($okCnpj) { 'ok' } else { 'FALTA' }
      Email    = if ($okEmail) { 'ok' } else { 'FALTA' }
      SemCF    = if ($semCf) { 'ok' } else { 'OFUSCADO' }
      Bytes    = $html.Length
      Resultado = if ($tudoOk) { 'PASSOU' } else { 'FALHOU' }
    }
  }
}

$linhas | Format-Table -AutoSize

if ($falhas -eq 0) {
  Write-Host "`nTodas as 9 paginas legais passaram." -ForegroundColor Green
  exit 0
} else {
  Write-Host "`n$falhas pagina(s) com problema." -ForegroundColor Red
  exit 1
}
