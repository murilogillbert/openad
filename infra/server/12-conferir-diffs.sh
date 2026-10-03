#!/usr/bin/env bash
# Confere os diffs de `public` gerados por `10-migrations-producao.sh`.
#
# O criterio do protocolo de 5 passos: o hub e dono de `public` e pode criar objeto la; o
# opendriver e o openad **nao** podem tocar `public` de forma nenhuma. Qualquer diferenca
# fora disso e motivo para parar e restaurar.
set -uo pipefail
D="${1:-/root/openad-infra/producao}"
cd "$D" || { echo "nao ha $D" >&2; exit 1; }

echo '=== arquivos de snapshot ==='
ls -la ./*.sql ./*.txt 2>/dev/null

echo ''
echo '=== HUB: objetos criados em public (esperado: push_tokens + indices) ==='
grep -E '^> (CREATE|ALTER TABLE ONLY)' diff-hub.txt | sed 's/^> //' | sort -u

echo ''
echo '=== HUB: objetos removidos de public (DEVE SER VAZIO) ==='
if grep -qE '^< ' diff-hub.txt; then
  grep -E '^< ' diff-hub.txt | head -20
  echo 'ATENCAO: houve remocao'
else
  echo '(nada removido)'
fi

echo ''
echo '=== OPENDRIVER: public mudou? (DEVE SER "intocado") ==='
if diff -q public-1.sql public-2.sql >/dev/null 2>&1; then
  echo 'intocado'
else
  diff public-1.sql public-2.sql | head -20
fi

echo ''
echo '=== OPENAD: public mudou? (DEVE SER "intocado") ==='
if diff -q public-2.sql public-3.sql >/dev/null 2>&1; then
  echo 'intocado'
else
  diff public-2.sql public-3.sql | head -20
fi
