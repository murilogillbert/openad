# Captura a tela do tablet e reduz a imagem.
#
# Por que reduzir: o `screencap -p` do TL10 sai com ~8 MB (2000x1200 sem perda), e esse
# tamanho estoura o limite de leitura de imagem das ferramentas. Reduzir pela metade mantem
# texto legivel e derruba o arquivo para algumas centenas de kB.
#
# Uso:
#   .\infra\server\87-tela-tablet.ps1 -Saida tela.png
#   .\infra\server\87-tela-tablet.ps1 -Pacote br.com.opendriverhub.app.preview -Espera 15 -Saida tela.png

param(
  [string] $Saida = 'tela.png',
  [string] $Pacote = '',
  [int] $Espera = 12,
  [double] $Escala = 0.5,
  [string] $Serial = '4AH47852E',
  [string] $Adb = 'D:\dev\android-sdk\platform-tools\adb.exe'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $Adb)) { throw "adb nao encontrado em $Adb" }

if ($Pacote) {
  & $Adb -s $Serial shell "am force-stop $Pacote" 2>&1 | Out-Null
  Start-Sleep -Seconds 1

  # `am start` com a atividade resolvida, nao `monkey`.
  #
  # O `monkey` escreve em stderr mesmo quando funciona ("args: [...]"), e o PowerShell trata
  # stderr de executavel nativo como erro — com `$ErrorActionPreference = 'Stop'` isso aborta
  # o script no meio de uma captura que teria dado certo. E `cmd package resolve-activity`
  # dispensa a gente saber o nome da atividade.
  $alvo = (& $Adb -s $Serial shell "cmd package resolve-activity --brief $Pacote" 2>&1 |
    Where-Object { $_ -match "^$([regex]::Escape($Pacote))/" } | Select-Object -First 1)
  if (-not $alvo) { throw "nao consegui resolver a atividade de $Pacote" }
  & $Adb -s $Serial shell "am start -W -n $($alvo.Trim())" 2>&1 | Out-Null

  Write-Output "iniciado $alvo; esperando $Espera s"
  Start-Sleep -Seconds $Espera
}

$bruta = [System.IO.Path]::GetTempFileName() + '.png'
# `exec-out` sem redirecionamento do PowerShell: `>` do PowerShell corrompe binario em
# algumas versoes por inserir conversao de texto. Aqui a saida vai por byte.
$proc = Start-Process -FilePath $Adb -ArgumentList @('-s', $Serial, 'exec-out', 'screencap', '-p') `
  -NoNewWindow -Wait -RedirectStandardOutput $bruta -PassThru
if ($proc.ExitCode -ne 0) { throw "screencap falhou (exit $($proc.ExitCode))" }

$img = [System.Drawing.Image]::FromFile($bruta)
try {
  $l = [int]($img.Width * $Escala)
  $a = [int]($img.Height * $Escala)
  $bmp = New-Object System.Drawing.Bitmap $l, $a
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, 0, 0, $l, $a)
  $g.Dispose()
  $bmp.Save($Saida, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ("ok  {0}  {1}x{2}  {3:N0} bytes" -f $Saida, $l, $a, (Get-Item $Saida).Length)
} finally {
  $img.Dispose()
  Remove-Item $bruta -ErrorAction SilentlyContinue
}
