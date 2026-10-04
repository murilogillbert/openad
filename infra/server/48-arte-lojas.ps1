# Gera os ativos graficos obrigatorios da ficha do Google Play para os tres apps:
#   - icone 512x512 (PNG 32 bits)
#   - recurso grafico 1024x500 (PNG 32 bits)
#
# De onde vem a arte: o unico desenho de marca real do ecossistema e
# `opendriver/mobile/assets/icon.png` (1024x1024) - o "D" em forma de alfinete de mapa com
# um volante dentro e tres nos de rede. `hub-mobile/assets/icon.png` e byte a byte identico
# a ele, e o icone do app de anunciante era um marcador generico de 7 KB.
#
# Tres apps da mesma empresa com o mesmo icone nao e reprovado pelo Google, mas confunde o
# usuario na gaveta de aplicativos. A diferenciacao aqui troca **so a cor de fundo**, e nao
# a marca: o desenho azul/oliva/branco fica intacto nos tres.
#
# Por que troca de fundo e nao rotacao de matiz: rotacao de matiz sobre a imagem inteira
# saturou o desenho (o azul degrade e o oliva dos nos viraram o mesmo verde neon) e destruiu
# a identidade. A troca de fundo e um chroma key sobre uma cor plana, com transicao suave na
# faixa de antisserrilhamento, entao nenhuma borda fica serrada. O navy tambem aparece nos
# vazados do volante e do "D" - e deve aparecer: ali e espaco negativo, que por definicao
# tem a cor do fundo.
#
# Nao instala nada: usa System.Drawing (GDI+), que ja vem no Windows.

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$origem = 'D:\Projetos\opendriver\mobile\assets\icon.png'
$saida = 'D:\Projetos\openad\docs\lojas\google-play'
New-Item -ItemType Directory -Path $saida -Force | Out-Null

# ----------------------------------------------------------------- definicoes

$apps = @(
  @{
    Id      = 'opendriver'
    Nome    = 'OpenDriver'
    Chamada = 'Corridas com motorista por perto'
    Itens   = @(
      'Passageiro e motorista no mesmo app',
      'Corrida agendada e motorista favorito',
      ('Bot' + [char]0x00E3 + 'o de emerg' + [char]0x00EA + 'ncia e contatos de confian' + [char]0x00E7 + 'a')
    )
    FundoIcone = '#0C1B2A'
    Fundo1     = '#0A1725'
    Fundo2     = '#143A63'
    Brilho     = '#1E7FD6'
  },
  @{
    Id      = 'opendriverhub'
    Nome    = 'OpenDriver HUB'
    Chamada = 'Cashback real nas lojas parceiras'
    Itens   = @(
      ('Cat' + [char]0x00E1 + 'logo de parceiros perto de voc' + [char]0x00EA),
      'Cashback que vira desconto na corrida',
      ('Pedido, pagamento e hist' + [char]0x00F3 + 'rico num lugar')
    )
    FundoIcone = '#0A2A22'
    Fundo1     = '#06201B'
    Fundo2     = '#0D4A3A'
    Brilho     = '#17A87E'
  },
  @{
    Id      = 'opendriverads'
    Nome    = ('OpenDriver An' + [char]0x00FA + 'ncios')
    Chamada = 'Anuncie nas telas dos carros'
    Itens   = @(
      'Crie a campanha direto do celular',
      ('Cr' + [char]0x00E9 + 'dito de veicula' + [char]0x00E7 + [char]0x00E3 + 'o sem mensalidade'),
      ('Relat' + [char]0x00F3 + 'rio de exibi' + [char]0x00E7 + [char]0x00E3 + 'o por campanha')
    )
    FundoIcone = '#1E1033'
    Fundo1     = '#160B28'
    Fundo2     = '#3A1A5C'
    Brilho     = '#8B4FD6'
  }
)

# Os acentos acima vao por `[char]0x00XX` de proposito: este arquivo e lido pelo
# PowerShell 5.1, que assume ANSI quando nao ha BOM, e um "u" com acento sairia como lixo no
# desenho. Escapar e mais barato do que depender da codificacao do arquivo.
#
# Cada concatenacao esta entre parenteses porque no PowerShell a virgula tem precedencia
# **maior** que o `+`: sem os parenteses, `'Cr' + [char]0x00E9 + 'dito', 'outro item'` nao
# monta uma string, monta um vetor de seis pedacos - e a arte saiu com "Cr", "e", "dito" em
# linhas separadas, estourando a altura do recurso grafico.

