/**
 * Semeia uma unidade, um produto e a disponibilidade por unidade no parceiro de demonstracao,
 * para que a Frente D possa ser **vista** nas telas.
 *
 * ============================================================================
 * Por que semear pela API, e nao por toques na tela
 * ============================================================================
 *
 * O que falta conferir e a **exibicao**: o painel de unidades com horario e a coluna "Agora",
 * a lista de produto no app, a disponibilidade por unidade, e o catalogo filtrando. Nenhuma
 * dessas telas podia ser vista porque producao nao tinha unidade nem produto.
 *
 * Preencher o formulario por `adb shell input tap` levaria dezenas de toques em campos de
 * latitude, categoria e intervalos de horario — e **nao** provaria nada a mais sobre a
 * exibicao, que e o que esta em questao. Provaria que eu sei tocar na tela.
 *
 * E a API usada aqui e exatamente a que as telas chamam: `POST /partner/stores`,
 * `POST /partner/products`, `PUT /partner/products/:id/stores`. Se o contrato estiver errado,
 * falha aqui do mesmo jeito que falharia na tela.
 *
 * ============================================================================
 * O que os dados exercitam de proposito
 * ============================================================================
 *
 * Duas unidades, nao uma:
 *
 *   "Centro"  horario 08:00-18:00, **aberta** no horario comercial
 *   "Noturna" horario 18:00-02:00, intervalo que **cruza a meia-noite** — o caso que a
 *             validacao de `domain/openingHours.ts` trata com `ate <= de`
 *
 * E tres produtos:
 *
 *   "Lanche"        disponivel SO no Centro      (declarado, uma unidade)
 *   "Cafe"          disponivel nas DUAS          (declarado, duas unidades)
 *   "Cartao brinde" SEM linha de disponibilidade (nao declarado -> todas as unidades)
 *
 * O terceiro e o que importa mais: produto sem linha continua disponivel em todo lugar. Se a
 * leitura tratasse ausencia como indisponivel, o catalogo sumiria no deploy — e e esse caso
 * que a tela tem de mostrar como disponivel.
 *
 * Idempotente. Uso:
 *   node 101-semear-frente-d.mjs
 *   node 101-semear-frente-d.mjs --estado
 *   node 101-semear-frente-d.mjs --remover
 */
const HUB = 'https://hubapi.opendriver.com.br/api/v1';

const argv = process.argv.slice(2);
const i = argv.indexOf('--senha');
const SENHA = i >= 0 ? argv[i + 1] : 'DemoParceiro2026';
const EMAIL = 'demo.parceiro@opendriver.com.br';

const cores = { ok: '\x1b[32m', erro: '\x1b[31m', aviso: '\x1b[33m', fim: '\x1b[0m' };
const passo = (t) => console.log(`\n== ${t}`);
const ok = (t) => console.log(`  ${cores.ok}ok${cores.fim}    ${t}`);
const aviso = (t) => console.log(`  ${cores.aviso}aviso${cores.fim} ${t}`);
const erro = (t) => console.log(`  ${cores.erro}ERRO${cores.fim}  ${t}`);

const UNIDADES = [
  {
    name: '[DEMO] Centro',
    address: 'Rua 14 de Julho, 1000',
    city: 'Campo Grande',
    state: 'MS',
    lat: -20.4697,
    lng: -54.6201,
    category: 'Alimentação',
    timezone: 'America/Campo_Grande',
    openingHours: {
      seg: [{ de: '08:00', ate: '18:00' }],
      ter: [{ de: '08:00', ate: '18:00' }],
      qua: [{ de: '08:00', ate: '18:00' }],
      qui: [{ de: '08:00', ate: '18:00' }],
      sex: [{ de: '08:00', ate: '18:00' }],
      sab: [{ de: '08:00', ate: '12:00' }],
      dom: [],
    },
  },
  {
    name: '[DEMO] Noturna',
    address: 'Av. Afonso Pena, 2000',
    city: 'Campo Grande',
    state: 'MS',
    lat: -20.4486,
    lng: -54.6295,
    category: 'Alimentação',
    timezone: 'America/Campo_Grande',
    // Cruza a meia-noite: `ate` menor que `de`. E o caso que a validacao trata, e o que uma
    // leitura ingenua de "esta aberta?" erra.
    openingHours: {
      seg: [{ de: '18:00', ate: '02:00' }],
      ter: [{ de: '18:00', ate: '02:00' }],
      qua: [{ de: '18:00', ate: '02:00' }],
      qui: [{ de: '18:00', ate: '02:00' }],
      sex: [{ de: '18:00', ate: '03:00' }],
      sab: [{ de: '18:00', ate: '03:00' }],
      dom: [{ de: '18:00', ate: '00:00' }],
    },
  },
];

