#!/usr/bin/env bash
#
# Lista as aplicacoes do Coolify com o commit que cada container esta rodando.
#
# Serve para responder uma pergunta que ja custou caro neste projeto: o que esta no ar e o
# mesmo que esta no `main`? Empurrar para o git nao e suficiente aqui — o deploy por webhook
# nao funciona, e ja aconteceu de producao ficar commits atras sem ninguem perceber.
#
# O commit vem da **imagem do container**, nao do registro do Coolify: o registro diz o que
# foi pedido, a imagem diz o que esta executando. Quando divergem, e a imagem que importa.
set -uo pipefail

printf '%-26s %-22s %-18s %s\n' UUID NOME ESTADO FQDN
docker exec coolify-db psql -U coolify -d coolify -At -F '|' -c \
  'select uuid, name, status, coalesce(fqdn, $$-$$) from applications order by name' |
  while IFS='|' read -r uuid nome estado fqdn; do
    printf '%-26s %-22s %-18s %s\n' "$uuid" "$nome" "$estado" "$fqdn"
    # O nome do container e `<uuid>-<sufixo>`; a tag da imagem traz o SHA do commit.
    docker ps --filter "name=$uuid" --format '{{.Names}}|{{.Image}}|{{.Status}}' |
      while IFS='|' read -r cnome imagem cstatus; do
        printf '    %-40s %s\n' "$cstatus" "${imagem##*:}"
      done
  done