# ----------------------------------------------------------------- utilidades

function ConvertFrom-Hex([string]$hex) {
  $h = $hex.TrimStart('#')
  return [System.Drawing.Color]::FromArgb(
    255,
    [Convert]::ToInt32($h.Substring(0, 2), 16),
    [Convert]::ToInt32($h.Substring(2, 2), 16),
    [Convert]::ToInt32($h.Substring(4, 2), 16)
  )
}

function New-CaminhoArredondado([int]$x, [int]$y, [int]$largura, [int]$altura, [int]$raio) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $raio * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $largura - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $largura - $d, $y + $altura - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $altura - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Set-AltaQualidade([System.Drawing.Graphics]$g) {
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
}

<#
  Troca a cor de fundo plana por outra, com transicao suave.

  `LockBits` em vez de `GetPixel`/`SetPixel`: sao 262.144 pixels por icone, e cada chamada
  de `GetPixel` atravessa o marshalling do GDI+. Em vetor de bytes a passagem inteira roda
  em milissegundos.

  Distancia de Chebyshev (maior diferenca entre canais) em vez de euclidiana: o navy e uma
  cor plana, e o que interessa e "este pixel ainda e o fundo?". Abaixo de `limiteCheio` e
  fundo puro e vira a cor nova; entre `limiteCheio` e `limiteBorda` esta na faixa
  antisserrilhada, e a cor nova entra proporcionalmente; acima disso e desenho e nao se toca.
#>
function Set-CorDeFundo([System.Drawing.Bitmap]$bmp, [System.Drawing.Color]$nova, [int]$limiteCheio = 26, [int]$limiteBorda = 72) {
  $ret = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $trava = $bmp.LockBits($ret, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $total = [Math]::Abs($trava.Stride) * $bmp.Height
    $bytes = New-Object byte[] $total
    [System.Runtime.InteropServices.Marshal]::Copy($trava.Scan0, $bytes, 0, $total)

    # Canto superior esquerdo: o fundo. BGRA na memoria.
    $fundoB = $bytes[0]; $fundoG = $bytes[1]; $fundoR = $bytes[2]

    $faixa = [double]($limiteBorda - $limiteCheio)
    for ($i = 0; $i -lt $total; $i += 4) {
      $dB = [Math]::Abs($bytes[$i] - $fundoB)
      $dG = [Math]::Abs($bytes[$i + 1] - $fundoG)
      $dR = [Math]::Abs($bytes[$i + 2] - $fundoR)
      $d = [Math]::Max($dR, [Math]::Max($dG, $dB))
      if ($d -ge $limiteBorda) { continue }

      if ($d -le $limiteCheio) {
        $peso = 1.0
      } else {
        $peso = 1.0 - (($d - $limiteCheio) / $faixa)
      }
      $bytes[$i] = [byte][Math]::Round($bytes[$i] * (1 - $peso) + $nova.B * $peso)
      $bytes[$i + 1] = [byte][Math]::Round($bytes[$i + 1] * (1 - $peso) + $nova.G * $peso)
      $bytes[$i + 2] = [byte][Math]::Round($bytes[$i + 2] * (1 - $peso) + $nova.R * $peso)
    }

    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $trava.Scan0, $total)
  } finally {
    $bmp.UnlockBits($trava)
  }
}

# --------------------------------------------------------------------- icones

$base = [System.Drawing.Image]::FromFile($origem)
Write-Host ("origem: {0}  {1}x{2}" -f (Split-Path $origem -Leaf), $base.Width, $base.Height)

$iconesGerados = @{}

foreach ($app in $apps) {
  $icone = New-Object System.Drawing.Bitmap 512, 512, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($icone)
  Set-AltaQualidade $g
  $g.DrawImage($base, (New-Object System.Drawing.Rectangle 0, 0, 512, 512))
  $g.Dispose()

  $novoFundo = ConvertFrom-Hex $app.FundoIcone
  Set-CorDeFundo $icone $novoFundo

  $arquivo = Join-Path $saida ("{0}-icone-512.png" -f $app.Id)
  $icone.Save($arquivo, [System.Drawing.Imaging.ImageFormat]::Png)
  $iconesGerados[$app.Id] = $icone
  Write-Host ("  icone  512x512    {0}  fundo {1}" -f (Split-Path $arquivo -Leaf), $app.FundoIcone)
}

