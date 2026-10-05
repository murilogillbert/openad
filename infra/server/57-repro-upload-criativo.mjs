#!/usr/bin/env node
/**
 * Reproduz, contra producao, o fluxo de upload de criativo do anunciante, passo a passo, e
 * para no primeiro que falhar imprimindo a resposta inteira.
 *
 * Por que contra producao e nao em teste: a suite do openad-api cobre o fluxo e passa. O que
 * falha e o ambiente - ha 4 campanhas e **zero** criativos no Mongo de producao, inclusive
 * uma campanha chamada "[TESTE] criativo - diagnostico de upload", rastro de uma tentativa
 * anterior. Entao o defeito esta em estado ou configuracao do servidor, e so aparece ali.
 *
 * O arquivo enviado e um PNG minimo gerado aqui, sem dependencia externa: o objetivo e
 * exercitar o caminho, nao validar codec.
 *
 * Uso: node 57-repro-upload-criativo.mjs
 */
import { deflateSync } from 'node:zlib';

const HUB = 'https://hubapi.opendriver.com.br/api/v1';
const ADS = 'https://adsapi.opendriver.com.br/api/v1';

const EMAIL = 'play.anunciante@opendriver.com.br';
const SENHA = 'PlayReview2026';

const cores = { ok: '\x1b[32m', erro: '\x1b[31m', aviso: '\x1b[33m', fim: '\x1b[0m' };
const ok = (t) => console.log(`  ${cores.ok}ok${cores.fim}    ${t}`);
const aviso = (t) => console.log(`  ${cores.aviso}aviso${cores.fim} ${t}`);
const erro = (t) => console.log(`  ${cores.erro}FALHA${cores.fim} ${t}`);

/** PNG valido de 2x2 pixels, montado na mao (assinatura + IHDR + IDAT + IEND). */
function pngMinimo() {
  const crcTabela = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTabela[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const pedaco = (tipo, dados) => {
    const t = Buffer.from(tipo, 'ascii');
    const tam = Buffer.alloc(4);
    tam.writeUInt32BE(dados.length);
    const soma = Buffer.alloc(4);
    soma.writeUInt32BE(crc(Buffer.concat([t, dados])));
    return Buffer.concat([tam, t, dados, soma]);
  };

  const largura = 2;
  const altura = 2;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // profundidade
  ihdr[9] = 2; // cor RGB
  // Uma linha = filtro (1 byte) + 3 bytes por pixel.
  const bruto = Buffer.concat(
    Array.from({ length: altura }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(largura * 3, 0x2a)]))
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', ihdr),
    pedaco('IDAT', deflateSync(bruto)),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}

function dados(json) {
  return json && typeof json === 'object' && 'data' in json ? json.data : json;
}

async function chamar(base, caminho, { metodo = 'GET', corpo, token, form } = {}) {
  const cab = {};
  if (token) cab.Authorization = `Bearer ${token}`;
  let body;
  if (form) body = form;
  else if (corpo !== undefined) {
    cab['Content-Type'] = 'application/json';
    body = JSON.stringify(corpo);
  }
  const r = await fetch(`${base}${caminho}`, { method: metodo, headers: cab, body });
  const t = await r.text();
  let j = null;
  try {
    j = t ? JSON.parse(t) : null;
  } catch {
    j = { bruto: t.slice(0, 600) };
  }
  return { status: r.status, json: j };
}

const resumo = (r) => `${r.status} ${JSON.stringify(r.json).slice(0, 500)}`;

async function principal() {
  console.log('Reproduzindo o upload de criativo do anunciante, contra producao.\n');

  // 1) Token do ecossistema
  console.log('--- 1. login no hub');
  const login = await chamar(HUB, '/auth/login', { metodo: 'POST', corpo: { email: EMAIL, password: SENHA } });
  if (login.status !== 200) {
    erro(`login: ${resumo(login)}`);
    return 1;
  }
  const token = dados(login.json).token;
  ok('token obtido');

  // 2) Campanha em rascunho. Criativo so entra em campanha que aceita alteracao.
  console.log('\n--- 2. campanha de rascunho');
  const lista = await chamar(ADS, '/advertiser/campaigns', { token });
  if (lista.status !== 200) {
    erro(`listar campanhas: ${resumo(lista)}`);
    return 1;
  }
  const itens = dados(lista.json)?.items ?? dados(lista.json) ?? [];
  let campanha = (Array.isArray(itens) ? itens : []).find((c) => c.status === 'draft');

  if (campanha) {
    ok(`reaproveitando rascunho ${campanha.campaignId ?? campanha.id} ("${campanha.name}")`);
  } else {
    const nova = await chamar(ADS, '/advertiser/campaigns', {
      metodo: 'POST',
      token,
      corpo: {
        name: '[DIAG] upload de criativo',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        budgetCents: 10_000,
        bidCents: 10,
      },
    });
    if (nova.status !== 201 && nova.status !== 200) {
      erro(`criar campanha: ${resumo(nova)}`);
      return 1;
    }
    campanha = dados(nova.json);
    ok(`campanha criada ${campanha.campaignId ?? campanha.id}`);
  }
  const campaignId = campanha.campaignId ?? campanha.id;

  // 3) Abrir sessao. Aqui mora o suspeito: `ensureCampaignFolderId` devolvendo nulo levanta
  //    VFS_NOT_BOOTSTRAPPED, que depende da arvore de midia existir no servidor.
  console.log('\n--- 3. abrir sessao de upload');
  const sessao = await chamar(ADS, `/advertiser/campaigns/${campaignId}/media`, {
    metodo: 'POST',
    token,
    corpo: { filename: 'diagnostico.png', contentType: 'image/png' },
  });
  if (sessao.status !== 201 && sessao.status !== 200) {
    erro(`abrir sessao: ${resumo(sessao)}`);
    return 1;
  }
  const sessionId = dados(sessao.json)?.sessionId ?? dados(sessao.json)?.id;
  ok(`sessao ${sessionId}`);

  // 4) Bytes
  console.log('\n--- 4. enviar bytes');
  const png = pngMinimo();
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'diagnostico.png');
  const bytes = await chamar(ADS, `/advertiser/campaigns/${campaignId}/media/${sessionId}/bytes`, {
    metodo: 'POST',
    token,
    form,
  });
  if (bytes.status !== 204 && bytes.status !== 200) {
    erro(`enviar bytes: ${resumo(bytes)}`);
    return 1;
  }
  ok(`${png.length} bytes aceitos`);

  // 5) Concluir: validacao tecnica (ffprobe contra o ruleset DOOH) e registro no catalogo.
  console.log('\n--- 5. concluir sessao');
  const fim = await chamar(ADS, `/advertiser/campaigns/${campaignId}/media/${sessionId}/complete`, {
    metodo: 'POST',
    token,
  });
  if (fim.status !== 200 && fim.status !== 201) {
    erro(`concluir: ${resumo(fim)}`);
    return 1;
  }
  ok(`criativo registrado: ${JSON.stringify(dados(fim.json)).slice(0, 300)}`);

  console.log(`\n${cores.ok}Fluxo completo passou.${cores.fim}`);
  return 0;
}

principal()
  .then((c) => process.exit(c))
  .catch((e) => {
    console.error(`\n${cores.erro}ABORTADO${cores.fim} ${e.stack ?? e.message}`);
    process.exit(1);
  });
