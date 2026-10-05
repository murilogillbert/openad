# Gera os ativos de icone dos aplicativos a partir de uma logo de origem.
#
# Por que nao basta copiar a logo sobre `assets/icon.png`: no Android o lancador usa o
# **icone adaptativo**, montado de `android-icon-foreground.png` (camada da frente, com
# transparencia) sobre `adaptiveIcon.backgroundColor` ou `android-icon-background.png`.
# Trocar so o `icon.png` muda o icone no iOS e na ficha da loja, e deixa o do lancador
# Android como estava. Por isso este script gera as quatro camadas de uma vez.
#
# Regras que o script respeita:
#
#  - Zona de seguranca do icone adaptativo: o Android recorta a camada da frente com uma
#    mascara que deixa visivel cerca de 66% da largura. O desenho e reduzido para caber nessa
#    fracao e centralizado, senao o lancador corta as pontas.
#  - `icon.png` e quadrado e **opaco**: a ficha do Play recusa transparencia no icone de
#    512x512. Logo com fundo transparente recebe o fundo informado em `-Fundo`.
#  - `monochrome` e a silhueta do desenho em branco sobre transparente, usada pelo tema
#    dinamico do Android 13+ e pelas notificacoes.
#
# Nao instala nada: usa System.Drawing (GDI+), que ja vem no Windows.
#
# Uso:
#   .\66-icones-apps.ps1 -Origem 'C:\...\logo1.png' -Destino 'd:\Projetos\opendriver\mobile\assets' -Fundo '#000000' -ChaveDeFundo '#000000'
#   .\66-icones-apps.ps1 -Origem 'C:\...\logo2.png' -Destino 'd:\Projetos\openad\app\openad-advertiser\assets' -Fundo '#FFFFFF'

param(
  [Parameter(Mandatory = $true)] [string] $Origem,
  [Parameter(Mandatory = $true)] [string] $Destino,

  # Cor do fundo do `icon.png` quadrado e opaco, e do fundo adaptativo.
  [Parameter(Mandatory = $true)] [string] $Fundo,

  # Quando a logo vem com fundo chapado em vez de transparencia, informe a cor aqui para que
  # ela seja transformada em transparencia antes de montar a camada da frente.
  [string] $ChaveDeFundo = '',

  # Fracao da largura ocupada pelo desenho em cada ativo.
  [double] $FracaoAdaptativo = 0.66,
  [double] $FracaoIcone = 0.80,

  [switch] $GerarFundoAdaptativo
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$LADO = 1024

function ConvertFrom-Hex([string]$hex) {
  $h = $hex.TrimStart('#')
  return [System.Drawing.Color]::FromArgb(
    255,
    [Convert]::ToInt32($h.Substring(0, 2), 16),
    [Convert]::ToInt32($h.Substring(2, 2), 16),
    [Convert]::ToInt32($h.Substring(4, 2), 16)
  )
}

function Set-AltaQualidade([System.Drawing.Graphics]$g) {
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
}

<#
  Transforma uma cor chapada de fundo em transparencia, com transicao suave.

  Distancia de Chebyshev (maior diferenca entre canais): o que interessa e "este pixel ainda e
  o fundo?". Abaixo de `limiteCheio` vira transparente; na faixa ate `limiteBorda` a
  transparencia entra proporcionalmente, o que preserva o antisserrilhamento da borda do
  desenho em vez de deixar degrau.
#>
function Remove-Fundo([System.Drawing.Bitmap]$bmp, [System.Drawing.Color]$chave, [int]$limiteCheio = 30, [int]$limiteBorda = 90) {
  $ret = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $trava = $bmp.LockBits($ret, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $total = [Math]::Abs($trava.Stride) * $bmp.Height
    $bytes = New-Object byte[] $total
    [System.Runtime.InteropServices.Marshal]::Copy($trava.Scan0, $bytes, 0, $total)
    $faixa = [double]($limiteBorda - $limiteCheio)

    for ($i = 0; $i -lt $total; $i += 4) {
      if ($bytes[$i + 3] -eq 0) { continue }
      $d = [Math]::Max(
        [Math]::Abs($bytes[$i + 2] - $chave.R),
        [Math]::Max([Math]::Abs($bytes[$i + 1] - $chave.G), [Math]::Abs($bytes[$i] - $chave.B))
      )
      if ($d -ge $limiteBorda) { continue }
      if ($d -le $limiteCheio) {
        $bytes[$i + 3] = 0
      } else {
        $peso = ($d - $limiteCheio) / $faixa
        $bytes[$i + 3] = [byte][Math]::Round($bytes[$i + 3] * $peso)
      }
    }

    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $trava.Scan0, $total)
  } finally {
    $bmp.UnlockBits($trava)
  }
}

