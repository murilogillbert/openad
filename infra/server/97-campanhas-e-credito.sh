#!/usr/bin/env bash
#
# Cruza campanha ativa com saldo do anunciante: quem veicula, quem nao, e por que.
#
# Para que serve: `96-saldo-dos-anunciantes.sh` responde "quem tem saldo" e
# `64-manifesto-do-aparelho.sh` responde "o que esta no ar". Nenhum dos dois responde a
# pergunta do meio, que e a que importa para decidir se falta lancar credito: **cada campanha
# ativa tem anunciante, e esse anunciante tem saldo?**
#
# A campanha mora no MongoDB e o saldo no Postgres, entao a resposta exige os dois — e e
# justamente por morarem separados que ninguem conferia isso.
#
# Somente leitura. Uso:  bash 97-campanhas-e-credito.sh
set -uo pipefail

PG="${PG_CONTAINER:-l5bcr9slmgtmeefkqwg5amia}"
MONGO_CONTAINER="${MONGO_CONTAINER:-openad-mongo}"

URI="$(docker exec openad-api printenv MONGO_URI 2>/dev/null || true)"
[ -n "$URI" ] || { echo 'ABORTADO: nao consegui ler MONGO_URI do openad-api' >&2; exit 1; }

echo '========== campanhas por anunciante (MongoDB) =========='
docker exec "$MONGO_CONTAINER" mongosh "$URI" --quiet --eval '
  const col = db.getCollection("campaigns");
  const linhas = col.find({}, { campaignId: 1, name: 1, status: 1, advertiserId: 1 })
                    .sort({ status: 1, name: 1 }).toArray();
  for (const c of linhas) {
    print([c.status, c.advertiserId || "(sem anunciante)", c.name, c.campaignId].join("|"));
  }
' | while IFS='|' read -r status adv nome id; do
  printf '%-15s %-38s %s\n' "$status" "$adv" "$nome"
done

echo ''
echo '========== saldo disponivel por anunciante (Postgres) =========='
# Mesma conta de `CreditLedgerService`: sinal por `direction`, e micros caindo para
# `amount_cents * 10.000` quando a coluna nova esta vazia.
docker exec "$PG" psql -U postgres -d hub -At -F '|' -c "
  with lanc as (
    select l.advertiser_id,
           sum(case when l.direction='credit' then 1 else -1 end
               * coalesce(l.amount_micros, l.amount_cents::bigint * 10000)) as saldo
      from openad.ad_credit_ledger l group by 1
  ), retido as (
    select h.advertiser_id, sum(h.amount_micros - h.captured_micros) as r
      from openad.ad_credit_holds h where h.status='open' group by 1
  )
  select a.id, a.legal_name,
         coalesce(lanc.saldo,0) - coalesce(retido.r,0)
    from openad.ad_advertisers a
    left join lanc on lanc.advertiser_id = a.id
    left join retido on retido.advertiser_id = a.id
   order by a.legal_name
" | while IFS='|' read -r id nome disp; do
  if [ "$disp" -gt 0 ]; then marca='tem saldo'; else marca='SEM SALDO'; fi
  printf '%-38s %-28s %14s micros  %s\n' "$id" "$nome" "$disp" "$marca"
done

echo ''
echo '========== leitura =========='
cat <<'FIM'
Campanha `active` com anunciante SEM SALDO nao abre reserva e fica fora do manifesto.
Campanha `active` com "(sem anunciante)" veicula de qualquer forma: o portao de credito so
se aplica a campanha que tem anunciante.

Comparar a lista de cima com a de baixo diz exatamente quais anunciantes precisam de credito
lancado a mao antes de a compra por Pix existir.
FIM
