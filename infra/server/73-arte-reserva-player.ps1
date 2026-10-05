# Gera o criativo institucional de reserva do player e escreve o manifesto de reserva.
#
# Por que existe: `playback-engine.service.ts` sempre teve o caminho de reserva
# (`loadFactoryFallback` -> `factoryUrls` -> `{ kind: 'factory' }`), mas
# `public/factory-default-ads/manifest.json` estava `{"urls": []}`. Com a lista vazia,
# `takeNextAd()` devolve `null` quando o manifesto do servidor vem sem itens — e manifesto
# vazio e situacao **normal**, nao excepcional: acontece quando o orcamento diario de todas
# as campanhas se esgota, quando a janela contratada termina, ou quando a segmentacao
# geografica nao casa com a posicao do veiculo.
#
# O resultado era tela preta num painel dentro de um carro em circulacao, com `sync.ok` no
# log e nenhum erro em lugar nenhum.
#
# Conteudo institucional e a resposta certa porque nao fatura e nao gera repasse: o item de
# reserva nao tem `campaignId`, entao nenhum play record e gravado
# (`recordManifestPlayCommitted` so trata `kind: 'manifest'`) e ninguem e cobrado. A tela
# nunca fica preta.
#
# 1920x1080 para casar com a Activity travada em paisagem e com `object-fit: cover`.

param(
  [string] $Destino = 'd:\Projetos\openad\app\openad-ad-client\public\factory-default-ads'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $Destino)) {
  New-Item -ItemType Directory -Path $Destino -Force | Out-Null
}

$largura = 1920
$altura = 1080

$bmp = New-Object System.Drawing.Bitmap($largura, $altura)
$g = [System.Drawing.Graphics]::FromImage($bmp)

try {
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  # Gradiente diagonal escuro: legivel com brilho baixo e sem cansar quem esta no carro.
  $area = New-Object System.Drawing.Rectangle(0, 0, $largura, $altura)
  $fundo = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $area,
    [System.Drawing.Color]::FromArgb(12, 18, 32),
    [System.Drawing.Color]::FromArgb(26, 46, 80),
    45.0)
  $g.FillRectangle($fundo, $area)
  $fundo.Dispose()

  # Faixa de acento na base, para a tela nao parecer falha de renderizacao.
  $acento = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(72, 148, 255))
  $g.FillRectangle($acento, 0, $altura - 14, $largura, 14)
  $acento.Dispose()

  $branco = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $claro = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(176, 200, 232))

  $fonteTitulo = New-Object System.Drawing.Font('Segoe UI', 132, [System.Drawing.FontStyle]::Bold)
  $fonteSub = New-Object System.Drawing.Font('Segoe UI', 46, [System.Drawing.FontStyle]::Regular)

  # Centraliza medindo o texto, em vez de passar um `RectangleF` com `StringFormat`: o
  # PowerShell interpreta a lista de argumentos de `New-Object ... (a, b, c, d)` como um
  # unico array, e a aritmetica dentro dela falha com `op_Subtraction`.
  $titulo = 'OpenDriver'
  $sub = 'Anuncie aqui  -  opendriver.com.br'

  $medTitulo = $g.MeasureString($titulo, $fonteTitulo)
  $medSub = $g.MeasureString($sub, $fonteSub)

  $xTitulo = ($largura - $medTitulo.Width) / 2
  $yTitulo = ($altura / 2) - $medTitulo.Height - 10
  $xSub = ($largura - $medSub.Width) / 2
  $ySub = ($altura / 2) + 40

  $g.DrawString($titulo, $fonteTitulo, $branco, [single]$xTitulo, [single]$yTitulo)
  $g.DrawString($sub, $fonteSub, $claro, [single]$xSub, [single]$ySub)

  $fonteTitulo.Dispose()
  $fonteSub.Dispose()
  $branco.Dispose()
  $claro.Dispose()

  $arquivo = Join-Path $Destino 'institucional-1920x1080.jpg'
  $bmp.Save($arquivo, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  Write-Output ("imagem: {0}  ({1:N0} KB)" -f $arquivo, ((Get-Item $arquivo).Length / 1KB))
}
finally {
  $g.Dispose()
  $bmp.Dispose()
}

# O caminho e relativo a raiz servida pela WebView (`https://localhost/`), que e o `webDir`
# do Capacitor — `public/` e copiado para a raiz do bundle. Nao usar caminho absoluto de
# disco: a WebView nao alcanca `file://` sem `convertFileSrc`.
$manifesto = @{ urls = @('/factory-default-ads/institucional-1920x1080.jpg') }
$json = $manifesto | ConvertTo-Json -Compress
Set-Content -Path (Join-Path $Destino 'manifest.json') -Value $json -Encoding UTF8 -NoNewline
Write-Output ("manifesto: {0}" -f $json)