# --------------------------------------------------- recurso grafico 1024x500

foreach ($app in $apps) {
  $L = 1024
  $A = 500
  $tela = New-Object System.Drawing.Bitmap $L, $A, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($tela)
  Set-AltaQualidade $g

  $ret = New-Object System.Drawing.Rectangle 0, 0, $L, $A
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $ret, (ConvertFrom-Hex $app.Fundo1), (ConvertFrom-Hex $app.Fundo2), 25.0)
  $g.FillRectangle($grad, $ret)
  $grad.Dispose()

  # Brilho atras do bloco do icone, para o icone nao parecer colado no fundo.
  $brilho = ConvertFrom-Hex $app.Brilho
  $caminhoBrilho = New-Object System.Drawing.Drawing2D.GraphicsPath
  $caminhoBrilho.AddEllipse(560, 20, 460, 460)
  $pincelBrilho = New-Object System.Drawing.Drawing2D.PathGradientBrush($caminhoBrilho)
  $pincelBrilho.CenterColor = [System.Drawing.Color]::FromArgb(110, $brilho.R, $brilho.G, $brilho.B)
  $pincelBrilho.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $brilho.R, $brilho.G, $brilho.B))
  $g.FillPath($pincelBrilho, $caminhoBrilho)
  $pincelBrilho.Dispose()
  $caminhoBrilho.Dispose()

  # Bloco do icone, cantos arredondados como o Android desenha.
  $lado = 280
  $bx = 660
  $by = [int](($A - $lado) / 2)
  $recorte = New-CaminhoArredondado $bx $by $lado $lado 62
  $estadoAnterior = $g.Save()
  $g.SetClip($recorte)
  $g.DrawImage($iconesGerados[$app.Id], (New-Object System.Drawing.Rectangle $bx, $by, $lado, $lado))
  $g.Restore($estadoAnterior)
  $canetaBorda = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(60, 255, 255, 255)), 2
  $g.DrawPath($canetaBorda, $recorte)
  $canetaBorda.Dispose()
  $recorte.Dispose()

  # Texto.
  $fonteNome = New-Object System.Drawing.Font 'Segoe UI', 44, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $fonteChamada = New-Object System.Drawing.Font 'Segoe UI Semibold', 26, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
  $fonteItem = New-Object System.Drawing.Font 'Segoe UI', 21, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)

  $branco = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $claro = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(235, 214, 228, 240))
  $suave = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(205, 160, 184, 205))
  $marcador = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, $brilho.R, $brilho.G, $brilho.B))

  $x = 72
  $y = 108
  $g.DrawString($app.Nome, $fonteNome, $branco, $x, $y)
  $y += 64
  $g.DrawString($app.Chamada, $fonteChamada, $claro, $x, $y)
  $y += 58
  foreach ($item in $app.Itens) {
    $g.FillEllipse($marcador, $x + 3, $y + 10, 8, 8)
    $g.DrawString($item, $fonteItem, $suave, $x + 22, $y)
    $y += 36
  }

  foreach ($d in @($fonteNome, $fonteChamada, $fonteItem, $branco, $claro, $suave, $marcador)) { $d.Dispose() }
  $g.Dispose()

  $arquivo = Join-Path $saida ("{0}-destaque-1024x500.png" -f $app.Id)
  $tela.Save($arquivo, [System.Drawing.Imaging.ImageFormat]::Png)
  $tela.Dispose()
  Write-Host ("  destaque 1024x500 {0}" -f (Split-Path $arquivo -Leaf))
}

foreach ($i in $iconesGerados.Values) { $i.Dispose() }
$base.Dispose()

Write-Host ''
Write-Host 'Conferindo o que foi gravado:'
Get-ChildItem $saida -Filter *.png | ForEach-Object {
  $img = [System.Drawing.Image]::FromFile($_.FullName)
  Write-Host ("  {0,-40} {1,4}x{2,-4} {3,8:N0} bytes  {4}" -f $_.Name, $img.Width, $img.Height, $_.Length, $img.PixelFormat)
  $img.Dispose()
}
