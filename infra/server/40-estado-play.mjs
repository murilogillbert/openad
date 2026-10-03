/**
 * Mostra, pela API, o que cada app tem em cada faixa do Google Play.
 *
 * Por que existe: `edits.commit` devolver 200 prova que a edicao foi publicada, nao que o
 * bundle ficou onde se queria. Esquecer o `tracks.update` sobe o artefato e nao o coloca em
 * faixa nenhuma: ele aparece na biblioteca e em lugar nenhum util, e o console nao grita.
 * Esta e a leitura independente do resultado.
 *
 * Uso: node 40-estado-play.mjs
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const CHAVE_PADRAO =
  'C:\\Users\\Ludimila\\Documents\\google\\lateral-pillar-454914-g5-dedafcca49ac.json';

const APPS = [
  { id: 'opendriver', pacote: 'br.com.opendriver.app', nome: 'OpenDriver' },
  { id: 'opendriverhub', pacote: 'br.com.opendriverhub.app', nome: 'OpenDriver HUB' },
  { id: 'opendriverads', pacote: 'br.com.opendriver.ads', nome: 'OpenDriver AD' },
];

const b64 = (b) =>
  Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

async function token(chave) {
  const agora = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const p = b64(
    JSON.stringify({
      iss: chave.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      iat: agora,
      exp: agora + 3600,
    })
  );
  const s = createSign('RSA-SHA256').update(`${h}.${p}`).sign(chave.private_key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${h}.${p}.${b64(s)}`,
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`OAuth ${res.status}: ${j.error_description ?? j.error}`);
  return j.access_token;
}

const chave = JSON.parse(readFileSync(process.env.PLAY_KEY ?? CHAVE_PADRAO, 'utf8'));
const t = await token(chave);
const auth = { Authorization: `Bearer ${t}` };

for (const app of APPS) {
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${app.pacote}`;
  console.log(`\n=== ${app.nome}  (${app.pacote})`);

  // Toda leitura de faixa acontece dentro de uma edicao, mesmo sem alterar nada.
  const insRes = await fetch(`${base}/edits`, { method: 'POST', headers: auth });
  if (!insRes.ok) {
    console.log(`  inacessivel (${insRes.status})`);
    continue;
  }
  const { id } = await insRes.json();

  try {
    const bRes = await fetch(`${base}/edits/${id}/bundles`, { headers: auth });
    const bundles = bRes.ok ? ((await bRes.json()).bundles ?? []) : [];
    console.log(
      `  bundles enviados: ${bundles.length ? bundles.map((b) => b.versionCode).join(', ') : 'nenhum'}`
    );

    const tRes = await fetch(`${base}/edits/${id}/tracks`, { headers: auth });
    const tracks = tRes.ok ? ((await tRes.json()).tracks ?? []) : [];
    const comConteudo = tracks.filter((x) => (x.releases ?? []).some((r) => r.versionCodes?.length));

    if (comConteudo.length === 0) {
      console.log('  faixas: nenhuma com versao atribuida');
    } else {
      for (const tr of comConteudo) {
        for (const r of tr.releases) {
          if (!r.versionCodes?.length) continue;
          console.log(
            `  faixa ${tr.track.padEnd(12)} versionCode ${r.versionCodes.join(',')}  status ${r.status}`
          );
        }
      }
    }
  } finally {
    // Edicao de leitura descartada: edicao aberta e abandonada aparece como alteracao
    // pendente no console e bloqueia a proxima.
    await fetch(`${base}/edits/${id}`, { method: 'DELETE', headers: auth }).catch(() => {});
  }
}

console.log('');
