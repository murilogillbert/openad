#!/usr/bin/env bash
#
# O que esta pendente, em producao, nos tres schemas.
#
# Existe porque `10-migrations-producao.sh` roda os tres repositorios de uma vez, e as pastas
# `prisma/` no servidor sao copias: uma copia desatualizada do hub ou do openad aplicaria, ou
# deixaria de aplicar, coisa que ninguem pediu. Antes de mexer em producao, saber exatamente
# o que esta pendente em cada schema e o passo zero.
set -uo pipefail
PG="${PG_CONTAINER:-l5bcr9slmgtmeefkqwg5amia}"
PRISMA_DIR=/root/openad-infra/prisma

q() { docker exec "$PG" psql -U postgres -d hub -At -c "$1"; }
secao() { printf '\n========== %s ==========\n' "$1"; }

secao 'APLICADAS EM PRODUCAO'
for par in 'public' 'opendriver' 'openad'; do
  printf '%-12s %s\n' "$par" "$(q "SELECT count(*) FROM ${par}._prisma_migrations" 2>/dev/null || echo '(sem tabela)')"
done

secao 'MIGRATIONS NAS PASTAS DO SERVIDOR'
for repo in hub opendriver openad; do
  if [ -d "$PRISMA_DIR/$repo/migrations" ]; then
    printf '%-12s %s pastas\n' "$repo" "$(find "$PRISMA_DIR/$repo/migrations" -maxdepth 1 -type d ! -path "$PRISMA_DIR/$repo/migrations" | wc -l)"
  else
    printf '%-12s (pasta ausente)\n' "$repo"
  fi
done

secao 'PENDENTE POR SCHEMA'
# Compara nome a nome, e nao so a contagem: contagem igual com nomes diferentes e o caso que
# passa despercebido e aplica a migration errada.
pendentes() {
  local repo="$1" schema="$2"
  [ -d "$PRISMA_DIR/$repo/migrations" ] || { echo "  (pasta de $repo ausente)"; return; }
  local aplicadas pasta
  aplicadas=$(q "SELECT migration_name FROM ${schema}._prisma_migrations ORDER BY 1" 2>/dev/null | sort)
  pasta=$(find "$PRISMA_DIR/$repo/migrations" -maxdepth 1 -mindepth 1 -type d -printf '%f\n' | sort)
  local falta sobra
  falta=$(comm -13 <(echo "$aplicadas") <(echo "$pasta"))
  sobra=$(comm -23 <(echo "$aplicadas") <(echo "$pasta"))
  if [ -n "$falta" ]; then
    echo "  PENDENTE em $schema:"
    echo "$falta" | sed 's/^/    + /'
  else
    echo "  $schema: nada pendente"
  fi
  if [ -n "$sobra" ]; then
    # Aplicada no banco e ausente da pasta = a copia do servidor esta atras do repositorio.
    echo "  APLICADA MAS AUSENTE DA PASTA ($schema) — a copia do servidor esta desatualizada:"
    echo "$sobra" | sed 's/^/    - /'
  fi
}
echo 'hub -> public'
pendentes hub public
echo 'opendriver -> opendriver'
pendentes opendriver opendriver
echo 'openad -> openad'
pendentes openad openad

secao 'MIGRATION PELA METADE (deve ser vazio)'
q "SELECT 'public: '||migration_name FROM public._prisma_migrations WHERE finished_at IS NULL
   UNION ALL SELECT 'opendriver: '||migration_name FROM opendriver._prisma_migrations WHERE finished_at IS NULL
   UNION ALL SELECT 'openad: '||migration_name FROM openad._prisma_migrations WHERE finished_at IS NULL"
echo '(vazio = tudo concluido)'
