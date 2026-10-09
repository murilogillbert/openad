#!/usr/bin/env bash
#
# Ritmo de consumo de credito: quantas veiculacoes por hora, quanto custa, e quanto tempo o
# saldo atual aguenta nesse ritmo.
#
# Por que existe: o tablete de teste, pareado e ligado, veicula igual a um carro em rua — e
# debita do anunciante igual. Durante a conferencia visual da v2 isso ficou visivel no extrato
# do painel: oito debitos de R$ 0,25 num unico minuto. Sem medir o ritmo, "o saldo esta caindo"
# e so uma impressao; com ele, da para dizer se o credito dura horas ou semanas.
#
# Somente leitura. Uso:  bash 99-ritmo-de-consumo.sh [horas]
set -uo pipefail

PG="${PG_CONTAINER:-l5bcr9slmgtmeefkqwg5amia}"
HORAS="${1:-3}"

q() { docker exec "$PG" psql -U postgres -d hub -At -F '|' -c "$1"; }
titulo() { printf '\n========== %s ==========\n' "$1"; }

titulo "debitos de veiculacao nas ultimas ${HORAS}h, por hora"
q "
  select to_char(date_trunc('hour', l.created_at), 'DD/MM HH24:00'),
         count(*),
         sum(coalesce(l.amount_micros, l.amount_cents::bigint * 10000))
    from openad.ad_credit_ledger l
   where l.direction = 'debit'
     and l.created_at > now() - interval '${HORAS} hours'
   group by 1 order by 1
" | while IFS='|' read -r hora n micros; do
  printf '  %-14s %4s veiculacoes   R$ %s\n' "$hora" "$n" \
    "$(awk -v v="$micros" 'BEGIN{printf "%.4f", v/1000000}')"
done

titulo 'ritmo medio e autonomia do saldo'
LINHA="$(q "
  with d as (
    select count(*) n,
           sum(coalesce(l.amount_micros, l.amount_cents::bigint * 10000)) gasto
      from openad.ad_credit_ledger l
     where l.direction='debit' and l.created_at > now() - interval '${HORAS} hours'
  ), s as (
    select sum(case when l.direction='credit' then 1 else -1 end
               * coalesce(l.amount_micros, l.amount_cents::bigint * 10000)) saldo
      from openad.ad_credit_ledger l
  )
  select coalesce(d.n,0), coalesce(d.gasto,0), coalesce(s.saldo,0) from d, s
")"
IFS='|' read -r n gasto saldo <<< "$LINHA"

awk -v n="$n" -v gasto="$gasto" -v saldo="$saldo" -v h="$HORAS" 'BEGIN {
  porHora = n / h;
  gastoHora = gasto / h / 1000000;
  printf "  veiculacoes por hora      %.1f\n", porHora;
  printf "  gasto por hora            R$ %.4f\n", gastoHora;
  printf "  saldo atual               R$ %.4f\n", saldo / 1000000;
  if (gastoHora > 0) {
    horas = (saldo / 1000000) / gastoHora;
    printf "  autonomia nesse ritmo     %.1f horas (%.1f dias)\n", horas, horas / 24;
  } else {
    print  "  autonomia nesse ritmo     sem consumo medido na janela";
  }
}'

titulo 'por campanha, na janela'
q "
  select coalesce(l.campaign_id,'(sem campanha)'),
         count(*),
         sum(coalesce(l.amount_micros, l.amount_cents::bigint * 10000))
    from openad.ad_credit_ledger l
   where l.direction='debit' and l.created_at > now() - interval '${HORAS} hours'
   group by 1 order by 3 desc
" | while IFS='|' read -r camp n micros; do
  printf '  %-40s %4s   R$ %s\n' "$camp" "$n" \
    "$(awk -v v="$micros" 'BEGIN{printf "%.4f", v/1000000}')"
done

titulo 'modelo de preco das campanhas que estao debitando'
cat <<'FIM'
Debito de R$ 0,2500 por veiculacao e a tarifa `per_impression` — as campanhas de hoje foram
criadas antes do preco por segundo e mantem o modelo delas, de proposito: reprecificar campanha
no ar mudaria o contrato depois de aceito. Campanha NOVA nasce `per_second` a R$ 0,003/s, o que
da R$ 0,045 por exibicao de 15 s — cerca de cinco vezes menos.

Ou seja: o numero alto no extrato nao e defeito do preco por segundo. E a tarifa antiga das
campanhas de demonstracao.
FIM
