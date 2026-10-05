#!/usr/bin/env bash
#
# Busca o manifesto **exatamente como o tablete o receberia** e mostra quantos itens vem e
# qual URL de download sai.
#
# Por que: o log do WebView esta afogado em resultado de plugin de sensor, e a unica coisa que
# sobra e `sync.failed: Failed to fetch` - sem URL, sem status. Para separar "o manifesto vem
# vazio" de "o manifesto vem e o download falha" e preciso ver o manifesto.
#
# O token e emitido aqui dentro, com o mesmo `JWT_SECRET` e o mesmo formato que o pareamento
# usa (`typ: 'device'`, `sub: deviceId`, `fp: hardwareFingerprintHash`), porque
# `ManifestDeviceJwtGuard` exige os tres e tambem o cabecalho
# `X-Device-Fingerprint-Hash` igual ao `fp`.
set -uo pipefail

DEVICE="${1:-c5ba917f-56fd-4c36-94f9-9b0f9045da5a}"

cat >/tmp/manifesto.cjs <<'JS'
const crypto = require('crypto');

const deviceId = process.argv[2];
const segredo = (process.env.JWT_SECRET || '').trim();
if (!segredo) {
  console.error('ERRO JWT_SECRET vazio');
  process.exit(1);
}

const b64 = (o) =>
  Buffer.from(typeof o === 'string' ? o : JSON.stringify(o))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

async function principal() {
  // A impressao digital vem do banco: o guarda compara o `fp` do token com a coluna, e o
  // cabecalho com o `fp`. Inventar um valor daria 401 e nao diria nada sobre o manifesto.
  const { MongoClient } = require('mongodb');
  const cliente = new MongoClient(process.env.MONGO_URI);
  await cliente.connect();
  const db = cliente.db('openad');
  const aparelho = await db.collection('devices').findOne({ deviceId });
  await cliente.close();
  if (!aparelho) {
    console.error('ERRO aparelho nao encontrado: ' + deviceId);
    process.exit(1);
  }
  const fp = aparelho.hardwareFingerprintHash || undefined;

  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = b64({ alg: 'HS256', typ: 'JWT' });
  const corpo = b64({ sub: deviceId, typ: 'device', fp, iat: agora, exp: agora + 600 });
  const assinatura = crypto
    .createHmac('sha256', segredo)
    .update(`${cabecalho}.${corpo}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const token = `${cabecalho}.${corpo}.${assinatura}`;

  const res = await fetch('http://127.0.0.1:3000/api/v1/manifest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(fp ? { 'X-Device-Fingerprint-Hash': fp } : {}),
    },
    body: JSON.stringify({
      deviceId,
      deviceState: { latitude: -15.5710077, longitude: -56.0619687 },
    }),
  });

  const texto = await res.text();
  console.log('STATUS ' + res.status);
  let j;
  try {
    j = JSON.parse(texto);
  } catch {
    console.log(texto.slice(0, 500));
    return;
  }
  const d = j.data ?? j;
  console.log('versao   : ' + d.version);
  console.log('isDelta  : ' + d.isDelta);
  const midia = d.media ?? [];
  console.log('itens    : ' + midia.length);
  for (const m of midia) {
    const u = String(m.downloadUrl || '');
    const host = u ? new URL(u).host : '(sem url)';
    // `mimeType` e o que o player usa para escolher entre `<img>` e `<video>`. Ausente, todo
    // criativo ia para um `<video>`, nenhum JPEG decodificava e a tela ficava preta.
    const tipo = m.mimeType === undefined ? '<AUSENTE>' : m.mimeType;
    console.log(
      `  - ${m.mediaId}  prio ${m.priority}  ${m.fileSize} bytes  ${tipo}  host ${host}`
    );
  }
  if (d.spatial) {
    console.log('spatial  : ' + (d.spatial.entries || []).length + ' entradas');
  }
}

principal().catch((e) => {
  console.error('ERRO ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
JS

docker cp /tmp/manifesto.cjs openad-api:/app/.manifesto.cjs >/dev/null
docker exec -w /app openad-api node /app/.manifesto.cjs "$DEVICE"
CODIGO=$?
docker exec -u 0 openad-api rm -f /app/.manifesto.cjs 2>/dev/null || true
rm -f /tmp/manifesto.cjs
exit $CODIGO
