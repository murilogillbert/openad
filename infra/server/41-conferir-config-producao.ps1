# Confere a configuracao resolvida da variante `production` dos tres apps.
#
# Por que existe: a conferencia do AAB procura o dominio esperado em texto puro dentro do
# arquivo, e o AAB e comprimido -- o literal costuma nao aparecer. Isso deixava um "nao
# localizei" em toda execucao, que e pior que nenhuma conferencia: ensina a ignorar o aviso.
#
# `expo config --type public` resolve `app.config.ts` com as mesmas variaveis de ambiente do
# build e imprime o que vai para `extra`. E a mesma fonte que o app le em tempo de execucao
# (`Constants.expoConfig.extra`), entao conferir aqui prova a URL embutida sem precisar
# descomprimir bytecode.
#
# Tambem confere o que mais importa e nao se ve no manifesto: pacote sem sufixo `.preview` e
# ausencia de `10.0.2.2` (host do emulador) nas URLs.

$ErrorActionPreference = 'Continue'

$apps = @(
  @{
    Nome = 'OpenDriver'
    Raiz = 'd:\Projetos\opendriver\mobile'
    Pacote = 'br.com.opendriver.app'
    Env = @{
      APP_VARIANT               = 'production'
      EXPO_PUBLIC_API_URL       = 'https://api-app.opendriver.com.br'
      EXPO_PUBLIC_HUB_URL       = 'https://opendriver.com.br'
      EXPO_PUBLIC_MAP_STYLE_URL = 'https://tiles.opendriver.com.br/style.json'
    }
  },
  @{
    Nome = 'OpenDriver HUB'
    Raiz = 'd:\Projetos\hub-mobile'
    Pacote = 'br.com.opendriverhub.app'
    Env = @{
      APP_VARIANT         = 'production'
      EXPO_PUBLIC_API_URL = 'https://hubapi.opendriver.com.br'
      EXPO_PUBLIC_WEB_URL = 'https://hub.opendriver.com.br'
    }
  },
  @{
    Nome = 'OpenDriver AD'
    Raiz = 'd:\Projetos\openad\app\openad-advertiser'
    Pacote = 'br.com.opendriver.ads'
    Env = @{
      APP_VARIANT             = 'production'
      EXPO_PUBLIC_HUB_API_URL = 'https://hubapi.opendriver.com.br'
      EXPO_PUBLIC_ADS_API_URL = 'https://adsapi.opendriver.com.br'
      EXPO_PUBLIC_HUB_WEB_URL = 'https://hub.opendriver.com.br'
    }
  }
)

$falhas = 0

foreach ($a in $apps) {
  Write-Output ''
  Write-Output ('=== ' + $a.Nome)

  if (-not (Test-Path $a.Raiz)) { Write-Output '  pasta nao existe'; $falhas++; continue }

  foreach ($k in $a.Env.Keys) { Set-Item -Path "env:$k" -Value $a.Env[$k] }

  Push-Location $a.Raiz
  try {
    $saida = npx expo config --type public --json 2>&1 | Out-String
    # `expo config` imprime avisos antes do JSON; corta no primeiro `{`.
    $i = $saida.IndexOf('{')
    if ($i -lt 0) { Write-Output "  FALHA expo config nao devolveu JSON"; $falhas++; continue }

    $cfg = $saida.Substring($i) | ConvertFrom-Json

    $pacote = $cfg.android.package
    if ($pacote -eq $a.Pacote) {
      Write-Output "  ok    package $pacote"
    } else {
      Write-Output "  FALHA package $pacote (esperado $($a.Pacote))"
      $falhas++
    }

    $ios = $cfg.ios.bundleIdentifier
    if ($ios -eq $a.Pacote) {
      Write-Output "  ok    bundleIdentifier $ios"
    } else {
      Write-Output "  AVISO bundleIdentifier $ios difere do package"
    }

    Write-Output "  ok    versao $($cfg.version)"

    # As URLs que o app vai usar em producao, lidas de `extra`.
    $extra = $cfg.extra
    foreach ($prop in $extra.PSObject.Properties) {
      if ($prop.Value -isnot [string]) { continue }
      if ($prop.Value -notmatch '^https?://') { continue }

      $valor = $prop.Value
      if ($valor -match '^http://') {
        Write-Output "  FALHA $($prop.Name) usa http: $valor"
        $falhas++
      } elseif ($valor -match '10\.0\.2\.2|localhost|127\.0\.0\.1') {
        Write-Output "  FALHA $($prop.Name) aponta para a maquina local: $valor"
        $falhas++
      } else {
        Write-Output "  ok    $($prop.Name) = $valor"
      }
    }

    if ($extra.variant -ne 'production') {
      Write-Output "  FALHA variant = $($extra.variant) (esperado production)"
      $falhas++
    }
  } finally {
    Pop-Location
  }
}

Write-Output ''
if ($falhas -eq 0) {
  Write-Output 'Os tres apps resolvem para producao, em https, com o pacote certo.'
  exit 0
}
Write-Output "$falhas problema(s) de configuracao. NAO suba estes AABs."
exit 1
