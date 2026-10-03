# Confere os pré-requisitos de loja que são **fatos verificáveis**, não preenchimento de
# formulário.
#
# Os três que a revisão encontra sozinha e que reprovam:
#   1. URL de política de privacidade e de termos. A Apple **abre** esses links. Link morto é
#      recusa, não ressalva.
#   2. Canal de suporte funcional. Caixa que não recebe é reprovação.
#   3. E-mail transacional entregável: a revisão cria uma conta e espera o e-mail de
#      verificação. SPF `-all` sem MX faz o destinatário recusar.
#
# O que este script NÃO verifica: conteúdo jurídico das páginas (se identificam o controlador
# dos dados, se têm CNPJ). Isso exige leitura humana.

$ProgressPreference = 'SilentlyContinue'

function Testar-Url {
  param([string] $Url, [string] $Para)
  try {
    $r = Invoke-WebRequest -Uri $Url -TimeoutSec 25 -UseBasicParsing
    $tamanho = if ($r.Content) { $r.Content.Length } else { 0 }
    # Página de 200 com corpo minúsculo normalmente é o `index.html` de uma SPA devolvido por
    # catch-all: a rota não existe, mas o servidor responde 200. Daí olhar o tamanho.
    $alerta = if ($tamanho -lt 500) { '  <- corpo pequeno; confira se nao e o index da SPA' } else { '' }
    '{0,-50} {1}  {2} bytes{3}' -f $Url, [int]$r.StatusCode, $tamanho, $alerta
  } catch {
    $s = $_.Exception.Response.StatusCode.value__
    '{0,-50} {1}' -f $Url, $(if ($s) { [int]$s } else { 'sem resposta' })
  }
  Write-Output "      (usado em: $Para)"
}

Write-Output ''
Write-Output '===== PAGINAS LEGAIS (a Apple abre estes links) ====='
Testar-Url 'https://hub.opendriver.com.br/privacidade' 'hub-mobile: links.privacyPolicy'
Testar-Url 'https://hub.opendriver.com.br/termos'      'hub-mobile: links.terms'
Testar-Url 'https://api-app.opendriver.com.br/legal/privacidade' 'opendriver/mobile: links.privacyPolicy'
Testar-Url 'https://api-app.opendriver.com.br/legal/termos'      'opendriver/mobile: links.terms'
Testar-Url 'https://opendriver.com.br/privacidade' 'openad-advertiser: links.privacyPolicy'
Testar-Url 'https://opendriver.com.br/termos'      'openad-advertiser: links.terms'

Write-Output ''
Write-Output '===== E-MAIL (suporte e transacional) ====='
foreach ($d in @('opendriver.com.br', 'opendriverhub.com.br')) {
  Write-Output ''
  Write-Output "--- $d"
  try {
    $mx = Resolve-DnsName -Name $d -Type MX -ErrorAction Stop |
      Where-Object { $_.NameExchange } | ForEach-Object { $_.NameExchange }
    if ($mx) { Write-Output ("  MX : " + ($mx -join ', ')) } else { Write-Output '  MX : nenhum (ou null MX "." = o dominio declara que NAO recebe e-mail)' }
  } catch {
    Write-Output '  MX : nenhum'
  }
  try {
    $txt = (Resolve-DnsName -Name $d -Type TXT -ErrorAction Stop).Strings
    foreach ($t in $txt) { Write-Output "  TXT: $t" }
  } catch {
    Write-Output '  TXT: nenhum'
  }
  try {
    $dmarc = (Resolve-DnsName -Name "_dmarc.$d" -Type TXT -ErrorAction Stop).Strings
    foreach ($t in $dmarc) { Write-Output "  DMARC: $t" }
  } catch {
    Write-Output '  DMARC: nenhum'
  }
}

Write-Output ''
Write-Output '===== COMO LER ====='
Write-Output 'SPF "-all" sem MX significa: nenhum servidor pode enviar por este dominio, e ele'
Write-Output 'nao recebe nada. O e-mail de verificacao de conta que a revisao espera e recusado'
Write-Output 'pelo destinatario, e o endereco de suporte nao recebe resposta.'
Write-Output ''
Write-Output 'Caminho curto: usar um endereco que ja funcione como contato de suporte e como'
Write-Output 'remetente. Caminho certo: MX reais + SPF autorizando o provedor + DKIM + DMARC'
Write-Output 'menos estrito que p=reject enquanto valida.'
