# Toca num elemento da tela **pelo texto**, e nao por coordenada adivinhada.
#
# Por que existe: conduzir o aplicativo por `input tap <x> <y>` com coordenada tirada de uma
# captura e fragil de um jeito que falha em silencio. Nesta sessao um toque destinado a
# "Entrar" caiu em "Criar conta", e os passos seguintes digitaram e-mail e senha dentro do
# campo "Nome completo" — sem erro nenhum, so uma tela errada vinte segundos depois.
#
# `uiautomator dump` devolve a arvore de acessibilidade com o `bounds` de cada no. Procurar o
# texto e tocar no centro do retangulo e exato, e de quebra documenta a intencao: o comando diz
# "toque em Entrar", nao "toque em 598,224".
#
# Uso:
#   .\infra\server\102-toque-por-texto.ps1 -Texto 'Entrar'
#   .\infra\server\102-toque-por-texto.ps1 -Texto 'Produtos' -Indice 1
#   .\infra\server\102-toque-por-texto.ps1 -Listar

param(
  [string] $Texto,
  [int] $Indice = 0,
  [switch] $Listar,
  [switch] $Exato,
  [string] $Serial = '4AH47852E',
  [string] $Adb = 'D:\dev\android-sdk\platform-tools\adb.exe'
)

$ErrorActionPreference = 'Stop'

function LerArvore {
  # `uiautomator dump` grava no aparelho; `cat` em seguida e mais confiavel que
  # `dump /dev/tty`, que mistura a mensagem de status no XML.
  & $Adb -s $Serial shell "uiautomator dump /sdcard/ui.xml" 2>&1 | Out-Null
  $xml = (& $Adb -s $Serial shell "cat /sdcard/ui.xml" 2>&1) -join ''
  if (-not $xml -or $xml -notmatch '<hierarchy') { throw 'nao consegui ler a arvore de elementos' }
  return $xml
}

function Nos {
  param([string] $Xml)
  $lista = @()
  foreach ($m in [regex]::Matches($Xml, '<node[^>]*?/>|<node[^>]*?>')) {
    $n = $m.Value
    $t = ([regex]::Match($n, 'text="([^"]*)"')).Groups[1].Value
    $d = ([regex]::Match($n, 'content-desc="([^"]*)"')).Groups[1].Value
    $b = ([regex]::Match($n, 'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'))
    if (-not $b.Success) { continue }
    $x1 = [int]$b.Groups[1].Value; $y1 = [int]$b.Groups[2].Value
    $x2 = [int]$b.Groups[3].Value; $y2 = [int]$b.Groups[4].Value
    $rotulo = if ($t) { $t } else { $d }
    if (-not $rotulo) { continue }
    $lista += [pscustomobject]@{
      Texto = $rotulo
      X = [int](($x1 + $x2) / 2)
      Y = [int](($y1 + $y2) / 2)
      Largura = $x2 - $x1
      Altura = $y2 - $y1
    }
  }
  return $lista
}

$xml = LerArvore
$nos = Nos -Xml $xml

if ($Listar) {
  Write-Output ("{0} elemento(s) com texto:" -f $nos.Count)
  foreach ($n in $nos) {
    Write-Output ("  ({0,4},{1,4})  {2,4}x{3,-4}  {4}" -f $n.X, $n.Y, $n.Largura, $n.Altura, $n.Texto)
  }
  exit 0
}

if (-not $Texto) { throw 'informe -Texto ou -Listar' }

$cand = if ($Exato) {
  $nos | Where-Object { $_.Texto -eq $Texto }
} else {
  $nos | Where-Object { $_.Texto -like "*$Texto*" }
}

if (-not $cand) {
  Write-Output "NAO ACHOU '$Texto'. Elementos visiveis:"
  foreach ($n in $nos) { Write-Output "  $($n.Texto)" }
  exit 1
}

$alvo = @($cand)[$Indice]
if (-not $alvo) { throw "indice $Indice fora da lista (achei $(@($cand).Count))" }

& $Adb -s $Serial shell "input tap $($alvo.X) $($alvo.Y)" 2>&1 | Out-Null
Write-Output ("tocou em '{0}' em ({1},{2})" -f $alvo.Texto, $alvo.X, $alvo.Y)
