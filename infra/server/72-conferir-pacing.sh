#!/usr/bin/env bash
# Por que o manifesto ficou vazio?
#
# `CampaignEligibilityService` descarta campanha por tres motivos, e **nenhum** deles produz
# erro: status diferente de `active`, instante fora de `scheduledStart..scheduledEnd`, e
# pacing diario em `paused`. O tablete recebe um manifesto de zero itens, apaga a midia que
# nao esta mais nele, e a tela fica preta com `sync.ok` no log.
#
# O terceiro motivo e o suspeito depois de uma rajada de veiculacao: `recordBillablePlayCost`
# debita `ratePerImpressionCents` por veiculacao faturavel, e orcamento de teste e pequeno.
set -u

cat >/tmp/pacing.js <<'JS'
const d = db.getSiblingDB('openad');
const agora = new Date();

print('=== campanhas: aptidao item por item');
d.campaigns.find({}).forEach((c) => {
  const dentroDaJanela = c.scheduledStart <= agora && c.scheduledEnd >= agora;
  print('  --- ' + c.name);
  print('      status      ' + c.status + (c.status === 'active' ? '' : '   <-- descarta'));
  print('      janela      ' + c.scheduledStart.toISOString().slice(0,10) + ' .. ' +
        c.scheduledEnd.toISOString().slice(0,10) + (dentroDaJanela ? '' : '   <-- descarta'));
  const b = c.budget || {};
  print('      orcamento   total=' + b.totalAmountCents + '  diario=' + b.dailyBudgetCents +
        '  tarifa=' + b.ratePerImpressionCents);
});

print('');
print('=== gasto diario (campaign_daily_spend) — e aqui que o pacing decide');
const gastos = d.campaign_daily_spend.find({}).sort({ _id: -1 }).limit(10).toArray();
if (gastos.length === 0) {
  print('  (nenhum registro)');
}
gastos.forEach((g) => {
  print('  ' + String(g.campaignId).slice(0,8) + '  dia=' + g.day +
        '  gasto=' + g.billableCostCents + '  orcamento=' + g.budgetCents +
        '  estado=' + g.pacingState + (g.pacingState === 'paused' ? '   <-- DESCARTA DO MANIFESTO' : ''));
});

print('');
print('=== criativos ativos e a campanha de cada um');
d.mediaassets.find({ isActive: true }, { mediaId: 1, campaignId: 1, filename: 1, _id: 0 })
  .forEach((m) => {
    const c = m.campaignId ? d.campaigns.findOne({ campaignId: m.campaignId }, { status: 1, name: 1 }) : null;
    print('  ' + String(m.mediaId).slice(0,8) + '  ' + m.filename +
          '  -> ' + (c ? c.name + ' (' + c.status + ')' : 'sem campanha (filler)'));
  });
JS

docker cp /tmp/pacing.js openad-mongo:/tmp/pacing.js >/dev/null
URI=$(docker exec openad-api printenv MONGO_URI)
[ -z "${URI:-}" ] && { echo 'ABORTADO: MONGO_URI vazia' >&2; exit 1; }
docker exec openad-mongo mongosh "$URI" --quiet --file /tmp/pacing.js
docker exec openad-mongo rm -f /tmp/pacing.js
rm -f /tmp/pacing.js