<# Retangulo que contem todo pixel com alfa acima do limite. Null quando a imagem e vazia. #>
function Get-LimitesDoConteudo([System.Drawing.Bitmap]$bmp, [int]$limiteAlfa = 8) {
  $ret = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $trava = $bmp.LockBits($ret, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $stride = [Math]::Abs($trava.Stride)
    $bytes = New-Object byte[] ($stride * $bmp.Height)
    [System.Runtime.InteropServices.Marshal]::Copy($trava.Scan0, $bytes, 0, $bytes.Length)

    $minX = $bmp.Width; $minY = $bmp.Height; $maxX = -1; $maxY = -1
    for ($y = 0; $y -lt $bmp.Height; $y++) {
      $linha = $y * $stride
      for ($x = 0; $x -lt $bmp.Width; $x++) {
        if ($bytes[$linha + $x * 4 + 3] -gt $limiteAlfa) {
          if ($x -lt $minX) { $minX = $x }
          if ($x -gt $maxX) { $maxX = $x }
          if ($y -lt $minY) { $minY = $y }
          if ($y -gt $maxY) { $maxY = $y }
        }
      }
    }
    if ($maxX -lt 0) { return $null }
    return New-Object System.Drawing.Rectangle $minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1)
  } finally {
    $bmp.UnlockBits($trava)
  }
}

<#
  Desenha o conteudo recortado dentro de um quadrado de 1024, ocupando `fracao` da largura,
  centralizado, preservando a proporcao.
#>
function New-Ativo(
  [System.Drawing.Bitmap]$fonte,
  [System.Drawing.Rectangle]$conteudo,
  [double]$fracao,
  [System.Drawing.Color]$corDeFundo,
  [bool]$comFundo
) {
  $destino = New-Object System.Drawing.Bitmap $LADO, $LADO, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($destino)
  Set-AltaQualidade $g
  if ($comFundo) {
    $pincel = New-Object System.Drawing.SolidBrush $corDeFundo
    $g.FillRectangle($pincel, 0, 0, $LADO, $LADO)
    $pincel.Dispose()
  }

  $alvo = $LADO * $fracao
  $escala = [Math]::Min($alvo / $conteudo.Width, $alvo / $conteudo.Height)
  $w = [int][Math]::Round($conteudo.Width * $escala)
  $h = [int][Math]::Round($conteudo.Height * $escala)
  $x = [int](($LADO - $w) / 2)
  $y = [int](($LADO - $h) / 2)

  $g.DrawImage($fonte, (New-Object System.Drawing.Rectangle $x, $y, $w, $h), $conteudo.X, $conteudo.Y, $conteudo.Width, $conteudo.Height, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  return $destino
}

<# Silhueta branca: mantem o alfa e pinta todos os canais de cor com branco. #>
function ConvertTo-Monocromatico([System.Drawing.Bitmap]$bmp) {
  $ret = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $trava = $bmp.LockBits($ret, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $total = [Math]::Abs($trava.Stride) * $bmp.Height
    $bytes = New-Object byte[] $total
    [System.Runtime.InteropServices.Marshal]::Copy($trava.Scan0, $bytes, 0, $total)
    for ($i = 0; $i -lt $total; $i += 4) {
      if ($bytes[$i + 3] -eq 0) { continue }
      $bytes[$i] = 255; $bytes[$i + 1] = 255; $bytes[$i + 2] = 255
    }
    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $trava.Scan0, $total)
  } finally {
    $bmp.UnlockBits($trava)
  }
}

