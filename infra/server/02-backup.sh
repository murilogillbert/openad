#!/usr/bin/env bash
#
# Janela 1 — backup completo antes de qualquer escrita.
#
# O que e salvo, e por que cada peca importa:
#
#   globals.sql          roles e permissoes do cluster. `pg_dump` **nao** inclui isso, e sem
#                        os roles um restore produz um banco que ninguem consegue acessar.
#   hub.dump             o banco inteiro, formato custom (`-Fc`): comprimido, restauravel
#                        seletivamente por tabela e verificavel sem restaurar.
#   hub-plain.sql.gz     o mesmo conteudo em SQL legivel. Redundante de proposito: se a
#                        versao do `pg_restore` divergir no futuro, texto sempre abre.
#   public-antes.sql     schema (sem dados) de `public`. E a **linha de base** de todas as
#                        comparacoes do protocolo de 5 passos.
#   opendriver-antes.sql idem para `opendriver`.
#   minio-data.tar.gz    objetos do hub-minio. O `pg_dump` nao cobre arquivo binario, e
#                        documento de parceiro e comprovante vivem ali.
#
# Nada aqui escreve no banco. O unico efeito e criar arquivos em BACKUP_DIR.
#
# Uso:  bash 02-backup.sh
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-l5bcr9slmgtmeefkqwg5amia}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-hub}"
STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
BACKUP_DIR="${BACKUP_DIR:-/root/backups/$STAMP}"

mkdir -p "$BACKUP_DIR"
cd "$BACKUP_DIR"

echo "=== backup em $BACKUP_DIR ==="

# Espaco livre antes de comecar. Dump que enche o disco em producao e pior que nao ter dump:
# o Postgres para de aceitar escrita quando `/` lota.
livre_kb=$(df --output=avail -k / | tail -1)
echo "espaco livre: $((livre_kb / 1024)) MB"
if [ "$livre_kb" -lt 2097152 ]; then
  echo "ABORTADO: menos de 2 GB livres em /. Libere espaco antes de dumpar." >&2
  exit 1
fi

echo '--- 1/6 roles e permissoes do cluster'
docker exec "$PG_CONTAINER" pg_dumpall -U "$PG_USER" --globals-only > globals.sql

echo '--- 2/6 banco completo, formato custom'
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > hub.dump

echo '--- 3/6 banco completo, SQL legivel'
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" | gzip -9 > hub-plain.sql.gz

echo '--- 4/6 linha de base dos schemas (criterio do diff pos-migration)'
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" --schema-only --schema=public \
  > public-antes.sql
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" --schema-only --schema=opendriver \
  > opendriver-antes.sql

echo '--- 5/6 objetos do hub-minio'
#
# Sem `--ignore-failed-read`: o `tar` do Alpine e o do BusyBox, que **nao** conhece essa
# opcao do GNU tar. Com ela, o comando falha inteiro por opcao invalida e nao gera arquivo
# nenhum — e, pior, o erro vira "erro parcial" na mensagem, que parece ressalva e e perda
# total do backup de midia. Foi o que aconteceu na primeira execucao.
#
# Tambem nao se redireciona o stderr para /dev/null: foi o que esconderia a causa.
if docker volume inspect hub-minio-data >/dev/null 2>&1; then
  docker run --rm \
    -v hub-minio-data:/dados:ro \
    -v "$BACKUP_DIR":/saida \
    alpine:3.20 \
    tar czf /saida/minio-data.tar.gz -C /dados .
else
  echo 'volume hub-minio-data nao encontrado — pulando'
fi

echo '--- 6/6 verificacao de integridade'
# `pg_restore --list` le o indice interno do dump. Se o arquivo estiver truncado ou corrompido,
# falha aqui — e e muito melhor descobrir agora do que no dia em que precisar restaurar.
docker run --rm -v "$BACKUP_DIR":/b:ro postgres:16-alpine \
  pg_restore --list /b/hub.dump > toc.txt
echo "objetos no dump: $(grep -c '^[0-9]' toc.txt || echo 0)"

gzip -t hub-plain.sql.gz && echo 'hub-plain.sql.gz: gzip valido'
if [ -f minio-data.tar.gz ]; then
  gzip -t minio-data.tar.gz && echo 'minio-data.tar.gz: gzip valido'
fi

# Soma de verificacao, para provar depois que o arquivo copiado e o mesmo que foi gerado.
sha256sum globals.sql hub.dump hub-plain.sql.gz public-antes.sql opendriver-antes.sql \
  $( [ -f minio-data.tar.gz ] && echo minio-data.tar.gz ) > SHA256SUMS

echo ''
echo '=== conteudo do backup ==='
ls -lh
echo ''
echo "=== caminho: $BACKUP_DIR ==="
echo "$BACKUP_DIR" > /root/backups/ULTIMO
