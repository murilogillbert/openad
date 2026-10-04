#!/usr/bin/env node
/**
 * Confere, de fora, que as tres contas de demonstracao entram em todos os apps onde o
 * revisor do Google Play vai usa-las.
 *
 * Nao basta "a conta existe": hub, opendriver e openad tem portoes diferentes. O passageiro
 * precisa entrar tanto no login do opendriver quanto no do hub (mesma tabela
 * `public.users`, dois servicos distintos); o motorista precisa estar `Approved` e online
 * *agora*, nao no momento em que foi provisionado; o anunciante precisa ter sua linha em
 * `openad.ad_advertisers` aceita pelo token do hub.
 *
 * Uso:  node 46-conferir-contas-demo.mjs [--senha <senha>]
 */

const OD = 'https://api-app.opendriver.com.br/api/v1';
const HUB = 'https://hubapi.opendriver.com.br/api/v1';
const ADS = 'https://adsapi.opendriver.com.br/api/v1';

const argv = process.argv.slice(2);
const i = argv.indexOf('--senha');
const SENHA = i >= 0 ? argv[i + 1] : 'PlayReview2026';

const EMAILS = {
  passageiro: 'play.passageiro@opendriver.com.br',
  motorista: 'play.motorista@opendriver.com.br',
  anunciante: 'play.anunciante@opendriver.com.br',
};

const cores = { ok: '\x1b[32m', erro: '\x1b[31m', fim: '\x1b[0m' };
let falhas = 0;
const linha = (bom, texto) => {
  if (!bom) falhas += 1;
  console.log(`  ${bom ? cores.ok + 'ok  ' : cores.erro + 'FALHA'}${cores.fim} ${texto}`);
};

function dados(json) {
  return json && typeof json === 'object' && 'data' in json ? json.data : json;
}

async function chamar(base, caminho, { metodo = 'GET', corpo, token } = {}) {
  const cabecalhos = {};
  if (token) cabecalhos.Authorization = `Bearer ${token}`;
  if (corpo) cabecalhos['Content-Type'] = 'application/json';
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const t = await r.text();
  let j = null;
  try {
    j = t ? JSON.parse(t) : null;
  } catch {
    j = { bruto: t.slice(0, 300) };
  }
  return { status: r.status, json: j };
}

const entrar = (base, email) => chamar(base, '/auth/login', { metodo: 'POST', corpo: { email, password: SENHA } });

async function principal() {
  console.log('Conferindo as contas de demonstracao do Google Play.\n');

  console.log('PASSAGEIRO');
  const pOd = await entrar(OD, EMAILS.passageiro);
  linha(pOd.status === 200, `login no OpenDriver (${pOd.status})`);
  const pHub = await entrar(HUB, EMAILS.passageiro);
  linha(pHub.status === 200, `login no HUB (${pHub.status})`);
  if (pOd.status === 200) {
    const me = dados((await chamar(OD, '/me', { token: dados(pOd.json).token })).json);
    linha(!!me?.passenger, 'perfil de passageiro presente');
  }

  console.log('\nMOTORISTA');
  const m = await entrar(OD, EMAILS.motorista);
  linha(m.status === 200, `login no OpenDriver (${m.status})`);
  if (m.status === 200) {
    const token = dados(m.json).token;
    const me = dados((await chamar(OD, '/me', { token })).json);
    linha(me?.driver?.status === 'Approved', `status do motorista = ${me?.driver?.status}`);
    linha(me?.driver?.isOnline === true, `online = ${me?.driver?.isOnline}`);
    linha(!!me?.driver?.currentVehicleId, `veiculo em uso = ${me?.driver?.currentVehicleId ?? 'nenhum'}`);
  }

  console.log('\nANUNCIANTE');
  const a = await entrar(HUB, EMAILS.anunciante);
  linha(a.status === 200, `login no HUB (${a.status})`);
  if (a.status === 200) {
    const token = dados(a.json).token;
    const sit = await chamar(ADS, '/advertiser/onboarding', { token });
    linha(sit.status === 200, `situacao no openad (${sit.status})`);
    const anun = sit.json?.anunciante;
    linha(anun?.status === 'active', `anunciante = ${anun?.status ?? 'ausente'}`);
    linha(sit.json?.precisaAderir === false, `precisaAderir = ${sit.json?.precisaAderir}`);
  }

  console.log('');
  if (falhas === 0) {
    console.log(`${cores.ok}As tres contas estao prontas para a revisao.${cores.fim}`);
    process.exit(0);
  }
  console.log(`${cores.erro}${falhas} verificacao(oes) falhou(aram).${cores.fim}`);
  process.exit(1);
}

principal().catch((e) => {
  console.error(`${cores.erro}ABORTADO${cores.fim} ${e.message}`);
  process.exit(1);
});
