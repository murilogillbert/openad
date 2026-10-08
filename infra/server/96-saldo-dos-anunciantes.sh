#!/usr/bin/env bash
#
# Saldo de credito por anunciante, e o que depende dele para veicular.
#
# Para que serve: com o portao de credito ligado (frente H.4), campanha de anunciante so vai
# ao ar se houver reserva, e a reserva so existe se houver saldo no livro-caixa. Este script
# responde "quem tem saldo, quem nao tem" — a pergunta que decide se e preciso lancar credito
# a mao enquanto a compra por Pix nao esta disponivel.
#
# ============================================================================
# A conta do saldo espelha `CreditLedgerService.saldoDoLedgerMicros`
# ============================================================================
#
# Nao e `sum(amount_micros)`. Duas razoes, e a primeira foi medida aqui:
#
# 1. `amount_micros` e **anulavel** e entrou na migration `ad_credit_holds`. O lancamento que
#    ja existia em producao tem a coluna vazia, e somar so ela devolveria saldo zero para um
#    anunciante que tem credito. O codigo cai para `amount_cents * 10.000` quando os micros
#    faltam, e aqui faz o mesmo.
#
# 2. O sinal vem de `direction` (`credit`/`debit`), nao do sinal do numero. Somar o valor sem
#    olhar a direcao daria credito onde ha debito.
#
# Script de conferencia que calcula diferente do codigo nao confere nada: ele inventa um
# segundo numero, e na divergencia ninguem sabe qual dos dois esta errado.
#
# Somente leitura.
#
# Uso:  bash 96-saldo-dos-anunciantes.sh
set -uo pipefail

PG="${PG_CONTAINER:-l5bcr9slmgtmeefkqwg5amia}"

q() { docker exec "$PG" psql -U postgres -d hub -At -F '|' -c "$1"; }
titulo() { printf '\n========== %s ==========\n' "$1"; }

titulo 'anunciantes, saldo do livro-caixa e retido em reserva'
q "
  with lanc as (
    select l.advertiser_id,
           sum(
             case when l.direction = 'credit' then 1 else -1 end
             * coalesce(l.amount_micros, l.amount_cents::bigint * 10000)
           ) as saldo_micros,
           count(*) as n
      from openad.ad_credit_ledger l
     group by l.advertiser_id
  ),
  retido as (
    select h.advertiser_id,
           sum(h.amount_micros - h.captured_micros) as retido_micros
      from openad.ad_credit_holds h
     where h.status = 'open'
     group by h.advertiser_id
  )
  select a.id,
         a.legal_name,
         a.status,
         coalesce(lanc.saldo_micros, 0),
         coalesce(retido.retido_micros, 0),
         coalesce(lanc.saldo_micros, 0) - coalesce(retido.retido_micros, 0),
         coalesce(lanc.n, 0)
    from openad.ad_advertisers a
    left join lanc   on lanc.advertiser_id = a.id
    left join retido on retido.advertiser_id = a.id
   order by a.legal_name
" | while IFS='|' read -r id nome status saldo retido disp n; do
  printf '  %s\n' "$nome"
  printf '    id              %s   status %s\n' "$id" "$status"
  printf '    livro-caixa     %14s micros   R$ %s   (%s lancamento(s))\n' \
    "$saldo" "$(awk -v v="$saldo" 'BEGIN{printf "%.4f", v/1000000}')" "$n"
  printf '    retido aberto   %14s micros   R$ %s\n' \
    "$retido" "$(awk -v v="$retido" 'BEGIN{printf "%.4f", v/1000000}')"
  printf '    disponivel      %14s micros   R$ %s\n' \
    "$disp" "$(awk -v v="$disp" 'BEGIN{printf "%.4f", v/1000000}')"
done

titulo 'reservas por estado'
q "select h.advertiser_id, h.status, count(*), coalesce(sum(h.amount_micros),0), coalesce(sum(h.captured_micros),0)
     from openad.ad_credit_holds h group by 1,2 order by 1,2" |
  while IFS='|' read -r id st n soma cap; do
    printf '  %s  %-10s %3s reserva(s)  reservado %s  capturado %s\n' "$id" "$st" "$n" "$soma" "$cap"
  done

titulo 'lancamentos do livro-caixa'
q "select l.advertiser_id, l.direction, l.reason, l.amount_cents, coalesce(l.amount_micros::text,'(vazio)'), l.created_at
     from openad.ad_credit_ledger l order by l.created_at" |
  while IFS='|' read -r id dir motivo cents micros quando; do
    printf '  %s  %-6s %-12s %6s centavos  micros=%-12s %s\n' "$id" "$dir" "$motivo" "$cents" "$micros" "$quando"
  done

titulo 'compras de credito'
printf 'total  %s\n' "$(q 'select count(*) from openad.ad_credit_purchases')"

titulo 'leitura do resultado'
cat <<'FIM'
Anunciante com disponivel <= 0 nao consegue abrir reserva, e campanha dele nao entra no
manifesto. Campanha SEM anunciante nao passa pelo portao e veicula de qualquer forma — e por
isso que o manifesto pode vir cheio com o livro-caixa quase vazio.

Enquanto a compra por Pix nao estiver ligada (falta o token do Asaas), o caminho e lancar
credito a mao. A chave sai do proprio banco, e o escopo exigido e ads:credit:write:

  CHAVE=$(docker exec l5bcr9slmgtmeefkqwg5amia psql -U postgres -d hub -At \
    -c "select value from public.integration_settings where key='Internal:AccountSyncKey'")

  curl -s -X POST https://adsapi.opendriver.com.br/api/v1/internal/ads/credits/adjust \
    -H "Authorization: Bearer $CHAVE" -H 'content-type: application/json' \
    -d '{"advertiserId":"<id>","direction":"credit","amountMicros":50000000,"note":"credito inicial"}'
FIM
