# Confere os enderecos que vao na ficha das lojas: site institucional, politica de
# privacidade e exclusao de conta. Um campo "Site" que devolve 404 e motivo de reprovacao.

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$urls = @(
  'https://opendriver.com.br',
  'https://www.opendriver.com.br',
  'https://app.opendriver.com.br',
  'https://hub.opendriver.com.br',
  'https://opendriverhub.com.br',
  'https://hubapi.opendriver.com.br/legal/privacidade',
  'https://api-app.opendriver.com.br/legal/privacidade',
  'https://adsapi.opendriver.com.br/legal/privacidade'
)

$linhas = foreach ($u in $urls) {
  $status = 'ERRO'
  $titulo = ''
  $tipo = ''
  try {
    $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 25 -MaximumRedirection 5
    $status = [int]$r.StatusCode
    $tipo = ($r.Headers['Content-Type'] -join '')
    $m = [regex]::Match($r.Content, '(?is)<title[^>]*>(.*?)</title>')
    if ($m.Success) { $titulo = $m.Groups[1].Value.Trim() }
  } catch {
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    else { $status = $_.Exception.Message.Split([Environment]::NewLine)[0] }
  }
  [pscustomobject]@{ URL = $u; HTTP = $status; Tipo = $tipo; Titulo = $titulo }
}

foreach ($l in $linhas) {
  $t = $l.Titulo
  if ($t.Length -gt 60) { $t = $t.Substring(0, 60) + '...' }
  Write-Host ("{0,-6} {1,-52} {2}" -f $l.HTTP, $l.URL, $t)
}
