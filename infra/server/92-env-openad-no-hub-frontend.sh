#!/usr/bin/env bash
#
# Acrescenta `VITE_OPENAD_API_URL` as variaveis de build do hub-frontend no Coolify.
#
# Por que e necessario: o painel de compra de credito de veiculacao vive no SPA do hub, em
# `/conta/credito-de-anuncio`, e fala com a API do OpenAd direto do navegador. `VITE_*` e
# embutida no bundle em tempo de **build** — sem ela o bundle sai com a variavel vazia, a tela
# mostra o aviso de "API nao configurada", e nao ha nada no log do servidor que explique.
#
# Por que por `artisan tinker` e nao por INSERT no banco: o Coolify guarda o valor **cifrado**
# pela chave da aplicacao Laravel (`APP_KEY`). Um INSERT com texto puro grava algo que o
# Coolify tenta decifrar e falha, e o build sai com a variavel vazia do mesmo jeito — com o
# agravante de parecer configurada na interface. O model faz a cifragem.
#
# Os sinalizadores (`is_buildtime`, `is_runtime`, `is_preview`, `is_literal`) sao copiados de
# `VITE_OPENDRIVER_API_URL`, que e a variavel irma: mesma natureza, mesmo consumo, e ja esta
# funcionando em producao. Copiar e melhor que escolher, porque a combinacao que funciona ja
# existe no banco.
#
# Uso:
#   bash 92-env-openad-no-hub-frontend.sh estado
#   bash 92-env-openad-no-hub-frontend.sh aplicar [valor]
set -uo pipefail

UUID="${UUID:-krqsjubqpzils0nij3atnekp}"
CHAVE='VITE_OPENAD_API_URL'
IRMA='VITE_OPENDRIVER_API_URL'
VALOR="${2:-https://adsapi.opendriver.com.br}"

sql() { docker exec coolify-db psql -U coolify -d coolify -At -F '|' -c "$1"; }

ID="$(sql "select id from applications where uuid = '$UUID'")"
[ -n "$ID" ] || { echo "ABORTADO: aplicacao $UUID nao encontrada" >&2; exit 1; }

mostrar() {
  echo "--- variaveis VITE_ do hub-frontend (id $ID) ---"
  sql "select key, is_buildtime, is_runtime, is_preview, is_literal, length(value)
         from environment_variables
        where resourceable_type like '%Application' and resourceable_id = $ID
          and key like 'VITE_%'
        order by key, is_preview" |
    while IFS='|' read -r k b r p l tam; do
      printf '%-26s build=%s exec=%s preview=%s literal=%s  (%s chars cifrados)\n' \
        "$k" "$b" "$r" "$p" "$l" "$tam"
    done
}

case "${1:-estado}" in
  estado)
    mostrar
    exit 0
    ;;
  aplicar) ;;
  *) echo "uso: $0 [estado|aplicar] [valor]" >&2; exit 1 ;;
esac

echo "ANTES:"
mostrar

# Idempotente: se a chave ja existir, atualiza o valor em vez de criar uma segunda linha.
# Duas linhas com a mesma chave e um estado que o Coolify aceita (a tabela permite, e
# `VITE_API_BASE_URL` tem duas por causa do par normal/preview) e que faria o build escolher
# uma delas sem a gente saber qual.
docker exec coolify-db psql -U coolify -d coolify -At -c \
  "select 1" >/dev/null || { echo 'ABORTADO: coolify-db nao responde' >&2; exit 1; }

echo ''
echo "--- gravando $CHAVE pelo model (cifra o valor) ---"
docker exec coolify php artisan tinker --execute="
\$app = \App\Models\Application::where('uuid', '$UUID')->first();
if (! \$app) { echo 'APP_NAO_ENCONTRADA'; exit; }

\$irma = \App\Models\EnvironmentVariable::where('resourceable_type', \App\Models\Application::class)
    ->where('resourceable_id', \$app->id)
    ->where('key', '$IRMA')
    ->where('is_preview', false)
    ->first();
if (! \$irma) { echo 'IRMA_NAO_ENCONTRADA'; exit; }

\$v = \App\Models\EnvironmentVariable::firstOrNew([
    'resourceable_type' => \App\Models\Application::class,
    'resourceable_id' => \$app->id,
    'key' => '$CHAVE',
    'is_preview' => false,
]);
\$v->value = '$VALOR';
\$v->is_buildtime = \$irma->is_buildtime;
\$v->is_runtime = \$irma->is_runtime;
\$v->is_literal = \$irma->is_literal;
\$v->is_multiline = false;
\$v->is_shown_once = false;
\$v->save();

// Le de volta pelo model: isso confirma que o valor **decifra** no mesmo valor que entrou.
// Conferir pelo banco so provaria que ha bytes la.
\$lido = \App\Models\EnvironmentVariable::where('resourceable_type', \App\Models\Application::class)
    ->where('resourceable_id', \$app->id)
    ->where('key', '$CHAVE')
    ->where('is_preview', false)
    ->first();
echo 'GRAVADO=' . \$lido->value . ' build=' . (\$lido->is_buildtime ? 'sim' : 'nao');
" 2>/dev/null | tr -d '\r'

echo ''
echo ''
echo "DEPOIS:"
mostrar

echo ''
echo 'A variavel so entra no bundle no proximo build. Rodar em seguida:'
echo "  bash /root/openad-infra/24-coolify-deploy.sh $UUID"
