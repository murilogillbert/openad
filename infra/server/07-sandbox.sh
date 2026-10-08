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

# A senha do sandbox tem de ser reposta **depois** do restore dos globals.
#
# `pg_dumpall --globals-only` inclui `ALTER ROLE postgres WITH PASSWORD 'SCRAM-SHA-256$...'`
# — o hash da senha de **producao**. Restaurar isso troca a senha do sandbox pela de
# producao, e qualquer ferramenta que use `SANDBOX_PASS` passa a receber
# `P1000: Authentication failed`. Levou uma execucao do ensaio para aparecer, porque
# `docker exec psql` autentica por socket local (`trust`) e nao sente a troca; so a conexao
# TCP de outro container sente.
docker exec "$SANDBOX" psql -U postgres -q -c \
  "ALTER ROLE postgres WITH PASSWORD '$SANDBOX_PASS'" >/dev/null

echo '--- criando o banco hub'
# `client_min_messages=warning` cala o NOTICE "database hub does not exist, skipping" do
# `IF EXISTS`. Ele sai em stderr, e stderr neste caminho e lido por quem roda o script de
# fora: um aviso benigno ali faz a execucao parecer ter falhado.
#
# Vai por `PGOPTIONS`, nao por `--set`: `--set` define variavel do **psql**, nao parametro do
# servidor, e o NOTICE continuava saindo. E nao por um segundo `-c "SET ..."` porque psql
# agrupa varios `-c` numa transacao implicita, e `DROP DATABASE` nao roda em transacao.
docker exec -e PGOPTIONS='-c client_min_messages=warning' "$SANDBOX" \
  psql -U postgres -q -c 'DROP DATABASE IF EXISTS hub' >/dev/null
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
#
# O que esta conferencia pode e nao pode afirmar.
#
# O sandbox e a restauracao de um dump tirado num instante. Producao continua escrevendo
# depois desse instante — `driver_earnings` recebe linha a cada repasse de receita de
# anuncio, que roda em cron. Exigir igualdade em tabela sob escrita faz o script acusar
# divergencia em toda execucao, e um alerta que sempre dispara e um alerta que ninguem le.
#
# Entao cada tabela declara o que se espera dela nesta janela:
#
#   exato   a tabela nao deveria mudar entre o dump e agora. Diferenca de qualquer sinal e
#           problema: ou o dump saiu incompleto, ou o restore perdeu linha.
#   cresce  a tabela recebe insercao continua. Aceita-se sandbox MENOR que producao, porque
#           e exatamente o que o tempo entre o dump e agora produz. Sandbox MAIOR, nao:
#           nao ha como a copia ter mais linha que a origem, e isso indicaria restore sobre
#           um banco que nao estava vazio.
contar() {
  docker exec "$1" psql -U postgres -d hub -At -c "$2" 2>/dev/null | tr -d '[:space:]'
}

ok=1
for par in \
  'public.users|exato|SELECT count(*) FROM public.users' \
  'public.integration_settings|exato|SELECT count(*) FROM public.integration_settings' \
  'migrations public|exato|SELECT count(*) FROM public._prisma_migrations' \
  'migrations opendriver|exato|SELECT count(*) FROM opendriver._prisma_migrations' \
  'public.cashback_entries|cresce|SELECT count(*) FROM public.cashback_entries' \
  'opendriver.rides|cresce|SELECT count(*) FROM opendriver.rides' \
  'opendriver.driver_earnings|cresce|SELECT count(*) FROM opendriver.driver_earnings' \
; do
  rotulo="${par%%|*}"
  resto="${par#*|}"
  regra="${resto%%|*}"
  sql="${resto#*|}"
  a=$(contar "$PG_PROD" "$sql")
  b=$(contar "$SANDBOX" "$sql")

  if [ -z "$a" ] || [ -z "$b" ]; then
    printf '  ERRO    %-28s nao consegui contar (prod=%s sandbox=%s)\n' "$rotulo" "${a:-?}" "${b:-?}"
    ok=0
    continue
  fi

  if [ "$a" = "$b" ]; then
    printf '  OK      %-28s prod=%s sandbox=%s\n' "$rotulo" "$a" "$b"
  elif [ "$regra" = 'cresce' ] && [ "$b" -lt "$a" ]; then
    printf '  OK      %-28s prod=%s sandbox=%s (+%s escritas apos o dump)\n' \
      "$rotulo" "$a" "$b" "$((a - b))"
  else
    printf '  DIVERGE %-28s prod=%s sandbox=%s  [regra=%s]\n' "$rotulo" "$a" "$b" "$regra"
    ok=0
  fi
done

echo ''
if [ "$ok" = 1 ]; then
  echo "RESULTADO: sandbox fiel ao dump. Container: $SANDBOX (sem porta publicada)"
  echo "Acesso:    docker exec -it $SANDBOX psql -U postgres -d hub"
else
  echo 'RESULTADO: houve divergencia — nao use este sandbox como referencia' >&2
  exit 1
fi
