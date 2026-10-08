#!/bin/sh
# Quais migrations estao aplicadas, nos dois schemas, em CADA Postgres que tenha o banco "hub".
#
# ============================================================================
# Por que lista todos em vez de escolher um
# ============================================================================
#
# A primeira versao deste script escolhia o primeiro conteiner com psql que tivesse o banco
# "hub" — e escolheu o `openad-pg-sandbox`, que e uma COPIA de ensaio. Um script que responde
# "estas sao as migrations de producao" apontando para o sandbox e pior do que script nenhum:
# levaria alguem a aplicar migration no lugar errado, ou a concluir que producao ja esta em dia.
#
# Agora lista todos os candidatos, marca o que tem "sandbox" no nome, e nao decide por ninguem.
#
# O nome do conteiner de producao e um uuid gerado pelo Coolify, que muda quando o recurso e
# recriado — por isso a descoberta e por varredura, e nao um uuid colado aqui.
set -u

echo '=== Postgres com o banco "hub"'
CANDIDATOS=''
for c in $(docker ps --format '{{.Names}}'); do
  if docker exec "$c" sh -lc 'command -v psql >/dev/null 2>&1' 2>/dev/null; then
    if docker exec "$c" psql -U postgres -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw hub; then
      CANDIDATOS="$CANDIDATOS $c"
    fi
  fi
done

if [ -z "$CANDIDATOS" ]; then
  echo '  NAO ENCONTREI nenhum conteiner com psql servindo o banco "hub"'
  exit 1
fi

for c in $CANDIDATOS; do
  case "$c" in
    *sandbox*) marca='  <-- SANDBOX, nao e producao' ;;
    *)         marca='' ;;
  esac
  echo "  $c$marca"
done

for c in $CANDIDATOS; do
  echo ''
  echo '=========================================================================='
  case "$c" in
    *sandbox*) echo "CONTEINER: $c   (SANDBOX — ignore para decidir deploy)" ;;
    *)         echo "CONTEINER: $c" ;;
  esac

  for schema in openad public opendriver; do
    echo ""
    echo "--- schema $schema: ultimas migrations aplicadas"
    docker exec "$c" psql -U postgres -d hub -t -A -F'  ' -c \
      "select migration_name, to_char(finished_at,'DD/MM HH24:MI') from ${schema}._prisma_migrations where finished_at is not null order by finished_at desc limit 5;" \
      2>/dev/null || echo "    (sem tabela _prisma_migrations em $schema)"

    pendentes=$(docker exec "$c" psql -U postgres -d hub -t -A -c \
      "select migration_name from ${schema}._prisma_migrations where finished_at is null;" 2>/dev/null)
    if [ -n "$pendentes" ]; then
      echo "    ATENCAO migrations com falha registrada em $schema:"
      echo "$pendentes" | sed 's/^/      /'
    fi
  done
done
