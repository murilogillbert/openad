#!/usr/bin/env node
/**
 * Leitura do estado atual da ficha de cada app no Play, antes de escrever qualquer coisa.
 *
 * Por que ler antes: `details.update` e `listings.update` sao PUT, ou seja, substituem o
 * recurso inteiro. Escrever sem saber o idioma padrao configurado nem quais idiomas ja tem
 * ficha apagaria texto existente sem aviso. E o idioma padrao decide qual ficha o Play exige
 * completa para liberar a producao.
 *
 * Uso: node 52-ler-ficha-play.mjs
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
const auth = { Authorization: `Bearer ${await token(chave)}` };

const corta = (s, n) => (!s ? '(vazio)' : s.length > n ? `${s.slice(0, n)}...` : s);

for (const app of APPS) {
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${app.pacote}`;
  console.log(`\n=== ${app.nome}  (${app.pacote})`);

  const ins = await fetch(`${base}/edits`, { method: 'POST', headers: auth });
  if (!ins.ok) {
    console.log(`  inacessivel (${ins.status})`);
    continue;
  }
  const { id } = await ins.json();

  try {
    const det = await fetch(`${base}/edits/${id}/details`, { headers: auth });
    if (det.ok) {
      const d = await det.json();
      console.log(`  idioma padrao : ${d.defaultLanguage ?? '(nao definido)'}`);
      console.log(`  e-mail        : ${d.contactEmail ?? '(vazio)'}`);
      console.log(`  site          : ${d.contactWebsite ?? '(vazio)'}`);
      console.log(`  telefone      : ${d.contactPhone ?? '(vazio)'}`);
    } else {
      console.log(`  details: ${det.status}`);
    }

    const lis = await fetch(`${base}/edits/${id}/listings`, { headers: auth });
    const listings = lis.ok ? ((await lis.json()).listings ?? []) : [];
    if (!listings.length) {
      console.log('  fichas        : nenhuma');
    } else {
      for (const l of listings) {
        console.log(`  ficha ${l.language}`);
        console.log(`    titulo    : ${corta(l.title, 60)}`);
        console.log(`    breve     : ${corta(l.shortDescription, 60)}`);
        console.log(`    completa  : ${l.fullDescription ? `${l.fullDescription.length} caracteres` : '(vazio)'}`);
      }
    }

    // Imagens por idioma e por tipo. Sem ficha de idioma nenhum, nao ha onde pendurar imagem.
    for (const l of listings.length ? listings.map((x) => x.language) : ['pt-BR']) {
      for (const tipo of ['icon', 'featureGraphic', 'phoneScreenshots']) {
        const r = await fetch(`${base}/edits/${id}/listings/${l}/${tipo}`, { headers: auth });
        const n = r.ok ? ((await r.json()).images ?? []).length : -1;
        console.log(`  imagem ${l} ${tipo.padEnd(16)} ${n < 0 ? `erro ${r.status}` : n}`);
      }
    }
  } finally {
    await fetch(`${base}/edits/${id}`, { method: 'DELETE', headers: auth }).catch(() => {});
  }
}

console.log('');
