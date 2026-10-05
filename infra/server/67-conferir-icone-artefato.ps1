# Extrai o icone de dentro do APK e mostra o que o lancador vai desenhar.
#
# Por que conferir no artefato e nao na pasta `assets`: entre a logo e a tela existem o
# `expo prebuild` (que gera `res/mipmap-*`), o merge de recursos do Gradle e o `adaptiveIcon`
# do `app.config.ts`. Trocar o arquivo em `assets/` e necessario, mas nao suficiente - se o
# `foregroundImage` apontasse para outro caminho, ou se o prebuild nao tivesse rodado, a pasta
# estaria certa e o APK errado. So abrindo o pacote se sabe.
#
# Uso:  .\67-conferir-icone-artefato.ps1 -Apk '...\app-release.apk' -Saida 'd:\tmp\icones'

param(
  [Parameter(Mandatory = $true)] [string] $Apk,
  [string] $Saida = (Join-Path $env:TEMP 'icones-apk'),
  [string] $Sdk = 'D:\dev\android-sdk'
)

$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (-not (Test-Path $Apk)) { throw "APK nao encontrado: $Apk" }

$aapt2 = Get-ChildItem (Join-Path $Sdk 'build-tools') -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending |
  ForEach-Object { Join-Path $_.FullName 'aapt2.exe' } |
  Where-Object { Test-Path $_ } |
  Select-Object -First 1

$nome = [IO.Path]::GetFileNameWithoutExtension($Apk)
$pasta = Join-Path $Saida $nome
New-Item -ItemType Directory -Path $pasta -Force | Out-Null

Write-Host ("apk: {0}" -f $Apk)
if ($aapt2) {
  $badging = & $aapt2 dump badging $Apk 2>&1 | Out-String
  if ($badging -match "package: name='([^']+)' versionCode='(\d+)'") {
    Write-Host ("  pacote {0}  versionCode {1}" -f $Matches[1], $Matches[2])
  }
  ($badging -split "`n") | Where-Object { $_ -match 'application-icon|application:' } |
    ForEach-Object { Write-Host ("  " + $_.Trim()) }
}

# Abre o pacote e tira as imagens de icone na maior densidade disponivel.
$zip = [IO.Compression.ZipFile]::OpenRead($Apk)
try {
  <#
    Nao procure por `ic_launcher`: o encolhimento de recursos do Gradle **renomeia** tudo
    dentro de `res/` para nomes curtos (o icone do aplicativo virou `res/BW.xml`). Procurar
    pelo nome original nao acha nada, e a primeira versao deste script concluiu "nenhum icone
    no pacote" num APK que tinha os icones certos.

    O caminho que funciona e pelo conteudo: imagens em `res/` com lado entre 96 e 1024 px. As
    camadas do icone adaptativo em xxxhdpi tem 432x432, e o icone legado 192x192.
  #>
  $alvos = $zip.Entries |
    Where-Object { $_.FullName -match '^res/.*\.(png|webp)$' -and $_.Length -gt 1000 } |
    Sort-Object Length -Descending |
    Select-Object -First 25

  Write-Host ''
  Write-Host 'icones no pacote:'
  foreach ($e in ($alvos | Sort-Object FullName)) {
    $arquivo = Join-Path $pasta ($e.FullName -replace '[\\/]', '_')
    [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $arquivo, $true)
    $dim = ''
    $lado = 0
    try {
      $img = [System.Drawing.Image]::FromFile($arquivo)
      $dim = "{0}x{1}" -f $img.Width, $img.Height
      $lado = [Math]::Max($img.Width, $img.Height)
      $img.Dispose()
    } catch {
      $dim = '(formato nao lido pelo GDI+)'
    }
    # Quadrado entre 96 e 1024: assinatura de icone, e nao de imagem de interface.
    $ehIcone = $lado -ge 96 -and $lado -le 1024
    if (-not $ehIcone) {
      Remove-Item $arquivo -Force -ErrorAction SilentlyContinue
      continue
    }
    Write-Host ("  {0,-34} {1,-12} {2,7:N0} bytes" -f $e.FullName, $dim, $e.Length)
    Write-Host ("      -> {0}" -f $arquivo)
  }

  # O XML do icone adaptativo diz quais camadas o lancador combina.
  $xml = $zip.Entries | Where-Object { $_.FullName -match '^res/mipmap-anydpi.*/ic_launcher\.xml$' } | Select-Object -First 1
  if ($xml) {
    Write-Host ''
    Write-Host ("icone adaptativo declarado em {0} (binario; camadas acima)" -f $xml.FullName)
  }
} finally {
  $zip.Dispose()
}

Write-Host ''
Write-Host ("extraidos em: {0}" -f $pasta)
