# Sincroniza os `schema.prisma` e as migrations dos tres repositorios para
# /root/openad-infra/prisma/{hub,opendriver,openad} na VPS.
#
# Por que existe: `10-migrations-producao.sh` roda `prisma migrate deploy` a partir
# daquela pasta. Se ela estiver atrasada, o deploy aplica menos do que se espera e o
# script termina dizendo "ok" sobre um banco que continua sem as tabelas novas — a
# falha mais silenciosa possivel neste caminho.
#
# Envia por `enviar.ps1`, que confere SHA-256 dos dois lados. Nao converte fim de linha.
#
# Uso:
#   .\infra\server\86-sincronizar-prisma.ps1              # envia o que falta
#   .\infra\server\86-sincronizar-prisma.ps1 -Conferir    # so lista a diferenca

param(
  [switch] $Conferir,
  [string] $Host_ = 'opendriver'
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$repos = @(
  @{ nome = 'hub';        local = 'D:\Projetos\hub\backend\prisma' }
  @{ nome = 'opendriver'; local = 'D:\Projetos\opendriver\backend\prisma' }
  @{ nome = 'openad';     local = 'D:\Projetos\openad\app\openad-api\prisma' }
)

$pares = @{}
$pendentes = @()

foreach ($r in $repos) {
  $nome = $r.nome
  $dir = $r.local
  if (-not (Test-Path $dir)) { throw "pasta prisma nao existe: $dir" }

  $remotoBase = "/root/openad-infra/prisma/$nome"

  # Quais migrations o servidor ja tem na pasta de trabalho.
  $jaLa = (ssh $Host_ "ls '$remotoBase/migrations' 2>/dev/null") -split "`n" |
    ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -ne 'migration_lock.toml' }

  $locais = Get-ChildItem (Join-Path $dir 'migrations') -Directory | Select-Object -ExpandProperty Name

  $faltando = $locais | Where-Object { $jaLa -notcontains $_ }

  Write-Output ("{0,-11} local={1}  no servidor={2}  faltando={3}" -f $nome, $locais.Count, $jaLa.Count, $faltando.Count)
  foreach ($f in $faltando) { Write-Output "              + $f" }

  # O schema vai sempre: `migrate deploy` compara o historico com a pasta, e um schema
  # atrasado nao impede o deploy, mas deixa a pasta mentindo sobre o que esta no banco.
  $pares[(Join-Path $dir 'schema.prisma')] = "$remotoBase/schema.prisma"

  $lock = Join-Path $dir 'migrations\migration_lock.toml'
  if (Test-Path $lock) { $pares[$lock] = "$remotoBase/migrations/migration_lock.toml" }

  foreach ($f in $faltando) {
    $sql = Join-Path $dir "migrations\$f\migration.sql"
    if (-not (Test-Path $sql)) { throw "migration sem migration.sql: $f" }
    $pares[$sql] = "$remotoBase/migrations/$f/migration.sql"
    $pendentes += "$nome/$f"
  }
}

if ($Conferir) {
  Write-Output ''
  Write-Output "a enviar: $($pendentes.Count) migration(s)"
  exit 0
}

Write-Output ''
Write-Output '--- enviando ---'
& (Join-Path $PSScriptRoot 'enviar.ps1') -Pares $pares -Host_ $Host_

Write-Output ''
Write-Output '--- conferencia no servidor ---'
foreach ($r in $repos) {
  $n = $r.nome
  Write-Output "$n :"
  ssh $Host_ "ls '/root/openad-infra/prisma/$n/migrations' | tail -5"
}
