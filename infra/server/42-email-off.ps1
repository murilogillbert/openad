# Envolve todo link `mailto:` das paginas legais em `<!--email_off-->`.
#
# Defeito que isto corrige, encontrado olhando o HTML servido em producao e nao o codigo:
# o Cloudflare (Scrape Shield -> Email Address Obfuscation) reescreve todo `mailto:` para
# `/cdn-cgi/l/email-protection` e troca o texto visivel por `[email protected]`, contando com
# um decodificador em JavaScript para restaurar no navegador.
#
# Nestas paginas a CSP e `default-src 'none'`, entao **o decodificador nao roda**. O endereco
# fica ilegivel para sempre. Duas consequencias concretas:
#   - o canal de exclusao de conta que o Google revisa aparece quebrado;
#   - o contato do encarregado de dados, exigido pelo art. 41 da LGPD, nao e legivel.
#
# `<!--email_off-->` e o mecanismo documentado do Cloudflare para excluir um trecho da
# obfuscacao, e e a correcao que nao depende de mexer na configuracao da zona (que afetaria
# todos os sites). Os marcadores tem de casar exatamente: dois hifens, sem espacos.

$arquivos = @(
  'd:\Projetos\openad\app\openad-api\src\modules\legal\legal.controller.ts',
  'd:\Projetos\hub\backend\src\routes\legal.routes.ts',
  'd:\Projetos\hub\backend\src\routes\legal.exclusao.ts',
  'd:\Projetos\opendriver\backend\src\modules\legal\legal.routes.ts',
  'd:\Projetos\opendriver\backend\src\modules\legal\exclusao.ts'
)

# Casa `<a href="mailto: ... </a>` sem atravessar o fim da tag. `[^<]*` no texto interno evita
# engolir outra tag caso o conteudo tenha marcacao.
$padrao = '(?<!email_off-->)(<a href="mailto:[^"]*"[^>]*>[^<]*</a>)'

$totalAntes = 0
$totalDepois = 0

foreach ($f in $arquivos) {
  if (-not (Test-Path $f)) { Write-Output "ausente: $f"; continue }

  $t = [System.IO.File]::ReadAllText($f)
  $antes = ([regex]::Matches($t, 'href="mailto:')).Count
  $jaProtegidos = ([regex]::Matches($t, '<!--email_off-->')).Count

  $n = [regex]::Replace($t, $padrao, '<!--email_off-->$1<!--/email_off-->')

  $protegidosDepois = ([regex]::Matches($n, '<!--email_off-->')).Count

  if ($n -ne $t) {
    [System.IO.File]::WriteAllText($f, $n, (New-Object System.Text.UTF8Encoding $false))
  }

  $totalAntes += $antes
  $totalDepois += $protegidosDepois

  "{0,-24} mailto={1}  protegidos: {2} -> {3}" -f (Split-Path $f -Leaf), $antes, $jaProtegidos, $protegidosDepois
}

Write-Output ''
Write-Output "total de mailto: $totalAntes  |  total protegido: $totalDepois"
if ($totalDepois -lt $totalAntes) {
  Write-Output 'ATENCAO: ha mailto sem protecao. Confira os padroes acima.'
  exit 1
}
Write-Output 'Todos os mailto estao dentro de email_off.'
