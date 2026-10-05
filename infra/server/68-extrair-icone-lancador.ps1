# Extrai do APK, pelo NOME do recurso, as camadas do icone do lancador.
#
# Por que pelo nome: o encolhimento de recursos do Gradle renomeia os arquivos dentro de
# `res/` (`ic_launcher_foreground` virou `res/iE.webp`), entao nao da para achar pelo caminho.
# E escolher "a imagem quadrada de 432 px" tambem nao serve: a arte da tela de abertura tem
# exatamente esse tamanho, e foi o que eu extraí por engano antes, concluindo que o icone nao
# havia trocado quando na verdade eu estava olhando outra imagem.
#
# `aapt2 dump resources` lista `mipmap/ic_launcher*` com o arquivo real de cada densidade. E
# a unica fonte confiavel.
#
# Uso:  .\68-extrair-icone-lancador.ps1 -Apk '...\app-release.apk' -Saida 'd:\...\icones'

param(
  [Parameter(Mandatory = $true)] [string] $Apk,
  [Parameter(Mandatory = $true)] [string] $Saida,
  [string] $Sdk = 'D:\dev\android-sdk'
)

$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (-not (Test-Path $Apk)) { throw "APK nao encontrado: $Apk" }

$aapt2 = Get-ChildItem (Join-Path $Sdk 'build-tools') -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending |
  ForEach-Object { Join-Path $_.FullName 'aapt2.exe' } |
  Where-Object { Test-Path $_ } |
  Select-Object -First 1
if (-not $aapt2) { throw "aapt2 nao encontrado em $Sdk\build-tools" }

$nome = [IO.Path]::GetFileNameWithoutExtension($Apk)
$pasta = Join-Path $Saida $nome
New-Item -ItemType Directory -Path $pasta -Force | Out-Null

$badging = & $aapt2 dump badging $Apk 2>&1 | Out-String
if ($badging -match "package: name='([^']+)' versionCode='(\d+)'") {
  Write-Host ("{0}  versionCode {1}" -f $Matches[1], $Matches[2])
}

# Mapa recurso -> arquivo, por densidade. Guarda a ultima (maior) densidade de cada recurso.
$dump = (& $aapt2 dump resources $Apk 2>&1 | Out-String) -split "`r?`n"
$mapa = @{}
$atual = $null
foreach ($linha in $dump) {
  $t = $linha.Trim()
  if ($t -match '^resource 0x[0-9a-f]+ (mipmap/ic_launcher[a-z_]*)$') {
    $atual = $Matches[1]
    continue
  }
  if ($t -match '^resource 0x') { $atual = $null; continue }
  if ($atual -and $t -match '\(file\) (res/\S+)$') {
    $mapa[$atual] = $Matches[1]
  }
}

if ($mapa.Count -eq 0) { throw 'nenhum recurso mipmap/ic_launcher* encontrado no APK' }

$zip = [IO.Compression.ZipFile]::OpenRead($Apk)
try {
  foreach ($recurso in ($mapa.Keys | Sort-Object)) {
    $caminho = $mapa[$recurso]
    $entrada = $zip.Entries | Where-Object { $_.FullName -eq $caminho } | Select-Object -First 1
    if (-not $entrada) {
      Write-Host ("  {0,-34} {1}  NAO ENCONTRADO no pacote" -f $recurso, $caminho)
      continue
    }
    $ext = [IO.Path]::GetExtension($caminho)
    $destino = Join-Path $pasta (($recurso -replace '[\\/]', '_') + $ext)
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entrada, $destino, $true)
    Write-Host ("  {0,-34} {1,-14} {2,7:N0} bytes" -f $recurso, $caminho, $entrada.Length)
    Write-Host ("      -> {0}" -f $destino)
  }
} finally {
  $zip.Dispose()
}
