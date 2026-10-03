# Confere o DNS de todos os nomes do ecossistema e diz quais faltam criar.
#
# Existe porque três nomes do openad (`adsapi`, `ads`, `mqtt`) e um do armazenamento
# (`storage`) ainda não têm registro, e sem eles o Traefik não consegue emitir certificado —
# o serviço fica de pé e inalcançável, o que é indistinguível de "não subiu" para quem olha de
# fora.
#
# Os endereços do Cloudflare (104.21.*, 172.67.*) significam proxy ligado: o IP de origem não
# aparece. Isso é o esperado para o que já funciona; para um nome novo, o proxy precisa ficar
# **desligado** (cinza) até o Let's Encrypt validar o desafio HTTP-01, senão o Cloudflare
# responde antes do Traefik e o certificado nunca emite.

$ipNovo = '179.236.228.94'
$ipAntigo = '187.77.46.26'

# Nome -> onde deve estar
$esperado = [ordered]@{
  'opendriver.com.br'           = 'VPS nova (hub-frontend)'
  'www.opendriver.com.br'       = 'VPS nova (hub-frontend)'
  'hub.opendriver.com.br'       = 'VPS nova (hub-frontend)'
  'hubapi.opendriver.com.br'    = 'VPS nova (hub-backend)'
  'api-app.opendriver.com.br'   = 'VPS nova (opendriver-backend)'
  'tiles.opendriver.com.br'     = 'VPS nova (opendriver-tiles-proxy)'
  'coolify.opendriver.com.br'   = 'VPS nova (Coolify)'
  'adsapi.opendriver.com.br'    = 'VPS nova (openad-api)      << CRIAR'
  'ads.opendriver.com.br'       = 'VPS nova (portal do openad) << CRIAR'
  'mqtt.opendriver.com.br'      = 'VPS nova (RabbitMQ/WSS)     << CRIAR'
  'storage.opendriver.com.br'   = 'VPS nova (hub-minio)        << CRIAR'
  'hubstorage.opendriver.com.br' = 'VPS ANTIGA (por decisao de topologia)'
  'solarapi.opendriver.com.br'  = 'VPS ANTIGA (por decisao de topologia)'
}

$faltando = @()

Write-Output ''
Write-Output 'NOME                            RESOLVE PARA              ESPERADO'
Write-Output ('-' * 100)

foreach ($nome in $esperado.Keys) {
  try {
    $ips = (Resolve-DnsName -Name $nome -Type A -ErrorAction Stop |
      Where-Object { $_.IPAddress }).IPAddress
  } catch {
    $ips = @()
  }

  if (-not $ips -or $ips.Count -eq 0) {
    $resolve = 'NAO RESOLVE'
    $faltando += $nome
  } else {
    $viaCloudflare = $ips | Where-Object { $_ -like '104.21.*' -or $_ -like '172.6*' }
    if ($viaCloudflare) {
      $resolve = 'Cloudflare (proxy on)'
    } elseif ($ips -contains $ipNovo) {
      $resolve = "$ipNovo (direto)"
    } elseif ($ips -contains $ipAntigo) {
      $resolve = "$ipAntigo (antiga)"
    } else {
      $resolve = ($ips -join ', ')
    }
  }

  '{0,-31} {1,-25} {2}' -f $nome, $resolve, $esperado[$nome]
}

Write-Output ''
if ($faltando.Count -eq 0) {
  Write-Output 'Todos os nomes resolvem.'
} else {
  Write-Output "FALTAM $($faltando.Count) registro(s) no Cloudflare:"
  foreach ($n in $faltando) {
    Write-Output "  $n   A   $ipNovo   (proxy DESLIGADO/cinza ate o certificado emitir)"
  }
  Write-Output ''
  Write-Output 'Depois de criar, conferir a emissao com:'
  Write-Output '  ssh opendriver ''docker logs coolify-proxy 2>&1 | grep -i acme | tail -20'''
}
