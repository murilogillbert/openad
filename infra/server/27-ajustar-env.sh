#!/usr/bin/env bash
#
# Define uma chave no `/root/openad/.env` e recria a API para que ela valha.
#
# Existe porque qualquer `sed` com `|`, `/` ou `$` escrito direto na linha de comando
# PowerShell -> ssh -> bash chega mutilado no servidor: o PowerShell remove barras invertidas
# e o `|` precisa sobreviver a duas camadas de interpretação. O mesmo defeito que trocou
# `redis-server` por `redis-serve` no compose. Script em arquivo, transferido com conferência
# de hash, é o único caminho confiável aqui.
#
# Uso: 27-ajustar-env.sh CHAVE VALOR [--sem-reiniciar]
set -uo pipefail

CHAVE="${1:?uso: 27-ajustar-env.sh CHAVE VALOR [--sem-reiniciar]}"
VALOR="${2:?falta o valor}"
MODO="${3:-}"
ENVF=/root/openad/.env

[ -f "$ENVF" ] || { echo "ABORTADO: $ENVF nao existe" >&2; exit 1; }

antes=$(grep "^${CHAVE}=" "$ENVF" || echo '(ausente)')

# A substituição é feita em awk e não em sed: o valor pode conter `/`, `|`, `&` e `$`, e todos
# têm significado na substituição do sed. O awk recebe o valor como variável, sem interpretar.
tmp=$(mktemp)
CHAVE="$CHAVE" VALOR="$VALOR" awk '
  BEGIN { k = ENVIRON["CHAVE"]; v = ENVIRON["VALOR"]; achou = 0 }
  {
    if (index($0, k "=") == 1) { print k "=" v; achou = 1 }
    else { print }
  }
  END { if (!achou) print k "=" v }
' "$ENVF" > "$tmp"

cat "$tmp" > "$ENVF"
rm -f "$tmp"
chmod 600 "$ENVF"

echo "antes:  $antes"
echo "depois: $(grep "^${CHAVE}=" "$ENVF")"

if [ "$MODO" = '--sem-reiniciar' ]; then
  echo '(API nao recriada, por pedido)'
  exit 0
fi

echo '--- recriando a API'
cd /root/openad
docker compose -f docker-compose.prod.yml up -d api 2>&1 | tail -3
sleep 40
docker ps --format '{{.Names}} | {{.Status}}' | grep openad-api
