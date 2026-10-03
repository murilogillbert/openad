# Verifica, **de fora**, que cada domínio do ecossistema chega ao serviço certo.
#
# O smoke de dentro do servidor (`22-smoke-openad.sh`) prova que a aplicação responde; não
# prova que DNS, Cloudflare, Traefik e certificado estão alinhados. Os dois defeitos que só
# aparecem aqui: nome sem registro (serviço de pé e inalcançável) e certificado não emitido
# (Cloudflare em Full strict sobre origem sem TLS devolve 526).

# A barra de progresso do `Invoke-WebRequest` escreve no mesmo fluxo da saída e embaralha a
# tabela até ficar ilegível. Desligar é o que torna este relatório utilizável.
$ProgressPreference = 'SilentlyContinue'

$alvos = @(
  @{ Url = 'https://hubapi.opendriver.com.br/health';      Espera = 200; Quem = 'hub-backend' },
  @{ Url = 'https://api-app.opendriver.com.br/health';     Espera = 200; Quem = 'opendriver-backend' },
  @{ Url = 'https://adsapi.opendriver.com.br/api/health';  Espera = 200; Quem = 'openad-api' },
  @{ Url = 'https://ads.opendriver.com.br/';               Espera = 200; Quem = 'portal do openad' },
  @{ Url = 'https://storage.opendriver.com.br/hub-uploads/4b26ee1a-41a2-40e8-ab07-b35bcb6ba768.jpg'; Espera = 200; Quem = 'hub-minio (bucket publico)' },
  @{ Url = 'https://hub.opendriver.com.br/';               Espera = 200; Quem = 'hub-frontend' },
  @{ Url = 'https://tiles.opendriver.com.br/';             Espera = 0;   Quem = 'tiles (qualquer resposta serve)' }
)

$falhas = 0

Write-Output ''
Write-Output 'URL                                                          STATUS  SERVICO'
Write-Output ('-' * 100)

foreach ($a in $alvos) {
  $status = 'sem resposta'
  $detalhe = ''
  try {
    # `UseBasicParsing` para não depender do motor de HTML do Internet Explorer, que não
    # existe em sessão sem interface.
    $r = Invoke-WebRequest -Uri $a.Url -Method GET -TimeoutSec 25 -UseBasicParsing
    $status = [int]$r.StatusCode
    if ($r.Content -and $r.Content.Length -gt 0) {
      $texto = ($r.Content -replace '\s+', ' ')
      $detalhe = if ($texto.Length -gt 70) { $texto.Substring(0, 70) } else { $texto }
    }
  } catch {
    $resp = $_.Exception.Response
    if ($resp -and $resp.StatusCode) {
      $status = [int]$resp.StatusCode
    } else {
      $detalhe = $_.Exception.Message
      if ($detalhe.Length -gt 60) { $detalhe = $detalhe.Substring(0, 60) }
    }
  }

  $ok = if ($a.Espera -eq 0) { $status -ne 'sem resposta' } else { $status -eq $a.Espera }
  if (-not $ok) { $falhas++ }

  $marca = if ($ok) { 'ok  ' } else { 'FALHA' }
  '{0,-60} {1,-7} {2} {3}' -f $a.Url, $status, $marca, $a.Quem
  if ($detalhe) { "    $detalhe" }
}

Write-Output ''
if ($falhas -eq 0) {
  Write-Output 'Todos os dominios respondem como esperado.'
  exit 0
}
Write-Output "$falhas dominio(s) nao responderam como esperado."
Write-Output 'Causas tipicas, nesta ordem: registro DNS ausente; proxy do Cloudflare ligado'
Write-Output 'antes de o certificado emitir; Full strict sobre origem sem certificado (526).'
exit 1
