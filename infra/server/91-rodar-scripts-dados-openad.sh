#!/usr/bin/env bash
#
# Roda, em producao, os dois scripts de dados de execucao unica do openad.
#
#   scripts/marcar-cobranca-aplicada.ts   OBRIGATORIO antes ou junto do deploy da G.1
#   scripts/semear-gasto-em-micros.ts     converte o acumulador de gasto para micro-reais
#
# Os dois sao idempotentes: rodar de novo nao faz nada.
#
# Por que num container efemero e nao dentro do openad-api: o container de producao tem a
# aplicacao **compilada**, nao o TypeScript nem `tsx`. Instalar ferramenta de build no
# container que serve requisicao e trocar um problema de execucao por um problema permanente.
# Aqui as dependencias nascem e morrem com o `docker run --rm`.
#
# Por que nao reescrever a consulta em `mongosh`: a logica de qual documento marcar, com que
# valor, e a validacao de que nao sobrou nenhum, vivem no script. Reescrever aqui criaria uma
# segunda versao da regra, e as duas divergiriam na primeira mudanca.
#
# A credencial sai do proprio openad-api, para nao haver segunda copia de senha em script.
#
# Uso:
#   bash 91-rodar-scripts-dados-openad.sh ensaio    # --dry-run nos dois, nada escreve
#   bash 91-rodar-scripts-dados-openad.sh valendo
set -uo pipefail

DIR='/root/openad-infra/scripts-dados'
MONGOOSE='mongoose@9'

MODO="${1:-ensaio}"
case "$MODO" in
  ensaio)  ARG='--dry-run' ;;
  valendo) ARG='' ;;
  *) echo "uso: $0 [ensaio|valendo]" >&2; exit 1 ;;
esac

for f in marcar-cobranca-aplicada.ts semear-gasto-em-micros.ts; do
  [ -f "$DIR/$f" ] || { echo "ABORTADO: falta $DIR/$f" >&2; exit 1; }
done

URI="$(docker exec openad-api printenv MONGO_URI 2>/dev/null || true)"
[ -n "$URI" ] || { echo 'ABORTADO: nao consegui ler MONGO_URI do openad-api' >&2; exit 1; }

# A rede do Mongo, para o container efemero alcancar `openad-mongo:27017` pelo nome que esta
# na URI. `--network container:openad-mongo` nao serviria: ali o nome do servico nao resolve,
# so `localhost`, e a URI teria de ser reescrita.
REDE="$(docker inspect openad-mongo \
  --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' | head -1)"
[ -n "$REDE" ] || { echo 'ABORTADO: nao descobri a rede do openad-mongo' >&2; exit 1; }
echo "rede: $REDE   modo: $MODO"

for f in marcar-cobranca-aplicada.ts semear-gasto-em-micros.ts; do
  printf '\n========== %s %s ==========\n' "$f" "$ARG"
  docker run --rm \
    --network "$REDE" \
    -v "$DIR":/s \
    -e MONGODB_URI="$URI" \
    -w /tmp/exec \
    node:22-alpine \
    sh -c "mkdir -p /tmp/exec && cp /s/$f /tmp/exec/ \
      && npm i --silent --no-audit --no-fund $MONGOOSE tsx >/dev/null 2>&1 \
      && npx --yes tsx /tmp/exec/$f $ARG"
  st=$?
  if [ "$st" -ne 0 ]; then
    echo "FALHOU: $f saiu com $st" >&2
    exit "$st"
  fi
done

printf '\n========== CONCLUIDO (%s) ==========\n' "$MODO"
