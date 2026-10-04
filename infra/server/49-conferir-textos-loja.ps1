# Mede os textos da ficha do Google Play contra os limites do Play Console.
#
# Por que medir por script e nao a olho: o Play recusa o campo inteiro quando passa do
# limite, e "Breve descricao" tem 80 caracteres - um a mais e a ficha nao salva. Contar
# manualmente texto com acento ainda convida ao erro de confundir byte com caractere.
#
# A fonte e o proprio documento `docs/lojas/ficha-google-play.md`, secao 6: assim nao existe
# copia dos textos em dois lugares para divergir.

$ErrorActionPreference = 'Stop'

$doc = 'D:\Projetos\openad\docs\lojas\ficha-google-play.md'
$texto = Get-Content -Raw -Encoding UTF8 $doc

$limites = @(
  @{ Campo = 'Nome do app'; Limite = 30 },
  @{ Campo = 'Breve descricao'; Limite = 80 },
  @{ Campo = 'Descricao completa'; Limite = 4000 }
)

# Secoes 6.1, 6.2, 6.3
$secoes = [regex]::Matches($texto, '(?ms)^### (6\.\d) (.+?)\r?\n(.*?)(?=^### |^---)')
if ($secoes.Count -eq 0) { throw "nao encontrei as secoes 6.x em $doc" }

$falhas = 0

foreach ($s in $secoes) {
  $titulo = $s.Groups[2].Value.Trim()
  $corpo = $s.Groups[3].Value
  Write-Host ''
  Write-Host ("=== {0} {1}" -f $s.Groups[1].Value, $titulo)

  $blocos = [regex]::Matches($corpo, '(?ms)^```\r?\n(.*?)\r?\n```')
  if ($blocos.Count -lt 3) {
    Write-Host ("  ERRO: esperava 3 blocos de texto, achei {0}" -f $blocos.Count) -ForegroundColor Red
    $falhas++
    continue
  }

  for ($i = 0; $i -lt 3; $i++) {
    $conteudo = $blocos[$i].Groups[1].Value
    $n = $conteudo.Length
    $limite = $limites[$i].Limite
    $campo = $limites[$i].Campo
    $cabe = $n -le $limite
    if (-not $cabe) { $falhas++ }
    $cor = if ($cabe) { 'Green' } else { 'Red' }
    $marca = if ($cabe) { 'ok  ' } else { 'ESTOUROU' }
    Write-Host ("  {0,-8} {1,-20} {2,5} / {3,-5} caracteres" -f $marca, $campo, $n, $limite) -ForegroundColor $cor
  }
}

Write-Host ''
if ($falhas -eq 0) {
  Write-Host 'Todos os textos cabem nos limites do Play Console.' -ForegroundColor Green
  exit 0
}
Write-Host ("{0} campo(s) fora do limite." -f $falhas) -ForegroundColor Red
exit 1