/**
 * Quatro produtos, cada um exercitando **uma** regra distinta da Frente D.
 *
 * `title` e nao `name`: e o nome do campo em `productUpsertSchema` e na coluna. A primeira
 * versao mandou `name` e levou `400 Required` — erro meu, e o tipo que a tela nunca cometeria
 * porque o formulario e montado a partir do mesmo contrato.
 */
const PRODUTOS = [
  // Declarado em uma unidade: aparece no Centro, nao aparece na Noturna.
  { title: '[DEMO] Lanche', kind: 'Physical', onde: ['[DEMO] Centro'] },
  // Declarado nas duas.
  { title: '[DEMO] Cafe', kind: 'Physical', onde: ['[DEMO] Centro', '[DEMO] Noturna'] },
  // SEM declaracao: `declared = false`, e por decisao fica disponivel em TODAS as unidades.
  // E o caso que, tratado ao contrario, sumiria com o catalogo inteiro no deploy.
  { title: '[DEMO] Salgado sem declaracao', kind: 'Physical', onde: null },
  // Digital: nao e filtrado por unidade nenhuma, porque nao se retira cartao-presente em loja.
  { title: '[DEMO] Cartao brinde digital', kind: 'Digital', onde: null },
];

let token = null;

async function req(caminho, { metodo = 'GET', corpo } = {}) {
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

async function entrar() {
  const r = await req('/auth/login', { metodo: 'POST', corpo: { email: EMAIL, password: SENHA } });
  const d = dados(r.json);
  if (r.status !== 200 || !d?.token) {
    erro(`login: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    process.exit(1);
  }
  token = d.token;
  ok(`entrou como ${EMAIL} (papel ${d.user?.role})`);
}

async function estado() {
  await entrar();

  passo('unidades');
  const s = dados((await req('/partner/stores')).json) ?? [];
  for (const u of s) {
    const h = u.openingHours ? Object.entries(u.openingHours).filter(([, v]) => v?.length).length : 0;
    ok(`${String(u.name).padEnd(22)} ativa=${u.active} fuso=${u.timezone ?? '(padrao)'} dias com horario=${h} aberta agora=${u.openNow ?? '(nao informado)'}`);
  }
  if (!s.length) aviso('nenhuma unidade');

  passo('produtos e disponibilidade');
  const p = dados((await req('/partner/products')).json) ?? [];
  for (const prod of p) {
    const d = dados((await req(`/partner/products/${prod.id}/stores`)).json);
    /**
     * `items` traz **toda** unidade do parceiro, declarada ou nao, porque a tela desenha uma
     * caixa por unidade para o lojista preencher. Unidade nunca preenchida vem com
     * `quantity: 0`, `active: true` e **`updatedAt: null`** — e e o `updatedAt` nulo, nao o
     * `active`, que diz "nunca foi declarada".
     *
     * Minha primeira versao filtrava por um `declaredHere` que **nao existe** no DTO. Como
     * `undefined !== false` e verdadeiro, o filtro passava tudo e o relatorio dizia que o
     * Lanche estava nas duas unidades quando esta so no Centro. Quase registrei isso como
     * defeito do produto: o catalogo le as linhas reais de `product_store_stock` e exige
     * `active && quantity > 0`, entao ele acerta. O errado era a minha leitura.
     */
    const itens = d?.items ?? [];
    const declaradas = itens.filter((l) => l.updatedAt !== null && l.active && l.quantity > 0);
    ok(
      `${String(prod.title ?? prod.name).padEnd(30)} estoque=${prod.stock} ` +
        `declarado=${d?.declared} unidades_na_lista=${itens.length} ` +
        `onde_retira=${d?.declared ? declaradas.map((l) => l.storeName).join('/') || '(nenhuma)' : 'todas'}`
    );
  }
  if (!p.length) aviso('nenhum produto');
}

async function semear() {
  await entrar();

  passo('1. unidades (POST /partner/stores — o que a tela de unidades chama)');
  const existentes = dados((await req('/partner/stores')).json) ?? [];
  const porNome = new Map(existentes.map((u) => [u.name, u]));
  for (const u of UNIDADES) {
    if (porNome.has(u.name)) {
      ok(`${u.name} ja existe`);
      continue;
    }
    const r = await req('/partner/stores', { metodo: 'POST', corpo: u });
    if (r.status >= 300) {
      erro(`${u.name}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
      process.exit(1);
    }
    const criada = dados(r.json);
    porNome.set(u.name, criada);
    ok(`${u.name} criada  (fuso ${criada.timezone}, aberta agora ${criada.openNow})`);
  }

  passo('2. produtos (POST /partner/products)');
  const prodsExistentes = dados((await req('/partner/products')).json) ?? [];
  const prodPorNome = new Map(prodsExistentes.map((p) => [p.title ?? p.name, p]));
  for (const p of PRODUTOS) {
    if (prodPorNome.has(p.title)) {
      ok(`${p.title} ja existe`);
      continue;
    }
    const r = await req('/partner/products', {
      metodo: 'POST',
      corpo: {
        title: p.title,
        description: 'Item de demonstracao, para conferir a tela. Pode ser apagado.',
        price: 19.9,
        cashbackPercent: 5,
        kind: p.kind,
        stock: 50,
        category: 'Alimentação',
        imageUrl: '',
      },
    });
    if (r.status >= 300) {
      erro(`${p.title}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
      process.exit(1);
    }
    prodPorNome.set(p.title, dados(r.json));
    ok(`${p.title} criado (${p.kind})`);
  }

  passo('3. disponibilidade por unidade (PUT /partner/products/:id/stores)');
  for (const p of PRODUTOS) {
    const prod = prodPorNome.get(p.title);
    if (!prod) continue;
    if (p.onde === null) {
      ok(`${p.title}: SEM declaracao de proposito (fica disponivel em todas)`);
      continue;
    }
    // `items`, nao `stores`: e o nome em `productStoreStockSchema`. Segundo chute errado meu
    // de nome de campo nesta sessao, e pelo mesmo motivo do primeiro — eu escrevi o corpo de
    // cabeca em vez de ler o contrato.
    const corpo = {
      items: p.onde.map((nome) => ({
        storeId: porNome.get(nome).id,
        quantity: 10,
        active: true,
      })),
    };
    const r = await req(`/partner/products/${prod.id}/stores`, { metodo: 'PUT', corpo });
    if (r.status >= 300) {
      erro(`${p.title}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
      process.exit(1);
    }
    ok(`${p.title}: declarado em ${p.onde.join(', ')}`);
  }

  await estado();
  console.log('');
  console.log('Pronto. Agora as telas tem o que exibir:');
  console.log('  web  https://hub.opendriver.com.br/parceiro/unidades   horario e coluna "Agora"');
  console.log('  web  https://hub.opendriver.com.br/parceiro/catalogo   disponibilidade por unidade');
  console.log('  app  Parceiro -> Produtos                              lista e edicao');
  console.log('  app  Parceiro -> Venda (conta financeiro)               balcao com seletor de unidade');
  console.log('  catalogo publico: precisa --ativar no 100-parceiro-de-demonstracao.mjs');
}

async function remover() {
  await entrar();
  passo('removendo produtos e unidades de demonstracao');
  const p = dados((await req('/partner/products')).json) ?? [];
  for (const prod of p.filter((x) => String(x.title ?? x.name).startsWith('[DEMO]'))) {
    const r = await req(`/partner/products/${prod.id}`, { metodo: 'DELETE' });
    ok(`produto ${prod.title ?? prod.name}: ${r.status}`);
  }
  const s = dados((await req('/partner/stores')).json) ?? [];
  for (const u of s.filter((x) => String(x.name).startsWith('[DEMO]'))) {
    const r = await req(`/partner/stores/${u.id}`, { metodo: 'DELETE' });
    ok(`unidade ${u.name}: ${r.status}`);
  }
  await estado();
}

async function principal() {
  if (argv.includes('--estado')) return estado();
  if (argv.includes('--remover')) return remover();
  if (argv.includes('--catalogo')) return catalogo();
  return semear();
}

principal().catch((e) => {
  erro(e.message);
  process.exit(1);
});

/**
 * Confere o **filtro do catalogo**, que e o lado do cliente da Frente D.
 *
 * Esta e a parte que nenhuma tela podia mostrar antes, porque producao nao tinha produto. As
 * quatro perguntas, e o que cada resposta significa:
 *
 *   sem filtro            -> os quatro produtos aparecem
 *   storeId = Centro      -> Lanche, Cafe, Salgado e Cartao (o Lanche so existe aqui, e os
 *                            nao declarados valem em todo lugar)
 *   storeId = Noturna     -> Cafe, Salgado e Cartao. **Sem o Lanche** — e esse "sem" que prova
 *                            o filtro por unidade; os outros tres apareceriam de qualquer jeito
 *   openNow = true        -> so o que da para retirar agora. As 22h, Centro esta fechada e
 *                            Noturna aberta, entao o Lanche sai e o resto fica
 *
 * O caso que importa mais e o produto **sem declaracao**: ele tem de aparecer nas duas
 * unidades. Se a leitura tratasse ausencia de linha como indisponivel, o catalogo de producao
 * teria sumido no deploy — e e um "nao aparece" que ninguem nota ate um lojista reclamar.
 */
async function catalogo() {
  await entrar();
  const unidades = dados((await req('/partner/stores')).json) ?? [];
  const porNome = new Map(unidades.map((u) => [u.name, u]));

  const nomes = (lista) =>
    (lista ?? [])
      .map((p) => p.title ?? p.name)
      .filter((n) => String(n).startsWith('[DEMO]'))
      .map((n) => String(n).replace('[DEMO] ', ''))
      .sort();

  async function consultar(rotulo, qs) {
    const r = await fetch(`${HUB}/catalog${qs}`);
    const j = await r.json().catch(() => null);
    const d = j && typeof j === 'object' && 'data' in j ? j.data : j;
    const lista = Array.isArray(d) ? d : (d?.items ?? d?.products ?? []);
    ok(`${rotulo.padEnd(34)} ${r.status}  ${nomes(lista).join(', ') || '(nenhum [DEMO])'}`);
    return nomes(lista);
  }

  passo('catalogo publico');
  await consultar('sem filtro', '?limit=100');
  const centro = porNome.get('[DEMO] Centro');
  const noturna = porNome.get('[DEMO] Noturna');
  if (centro) await consultar('storeId = Centro (fechada)', `?limit=100&storeId=${centro.id}`);
  if (noturna) await consultar('storeId = Noturna (aberta)', `?limit=100&storeId=${noturna.id}`);
  await consultar('openNow = true', '?limit=100&openNow=true');

  passo('leitura');
  console.log('  O Lanche deve sair na Noturna e no openNow (o Centro esta fechado as 22h).');
  console.log('  Salgado e Cartao devem aparecer em TODAS: produto sem declaracao vale em');
  console.log('  qualquer unidade, e e o caso que, tratado ao contrario, sumiria com o catalogo.');
}
