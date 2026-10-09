/**
 * Provisiona um parceiro de demonstracao para conferir a Frente D no aparelho.
 *
 * ============================================================================
 * Por que e necessario
 * ============================================================================
 *
 * A Frente D (estoque por unidade, horario de funcionamento, gestao de produto no app) nao
 * pode ser conferida na tela porque producao tem **4 parceiros e zero unidades e zero
 * produtos**, e nenhuma credencial de parceiro esta disponivel. O catalogo abre e responde
 * "0 resultados", o que prova que a tela nao quebrou com os parametros novos (`storeId`,
 * `openNow`) e **nao** prova que o filtro por unidade funciona: nao ha o que filtrar.
 *
 * ============================================================================
 * O que e feito pela API publica, e o que e feito por SQL
 * ============================================================================
 *
 * Mesma divisao do `45-contas-demo.mjs`, pelo mesmo motivo: **ato de usuario vai pela API,
 * ato de operador vai por SQL**.
 *
 *   API publica  `POST /auth/register/partner`  cria o parceiro **e** a conta do dono numa
 *                                               transacao. Existe autoatendimento para isso,
 *                                               entao criar o parceiro por SQL seria inventar
 *                                               um caminho que o produto nao usa. De brinde,
 *                                               exercita `avatarPadrao()` no cadastro — parte
 *                                               da Frente C.
 *   SQL          `users.role`, `partnerId`      vincula a conta do **financeiro**. Nao ha
 *                                               autoatendimento para o parceiro criar equipe;
 *                                               e ato de operador, e sao exatamente os dois
 *                                               campos que `adminUserUpdateSchema` altera.
 *   SQL          `partners.active`              liga e desliga no catalogo publico.
 *
 * A primeira versao deste script criava o parceiro por SQL, antes de eu notar que
 * `POST /auth/register/partner` existe. Ficou registrado porque e o erro tipico: replicar por
 * script um caminho que o produto ja tem, e com isso testar o script em vez do produto.
 *
 * **Nada mais.** Unidade, horario, produto e disponibilidade por unidade sao criados pelas
 * **telas**, no aparelho — e e isso que esta sendo conferido. Criar por script o que se quer
 * testar na tela provaria apenas que o script funciona.
 *
 * ============================================================================
 * Por que `active = false` no parceiro
 * ============================================================================
 *
 * Parceiro ativo entra no catalogo **publico**. Um "Parceiro de Demonstracao" visivel a
 * qualquer cliente e poluicao em producao, e nao e reversivel por desfazer: alguem pode ve-lo
 * no intervalo.
 *
 * Entao ele nasce inativo, e a conferencia do catalogo liga e desliga de proposito: ligar e
 * parte do teste (o produto tem de aparecer), e desligar em seguida devolve o catalogo ao
 * estado anterior. O `--remover` apaga tudo.
 *
 * Idempotente: rodar de novo nao duplica. Uso:
 *   node 100-parceiro-de-demonstracao.mjs            # cria (inativo)
 *   node 100-parceiro-de-demonstracao.mjs --ativar   # liga no catalogo
 *   node 100-parceiro-de-demonstracao.mjs --desativar
 *   node 100-parceiro-de-demonstracao.mjs --estado
 *   node 100-parceiro-de-demonstracao.mjs --remover  # apaga parceiro, unidades, produtos e contas
 */
import { spawnSync } from 'node:child_process';

const HUB = 'https://hubapi.opendriver.com.br/api/v1';
const PG_CONTAINER = 'l5bcr9slmgtmeefkqwg5amia';
const PG_DB = 'hub';
const PG_USER = 'postgres';

const argv = process.argv.slice(2);
const i = argv.indexOf('--senha');
const SENHA = i >= 0 ? argv[i + 1] : 'DemoParceiro2026';

const NOME_PARCEIRO = '[DEMO] Parceiro de Conferencia';

const DONO = {
  nome: 'Dono Demo Parceiro',
  email: 'demo.parceiro@opendriver.com.br',
  papel: 'Partner',
};

/**
 * Conta de papel `Financeiro`, no mesmo parceiro.
 *
 * Existe para conferir o conserto da Frente D: a rota `parceiro/venda` nao era registrada
 * para esse papel e o balcao de resgate caia em "nao encontrado". Sem uma conta assim, aquele
 * conserto nao tem como ser visto na tela.
 */
const FINANCEIRO = {
  nome: 'Financeiro Demo Parceiro',
  email: 'demo.financeiro@opendriver.com.br',
  papel: 'Financeiro',
};

const CONTAS = [DONO, FINANCEIRO];

/**
 * CNPJ com digitos verificadores validos, porque `isValidPartnerDocument` recusa invalido.
 *
 * Numero montado a partir de uma raiz improvavel de existir, e os dois digitos calculados —
 * nao copiado de empresa real. Documento de terceiro em dado de teste e o tipo de coisa que
 * depois aparece numa consulta e assusta quem le.
 */