# ----------------------------------------------------------------- execucao

if (-not (Test-Path $Origem)) { throw "logo de origem nao encontrada: $Origem" }
if (-not (Test-Path $Destino)) { throw "pasta de destino nao encontrada: $Destino" }

$corFundo = ConvertFrom-Hex $Fundo

$originalTmp = [System.Drawing.Image]::FromFile($Origem)
Write-Host ("origem : {0}  {1}x{2}" -f (Split-Path $Origem -Leaf), $originalTmp.Width, $originalTmp.Height)
if ($originalTmp.Width -lt 512 -or $originalTmp.Height -lt 512) {
  Write-Host ("  ATENCAO: a origem tem menos de 512 px. Ampliar para 1024 deixa a borda suave;") -ForegroundColor Yellow
  Write-Host ("           o ideal e um arquivo de 1024x1024 ou vetorial.") -ForegroundColor Yellow
}

# Copia em 32 bits com alfa, para poder mexer nos pixels.
$fonte = New-Object System.Drawing.Bitmap $originalTmp.Width, $originalTmp.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g0 = [System.Drawing.Graphics]::FromImage($fonte)
Set-AltaQualidade $g0
$g0.DrawImage($originalTmp, (New-Object System.Drawing.Rectangle 0, 0, $originalTmp.Width, $originalTmp.Height))
$g0.Dispose()
$originalTmp.Dispose()

if ($ChaveDeFundo) {
  Remove-Fundo $fonte (ConvertFrom-Hex $ChaveDeFundo)
  Write-Host ("  fundo {0} transformado em transparencia para montar a camada da frente" -f $ChaveDeFundo)
}

$conteudo = Get-LimitesDoConteudo $fonte
if (-not $conteudo) { throw 'a logo ficou vazia depois de remover o fundo; confira -ChaveDeFundo' }
Write-Host ("  conteudo util: {0}x{1} em ({2},{3})" -f $conteudo.Width, $conteudo.Height, $conteudo.X, $conteudo.Y)

$gerados = @()

# 1) icon.png: quadrado, opaco, usado no iOS e como icone da ficha.
$icone = New-Ativo $fonte $conteudo $FracaoIcone $corFundo $true
$p = Join-Path $Destino 'icon.png'
$icone.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
$gerados += $p
$icone.Dispose()

# 2) camada da frente do icone adaptativo: transparente, dentro da zona de seguranca.
$frente = New-Ativo $fonte $conteudo $FracaoAdaptativo ([System.Drawing.Color]::Transparent) $false
$p = Join-Path $Destino 'android-icon-foreground.png'
$frente.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
$gerados += $p

# 3) monocromatico: a mesma silhueta em branco.
$mono = New-Object System.Drawing.Bitmap $frente
$frente.Dispose()
ConvertTo-Monocromatico $mono
$p = Join-Path $Destino 'android-icon-monochrome.png'
$mono.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
$gerados += $p
$mono.Dispose()

# 4) fundo adaptativo, so quando o aplicativo usa arquivo em vez de cor chapada.
if ($GerarFundoAdaptativo) {
  $fundoBmp = New-Object System.Drawing.Bitmap $LADO, $LADO, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $gf = [System.Drawing.Graphics]::FromImage($fundoBmp)
  $pincel = New-Object System.Drawing.SolidBrush $corFundo
  $gf.FillRectangle($pincel, 0, 0, $LADO, $LADO)
  $pincel.Dispose(); $gf.Dispose()
  $p = Join-Path $Destino 'android-icon-background.png'
  $fundoBmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
  $gerados += $p
  $fundoBmp.Dispose()
}

$fonte.Dispose()

Write-Host ''
Write-Host 'gravados:'
foreach ($f in $gerados) {
  $img = [System.Drawing.Image]::FromFile($f)
  Write-Host ("  {0,-34} {1,4}x{2,-4} {3,8:N0} bytes" -f (Split-Path $f -Leaf), $img.Width, $img.Height, (Get-Item $f).Length)
  $img.Dispose()
}
