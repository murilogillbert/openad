# Confere, por SHA-256, se os arquivos de migration que estão na VPS são **byte a byte** os
# mesmos dos três repositórios.
#
# Motivo: o padrão antigo de transferência fazia `scp` seguido de
# `ssh 'sed -i "s/\r$//" arquivo'` para normalizar fim de linha. O PowerShell remove a barra
# invertida ao montar a linha de comando de um executável nativo, então o servidor recebia
# `s/r$//` — que apaga o **`r` final de cada linha**. O defeito foi descoberto porque
# `redis-server` virou `redis-serve` no `docker-compose.prod.yml` e o Redis entrou em laço de
# reinício.
#
# A mesma transferência foi usada para os SQL de migration que já foram aplicados ao banco de
# produção compartilhado pelos três serviços. Se algum deles chegou alterado, o schema em
# produção não é o que o repositório descreve — e a diferença seria em identificador ou
# palavra terminada em `r` (`VARCHAR`, `ALTER`, `USER`, `driver`, `order`...), ou seja,
# provavelmente um erro de sintaxe, mas não necessariamente.
#
# Este script não conserta nada: ele responde "idêntico" ou "diferente, nestes arquivos".
# Conferir é barato; supor que passou porque a migration não deu erro, não é.

param([string] $Host_ = 'opendriver')

$ErrorActionPreference = 'Stop'

$mapa = @(
  @{ Nome = 'hub';        Remoto = '/root/openad-infra/prisma/hub';        Local = 'd:\Projetos\hub\backend\prisma' },
  @{ Nome = 'opendriver'; Remoto = '/root/openad-infra/prisma/opendriver'; Local = 'd:\Projetos\opendriver\backend\prisma' },
  @{ Nome = 'openad';     Remoto = '/root/openad-infra/prisma/openad';     Local = 'd:\Projetos\openad\app\openad-api\prisma' }
)

$divergentes = @()
$conferidos = 0
$ausentes = @()

foreach ($m in $mapa) {
  Write-Output ''
  Write-Output "===== $($m.Nome)"

  # `sha256sum` em uma única invocação por repositório: uma chamada ssh por arquivo custaria
  # minutos para dezenas de migrations.
  $saida = ssh $Host_ "cd '$($m.Remoto)' && find . -type f | sort | xargs sha256sum"
  if ($LASTEXITCODE -ne 0) { throw "falha ao listar $($m.Remoto)" }

  foreach ($linha in $saida) {
    if ([string]::IsNullOrWhiteSpace($linha)) { continue }
    $partes = $linha -split '\s+', 2
    $hashRemoto = $partes[0].ToLower()
    $rel = $partes[1].Trim() -replace '^\./', ''

    $caminhoLocal = Join-Path $m.Local ($rel -replace '/', '\')
    if (-not (Test-Path $caminhoLocal)) {
      $ausentes += "$($m.Nome): $rel (nao existe em $($m.Local))"
      continue
    }

    $hashLocal = (Get-FileHash -Algorithm SHA256 -Path $caminhoLocal).Hash.ToLower()
    $conferidos++

    if ($hashLocal -ne $hashRemoto) {
      $divergentes += "$($m.Nome): $rel`n    local  $hashLocal`n    remoto $hashRemoto"
      Write-Output "  DIFERENTE  $rel"
    }
  }
  Write-Output "  (conferidos ate aqui: $conferidos)"
}

Write-Output ''
Write-Output "===== resultado: $conferidos arquivos conferidos"

if ($ausentes.Count -gt 0) {
  Write-Output ''
  Write-Output "--- presentes na VPS e ausentes no repositorio ($($ausentes.Count)):"
  $ausentes | ForEach-Object { Write-Output "  $_" }
}

if ($divergentes.Count -eq 0) {
  Write-Output ''
  Write-Output 'NENHUMA divergencia: o SQL aplicado em producao e o do repositorio.'
  exit 0
}

Write-Output ''
Write-Output "--- DIVERGENTES ($($divergentes.Count)):"
$divergentes | ForEach-Object { Write-Output "  $_" }
exit 1