function cnpjValido(raiz12) {
  const calc = (base, pesos) => {
    const s = base.reduce((a, d, i) => a + d * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d = raiz12.split('').map(Number);
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calc(d, p1);
  const d2 = calc([...d, d1], p2);
  return `${raiz12}${d1}${d2}`;
}
const CNPJ = cnpjValido('000000000191'.slice(0, 12));

const cores = { ok: '\x1b[32m', erro: '\x1b[31m', aviso: '\x1b[33m', fim: '\x1b[0m' };
const passo = (t) => console.log(`\n== ${t}`);
const ok = (t) => console.log(`  ${cores.ok}ok${cores.fim}    ${t}`);
const aviso = (t) => console.log(`  ${cores.aviso}aviso${cores.fim} ${t}`);
const erro = (t) => console.log(`  ${cores.erro}ERRO${cores.fim}  ${t}`);

/**
 * SQL no Postgres de producao.
 *
 * `spawnSync` com vetor de argumentos e sem shell: o PowerShell come barra invertida e aspas
 * simples ao repassar para executavel nativo — foi assim que um `sed -i 's/\r$//'` virou
 * `s/r$//` e apagou o `r` final de cada linha de um compose em producao.
 */
function sql(texto) {
  /**
   * Uma linha so, antes de `JSON.stringify`.
   *
   * O SQL aqui e escrito em varias linhas para ser legivel, e `JSON.stringify` transforma
   * cada quebra no **texto** `\n`. O shell remoto repassa isso literal, e o psql recebe uma
   * barra invertida solta no meio da consulta: `syntax error at or near "\"`. Achatar antes
   * resolve sem precisar escrever SQL ilegivel em uma linha.
   */
  const umaLinha = texto.replace(/\s+/g, ' ').trim();
  const r = spawnSync(
    'ssh',
    ['-o', 'BatchMode=yes', 'opendriver', `docker exec ${PG_CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -At -F '|' -v ON_ERROR_STOP=1 -c ${JSON.stringify(umaLinha)}`],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) {
    throw new Error(`psql falhou: ${(r.stderr || r.stdout || '').trim()}`);
  }
  return (r.stdout || '').trim();
}

async function req(caminho, { metodo = 'GET', corpo, token } = {}) {
  const cab = {};
  if (token) cab.Authorization = `Bearer ${token}`;
  if (corpo) cab['Content-Type'] = 'application/json';
  const r = await fetch(`${HUB}${caminho}`, {
    method: metodo,
    headers: cab,
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

const dados = (j) => (j && typeof j === 'object' && 'data' in j ? j.data : j);

function estado() {
  passo('parceiro de demonstracao');
  const p = sql(
    `select id, active, (select count(*) from partner_stores s where s.partner_id = partners.id),
            (select count(*) from products pr where pr.partner_id = partners.id)
       from partners where name = '${NOME_PARCEIRO}'`
  );
  if (!p) {
    aviso('nao existe');
    return null;
  }
  const [id, ativo, unidades, produtos] = p.split('|');
  ok(`id ${id}`);
  ok(`no catalogo: ${ativo === 't' ? 'SIM (ativo)' : 'nao (inativo)'}`);
  ok(`unidades ${unidades}   produtos ${produtos}`);

  passo('contas vinculadas');
  const us = sql(
    `select email, role, coalesce(partner_id::text,'(sem parceiro)') from users
      where email in (${CONTAS.map((c) => `'${c.email}'`).join(',')}) order by email`
  );
  if (!us) aviso('nenhuma conta criada');
  else for (const l of us.split('\n')) {
    const [email, papel, pid] = l.split('|');
    ok(`${email.padEnd(40)} ${papel.padEnd(11)} ${pid}`);
  }

  passo('disponibilidade por unidade');
  const d = sql(
    `select count(*) from product_store_stock s
      join products pr on pr.id = s.product_id
     where pr.partner_id = (select id from partners where name = '${NOME_PARCEIRO}')`
  );
  ok(`linhas em product_store_stock: ${d || 0}`);
  return id;
}

function ligar(valor) {
  const r = sql(
    `update partners set active = ${valor} where name = '${NOME_PARCEIRO}' returning id, active`
  );
  if (!r) {
    erro('parceiro nao existe');
    process.exit(1);
  }
  ok(`active = ${r.split('|')[1]}`);
}

function remover() {
  passo('removendo');
  // Ordem importa: as contas apontam para o parceiro, e `users.partner_id` tem FK.
  sql(
    `update users set partner_id = null, role = 'Passenger'
      where email in (${CONTAS.map((c) => `'${c.email}'`).join(',')})`
  );
  ok('contas desvinculadas e rebaixadas a Passenger');
  // `product_store_stock` sai por CASCADE do produto e da unidade.
  const n = sql(
    `with p as (select id from partners where name = '${NOME_PARCEIRO}')
     , a as (delete from products where partner_id in (select id from p) returning 1)
     , b as (delete from partner_stores where partner_id in (select id from p) returning 1)
     select (select count(*) from a), (select count(*) from b)`
  );
  ok(`produtos e unidades apagados: ${n}`);
  sql(`delete from partners where name = '${NOME_PARCEIRO}'`);
  ok('parceiro apagado');
  aviso('as duas contas continuam existindo, como Passenger sem parceiro. Apagar usuario e');
  aviso('ato separado e passa pela exclusao de conta, que tem fan-out para os outros servicos.');
}

async function criar() {
  passo('1. parceiro e conta do dono, por autoatendimento (POST /auth/register/partner)');
  let partnerId = sql(`select id from partners where name = '${NOME_PARCEIRO}'`);
  if (partnerId) {
    ok(`parceiro ja existe: ${partnerId}`);
  } else {
    const r = await req('/auth/register/partner', {
      metodo: 'POST',
      corpo: {
        name: DONO.nome,
        email: DONO.email,
        password: SENHA,
        storeName: NOME_PARCEIRO,
        segment: 'Alimentação',
        cnpj: CNPJ,
        documentType: 'CNPJ',
        city: 'Campo Grande',
        state: 'MS',
        lat: -20.4697,
        lng: -54.6201,
      },
    });
    if (r.status >= 300) {
      erro(`register/partner: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
      process.exit(1);
    }
    partnerId = sql(`select id from partners where name = '${NOME_PARCEIRO}'`);
    ok(`parceiro criado: ${partnerId}`);
    // Nasce `active = true` no autoatendimento. Desligar imediatamente: parceiro de teste
    // visivel no catalogo publico e poluicao, e "por pouco tempo" nao e reversivel.
    sql(`update partners set active = false where id = '${partnerId}'`);
    ok('desligado do catalogo publico (active = false)');
    // O avatar do parceiro e do dono vem de `avatarPadrao()` — string vazia, e cada cliente
    // desenha as iniciais. Conferir aqui prova a Frente C no caminho de cadastro.
    const av = sql(
      `select case when coalesce(logo_url,'') = '' then 'vazio (iniciais no cliente)' else logo_url end
         from partners where id = '${partnerId}'`
    );
    ok(`logo do parceiro: ${av}`);
  }

  passo('2. conta do financeiro');
  const temFin = sql(`select id from users where email = '${FINANCEIRO.email}'`);
  if (temFin) {
    ok(`${FINANCEIRO.email} ja existe`);
  } else {
    const r = await req('/auth/register', {
      metodo: 'POST',
      corpo: {
        name: FINANCEIRO.nome,
        email: FINANCEIRO.email,
        password: SENHA,
        role: 'Passenger',
      },
    });
    if (r.status >= 300) {
      erro(`register: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
      process.exit(1);
    }
    ok(`${FINANCEIRO.email} criada`);
  }

  passo('3. vinculo do financeiro (SQL: os dois campos que adminUserUpdateSchema altera)');
  const v = sql(
    `update users set role = '${FINANCEIRO.papel}', partner_id = '${partnerId}'
      where email = '${FINANCEIRO.email}' returning email, role`
  );
  ok(v.replace('|', ' -> '));

  passo('4. conferencia');
  for (const c of CONTAS) {
    const r = await req('/auth/login', {
      metodo: 'POST',
      corpo: { email: c.email, password: SENHA },
    });
    const d = dados(r.json);
    // `token`, nao `accessToken`: a primeira versao olhava o nome errado e reprovava um login
    // que respondia 200 (`AuthResponse` do hub e `{ token, refreshToken, user }`).
    const token = d?.token;
    if (r.status === 200 && token) {
      ok(`login de ${c.email}: papel ${d.user?.role}, parceiro ${d.user?.partnerId ?? '(nenhum)'}`);
      // A rota de unidades e a porta de entrada da Frente D; se ela responde, a tela abre.
      const s = await req('/partner/stores', { token });
      const lista = dados(s.json);
      ok(`  GET /partner/stores -> ${s.status} (${Array.isArray(lista) ? lista.length : '?'} unidade(s))`);
      const p = await req('/partner/products', { token });
      const prods = dados(p.json);
      ok(`  GET /partner/products -> ${p.status} (${Array.isArray(prods) ? prods.length : '?'} produto(s))`);
    } else {
      erro(`login de ${c.email}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    }
  }

  console.log('');
  console.log('Pronto. O parceiro esta INATIVO: nao aparece no catalogo publico ainda.');
  console.log('Unidade, horario, produto e disponibilidade devem ser criados PELAS TELAS.');
  console.log('Para a conferencia do catalogo: --ativar, conferir, e --desativar em seguida.');
  console.log(`Senha das duas contas: a passada em --senha (padrao do script).`);
}

async function principal() {
  if (argv.includes('--estado')) {
    estado();
    return;
  }
  if (argv.includes('--remover')) {
    remover();
    estado();
    return;
  }
  if (argv.includes('--ativar')) {
    ligar('true');
    return;
  }
  if (argv.includes('--desativar')) {
    ligar('false');
    return;
  }
  await criar();
}

principal().catch((e) => {
  erro(e.message);
  process.exit(1);
});
