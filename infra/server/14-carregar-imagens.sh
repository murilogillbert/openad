#!/usr/bin/env bash
# Carrega as imagens transferidas e confirma que chegaram.
#
# As imagens sao construidas na maquina de desenvolvimento e transferidas, **nao** construidas
# aqui. O build do portal Angular passa de 2 GB de heap em pico; nesta VPS, com 2 vCPU e
# ~4,1 GB livres, isso convida o OOM killer — e ele escolhe o processo maior, que e o
# **Postgres compartilhado pelos tres servicos**. Compilar aqui seria arriscar producao para
# economizar uma transferencia de 212 MB.
set -uo pipefail
TAR="${1:-/root/openad-imagens.tar}"

if [ -f "$TAR" ]; then
  echo "--- carregando $TAR"
  docker load -i "$TAR"
  rm -f "$TAR"
else
  echo "--- $TAR nao existe; so conferindo o que ja esta carregado"
fi

echo ''
echo '=== imagens do openad presentes ==='
docker images --format '{{.Repository}}:{{.Tag}} | {{.Size}} | {{.CreatedSince}}' \
  | grep -E '^openad-' || echo 'NENHUMA imagem do openad encontrada'
