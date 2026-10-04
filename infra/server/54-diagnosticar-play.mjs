#!/usr/bin/env node
/**
 * Despeja, sem interpretar, o que a API diz sobre um app: faixas, versoes, bundles e o
 * estado da revisao.
 *
 * Existe porque `40-estado-play.mjs` **resume**, e resumo esconde. Depois de subir o HUB e o
 * AD, o OpenDriver passou a aparecer como "bundles enviados: nenhum", e um resumo nao
 * distingue "a API nao devolveu nada" de "o filtro do resumo descartou o que ela devolveu".
 *
 * Uso: node 54-diagnosticar-play.mjs [pacote...]
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const CHAVE_PADRAO =
  'C:\\Users\\Ludimila\\Documents\\google\\lateral-pillar-454914-g5-dedafcca49ac.json';

const PACOTES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['br.com.opendriver.app', 'br.com.opendriverhub.app', 'br.com.opendriver.ads'];

const b64 = (b) =>
  Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

async function obterToken(chave) {
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
const auth = { Authorization: `Bearer ${await obterToken(chave)}` };

async function pegar(url) {
  const r = await fetch(url, { headers: auth });
  const t = await r.text();
  let j = null;
  try {
    j = t ? JSON.parse(t) : null;
  } catch {
    j = { bruto: t.slice(0, 300) };
  }
  return { status: r.status, json: j };
}

for (const pacote of PACOTES) {
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pacote}`;
  console.log(`\n${'='.repeat(70)}\n${pacote}\n${'='.repeat(70)}`);

  const ins = await fetch(`${base}/edits`, { method: 'POST', headers: auth });
  if (!ins.ok) {
    console.log(`edits.insert -> ${ins.status}: ${(await ins.text()).slice(0, 300)}`);
    continue;
  }
  const { id } = await ins.json();

  try {
    for (const rec of ['bundles', 'apks', 'tracks', 'countryavailability/production']) {
      const r = await pegar(`${base}/edits/${id}/${rec}`);
      console.log(`\n--- ${rec}  (HTTP ${r.status})`);
      console.log(JSON.stringify(r.json, null, 2).slice(0, 2500));
    }
  } finally {
    await fetch(`${base}/edits/${id}`, { method: 'DELETE', headers: auth }).catch(() => {});
  }
}

console.log('');
