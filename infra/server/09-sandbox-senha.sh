#!/usr/bin/env bash
# Repoe a senha do sandbox e prova que ela funciona por TCP.
#
# Existe como script, e nao como comando solto, porque o quoting aninhado
# (PowerShell -> ssh -> bash -> docker -> psql -> SQL) quebra de formas diferentes em cada
# camada e ja custou duas execucoes falsas.
set -euo pipefail
SANDBOX="${SANDBOX:-openad-pg-sandbox}"
SENHA="${SANDBOX_PASS:-sandbox-nao-exposto}"

echo '--- repondo a senha'
docker exec "$SANDBOX" psql -U postgres -q -c "ALTER ROLE postgres WITH PASSWORD '$SENHA'"

echo '--- metodo de autenticacao configurado (host)'
docker exec "$SANDBOX" cat /var/lib/postgresql/data/pg_hba.conf 2>/dev/null \
  | grep -vE '^\s*#|^\s*$' | grep -E '^host' || echo '(nao consegui ler o pg_hba)'

echo '--- teste por TCP de dentro de um container na mesma pilha de rede'
docker run --rm --network "container:$SANDBOX" \
  -e PGPASSWORD="$SENHA" \
  postgres:16-alpine \
  psql -h 127.0.0.1 -U postgres -d hub -At -c 'SELECT current_user, 1 AS ok'

echo '--- teste pelo nome do container (como o Prisma faz)'
docker run --rm --network "container:$SANDBOX" \
  -e PGPASSWORD="$SENHA" \
  postgres:16-alpine \
  psql -h "$SANDBOX" -U postgres -d hub -At -c 'SELECT 1 AS ok' \
  || echo 'FALHOU pelo nome; o ensaio deve usar 127.0.0.1'
