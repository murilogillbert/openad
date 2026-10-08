#!/usr/bin/env bash
#
# Backup completo antes da leva da versao 2.
#
# Por que nao reusar `02-backup.sh`: ele foi escrito na janela 1, quando o openad ainda nao
# existia. Faltam duas pecas que a v2 vai mexer justamente:
#
#   - linha de base do schema `openad` (a v2 acrescenta tabela de credito e de categoria)
#   - MongoDB inteiro (campanhas, criativos, aparelhos, play records — nada disso esta no
#     Postgres, e o `pg_dump` obviamente nao cobre)
#
# O que e salvo, e por que cada peca importa:
#
#   globals.sql            roles do cluster. `pg_dump` nao inclui, e sem eles o restore
#                          produz um banco que ninguem acessa.
#   hub.dump               banco inteiro, formato custom: comprimido e restauravel por tabela.
#   hub-plain.sql.gz       o mesmo em SQL legivel. Redundante de proposito: se a versao do
#                          `pg_restore` divergir no futuro, texto sempre abre.
#   {public,opendriver,openad}-antes.sql   schema sem dados. Linha de base dos diffs.
#   mongo-openad.archive.gz   `mongodump --archive` do banco `openad`.
#   minio-data.tar.gz      objetos do hub-minio (inclui hub-uploads, openad-media e
#                          opendriver-private).
#   integration_settings.sql  so esta tabela, em INSERTs, porque e a que carrega credencial
#                          configurada pela interface e e a mais facil de perder sem notar.
#
# Nada aqui escreve no banco.
#
# Uso:  bash 77-backup-v2.sh
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-l5bcr9slmgtmeefkqwg5amia}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-hub}"
MONGO_CONTAINER="${MONGO_CONTAINER:-openad-mongo}"
STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
BACKUP_DIR="${BACKUP_DIR:-/root/backups/v2-$STAMP}"

mkdir -p "$BACKUP_DIR"
cd "$BACKUP_DIR"

echo "=== backup da v2 em $BACKUP_DIR ==="

# Dump que enche o disco e pior que nao ter dump: o Postgres para de aceitar escrita quando
# `/` lota.
livre_kb=$(df --output=avail -k / | tail -1)
echo "espaco livre: $((livre_kb / 1024)) MB"
if [ "$livre_kb" -lt 3145728 ]; then
  echo 'ABORTADO: menos de 3 GB livres em /. Libere espaco antes de dumpar.' >&2
  exit 1
fi

echo '--- 1/8 roles e permissoes do cluster'
docker exec "$PG_CONTAINER" pg_dumpall -U "$PG_USER" --globals-only > globals.sql

echo '--- 2/8 banco completo, formato custom'
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > hub.dump

echo '--- 3/8 banco completo, SQL legivel'
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" | gzip -9 > hub-plain.sql.gz

echo '--- 4/8 linha de base dos tres schemas'
for s in public opendriver openad; do
  docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" --schema-only --schema="$s" \
    > "${s}-antes.sql"
  echo "    ${s}-antes.sql  $(wc -l < "${s}-antes.sql") linhas"
done

echo '--- 5/8 integration_settings em INSERTs'
# `--column-inserts` para o arquivo sobreviver a mudanca de ordem de coluna.
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" \
  --data-only --column-inserts --table=public.integration_settings \
  > integration_settings.sql

echo '--- 6/8 MongoDB do openad'
# A credencial sai da propria aplicacao, para nao haver segunda copia de senha em script.
MONGO_URI=$(docker exec openad-api printenv MONGO_URI 2>/dev/null || true)
if [ -z "${MONGO_URI:-}" ]; then
  echo '    ATENCAO: MONGO_URI vazia; pulando o dump do Mongo' >&2
else
  docker exec "$MONGO_CONTAINER" sh -lc \
    "mongodump --uri='$MONGO_URI' --archive --gzip" > mongo-openad.archive.gz
  echo "    mongo-openad.archive.gz  $(du -h mongo-openad.archive.gz | cut -f1)"
fi

echo '--- 7/8 objetos do hub-minio'
# Sem `--ignore-failed-read`: o tar do Alpine e o do BusyBox e nao conhece a opcao do GNU
# tar; com ela o comando falha inteiro e nao gera arquivo nenhum.
if docker volume inspect hub-minio-data >/dev/null 2>&1; then
  docker run --rm \
    -v hub-minio-data:/dados:ro \
    -v "$BACKUP_DIR":/saida \
    alpine:3.20 \
    tar czf /saida/minio-data.tar.gz -C /dados .
else
  echo '    volume hub-minio-data nao encontrado — pulando'
fi

echo '--- 8/8 verificacao de integridade'
# `pg_restore --list` le o indice interno do dump: arquivo truncado falha aqui, e e muito
# melhor descobrir agora do que no dia de restaurar.
docker run --rm -v "$BACKUP_DIR":/b:ro postgres:16-alpine \
  pg_restore --list /b/hub.dump > toc.txt
echo "    objetos no dump: $(grep -c '^[0-9]' toc.txt || echo 0)"

gzip -t hub-plain.sql.gz && echo '    hub-plain.sql.gz: gzip valido'
[ -f mongo-openad.archive.gz ] && { gzip -t mongo-openad.archive.gz && echo '    mongo-openad.archive.gz: gzip valido'; }
[ -f minio-data.tar.gz ] && { gzip -t minio-data.tar.gz && echo '    minio-data.tar.gz: gzip valido'; }

sha256sum * > SHA256SUMS 2>/dev/null || true

echo ''
echo '=== conteudo ==='
ls -lh
echo ''
echo "=== caminho: $BACKUP_DIR ==="
echo "$BACKUP_DIR" > /root/backups/ULTIMO_V2
