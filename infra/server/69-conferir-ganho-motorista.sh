#!/usr/bin/env bash
# A veiculacao virou dinheiro para o motorista?
#
# Entre "o tablete exibiu" e "o motorista recebeu" ha quatro portoes, e cada um descarta em
# silencio: buffer local -> envio em lote -> reconciliacao (duracao e antifraude) ->
# credito. `play_records` com registro nao prova nada: so `reconciliationStatus: billable`
# gera repasse, e o credito so acontece na **transicao** para billable.
set -u

cat >/tmp/ganho.js <<'JS'
const d = db.getSiblingDB('openad');

print('=== play_records por status de reconciliacao');
d.play_records.aggregate([
  { $group: { _id: { s: '$reconciliationStatus', b: '$billable' }, n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]).forEach((g) => print('  ' + String(g._id.s) + '  billable=' + g._id.b + '  -> ' + g.n));

print('');
print('=== ultimos 5 registros');
d.play_records.find({}, {
  uniqueEventId: 1, campaignId: 1, vehicleId: 1, reconciliationStatus: 1,
  billable: 1, impliedSpeedKmh: 1, heartbeatRatio: 1, timestampEnd: 1, _id: 0,
}).sort({ timestampEnd: -1 }).limit(5).forEach((x) => {
  print('  ' + x.timestampEnd.toISOString() + '  ' + x.reconciliationStatus +
        '  billable=' + x.billable + '  campanha=' + String(x.campaignId).slice(0, 8) +
        '  vel=' + x.impliedSpeedKmh + '  hb=' + x.heartbeatRatio);
});

print('');
print('=== veiculo e motorista');
d.vehicles.find({}, { vehicleId: 1, registrationPlate: 1, driverId: 1, pairedDeviceIds: 1, _id: 0 })
  .forEach((v) => print('  ' + v.registrationPlate + '  ' + v.vehicleId +
                        '  motorista=' + v.driverId + '  tablets=' + JSON.stringify(v.pairedDeviceIds)));

print('');
print('=== tarifa das campanhas ativas (base do repasse)');
d.campaigns.find({ status: 'active' }, { campaignId: 1, name: 1, budget: 1, driverPayout: 1, _id: 0 })
  .forEach((c) => print('  ' + String(c.campaignId).slice(0, 8) + '  ' + c.name +
                        '  tarifa=' + (c.budget && c.budget.ratePerImpressionCents) +
                        '  repasse=' + JSON.stringify(c.driverPayout)));

print('');
print('=== trilha de vinculo de motorista');
d.vehicle_binding_audit_events.find({ action: { $in: ['driver_bind', 'driver_unbind'] } },
  { action: 1, vehicleId: 1, deviceId: 1, actorEmail: 1, createdAt: 1, _id: 0 })
  .sort({ createdAt: -1 }).limit(5)
  .forEach((a) => print('  ' + a.createdAt.toISOString() + '  ' + a.action + '  por ' + a.actorEmail));
JS

docker cp /tmp/ganho.js openad-mongo:/tmp/ganho.js >/dev/null
URI=$(docker exec openad-api printenv MONGO_URI)
[ -z "${URI:-}" ] && { echo 'ABORTADO: MONGO_URI vazia' >&2; exit 1; }
docker exec openad-mongo mongosh "$URI" --quiet --file /tmp/ganho.js
docker exec openad-mongo rm -f /tmp/ganho.js
rm -f /tmp/ganho.js

# O log do credito fica em `70-repasse-no-log.sh`: `docker logs` deste contêiner e lento o
# bastante para estourar o tempo de uma sessao de ssh, e misturar as duas conferencias fazia
# a parte barata (Mongo) ficar hostage da caraO.
