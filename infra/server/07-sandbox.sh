#!/usr/bin/env bash
#
# Sobe um Postgres **separado** com uma copia restaurada do banco de producao.
#
# Para que serve: ensaiar migration, testar o bootstrap do schema `openad`, rodar
# `prisma migrate deploy` e comparar `pg_dump` antes/depois — tudo sem tocar no banco que as
# aplicacoes usam. Se algo der errado aqui, o custo e derrubar um container.
#
# Por que isso nao e preciosismo: o `prisma migrate diff --shadow-database-url` **reseta** o
# banco que recebe. Apontado para um banco real, apaga. Ja aconteceu no desenvolvimento deste
# projeto. O sandbox e o alvo seguro para esse tipo de comando.
#
# O container:
#   nome   openad-pg-sandbox
#   imagem postgres:16-alpine (mesma minor do de producao: 16.15)
#   porta  **nenhuma publicada** — so a rede interna do Docker. Postgres exposto na internet
#          com senha simples e comprometido em horas.
#   rede   a mesma do Postgres de producao, para que ferramentas em container o alcancem.
#
# Uso:  bash 07-sandbox.sh [caminho-do-backup]
#       bash 07-sandbox.sh                      # usa /root/backups/ULTIMO
set -euo pipefail

PG_PROD="${PG_PROD:-l5bcr9slmgtmeefkqwg5amia}"
SANDBOX='openad-pg-sandbox'
SANDBOX_PASS="${SANDBOX_PASS:-sandbox-nao-exposto}"
BACKUP_DIR="${1:-$(cat /root/backups/ULTIMO)}"

if [ ! -f "$BACKUP_DIR/hub.dump" ]; then
  echo "ABORTADO: nao encontrei $BACKUP_DIR/hub.dump" >&2
  exit 1
fi
echo "=== restaurando de $BACKUP_DIR ==="

# A rede do Postgres de producao. O sandbox entra nela para ser alcancavel por container de
# ferramenta, sem publicar porta no host.
REDE=$(docker inspect "$PG_PROD" \
  --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' | head -1)
echo "rede: ${REDE:-(nenhuma, usando bridge)}"

# Recria do zero: sandbox com estado acumulado de um ensaio anterior nao serve para ensaiar
# o proximo.
if docker ps -a --format '{{.Names}}' | grep -qx "$SANDBOX"; then
  echo '--- removendo sandbox anterior'
  docker rm -f "$SANDBOX" >/dev/null
fi
docker volume rm -f openad-pg-sandbox-data >/dev/null 2>&1 || true

echo '--- subindo o container'
docker run -d \
  --name "$SANDBOX" \
  --restart unless-stopped \
  ${REDE:+--network "$REDE"} \
  -e POSTGRES_PASSWORD="$SANDBOX_PASS" \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=postgres \
  -v openad-pg-sandbox-data:/var/lib/postgresql/data \
  postgres:16-alpine >/dev/null

echo '--- esperando aceitar conexao'
for i in $(seq 1 60); do
  if docker exec "$SANDBOX" pg_isready -U postgres -q 2>/dev/null; then
    echo "pronto em ${i}s"
    break
  fi
  sleep 1
  if [ "$i" -eq 60 ]; then
    echo 'ABORTADO: o sandbox nao ficou pronto em 60s' >&2
    docker logs --tail 30 "$SANDBOX" >&2
    exit 1
  fi
done

echo '--- restaurando roles do cluster'
# Antes do banco: os objetos tem dono, e sem o role o restore emite erro em cada GRANT.
docker cp "$BACKUP_DIR/globals.sql" "$SANDBOX:/tmp/globals.sql" >/dev/null
docker exec "$SANDBOX" psql -U postgres -q -f /tmp/globals.sql >/dev/null 2>&1 || true

echo '--- criando o banco hub'
docker exec "$SANDBOX" psql -U postgres -q -c 'DROP DATABASE IF EXISTS hub' >/dev/null
docker exec "$SANDBOX" psql -U postgres -q -c 'CREATE DATABASE hub' >/dev/null

echo '--- restaurando dados'
docker cp "$BACKUP_DIR/hub.dump" "$SANDBOX:/tmp/hub.dump" >/dev/null
# `--no-owner --no-privileges`: o sandbox nao precisa reproduzir a matriz de permissoes, e
# tentar faz o restore gritar sobre role que nao existe. `--single-transaction` garante tudo
# ou nada, para nao ficar um sandbox meio restaurado parecendo bom.
docker exec "$SANDBOX" pg_restore -U postgres -d hub \
  --no-owner --no-privileges --single-transaction /tmp/hub.dump 2>&1 \
  | grep -vE 'already exists|does not exist' || true

echo ''
echo '=== conferencia: producao x sandbox ==='
contar() {
  docker exec "$1" psql -U postgres -d hub -At -c "$2" 2>/dev/null | tr -d '[:space:]'
}

ok=1
for par in \
  'public.users|SELECT count(*) FROM public.users' \
  'public.cashback_entries|SELECT count(*) FROM public.cashback_entries' \
  'public.integration_settings|SELECT count(*) FROM public.integration_settings' \
  'opendriver.rides|SELECT count(*) FROM opendriver.rides' \
  'opendriver.driver_earnings|SELECT count(*) FROM opendriver.driver_earnings' \
  'migrations public|SELECT count(*) FROM public._prisma_migrations' \
  'migrations opendriver|SELECT count(*) FROM opendriver._prisma_migrations' \
; do
  rotulo="${par%%|*}"
  sql="${par#*|}"
  a=$(contar "$PG_PROD" "$sql")
  b=$(contar "$SANDBOX" "$sql")
  if [ "$a" = "$b" ]; then
    printf '  OK      %-28s prod=%s sandbox=%s\n' "$rotulo" "$a" "$b"
  else
    printf '  DIVERGE %-28s prod=%s sandbox=%s\n' "$rotulo" "$a" "$b"
    ok=0
  fi
done

echo ''
if [ "$ok" = 1 ]; then
  echo "RESULTADO: sandbox fiel a producao. Container: $SANDBOX (sem porta publicada)"
  echo "Acesso:    docker exec -it $SANDBOX psql -U postgres -d hub"
else
  echo 'RESULTADO: houve divergencia — nao use este sandbox como referencia' >&2
  exit 1
fi
