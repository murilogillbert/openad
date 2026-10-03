# Transferência verificada de arquivo para a VPS.
#
# Existe por causa de um defeito que custou um serviço fora do ar: o padrão anterior era
# `scp` seguido de `ssh opendriver 'sed -i "s/\r$//" arquivo'` para normalizar fim de linha.
# O PowerShell **remove a barra invertida** ao montar a linha de comando de um executável
# nativo, então o servidor recebia `s/r$//` — uma expressão que apaga o `r` final de toda
# linha. Foi assim que `redis-server` virou `redis-serve` no `docker-compose.prod.yml`, e o
# Redis entrou em laço de reinício com `exec: redis-serve: not found`.
#
# Duas decisões decorrem disso:
#
# 1. **Nenhuma conversão de fim de linha.** Os arquivos deste repositório já estão em LF
#    (o `.gitattributes`/`core.autocrlf` do repo não os converte), e `scp` transfere bytes
#    verbatim. Converter era resolver um problema que não existia, com uma ferramenta que o
#    PowerShell não consegue invocar corretamente.
# 2. **Conferência por hash, não por "o scp não reclamou".** A corrupção acima passou pelo
#    `scp` sem erro nenhum: o arquivo chegou inteiro e **depois** foi estragado. Comparar o
#    SHA-256 dos dois lados é o que transforma "transferi" em "está idêntico".
#
# Uso:
#   .\infra\server\enviar.ps1 -Local docker-compose.prod.yml -Remoto /root/openad/docker-compose.prod.yml
#   .\infra\server\enviar.ps1 -Pares @{ 'infra/server/15-provisionar.sh' = '/root/openad-infra/15-provisionar.sh' }

param(
  [string] $Local,
  [string] $Remoto,
  [hashtable] $Pares,
  [string] $Host_ = 'opendriver'
)

$ErrorActionPreference = 'Stop'

function Enviar-Arquivo {
  param([string] $De, [string] $Para)

  if (-not (Test-Path $De)) { throw "arquivo local nao existe: $De" }

  $esperado = (Get-FileHash -Algorithm SHA256 -Path $De).Hash.ToLower()

  # A pasta de destino pode não existir ainda. `mkdir -p` sem barra invertida nenhuma.
  $pasta = ($Para -replace '/[^/]+$', '')
  ssh $Host_ "mkdir -p '$pasta'" | Out-Null

  scp $De "${Host_}:$Para" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "scp falhou para $Para" }

  $obtido = (ssh $Host_ "sha256sum '$Para' | cut -d' ' -f1").Trim()

  if ($obtido -ne $esperado) {
    throw "CONFERENCIA FALHOU em $Para`n  local  : $esperado`n  remoto : $obtido"
  }
  Write-Output "ok  $Para  ($esperado)"
}

if ($Pares) {
  foreach ($k in $Pares.Keys) { Enviar-Arquivo -De $k -Para $Pares[$k] }
} elseif ($Local -and $Remoto) {
  Enviar-Arquivo -De $Local -Para $Remoto
} else {
  throw 'informe -Local e -Remoto, ou -Pares'
}
