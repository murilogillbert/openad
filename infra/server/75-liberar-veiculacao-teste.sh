#!/usr/bin/env bash
# Devolve as campanhas de teste ao ar, zerando o gasto do dia.
#
# O que aconteceu: 71 veiculacoes de teste em poucos minutos, a 25 centavos cada, estouraram
# o orcamento **diario** de `Teste 1` (gasto 3350 contra 1612) e `Teste 2` (1100 contra 322).
# O pacing marcou as duas como `paused` e `CampaignEligibilityService` passou a descarta-las
# — manifesto de zero itens. Isso **nao e defeito**: e o controle de orcamento funcionando.
#
# `dailyBudgetCents` e nulo nas duas, entao o teto diario e derivado do total dividido pelos
# dias contratados. Com rotacao de 10 s, um tablete sozinho consome 90 reais por hora; um
# teto diario de 16 reais se esgota em pouco mais de 10 minutos. Para um ambiente de
# demonstracao que roda continuamente, o teto derivado e pequeno por construcao.
#
# Duas acoes, as duas restritas a campanhas cujo nome comeca com "Teste":
#   1. zera `campaign_daily_spend` do dia
#   2. eleva o total contratado, para o teto derivado caber numa demonstracao continua
#
# Nao toca em campanha de cliente real. O filtro por nome e deliberado.
set -u

cat >/tmp/liberar.js <<'JS'
const d = db.getSiblingDB('openad');

const teste = d.campaigns.find(
  { name: /^(Teste|\[TESTE\])/i },
  { campaignId: 1, name: 1, budget: 1 }
).toArray();

if (teste.length === 0) {
  print('nenhuma campanha de teste encontrada; nada feito');
} else {
  const ids = teste.map((c) => c.campaignId);

  print('=== campanhas afetadas');
  teste.forEach((c) => print('  ' + c.name + '  total=' + (c.budget && c.budget.totalAmountCents)));

  // 1. Zera o gasto do dia. Remover o documento e mais seguro que reescrever `pacingState`:
  // o proximo debito recria a linha com o estado recalculado a partir do orcamento atual.
  const r1 = d.campaign_daily_spend.deleteMany({ campaignId: { $in: ids } });
  print('');
  print('=== gasto diario removido: ' + r1.deletedCount + ' documento(s)');

  // 2. Eleva o total contratado para 500000 centavos (5 mil reais) nas de teste. Com 30 dias
  // contratados, o teto diario derivado passa a ~166 reais, que sustenta um tablete em
  // rotacao continua por ~1,8 h de veiculacao faturavel por dia.
  const r2 = d.campaigns.updateMany(
    { campaignId: { $in: ids } },
    { $set: { 'budget.totalAmountCents': 500000 } }
  );
  print('=== orcamento elevado: ' + r2.modifiedCount + ' campanha(s) para 500000 centavos');
}

print('');
print('=== estado depois');
d.campaigns.find({ status: 'active' }, { name: 1, budget: 1, _id: 0 }).forEach((c) =>
  print('  ' + c.name + '  total=' + (c.budget && c.budget.totalAmountCents) +
        '  tarifa=' + (c.budget && c.budget.ratePerImpressionCents)));
print('  linhas de gasto diario restantes: ' + d.campaign_daily_spend.countDocuments({}));
JS

docker cp /tmp/liberar.js openad-mongo:/tmp/liberar.js >/dev/null
URI=$(docker exec openad-api printenv MONGO_URI)
[ -z "${URI:-}" ] && { echo 'ABORTADO: MONGO_URI vazia' >&2; exit 1; }
docker exec openad-mongo mongosh "$URI" --quiet --file /tmp/liberar.js
docker exec openad-mongo rm -f /tmp/liberar.js
rm -f /tmp/liberar.js

# O pacing guarda snapshot em Redis; sem limpar, a campanha continua `paused` ate o cache
# expirar e o manifesto segue vazio.
echo
echo '=== limpando o snapshot de pacing no Redis'
docker exec openad-redis redis-cli --scan --pattern 'pacing:*' 2>/dev/null | head -20 | while read -r k; do
  [ -n "$k" ] && docker exec openad-redis redis-cli DEL "$k" >/dev/null && echo "  removido $k"
done
echo '  (fim)'
