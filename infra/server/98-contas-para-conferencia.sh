#!/usr/bin/env bash
#
# Lista as contas uteis para conferir tela por tela, e o que cada uma alcanca.
#
# Para que serve: a conferencia visual das telas novas da v2 exige entrar nos aplicativos, e
# cada tela exige um papel diferente — gestao de produto e do parceiro, cartao de credito de
# veiculacao e do anunciante, avatar e de qualquer um. Sem saber quem e o que, a conferencia
# vira tentativa e erro no aparelho.
#
# Somente leitura, e **nao imprime senha**.
#
# Uso:  bash 98-contas-para-conferencia.sh
set -uo pipefail

PG="${PG_CONTAINER:-l5bcr9slmgtmeefkqwg5amia}"

q() { docker exec "$PG" psql -U postgres -d hub -At -F '|' -c "$1"; }
titulo() { printf '\n========== %s ==========\n' "$1"; }

titulo 'contas de demonstracao das lojas'
q "select email, role, case when avatar_url = '' then '(sem avatar)' else left(avatar_url, 40) end
     from public.users where email like 'play.%' order by email" |
  while IFS='|' read -r email papel av; do
    printf '  %-42s %-12s %s\n' "$email" "$papel" "$av"
  done

titulo 'usuarios por papel'
q "select role, count(*) from public.users group by role order by 2 desc" |
  while IFS='|' read -r papel n; do printf '  %-14s %s\n' "$papel" "$n"; done

titulo 'contas com papel de parceiro (gestao de produto e balcao)'
# `isPartnerRole` no app aceita mais de um papel: dono e financeiro. A tela de produto e a de
# venda ficam atras desse grupo, e foi exatamente aqui que estava o defeito do papel
# `financeiro` corrigido na Frente D.
q "select u.email, u.role, coalesce(p.trade_name, p.legal_name, '(sem parceiro)')
     from public.users u
     left join public.partners p on p.user_id = u.id
    where u.role in ('partner','partner_finance','financeiro')
    order by u.email" |
  while IFS='|' read -r email papel parceiro; do
    printf '  %-42s %-16s %s\n' "$email" "$papel" "$parceiro"
  done

titulo 'parceiros, unidades e produtos (o que a tela de produto vai mostrar)'
printf 'parceiros        %s\n' "$(q 'select count(*) from public.partners')"
printf 'unidades         %s\n' "$(q 'select count(*) from public.partner_stores')"
printf 'produtos         %s\n' "$(q 'select count(*) from public.products')"
printf 'disponibilidade  %s\n' "$(q 'select count(*) from public.product_store_stock')"

titulo 'avatares (a Frente C deixou todos vazios, e o cliente desenha as iniciais)'
printf 'users com avatar proprio   %s\n' "$(q "select count(*) from public.users where coalesce(avatar_url,'') <> ''")"
printf 'users sem avatar           %s\n' "$(q "select count(*) from public.users where coalesce(avatar_url,'') = ''")"
printf 'partners com logo proprio  %s\n' "$(q "select count(*) from public.partners where coalesce(logo_url,'') <> ''")"

titulo 'leitura'
cat <<'FIM'
A senha das contas `play.*` esta no 45-contas-demo.mjs e no 46-conferir-contas-demo.mjs; ela
NAO e impressa aqui.

Se nao houver parceiro com unidade nem produto, a tela de gestao de produto abre vazia — o que
confere que ela carrega, mas nao que ela lista. Para ver a lista e a disponibilidade por
unidade e preciso cadastrar ao menos um produto e uma unidade.
FIM
