#!/usr/bin/env node
/**
 * Provisiona as contas de demonstracao exigidas pelo Google Play.
 *
 * Por que isto existe: o formulario "Acesso ao app" do Play Console exige credenciais que
 * deem ao revisor acesso a *todas* as partes do app. No OpenDriver, "todas as partes"
 * significa tres estados distintos que nao se alcancam por conta propria:
 *   - passageiro: cria sozinho, sem bloqueio;
 *   - motorista: so ve as telas de corrida depois de documento aprovado por operador
 *     (`driver_profiles.status = 'Approved'`), veiculo aprovado e `is_online = true`;
 *   - anunciante: precisa de linha em `openad.ad_advertisers` e de saldo em
 *     `openad.ad_credit_ledger` (o saldo e a soma dos lancamentos, nao uma coluna).
 * Sem isso o revisor abre o app, ve a tela de "aguardando aprovacao", e reprova por
 * "funcionalidade incompleta".
 *
 * Tudo que pode ser feito pela API publica e feito pela API publica (cadastro, dados de CNH,
 * upload de documento, cadastro de veiculo, submissao para analise, ficar online, adesao de
 * anunciante). Apenas dois atos sao gravados por SQL, porque sao atos de operador e nao de
 * usuario: a aprovacao de motorista/veiculo e o lancamento de credito de veiculacao. A
 * aprovacao grava exatamente as mesmas colunas que `admin.service.ts reviewDriver` gravaria
 * (`status`, `reviewed_at`); o credito grava um lancamento `adjustment`, que e a razao que o
 * proprio enum reserva para ajuste manual.
 *
 * Idempotente: rodar de novo nao duplica nada. Se o e-mail ja tem conta, faz login.
 *
 * Uso:  node 45-contas-demo.mjs [--senha <senha>]
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------- configuracao

const OD = 'https://api-app.opendriver.com.br/api/v1';
const HUB = 'https://hubapi.opendriver.com.br/api/v1';
const ADS = 'https://adsapi.opendriver.com.br/api/v1';

const PG_CONTAINER = 'l5bcr9slmgtmeefkqwg5amia';
const PG_DB = 'hub';
const PG_USER = 'postgres';

const IMAGEM_DOC = 'D:/Projetos/opendriver/mobile/assets/icon.png';

const argv = process.argv.slice(2);
const idx = argv.indexOf('--senha');
const SENHA = idx >= 0 ? argv[idx + 1] : 'PlayReview2026';

const CREDITO_CENTAVOS = 50_000; // R$ 500,00 de credito de veiculacao

const CONTAS = {
  passageiro: {
    email: 'play.passageiro@opendriver.com.br',
    nome: 'Revisor Passageiro Google Play',
    telefone: '61999990001',
  },
  motorista: {
    email: 'play.motorista@opendriver.com.br',
    nome: 'Revisor Motorista Google Play',
    telefone: '61999990002',
  },
  anunciante: {
    email: 'play.anunciante@opendriver.com.br',
    nome: 'Revisor Anunciante Google Play',
    telefone: '61999990003',
  },
};

// ---------------------------------------------------------------- utilitarios

const cores = { ok: '\x1b[32m', erro: '\x1b[31m', aviso: '\x1b[33m', fim: '\x1b[0m' };
let falhas = 0;

function passo(texto) {
  process.stdout.write(`\n--- ${texto}\n`);
}
function ok(texto) {
  console.log(`  ${cores.ok}ok${cores.fim}    ${texto}`);
}
function aviso(texto) {
  console.log(`  ${cores.aviso}aviso${cores.fim} ${texto}`);
}
function erro(texto) {
  falhas += 1;
  console.log(`  ${cores.erro}ERRO${cores.fim}  ${texto}`);
}

/** Digito verificador de CPF; gera um CPF valido e estavel a partir de uma base de 9 digitos. */
function cpfValido(base9) {
  const d = base9.split('').map(Number);
  const dv = (len) => {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += d[i] * (len + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dv(9));
  d.push(dv(10));
  return d.join('');
}

/** CNH valida pelo algoritmo do DENATRAN (mesmo que `domain/validators.ts isValidCnh`). */
function cnhValida(base9) {
  const c = base9.split('').map(Number);
  let v = 0;
  for (let i = 0, j = 9; i < 9; i++, j--) v += c[i] * j;
  let dsc = 0;
  let dv1 = v % 11;
  if (dv1 >= 10) {
    dv1 = 0;
    dsc = 2;
  }
  v = 0;
  for (let i = 0, j = 1; i < 9; i++, j++) v += c[i] * j;
  const x = v % 11;
  const dv2 = x >= 10 ? 0 : x - dsc;
  return `${base9}${dv1}${dv2}`;
}

/**
 * Roda SQL no Postgres de producao.
 *
 * `spawnSync` com vetor de argumentos e sem shell: o PowerShell come barra invertida e
 * aspas simples ao repassar para executavel nativo (foi assim que um `sed -i 's/\r$//'`
 * virou `s/r$//` e apagou o `r` final de cada linha de um compose em producao).
 */
function sql(texto) {
  const r = spawnSync(
    'ssh',
    ['opendriver', 'docker', 'exec', '-i', PG_CONTAINER, 'psql', '-U', PG_USER, '-d', PG_DB, '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    { input: texto, encoding: 'utf8', shell: false }
  );
  if (r.status !== 0) {
    throw new Error(`psql falhou (${r.status}): ${(r.stderr || '').trim()}`);
  }
  return (r.stdout || '').trim();
}

async function req(base, caminho, { metodo = 'GET', corpo, token, form } = {}) {
  const cabecalhos = {};
  if (token) cabecalhos.Authorization = `Bearer ${token}`;
  let body;
  if (form) {
    body = form;
  } else if (corpo !== undefined) {
    cabecalhos['Content-Type'] = 'application/json';
    body = JSON.stringify(corpo);
  }
  const resposta = await fetch(`${base}${caminho}`, { method: metodo, headers: cabecalhos, body });
  const texto = await resposta.text();
  let json;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = { bruto: texto.slice(0, 400) };
  }
  return { status: resposta.status, json };
}

/** O hub e o opendriver respondem num envelope `{ data: ... }`; o openad responde direto. */
function dados(json) {
  return json && typeof json === 'object' && 'data' in json ? json.data : json;
}

/** Cadastra; se o e-mail ja existe (409), faz login. Devolve `{ token, user }`. */
async function cadastrarOuEntrar(base, conta, papel, comCpf) {
  const corpo = {
    name: conta.nome,
    email: conta.email,
    password: SENHA,
    phone: conta.telefone,
    role: papel,
  };
  if (comCpf) corpo.cpf = comCpf;

  const criado = await req(base, '/auth/register', { metodo: 'POST', corpo });
  if (criado.status === 201 || criado.status === 200) {
    ok(`conta criada: ${conta.email} (${papel})`);
    return dados(criado.json);
  }

  const codigo = criado.json?.error?.code ?? criado.json?.code;
  if (criado.status !== 409 && codigo !== 'email_taken') {
    throw new Error(`cadastro de ${conta.email} falhou: ${criado.status} ${JSON.stringify(criado.json).slice(0, 300)}`);
  }

  const entrada = await req(base, '/auth/login', { metodo: 'POST', corpo: { email: conta.email, password: SENHA } });
  if (entrada.status !== 200) {
    throw new Error(
      `conta ${conta.email} ja existe mas a senha nao e a esperada (login ${entrada.status}). ` +
        `Troque a senha com --senha, ou redefina a senha dessa conta.`
    );
  }
  ok(`conta ja existia, login confere: ${conta.email}`);
  return dados(entrada.json);
}

async function enviarImagem(base, caminho, token, nomeArquivo) {
  const bytes = readFileSync(IMAGEM_DOC);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/png' }), nomeArquivo);
  return req(base, caminho, { metodo: 'POST', token, form });
}

// ---------------------------------------------------------------- execucao

async function principal() {
  console.log('Provisionando contas de demonstracao para a revisao do Google Play.');
  console.log(`Senha usada nas tres contas: ${SENHA}`);

  const resultado = {};

  // ===================== PASSAGEIRO =====================
  passo('PASSAGEIRO (app OpenDriver)');
  const passageiro = await cadastrarOuEntrar(OD, CONTAS.passageiro, 'Passenger', cpfValido('529982247'));
  resultado.passageiro = { email: CONTAS.passageiro.email, id: passageiro.user.id };

  const euPassageiro = await req(OD, '/me', { token: passageiro.token });
  if (euPassageiro.status === 200 && dados(euPassageiro.json).passenger) {
    ok('perfil de passageiro ativo');
  } else {
    erro(`perfil de passageiro ausente (${euPassageiro.status})`);
  }

  // ===================== MOTORISTA =====================
  passo('MOTORISTA (app OpenDriver) - cadastro');
  const motorista = await cadastrarOuEntrar(OD, CONTAS.motorista, 'Driver', cpfValido('111444777'));
  const tokenMotorista = motorista.token;
  resultado.motorista = { email: CONTAS.motorista.email, id: motorista.user.id };

  passo('MOTORISTA - dados da CNH');
  const cnh = cnhValida('123456789');
  const perfil = await req(OD, '/driver/profile', {
    metodo: 'PUT',
    token: tokenMotorista,
    corpo: {
      cnhNumber: cnh,
      cnhCategory: 'B',
      cnhExpiresAt: '2032-12-31',
      birthDate: '1990-05-20',
    },
  });
  if (perfil.status === 200) ok(`CNH ${cnh} categoria B, validade 2032-12-31`);
  else erro(`dados da CNH recusados: ${perfil.status} ${JSON.stringify(perfil.json).slice(0, 300)}`);

  passo('MOTORISTA - documentos');
  for (const tipo of ['cnh', 'selfie']) {
    const envio = await enviarImagem(OD, `/driver/documents/${tipo}`, tokenMotorista, `${tipo}.png`);
    if (envio.status === 200) ok(`documento ${tipo} enviado`);
    else erro(`documento ${tipo}: ${envio.status} ${JSON.stringify(envio.json).slice(0, 300)}`);
  }

  passo('MOTORISTA - veiculo');
  let veiculoId = null;
  const veiculo = await req(OD, '/driver/vehicles', {
    metodo: 'POST',
    token: tokenMotorista,
    corpo: {
      plate: 'DEM1A23',
      brand: 'Chevrolet',
      model: 'Onix',
      color: 'Prata',
      year: 2022,
      category: 'Economy',
    },
  });
  if (veiculo.status === 201) {
    veiculoId = dados(veiculo.json).id;
    ok(`veiculo DEM1A23 cadastrado (${veiculoId})`);
  } else {
    // Rodada anterior pode ja ter cadastrado; o perfil lista os veiculos.
    const p = await req(OD, '/driver/profile', { token: tokenMotorista });
    const lista = dados(p.json)?.vehicles ?? [];
    const achado = lista.find((v) => v.plate === 'DEM1A23');
    if (achado) {
      veiculoId = achado.id;
      ok(`veiculo DEM1A23 ja existia (${veiculoId})`);
    } else {
      erro(`veiculo recusado: ${veiculo.status} ${JSON.stringify(veiculo.json).slice(0, 300)}`);
    }
  }

  if (veiculoId) {
    const crlv = await enviarImagem(OD, `/driver/vehicles/${veiculoId}/crlv`, tokenMotorista, 'crlv.png');
    if (crlv.status === 200) ok('CRLV enviado');
    else aviso(`CRLV: ${crlv.status} ${JSON.stringify(crlv.json).slice(0, 200)}`);
  }

  passo('MOTORISTA - submissao para analise');
  const submissao = await req(OD, '/driver/submit', { metodo: 'POST', token: tokenMotorista });
  if (submissao.status === 200) ok('enviado para analise (InReview)');
  else aviso(`submit: ${submissao.status} ${JSON.stringify(submissao.json).slice(0, 200)}`);

  passo('MOTORISTA - aprovacao de operador (SQL)');
  const aprovacao = sql(`
    UPDATE opendriver.driver_profiles
       SET status = 'Approved', reviewed_at = now(), rejection_reason = NULL
     WHERE user_id = '${motorista.user.id}'
    RETURNING status;
    UPDATE opendriver.vehicles
       SET status = 'Approved', active = true, rejection_reason = NULL
     WHERE driver_id = '${motorista.user.id}'
    RETURNING plate || '=' || status;
  `);
  ok(`aprovado: ${aprovacao.split('\n').join(' | ')}`);

  passo('MOTORISTA - selecionar veiculo e ficar online');
  if (veiculoId) {
    const sel = await req(OD, `/driver/vehicles/${veiculoId}/current`, { metodo: 'PUT', token: tokenMotorista });
    if (sel.status === 200) ok('veiculo selecionado');
    else erro(`selecao de veiculo: ${sel.status} ${JSON.stringify(sel.json).slice(0, 300)}`);
  }
  const online = await req(OD, '/driver/online', { metodo: 'POST', token: tokenMotorista });
  if (online.status === 200) ok('motorista ONLINE');
  else erro(`ficar online: ${online.status} ${JSON.stringify(online.json).slice(0, 300)}`);

  const euMotorista = dados((await req(OD, '/me', { token: tokenMotorista })).json);
  if (euMotorista?.driver?.status === 'Approved' && euMotorista.driver.isOnline === true) {
    ok('conferido em /me: status=Approved, isOnline=true');
  } else {
    erro(`/me nao confirma: ${JSON.stringify(euMotorista?.driver)}`);
  }

  // ===================== ANUNCIANTE =====================
  passo('ANUNCIANTE (app OpenDriver AD) - conta do ecossistema no hub');
  const anunciante = await cadastrarOuEntrar(HUB, CONTAS.anunciante, 'Passenger', null);
  const tokenAnunciante = anunciante.token;
  resultado.anunciante = { email: CONTAS.anunciante.email, id: anunciante.user.id };

  passo('ANUNCIANTE - adesao no openad');
  const adesao = await req(ADS, '/advertiser/onboarding', {
    metodo: 'POST',
    token: tokenAnunciante,
    corpo: { legalName: 'Conta de demonstracao - Google Play' },
  });
  let advertiserId = null;
  if (adesao.status === 200) {
    advertiserId = adesao.json?.anunciante?.advertiserId ?? adesao.json?.advertiser?.id;
    ok(`anunciante ${adesao.json?.criado ? 'criado' : 'ja existia'}: ${advertiserId}`);
  } else {
    erro(`adesao: ${adesao.status} ${JSON.stringify(adesao.json).slice(0, 400)}`);
  }

  if (advertiserId) {
    passo('ANUNCIANTE - credito de veiculacao (SQL, lancamento adjustment)');
    // Idempotente pela ausencia de outro lancamento `adjustment` para este anunciante.
    const credito = sql(`
      INSERT INTO openad.ad_credit_ledger (advertiser_id, direction, amount_cents, reason)
      SELECT '${advertiserId}', 'credit', ${CREDITO_CENTAVOS}, 'adjustment'
       WHERE NOT EXISTS (
         SELECT 1 FROM openad.ad_credit_ledger
          WHERE advertiser_id = '${advertiserId}' AND reason = 'adjustment'
       );
      SELECT coalesce(sum(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0)
        FROM openad.ad_credit_ledger WHERE advertiser_id = '${advertiserId}';
    `);
    const saldo = Number(credito.split('\n').pop());
    if (saldo >= CREDITO_CENTAVOS) ok(`saldo de credito: R$ ${(saldo / 100).toFixed(2)}`);
    else erro(`saldo inesperado: ${credito}`);
  }

  // ===================== RESUMO =====================
  passo('RESUMO PARA O PLAY CONSOLE');
  console.log('');
  console.log('  App OpenDriver (br.com.opendriver.app)');
  console.log(`    passageiro : ${CONTAS.passageiro.email} / ${SENHA}`);
  console.log(`    motorista  : ${CONTAS.motorista.email} / ${SENHA}   (aprovado e online)`);
  console.log('');
  console.log('  App OpenDriver HUB (br.com.opendriverhub.app)');
  console.log(`    cliente    : ${CONTAS.passageiro.email} / ${SENHA}   (mesma conta, hub e opendriver`);
  console.log('                 compartilham a tabela de usuarios)');
  console.log('');
  console.log('  App OpenDriver AD (br.com.opendriver.ads)');
  console.log(`    anunciante : ${CONTAS.anunciante.email} / ${SENHA}   (R$ ${(CREDITO_CENTAVOS / 100).toFixed(2)} de credito)`);
  console.log('');

  if (falhas === 0) {
    console.log(`${cores.ok}Todas as contas provisionadas e conferidas.${cores.fim}`);
    process.exit(0);
  }
  console.log(`${cores.erro}${falhas} etapa(s) com problema.${cores.fim}`);
  process.exit(1);
}

principal().catch((e) => {
  console.error(`\n${cores.erro}ABORTADO${cores.fim} ${e.message}`);
  process.exit(1);
});
