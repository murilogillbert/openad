# Plano da versão 2 — ecossistema OpenDriver

Levantamento feito em 2026-10-05 por leitura dos quatro repositórios (`openad`, `hub`,
`hub-mobile`, `opendriver`). Cada afirmação abaixo tem arquivo e linha. Onde eu não verifiquei
em execução, está dito.

A versão 1 está publicada: OpenDriver HUB aprovado, OpenDriver e OpenDriver Anúncios
aprovados na segunda submissão. Isso muda a natureza do trabalho — ver
[Restrição de compatibilidade](#restrição-de-compatibilidade).

---

## 1. Respostas curtas

| Pergunta | Resposta apurada |
| --- | --- |
| Como o anunciante paga para veicular? | **Hoje não paga.** As tabelas existem, não há uma única escrita, e a veiculação não consulta saldo. Campanha vai ao ar de graça. |
| Como o usuário troca a foto no HUB e no OpenDriver? | **Só pelo site do hub.** Os dois apps apenas exibem o avatar. |
| Como as pessoas pagam? | Cartão e Pix, implementados de verdade nos dois backends. **Mas o provedor ativo é `mock` por padrão.** |
| O parceiro gerencia produtos e unidades pelo app? | **Não.** O app tem só o resgate de voucher; as outras 27 rotas de parceiro são exclusivas da web. |
| O Asaas está configurado, faltando só colar os dados no admin e redeployar? | **Quase.** A chave entra pela tela e vale na hora, sem redeploy. Mas **ligar** o Asaas (sair do `mock`) é variável de ambiente lida no boot — essa parte exige redeploy. |
| Onde defino a lista de modelos econômico/conforto? | **Não existe esse lugar.** A categoria é escolha do motorista, sem nenhuma regra. Proposta na [Frente E](#frente-e--categoria-de-veículo-automática). |
| A consulta por RENAVAM está ligada à API? | Cliente implementado e chamado no cadastro, mas provider default é `mock`, cobertura só **MT e MS**, e `chassi` nunca é enviado. |

---

## 2. O risco que eu trataria antes de qualquer outro

**Campanha veicula sem crédito pago.** Não é um recurso faltando, é receita saindo pela porta.

`CampaignEligibilityService.resolveEligible`
(`app/openad-api/src/modules/manifest/generators/campaign-eligibility.service.ts:77-130`)
aplica três critérios para decidir se um anúncio vai ao tablete: `status: 'active'`, instante
dentro de `scheduledStart..scheduledEnd`, e pacing diário diferente de `paused`. O serviço nem
injeta o Prisma — ele não tem como consultar saldo.

O teto que pausa a campanha é `campaigns.budget`, um valor **declarado pelo anunciante na
criação**, não dinheiro recebido. E o "gasto" que alimenta o pacing
(`pacing-signal.service.ts:62-105`) incrementa `campaign_daily_spend` no Mongo — nunca emite
`direction: 'debit'`, `reason: 'campaign_spend'` no `ad_credit_ledger`.

Hoje, em produção, o caminho completo é: aderir → criar campanha com orçamento que o próprio
anunciante digita → subir criativo → passar pela moderação → veicular na frota → **e o
motorista é creditado de verdade** (`repasse.creditado`, confirmado em produção com 71 play
records). Ou seja, a plataforma paga o motorista com dinheiro que nunca entrou.

As três campanhas ativas hoje são da conta de demonstração, então o prejuízo atual é zero. Com
anunciante real, não é.

---

## 3. Restrição de compatibilidade

Os três apps estão aprovados e instalados. Isso impõe:

- **Mudança de API tem de ser aditiva.** Campo novo em resposta, rota nova: sim. Campo que
  vira obrigatório em requisição, rota que muda semântica, campo removido: não. Um app na
  versão antiga continua chamando a API por tempo indeterminado.
- **Mudança de app custa uma submissão.** Cada frente que mexe em app mobile tem latência de
  revisão e uma fração de usuários que não atualiza. Vale agrupar as mudanças de app numa leva
  só por aplicativo, em vez de submeter a cada ajuste.
- **O que não tem esse custo:** `openad-api`, `openad-management`, backend do hub, backend do
  opendriver, frontend web do hub, e o APK do tablete (instalado por cabo).

Consequência de planejamento: priorizar o que é só servidor e web rende valor sem fila de
revisão. É por isso que a ordem no fim deste documento não segue a ordem de importância.

---

## Frente A — pagamento do anunciante

### O que já existe

Mais do que parece. A modelagem está pronta e bem pensada:

- `AdCreditPurchase` (`app/openad-api/prisma/schema.prisma:192-219`) com `store` (apple|google),
  `productSku`, `creditCents`, `priceCents`, `storeFeeCents`, `transactionId`, `receiptStatus`.
- `AdCreditLedger` (`:228-249`), append-only, saldo é a soma. Separado do cashback do hub de
  propósito, e o comentário explica por quê: crédito de veiculação não é sacável, e se caísse
  em `public.users.cashback_balance` a loja o trataria como valor armazenado equivalente a
  dinheiro — o que é recusado na revisão.
- **A trava de idempotência já está no banco**: índice único `(store, transaction_id)` em
  `prisma/migrations/20261003000000_init_openad/migration.sql:92`. É exatamente o que impede o
  mesmo recibo creditar duas vezes quando a loja reenvia.
- Uma leitura de saldo funcionando, em `account-purge.service.ts:161-181`, usada para impedir
  exclusão de conta com crédito não consumido.

### O que falta

Tudo que escreve. Zero rotas, zero serviços, zero workers, nenhuma lib de IAP no app
(`app/openad-advertiser/package.json` não tem `react-native-iap`, `expo-in-app-purchases` nem
RevenueCat), nenhum webhook de loja (`grep webhook` em `openad-api/src` não retorna nada).
`receiptStatus` nunca sai de `pending`.

### O que fazer

1. **Validação de recibo no servidor.** Google Play Developer API
   `purchases.products.get` e App Store Server API. É o único lugar onde `receiptStatus` pode
   virar `validated` com segurança. Validar no cliente é o erro clássico: o recibo é
   falsificável.
   > A credencial do Google já existe e já é usada: a conta de serviço
   > `publicador-eas@lateral-pillar-454914-g5` com escopo `androidpublisher`, hoje usada pelos
   > scripts de publicação em `infra/server/`. Falta conceder a permissão de **ver compras
   > financeiras** no Play Console e reaproveitar o mesmo JWT.
2. **`POST /advertiser/credits/purchases`** recebendo `{ store, productSku, transactionId, receipt }`.
   Valida o recibo, e numa transação Prisma grava `AdCreditPurchase` + `AdCreditLedger`
   (`credit`/`purchase`). A idempotência é o índice único — repetir devolve 200 com o
   lançamento existente, não erro.
3. **Produtos de crédito** cadastrados nas duas lojas, e `GET /advertiser/credits/products`
   para o app não ter SKU compilado.
4. **`GET /advertiser/credits/balance`** para a tela de conta.
5. **Portão de saldo na veiculação.** Aqui há uma decisão de produto que eu não tomo sozinho:
   bloquear no `submit`/aprovação (anunciante só submete com saldo suficiente para o orçamento)
   ou no `resolveEligible` (campanha sai do ar quando o saldo zera). A segunda é mais justa e
   mais arriscada: exige consulta por ciclo de manifesto, e um erro ali derruba a veiculação
   inteira. Eu faria **as duas**, com a do `resolveEligible` em cache curto.
6. **Débito por veiculação faturável.** Estender o ponto que hoje chama
   `recordBillablePlayCost` para emitir também o `debit`/`campaign_spend`. O gancho já existe e
   é idempotente por play record (`analytics-reconciliation.processor.ts:165-176`).
7. **Webhooks de estorno** (RTDN do Google, ASSN V2 da Apple) → lançamento compensatório.
   Sem isso, reembolso na loja vira crédito de graça.
8. **Tela de compra no app do anunciante** — a única parte que custa submissão.

### Alternativa que vale considerar

> **Decidido em 2026-10-07 (PDF de monetização):** a compra de crédito é no **painel web, por Pix**,
> e o app do anunciante fica só de gestão, sem compra. A compra dentro do app (IAP), e com ela o
> A.8, sai do escopo. A regra de consumo do crédito está na Frente H.

O Asaas já está integrado no hub, com split por carteira. Cobrar o anunciante por **Pix**, e
não por in-app purchase, evita a taxa de 15–30% da loja e todo o item 1 e 7 acima. O custo:
a política de pagamentos do Google exige in-app purchase para "bens digitais consumidos dentro
do app" — e crédito de veiculação provavelmente se encaixa. Pix funcionaria sem risco se a
compra acontecesse **fora do app**, num painel web do anunciante. Isso é uma decisão de
produto e de risco de loja, não técnica, e eu recomendaria consultar a política antes de
escolher. Um painel web do anunciante também resolveria a Frente D de graça.

### Esforço e risco

Grande. É a frente mais pesada do plano, e a única com dependência externa (revisão de
produtos nas lojas). Risco de implementação médio; risco de **não** fazer, alto.

---

## Frente B — ligar o Asaas de verdade

### O que já existe

A integração é real e completa nos dois backends, e melhor do que eu esperava:

- **Hub** (`backend/src/infra/paymentGateways/asaas.ts`): tokeniza o cartão no próprio backend
  (`POST creditCard/tokenizeCreditCard`, linhas 226-272), Pix com QR
  (`payments/{id}/pixQrCode`), e **split automático** entre parceiros por `asaasWalletId`
  (linhas 53-69).
- **OpenDriver** (`backend/src/infra/payments/asaas.ts`): `tokenizeCard`, `chargeCard`,
  `createPix`, um `AsaasCustomer` por usuário. A corrida é cobrada em
  `settlement.service.ts:52-119` (`settleRide`), idempotente, com lock, abatendo cashback
  primeiro e caindo para Pix quando o cartão não tem token.
- Webhooks dos dois com comparação de token em tempo constante (`crypto.timingSafeEqual`), e —
  detalhe bem feito — o opendriver **nunca confia no corpo do webhook**: reconsulta o status no
  Asaas (`payments.routes.ts:66`).
- **As credenciais são configuráveis pela tela de admin.** Tabela `integration_settings`,
  catálogo em `hub/backend/src/services/settingsService.ts` (grupo `asaas`, linhas 38-51),
  precedência banco > env (`settingsProvider.ts:4-10`), segredo mascarado na leitura e nunca
  registrado em auditoria. Valor vazio apaga a linha e volta ao `.env`.

### O que falta

Uma linha, e é a que importa: **`PAYMENT_PROVIDER` não está no catálogo.** Ela é lida no boot
(`opendriver/backend/src/config.ts:54`; no hub, `config.paymentProvider`) e o **default é
`mock`**. O gateway mock gera um QR falso `https://mock.local/pix/...` e **aprova sozinho após
5 minutos** (`paymentGateways/mock.ts:61-63`).

Então a resposta exata à sua pergunta: colar a API key na tela de admin funciona e vale na
hora. Mas enquanto `PAYMENT_PROVIDER` não for `asaas` no ambiente, nada disso é usado — e, pior,
o sistema **finge** que cobrou.

Também falta, e é menor: **boleto não existe** em nenhum dos dois repositórios. Débito é
mapeado para `CREDIT_CARD` no Asaas (`dtos/orders.dto.ts:76`).

### O que fazer

1. Acrescentar `Payments:Provider` ao catálogo de `settingsService.ts`, e trocar a leitura de
   `config.paymentProvider` por `getSetting` com cache curto — o mesmo padrão que
   `Infosimples:Token` já usa (`infosimples.ts:50-56`, cache de 30 s). Aí o provedor passa a
   ser chaveável pela tela, sem redeploy, nos dois serviços.
2. **Um sinal visível de que o pagamento é simulado.** Hoje, com `mock`, a diferença entre
   "cobrou" e "fingiu que cobrou" não aparece em nenhum lugar da interface. Um aviso no admin
   quando o provedor ativo é `mock` evita a pior falha possível aqui: descobrir semanas depois
   que nenhum pedido foi pago de verdade.
3. Conferir em produção se `integration_settings` tem as chaves do Asaas preenchidas. Não
   verifiquei — a leitura exige acesso ao banco com a aplicação de pé, e
   `opendriver/docs/plano-producao-final.md:32-79` sugere que **não** estão.

### Esforço e risco

Pequeno e alto retorno. É a melhor relação do plano. Risco: trocar para `asaas` em produção
expõe cobrança real — fazer em sandbox primeiro, com `Asaas:Environment=sandbox`.

---

## Frente C — foto de perfil nos apps

### O que já existe

- Rota de upload no hub: `POST /api/v1/uploads/image`
  (`hub/backend/src/routes/uploads.routes.ts:13`), qualquer usuário autenticado, multer em
  memória, 10 MB. Valida pelos **magic bytes**, não pelo content-type do cliente
  (`minioStorage.ts:22-46`) — aceita JPEG, PNG e WEBP. Grava no MinIO e devolve a URL.
- A persistência é do cliente: `uploadsApi.image(file)` → `authApi.updateProfile({ avatarUrl })`.
  O site do hub faz isso em `AccountSettingsCards.tsx:30-43`.
- O backend do opendriver **aceita** `avatarUrl` no `PUT /me/profile`
  (`auth.service.ts:66`, `:208`).

### O que falta

Interface nos apps. Nenhum dos dois permite trocar a foto:

- `hub-mobile` não tem `expo-image-picker` nem no `package.json`. A tela de conta só exibe
  (`src/app/(tabs)/conta.tsx:77`), e `conta/perfil.tsx` tem nome, e-mail, celular e CPF — sem
  foto. O client até tipa `avatarUrl?` em `updateProfile` (`src/api/endpoints.ts:53`), e
  nenhuma tela passa o campo.
- `opendriver/mobile` **tem** `expo-image-picker`, mas só para documentos do motorista e
  anexo de denúncia. `AccountScreen.tsx:77` é display-only.
- O opendriver não tem rota de upload própria — só o hub produz URL de avatar.

Por padrão o avatar é gerado pelo **DiceBear** (`https://api.dicebear.com/9.x/avataaars/svg?seed=`),
gravado no banco no cadastro. Vale registrar o que isso significa: a foto de todo usuário que
nunca trocou depende de um serviço de terceiro estar no ar em tempo de execução.

### O que fazer

1. `hub-mobile`: adicionar `expo-image-picker`, um botão na tela de perfil, e a sequência
   upload → `updateProfile({ avatarUrl })`. É a mudança menor, e o backend já aceita.
2. `opendriver/mobile`: o mesmo, apontando o upload para a rota **do hub**. O app já tem o
   picker; falta a tela e a chamada. Alternativa mais limpa: criar
   `POST /api/v1/uploads/image` também no opendriver, para o app não depender de dois hosts.
3. Trocar o DiceBear por avatar gerado localmente (iniciais sobre cor derivada do nome).
   Remove uma dependência externa de runtime e some com uma chamada a terceiro por usuário
   exibido.

### Esforço e risco

Pequeno, mas custa submissão nos dois apps. Candidato natural a entrar junto com a Frente D no
`hub-mobile`.

---

## Frente D — parceiro no app

### O que já existe

O backend do hub expõe **28 rotas** em `/api/v1/partner`
(`hub/backend/src/routes/partner.routes.ts`, montadas em `app.ts:71`), com guard
`requireRole('Partner','Admin')` e tenant resolvido do token (`partnerId(req)`):

- Produtos: CRUD completo (`:22`, `:26`, `:30`, `:34`). Preço, estoque e foto são campos do
  mesmo upsert (`productUpsertSchema`, `dtos/catalog.dto.ts:21-30`).
- Unidades: CRUD completo (`:39`, `:43`, `:47`, `:51`). `PartnerStore`
  (`schema.prisma:292-307`) é separado de `Partner` e tem geo próprio.
- `GET /metrics` (`:56`), `POST /redeem` em dois passos (`:61`), `GET /me` (`:70`),
  `PUT /profile` (`:79`).
- Bloco de afiliado solar e afiliação loja↔motorista.

O painel **web** consome praticamente tudo (`hub/src/routes/AppRoutes.tsx:150-175`:
`/parceiro/catalogo`, `/unidades`, `/venda`, `/perfil`, métricas, afiliados).

### O que falta

O app consome **1 de 28**. `hub-mobile/src/app/parceiro/venda.tsx` é só balcão de resgate
(scanner QR + código digitado), e `(tabs)/conta.tsx:110-123` tem um atalho que abre o painel
web no navegador, com o subtítulo honesto "Catálogo, unidades e métricas continuam na web".

E faltam coisas no **modelo**, não só na tela:

- **Nenhum horário de funcionamento** — não existe campo, DTO nem tela, em nível nenhum.
- **Uma foto por produto e por unidade** (`imageUrl`, string). Sem galeria.
- **`Product` não tem vínculo com `PartnerStore`**: estoque é por parceiro, não por unidade.
  Uma rede com três lojas não consegue dizer que o produto acabou em uma só.
- **Loja de marketplace não tem rota de saque.** Saque existe só para afiliado solar; o
  repasse da loja é `PartnerPayout` (`schema.prisma:563`), operado por admin/financeiro.

Um defeito pequeno que achei no caminho: `conta.tsx:110` decide exibir a seção de parceiro por
`isWebOnlyRole`, que inclui `financeiro`, mas o guard da rota (`_layout.tsx:50`, `:85`) só
aceita `partner` e `admin`. Um usuário `financeiro` vê "Validar voucher" e o toque cai numa
rota não liberada.

### O que fazer

A pergunta "ou será só pela web?" é de produto, e as duas respostas são defensáveis:

**Opção 1 — assumir a web como painel.** Melhorar o atalho (login já autenticado por token na
URL, em vez de pedir senha de novo no navegador) e parar de prometer gestão no app. Custo
quase zero. Faz sentido se o lojista administra sentado, no computador.

**Opção 2 — gestão no app.** Trazer produtos e unidades para o `hub-mobile`. O backend já está
pronto: as rotas existem e são REST simples. O trabalho é de interface. Faz sentido se o
lojista é um comerciante pequeno que não tem computador — e, no público deste produto, essa é a
hipótese mais provável.

Eu recomendo a **Opção 2 para produtos** e a Opção 1 para o resto. Mexer no estoque e no preço
é tarefa de todo dia, com o celular na mão atrás do balcão. Cadastrar unidade e ler métrica é
tarefa de vez em quando, e a web serve.

Nos dois casos, o que eu acrescentaria ao modelo, em ordem de valor:

1. **Estoque por unidade** — é o que impede uma rede de usar o produto hoje. Exige tabela de
   junção `product_store_stock` e mudança na leitura pública do catálogo.
2. **Horário de funcionamento** por unidade, e filtro de "aberto agora" no catálogo.
3. Galeria de fotos.

### Esforço e risco

Médio. A parte de modelo (estoque por unidade) é a mais delicada, porque toca a leitura
pública do catálogo, que é o caminho mais quente do hub.

---

## Frente E — categoria de veículo automática

Esta é a frente que você pediu com mais precisão, então vai mais detalhada.

> **Situação: implantada em produção em 08/10/2026.** Commits `20b0955` (opendriver),
> `c370430` (hub) e `a9eb0a6` (openad, scripts de ensaio).
>
> O que mudou em relação ao que está escrito abaixo, e por quê:
>
> - **A lista de UFs foi para o banco** (`opendriver.detran_providers`), em vez de ficar numa
>   constante no código. A sondagem dos endereços da Infosimples foi **inconclusiva**: sem
>   token a resposta é `601 não foi possível se autenticar` **antes** de a rota ser validada,
>   então 601 não prova que o endpoint existe, e varrer com token válido poderia gerar
>   cobrança por consulta executada. Com a tabela, corrigir um endereço é edição no admin e um
>   clique em "testar", não deploy.
> - **GO entrou desativado**, porque exige login do gov.br (CPF + senha) ou certificado A1, que
>   ainda não existe. Desativado cai em revisão manual com motivo explícito.
> - **DF usa `detran/df/veiculo-mobile`**: o `detran-df-veiculo` foi descontinuado quando o
>   site oficial mudou. O caminho ainda **não foi confirmado por consulta real**.
> - **Política de divergência: a menor categoria vence.** Econômico ganha de Conforto, com
>   `category_divergence` gravado para medir quantos casos existem antes de endurecer.
> - **`category_source = 'admin'` tem precedência** e não é desfeito por revalidação.
> - **`VEHICLE_VALIDATION_PROVIDER` continua em `mock` nos dois backends.** Enquanto estiver
>   assim a consulta ao Detran não acontece: o mock ecoa o que o motorista digitou, o que
>   exercita a tabela de regras mas não descobre nada. Ligar o provedor real passa a gastar
>   crédito da Infosimples por cadastro de veículo — é decisão de custo, e está em aberto.
>
> Estado conferido em produção: 4 UFs cadastradas, 137 regras em 28 marcas, os 5 veículos
> existentes intactos (`Economy` / `Pending` / `category_source = driver`), 30 casos de
> classificação conferidos em SQL contra a tabela gravada e 3 confirmados sem regra.

### O que já existe

- Enum `VehicleCategory { Economy, Comfort }` (`opendriver/backend/prisma/schema.prisma:196-201`),
  campo `category` no veículo com default `Economy` (`:396`).
- **A categoria é 100% escolha do motorista.** `vehicleSchema`
  (`backend/src/modules/driver/driver.service.ts:42`) é só
  `z.enum(['Economy','Comfort']).default('Economy')`, e `addVehicle` (`:228-247`) grava o input
  direto. No app é um seletor Econômico/Conforto (`mobile/src/app/driver/vehicle-new.tsx:78-86`).
- **Não existe lista de modelos por categoria.** Procurei por tabela, seed, enum e constante:
  nada. Marca e modelo são texto livre (`driver.service.ts:37-38`).
- A única regra derivada de ano é de elegibilidade, não de categoria:
  `MIN_VEHICLE_YEAR_OFFSET = 15` (`:19`) recusa veículo com mais de 15 anos.
- **A categoria define o preço.** `Pricing` (`schema.prisma:580-600`) tem `category` como
  **chave primária**, com `baseFare`, `perKm`, `perMinute`, `minimumFare`,
  `platformFeePercent`, `cancellationFee`. Seed na migration (`migration.sql:479-483`):
  Econômico 4,00 + 1,60/km + 0,30/min, mínima 8,00; Conforto 6,00 + 2,20/km + 0,40/min, mínima
  12,00; taxa da plataforma 20% nos dois. Editável por `PUT /admin/pricing/:category`
  (`admin.service.ts:338-366`), com proteção de "pelo menos uma categoria ativa".
- O despacho usa a categoria para casar oferta e veículo (`dispatch.ts:92`): **Conforto atende
  chamada Econômico, o inverso não.**
- **A Infosimples está implementada de verdade.** Cliente HTTP em
  `backend/src/infra/vehicleValidation/infosimples.ts`, token lido de
  `integration_settings` (`Infosimples:Token`) com fallback para env, e regras de decisão
  (`:70-101`): roubo/furto → `rejected`; restrição ou bloqueio judicial → `rejected`; bloqueio
  administrativo ou marca/modelo divergente → `needs_review`; limpo e casando → `approved`.
  Resultado grava `validationStatus` e auditoria em `vehicle_validations`
  (`driver.service.ts:249-276`).

### O que falta

1. **Provider default é `mock`** (`config.ts:70-74`, `VEHICLE_VALIDATION_PROVIDER`). O mock
   decide pelo último dígito do RENAVAM (`mock.ts:10-20`). Mesmo problema da Frente B: parece
   funcionar.
2. **Cobertura só MT e MS** (`STATE_ENDPOINT`, `infosimples.ts:24-27`). Outra UF cai em
   `needs_review` com `uf_sem_consulta_automatica`. O comentário do arquivo registra que DF e
   GO exigem login GOV.BR. Vale notar: o tablete em teste está em Cuiabá (MT, coberto), mas a
   sede da empresa é no DF (não coberto).
3. **A consulta roda em um único ponto**, e só se vierem RENAVAM **e** UF:
   `driver.service.ts:245`. Não há job, não há rota de reprocessamento, e subir CRLV novo
   (`uploadCrlv`, `:280-288`) volta o veículo para `InReview` **sem** reconsultar.
4. **`chassi` é inerte.** Existe no schema (`:408`), no zod (`:51`) e é passado ao provider
   (`:260`), mas `infosimples.ts:66` envia só `placa` e `renavam`, e o app nunca preenche o
   campo.
5. **Ninguém pode reclassificar.** O admin aprova/rejeita veículo (`reviewVehicle`,
   `admin.service.ts:219-231`) mexendo apenas em `status` e `rejectionReason` — não toca
   `category` nem `validationStatus`. O motorista não tem `PUT` de veículo. **Para mudar de
   categoria hoje é apagar o veículo e cadastrar de novo.**
6. **O retorno da Infosimples é jogado fora para este fim.** `marca_modelo` e `ano_fabricacao`
   são lidos (`:79-82`) e usados só para decidir `matched`. É a informação exata que
   classificaria o veículo, e ela já está na mão.

### O que fazer

A boa notícia: o dado necessário já chega. O trabalho é guardá-lo e aplicar uma regra.

**1. Tabela de classificação, editável pelo admin.** É o "lugar onde definir a lista" que
você procurou:

```
vehicle_model_category
  id
  brand          -- normalizado (maiúsculas, sem acento)
  modelPattern   -- prefixo ou expressão; "ONIX", "COROLLA%"
  yearFrom       -- nulo = sem piso
  yearTo         -- nulo = sem teto
  category       -- Economy | Comfort
  source         -- 'manual' | 'importado'
  priority       -- desempate: regra mais específica ganha
```

Com `GET/POST/PUT/DELETE /admin/vehicle-categories` e tela no painel web do hub, ao lado da
tela de preços que já existe. Importação por CSV resolve a carga inicial sem digitação.

**2. Classificação no cadastro, com a consulta que já acontece.** Em `validateVehicle`, depois
de `vehicleValidation.validate`, usar `marca_modelo` e `ano_fabricacao` do retorno para
procurar na tabela e gravar a categoria. Três campos novos no veículo, todos aditivos:

- `categorySource`: `'driver' | 'auto' | 'admin'` — de onde veio a classificação atual
- `categoryAuto`: o que a regra calculou (guardado mesmo quando não é aplicado)
- `brandNormalized` / `modelNormalized`: o que o Detran devolveu, para auditoria

**3. Política de divergência, que é a decisão de produto.** Quando o motorista declara Conforto
e a regra diz Econômico, o que vale? Três caminhos:

- **A regra vence sempre.** Honesto com o passageiro, e vai gerar reclamação de motorista que
  cadastrou errado de boa-fé.
- **A mais baixa vence.** Nunca cobra Conforto de quem recebe Econômico. É a mais segura para
  o passageiro e a mais conservadora de receita.
- **Divergência vai para revisão.** Veículo fica `InReview` com motivo, e o operador decide.
  Mais trabalho humano, menos erro.

Eu recomendaria **a mais baixa vence, com divergência registrada** — protege o passageiro sem
criar fila, e o registro permite medir quantos casos existem antes de endurecer.

**4. Rota de reclassificação para o admin.** `PUT /admin/vehicles/:id/category`, com auditoria.
Hoje não existe caminho nenhum, e isso é um buraco operacional: um veículo classificado errado
só se conserta apagando.

**5. Reprocessamento.** Rota `POST /admin/vehicles/:id/revalidate` e um job para os veículos em
`validationStatus: 'Manual'` quando o token passar a existir ou a cobertura de UF crescer. Hoje
todo veículo cadastrado antes da configuração do token fica em revisão manual para sempre.

**6. Enviar o `chassi`** no formulário da Infosimples, e pedir o campo no app. Melhora a
conferência e o campo já existe inteiro, só não é usado.

**7. Antes de tudo isso: ligar o provider.** `VEHICLE_VALIDATION_PROVIDER=infosimples` e o
token em `Infosimples:Token`. Sem isso, os itens 2 e 5 classificam a partir de dados
inventados pelo mock — pior do que não classificar. Mesma recomendação da Frente B:
acrescentar `VehicleValidation:Provider` ao catálogo do admin, para não depender de redeploy.

### Esforço e risco

Médio. Nada aqui exige mudança de app (o seletor de categoria pode continuar existindo como
declaração inicial), então **a frente inteira é servidor e web** — é a de maior valor por
unidade de atrito. O risco é a qualidade da lista de modelos: regra errada reclassifica frota
em massa. Mitigação: `categoryAuto` gravado sem aplicar, por um período, para medir o acerto
antes de ligar.

---

## Frente F — retomada de download: provar que funciona de ponta a ponta

> Correção de uma versão anterior desta frente, que afirmava que "todo byte passa pela API".
> Isso vale só para a rota `/file`, que o tablet **não** usa para baixar. O caminho real é outro,
> descrito abaixo.

### O que já existe

- O tablet foi escrito para retomar download interrompido. `resumable-download.service.ts:14-52`
  (app `openad-ad-client`): com offset gravado, pede `Range: bytes=<offset>-`, trata `206` e
  `416` e soma os pedaços até o total do `Content-Range`. O `download-manager.service.ts` guarda o
  offset no IndexedDB, confere o SHA-256 e repete com espera exponencial.
- **O manifesto já entrega URL pré-assinada direto do storage.**
  `manifest-generator.service.ts:169` chama `getPresignedGetUrl(row.storageUrl, 3600)` e o
  tablet passa exatamente esse `item.downloadUrl` ao downloader
  (`sync-orchestrator.service.ts:156`). O endpoint público é
  `S3_PUBLIC_ENDPOINT=https://storage.opendriver.com.br` (`docker-compose.prod.yml:241`), e o
  MinIO atende `Range` e `ETag` sozinho. A spec previa exatamente isso
  (`specs/004-media-orchestration-pipeline/spec.md:206`, `research.md:183`).

Ou seja, a base certa já está no caminho principal. O que falta é prová-la.

### O que falta

1. **Ninguém verificou que a retomada funciona.** Ela depende de duas coisas que eu não consegui
   checar lendo código:
   - **CORS do storage.** O tablet lê o `Content-Range` por `fetch` em WebView, e não encontrei
     `CapacitorHttp` no app, então o CORS vale. Sem `Access-Control-Expose-Headers: Content-Range`
     no `storage.opendriver.com.br`, `res.headers.get('Content-Range')` devolve `null`
     (`resumable-download.service.ts:48`). O laço então pede `bytes=<tamanho>-`, recebe `416` e
     recomeça do zero (linhas 26-30). Nada falha visivelmente: o vídeo é baixado de novo por
     inteiro, e a "retomada" não retoma.
   - **Validade da URL.** A URL do manifesto vale 1 h. Uma retomada depois disso usa URL vencida
     e a resposta de erro faz o downloader lançar (`resumable-download.service.ts:33-35`). Não
     verifiquei se o próximo ciclo de sync renova a URL a tempo.
2. **A rota `/file` não suporta `Range`.** `GET /campaigns/:campaignId/assets/:assetId/file`
   (`campaigns.controller.ts:101-120`) faz `stream.pipe(res)` sem `Range`, `206`,
   `Accept-Ranges`, `Content-Length`, `ETag` nem `Cache-Control`. Hoje as únicas URLs dela saem no
   push de agenda por MQTT (`schedule-push.service.ts:105`) e no mapa da frota
   (`fleet-map.service.ts:329`), e **não achei leitor dessa URL no código do tablet**. É uma
   divergência latente, não um defeito ativo: passa a doer se o push de agenda for usado para
   baixar mídia.
3. Relacionado, mas fora desta frente: `downloadToBuffer` junta o arquivo inteiro num
   `ArrayBuffer` antes de gravar, então vídeo grande pressiona a memória do WebView.

### O que fazer

1. **Medir antes de construir.** Cortar a rede no meio do download de um vídeo grande num tablet
   real e observar se o pedido seguinte sai com `Range` e volta `206` com `Content-Range`
   legível. Em paralelo, `curl -I` na URL pré-assinada com `Origin` do WebView e `Range` para
   conferir `Access-Control-Expose-Headers`. É barato e decide o resto.
2. **Se o `Content-Range` não for legível:** configurar o CORS do MinIO (`Range` em
   `Allow-Headers`; `Content-Range`, `Accept-Ranges`, `ETag` e `Content-Length` em
   `Expose-Headers`), ou fazer o downloader calcular o total por `Content-Length` quando a
   resposta for `206` sem `Content-Range` legível.
3. **Renovar a URL na retomada:** tratar `403` do storage como "URL vencida" e buscar o manifesto
   de novo antes de tentar outra vez, ou subir o TTL para além da janela de sync.
4. **Rota `/file`:** responder `302` para `getPresignedGetUrl`, que já existe
   (`asset-storage.service.ts:199`), em vez de reimplementar `Range` no Node. Prioridade baixa
   enquanto nada a consome para baixar.
5. **Alinhar a spec 004** ao que ficar de fato verdadeiro.

### Esforço e risco

Pequeno, e em grande parte é verificação. O APK do tablete é instalado por cabo, então qualquer
ajuste no downloader não passa por loja. Não medi o tamanho típico dos vídeos nem a taxa de queda
de download na frota; é isso que decide a urgência.

---

## Frente G — rodar mais de uma instância da API

### O que já escala

- **Plays:** entram por fila BullMQ (`playback-batch-ingest.service.ts:154-160`) e têm índice
  único `(deviceId, uniqueEventId)` (`play-record.schema.ts:99`).
- **Impressões:** Redis Streams com consumer group (`impression-stream.consumer.ts`) e índice
  único em `eventId` (`impression-event.schema.ts:72`). Duplicata é ignorada.
- **URLs de mídia:** assinadas por HMAC, sem estado; qualquer instância valida.
- **MQTT:** o cliente não fixa `clientId`, então uma instância não derruba a outra no broker.
- Não achei estado de negócio guardado em memória do processo. A busca foi por campos
  `Map`/`Set`; é indício, não prova.

### O que não escala hoje

1. **Cobrança do play tem corrida.** `analytics-reconciliation.processor.ts:106-171` detecta a
   transição "pendente → faturável" lendo o registro, reconciliando e lendo de novo. O
   `reconcileOne` (`reconciliation.service.ts:62-99`) só retorna cedo se o registro já não estiver
   `pending` e grava com `updateOne` sem condição, e o `queue.add` não usa `jobId`
   (`playback-batch-ingest.service.ts:154-160`). Hoje existe um worker, então os lotes se
   serializam. Com duas instâncias, ou com concorrência maior que 1, o **mesmo lote enviado duas
   vezes** (retry do tablet depois de timeout, o que é normal) pode ser processado em paralelo, e
   os dois workers enxergam `pending` e somam `billableCostCents` duas vezes
   (`pacing-signal.service.ts:86`). O repasse tem a própria trava de idempotência
   (`referenceId`), mas não verifiquei se ela cobre todo o caminho.
2. **Socket.IO sem adapter.** `main.ts:19` usa o `IoAdapter` padrão. Um evento emitido numa
   instância só chega aos clientes conectados nela, então o painel perde atualizações. O `ioredis`
   já está nas dependências; falta o adapter de Redis.
3. **Assinaturas MQTT sem `$share`.** Cinco serviços assinam o mesmo tópico em toda instância:
   `command-ack.handler.ts:20`, `telemetry-ingestor.service.ts:34`,
   `impression-ingestion.service.ts:20`, `priority-commands.gateway.ts:25`,
   `spatial-ledger-mqtt.service.ts:17`. Com N instâncias, cada mensagem é processada N vezes.
   Impressões e plays são idempotentes por índice; nos demais eu não verifiquei. O broker em
   produção é o RabbitMQ, e **não sei se o plugin MQTT dele suporta assinatura compartilhada**.
4. **Tarefas `@Cron` rodam em toda instância, sem lock nem líder.** São seis:
   `heartbeat-monitor.service.ts:25` (a cada 30 s, lê a frota inteira),
   `command-expiry-sweep.service.ts:18`, `impression-stream.consumer.ts:39`,
   `dooh-media-revalidation.job.ts:23`, `upload-session-cleanup.job.ts:14` e
   `object-storage-cleanup.service.ts:26`. Procurei `redlock`, `NX` e eleição de líder: nada. O
   consumo de impressões é seguro por causa do consumer group; os demais rodam em duplicata, e as
   limpezas apagam duas vezes.
5. **Upload do anunciante em memória.** `advertiser.controller.ts:166-168` usa `memoryStorage` com
   limite de 500 MB: um vídeo grande ocupa 500 MB de RAM por requisição, em qualquer número de
   instâncias. O caminho do painel de gestão já tem URL pré-assinada de escrita
   (`getPresignedPutObjectUrl`); este não usa.
6. **Camada de dados única.** O `docker-compose.prod.yml` sobe um contêiner de Mongo, um de Redis
   e um de RabbitMQ, e o Postgres é compartilhado com o hub, tudo no mesmo servidor. Mais
   instâncias de API escalam CPU, não resiliência.
7. **Menores.** `consumerName = api-${process.pid}` (`impression-stream.consumer.ts:19`): em
   contêineres o PID costuma ser igual entre réplicas, então duas réplicas dividem o mesmo nome de
   consumidor. E o segredo de assinatura das URLs cai para um valor fixo
   (`'dev-asset-url-secret-change-me'`) se faltarem `ASSET_URL_SIGNING_SECRET` e `JWT_SECRET`
   (`asset-url.service.ts:14`); o correto é falhar no boot.

### O que fazer

1. **G.1 primeiro, antes de qualquer segunda instância ou aumento de concorrência.** `jobId:
   batchId` no `queue.add` e a transição virar atômica: `findOneAndUpdate` condicionado a
   `reconciliationStatus: 'pending'`, cobrando e debitando só quando ele devolver o documento.
   Quando a Frente A.5/A.6 grudar o débito no ledger, é neste mesmo ponto.
2. Uma flag de ambiente que liga os agendadores (`@Cron`) em uma instância só, ou lock curto no
   Redis (`SET ... NX PX`). Como o BullMQ já está no projeto, mover os jobs para tarefas
   repetíveis dele resolve o mesmo problema.
3. Adapter de Redis no Socket.IO.
4. Ingestão MQTT numa instância só (mesma flag do item 2), ou consumir por fila AMQP em vez de
   assinar o tópico em toda instância. Antes de decidir, conferir se o RabbitMQ em uso suporta
   `$share`.
5. Upload direto ao storage por URL pré-assinada, como o painel de gestão já faz.
6. Falhar no boot sem o segredo de assinatura, e trocar o nome do consumidor por algo único por
   réplica (`hostname`).
7. **Validar com carga.** Existe `tools/analytics-ingest-load`; não o executei. Rodá-lo contra duas
   réplicas, reenviando lotes de propósito, é o teste que mostra se o G.1 fechou.

### Esforço e risco

O G.1 é pequeno e é o único que mexe em dinheiro. O resto é médio e independente entre si. Não sei
o tamanho da frota: para algumas centenas de tablets, uma instância bem configurada provavelmente
basta, e o G.1 já protege contra a concorrência que surgir por outro motivo (por exemplo, subir a
concorrência do worker). Escalar na horizontal não elimina o ponto único de falha da camada de
dados (G.6).

---

## Frente H — preço por segundo e consumo do crédito depositado

> **Situação: H.1 a H.4 implementadas** (commits `836b63c` e seguintes). O que mudou em relação
> ao desenho abaixo, e por quê:
>
> - **A unidade é micro-real, como planejado**, e a conversão para centavos acontece com o resto
>   carregado para o lançamento seguinte. `campaign_daily_spend.billableCostCents` deixou de ser
>   o acumulador e passou a ser **derivado** de `billableCostMicros` — e o valor derivado **só
>   sobe**, para não apagar gasto de linha gravada antes da mudança.
> - **O tipo do criativo é derivado do `mimeType`/extensão**, não de um campo novo no schema.
>   Um campo exigiria preencher o acervo, e um backfill errado mudaria o preço de campanha no
>   ar. O padrão é `video`, que é o lado conservador: cobra o que tocou, em vez de 15 s fixos.
> - **O custo da reserva é dimensionado pelo criativo mais caro da campanha**, não pela média.
>   Subdimensionar faria a captura estourar o `CHECK` da retenção no meio do ciclo — a
>   veiculação aconteceria e o débito falharia. Superdimensionar apenas retém um pouco mais, e
>   o fechamento devolve.
> - **A reserva é múltiplo inteiro do custo de uma exibição.** Reservar R$ 0,07 quando a
>   exibição custa R$ 0,045 reteria R$ 0,025 que não podem virar exibição nenhuma.
> - **O rateio entre campanhas do mesmo anunciante é por prioridade, não proporcional.** Rateio
>   proporcional daria a cada campanha uma fatia que pode não cobrir nem uma exibição, e o
>   anunciante veria todas no ar entregando quase nada.
> - **A cota vai inteira para cada tablet**, e não dividida pela frota. Dividir exigiria saber
>   agora quantos aparelhos vão sincronizar no ciclo, e o número só é conhecido depois. O limite
>   efetivo continua sendo a reserva. A divisão é o refinamento que depende do sinal de "corrida
>   iniciada", registrado em `pendencias.md`.
> - **O lock do job é economia, não correção.** O `cycleId` determinístico e o índice único
>   `(campaignId, cycleId)` já garantem que duas instâncias produzam as mesmas reservas e não o
>   dobro. O lock no Redis evita que cada réplica percorra todos os anunciantes para descobrir
>   no fim que a outra já reservou — e quando o Redis está fora, o job **executa**, porque sem
>   reserva nenhuma campanha veicula.
> - **O repasse ao motorista continua em centavos**, com o resto por motorista ficando para
>   depois. Nada se perde hoje porque toda campanha existente é `per_impression`, onde o custo
>   já é centavo inteiro.

> Origem: o PDF "Plano de monetização e uso dos recursos — OpenDriver" (2026-10-07) e as decisões
> do dono do mesmo dia, listadas abaixo. Esta frente **detalha o A.5/A.6** com a regra de reserva
> por ciclo e **depende da G.1** (cobrança atômica do play).

### Decisões já tomadas

1. O preço é **R$ 0,003 por segundo de tela**, consumido do crédito depositado pelo anunciante.
2. **Tudo o que o código faz hoje com repasse e leilão fica**: piso, modelos `percent` e
   `per_play`, peso do leilão. Muda só o teto: o repasse que o anunciante pede é **limitado a
   80%**.
3. Discrepância de centavos: **arredondar para baixo**.
4. Segundos cobrados: **imagem = 15 s fixos** (o anunciante não escolhe); **vídeo = a própria
   duração, de 10 a 120 s**.
5. Só vai ao ar o anúncio que tem crédito **no momento do débito**. O débito é **transação
   atômica, como em banco**. A análise e o manifest são **refeitos a cada 15 min**. Os anúncios
   **só ficam ativos quando o motorista inicia a corrida**.
6. O preço mora em `platform_config.monetization` (editável no admin, sem redeploy), com exceção
   por campanha para o preço de lançamento.

### O que já existe

- **Preço por exibição, em centavos inteiros.** `ratePerImpressionCents`
  (`campaign.schema.ts:29`), digitado pelo anunciante (`create-advertiser-campaign.dto.ts:26`,
  `@Min(1)`). O faturamento lê esse valor em `analytics-reconciliation.processor.ts:170`, e o
  pacing arredonda com `Math.round` (`pacing-signal.service.ts:86`).
- **Duração.** Vídeo é validado entre 10 s (`video-validator.service.ts:21`) e 120 s
  (`platform-config.service.ts:22`). **Imagem entra com `duration: 10` fixo**
  (`video-validator.service.ts:238`), o manifest repassa esse valor e o tablet o usa para decidir
  quanto tempo a imagem fica na tela. O tablet ainda tem dois padrões diferentes: 10 s
  (`playback-engine.service.ts:41`) e 15 s ao registrar o play (`:594`). Ou seja, **hoje a imagem
  fica 10 s na tela, não 15 s** (por leitura de código; não vi em aparelho).
- **Faturável.** Um play só fatura se tocou pelo menos `reconFullPlayMinRatio` (0,9) da duração do
  criativo, ou 3 s quando a duração é desconhecida (`reconciliation.service.ts`, `classifyPlay`).
  É sim/não; o tempo exato não entra no preço.
- **Repasse e leilão.** Piso de 30% (`platform-config.service.ts:43`). `percent` ou `per_play` por
  campanha (`driver-payout.policy.ts`). O teto de 100% só é verificado no `per_play`; para
  `percent` o limite é o `@Max(1)` do DTO (`create-advertiser-campaign.dto.ts:73`). O peso do
  leilão é `1 + k·(repasse/piso − 1)`, entre 0,5 e 3, multiplicando a prioridade do item
  (`internal/driver-payout.policy.ts:86`, `manifest-generator.service.ts:164`).
- **Crédito do anunciante.** `AdCreditLedger` existe, append-only, em centavos inteiros, e
  **nada escreve nele**. Não tem chave de idempotência por lançamento. A elegibilidade
  (`campaign-eligibility.service.ts:77-130`) não consulta saldo.
- **Ciclo.** O tablet sincroniza a cada 15 min (`sync-scheduler.service.ts:10`).
- **Corrida iniciada.** Procurei por nomes de sinal de corrida iniciada em `openad-api` e no app
  do tablet e não encontrei. A busca é por nome e não é exaustiva.

### O que muda

**H.1 — Unidade do preço.** R$ 0,003 é 0,3 centavo por segundo, e uma imagem de 15 s custa 4,5
centavos: não cabe em centavo inteiro. Guardar preço e custo em **micro-reais (µR$)**, inteiros:
R$ 0,003/s = 3.000 µR$/s; imagem de 15 s = 45.000 µR$. Chaves novas em `platform_config.monetization`:
`pricePerSecondMicros` (3000), `imageDisplaySeconds` (15), `driverPayoutMaxPercent` (0,8) e
`creditCycleMinutes` (15). Exceção por campanha em `budget.pricePerSecondMicros` (opcional).
Campanhas existentes continuam em `per_impression`; só as novas nascem `per_second`, com o preço
**gravado na campanha** na criação, para um reajuste futuro não reprecificar campanha no ar.

**H.2 — Segundos cobrados.** Imagem: `imageDisplaySeconds` (15), vindo do `platform_config`, e não
do `duration` gravado no asset (que vale 10 nas imagens já enviadas). Vídeo: `floor(asset.duration)`
(a duração vem do ffprobe, em fracionário). Alinhar o `duration: 10` de
`video-validator.service.ts:238` para a constante, o manifest para enviar 15 nas imagens, e os dois
padrões do tablet (`playback-engine.service.ts:41` e `:594`) para o mesmo valor. A tabela de
preço, a R$ 0,003/s, fica: imagem 15 s = R$ 0,045; vídeo 10 s = R$ 0,03; 30 s = R$ 0,09; 60 s =
R$ 0,18; 120 s = R$ 0,36. Os pacotes do PDF fecham exatamente (15 s × 20 mil = R$ 900; 30 s × 30
mil = R$ 2.700; 60 s × 50 mil = R$ 9.000).

**H.3 — Teto de 80% no repasse.** Aplicar nos dois modelos e em três pontos:
- `validarRepasse` (`advertiser/driver-payout.policy.ts:58`): recusar acima do teto com a mesma
  mensagem exata do piso (`DRIVER_PAYOUT_ABOVE_CAP`, "Repasse de X% está acima do teto de 80%").
  O `@Max(1)` do DTO fica como limite sintático; a política é o `platform_config`.
- `repasseEmCentavos` e `percentEfetivoDoRepasse` (`internal/driver-payout.policy.ts:31`, `:100`):
  limitar ao teto, como rede de segurança para campanha gravada antes da regra existir (hoje
  `percent` pode estar em qualquer valor até 100%).
- Efeito no leilão: com piso 0,30, `k` 0,5 e teto 0,8, o peso máximo é 1 + 0,5·(0,8/0,3 − 1) ≈
  **1,83**; o limite de 3 do código nunca é atingido, e a plataforma retém pelo menos 20% de cada
  exibição.

**H.4 — Reserva e débito atômicos por ciclo de 15 min.** É o padrão de "retenção e captura" de
cartão: reservar antes de mostrar, capturar o que foi mostrado, devolver o resto.

1. **Tabela nova** `ad_credit_holds` (Postgres, aditiva): `advertiserId`, `campaignId`, `cycleId`,
   `amountMicros`, `capturedMicros`, `status` (`open`/`closed`), `closesAt`. O ledger fica só
   com dinheiro que entrou e saiu (é registro fiscal, como o comentário do schema diz). Saldo
   disponível = soma do ledger − o que ainda resta em retenções abertas.
2. **Início do ciclo**, num único job (uma instância só — ver G.4): para cada anunciante, uma
   transação com `SELECT … FOR UPDATE` na linha do anunciante calcula o disponível e abre as
   retenções, campanha por campanha, na ordem de prioridade. **Só entra no manifest a campanha com
   retenção aberta.** Sem crédito, sai do manifest no ciclo seguinte.
3. **Cota por tablet.** O manifest ganha dois campos opcionais por item, `maxPlaysInCycle` e
   `cycleEndsAt` (aditivos em `ManifestMediaItemDto`, `manifest-response.dto.ts`), e o tablet para
   de tocar o item ao atingir a cota. **Sem a cota, a retenção não limita nada**: é ela que
   impede "exibir a mais". A cota é o pacing com teto duro.
4. **Captura.** No instante em que o play vira faturável (a transição atômica da G.1), debitar o
   ledger com `referenceId = campaignId:uniqueEventId` **único** (coluna nova no ledger). Repetir o
   débito é inofensivo, como já é no repasse. Mongo e Postgres **não compartilham transação**, então
   a atomicidade vem de três coisas juntas: transição única no Mongo (G.1), débito idempotente no
   Postgres e um job de conciliação que refaz o débito de qualquer play faturável sem lançamento
   (o padrão *outbox*).
5. **Fechamento.** No fim do ciclo, mais uma janela de tolerância, a retenção fecha e o que não foi
   capturado volta ao saldo (a quantia reservada que não foi usada deixa de contar como retida).
   Play enviado depois da janela (tablet ficou offline) precisa de regra: sugestão, lançar como
   ajuste absorvido pela plataforma e não debitar o anunciante.
6. **Arredondamento.** O custo de uma exibição é exato em µR$. A conversão para centavos acontece só
   ao lançar no ledger e ao creditar o motorista, e arredonda **para baixo**. Aplicar o "para baixo"
   por exibição perderia 0,5 centavo dos 4,5 de uma imagem de 15 s (11%), sempre contra o mesmo
   lado; por isso ele vale sobre o **acumulado do lote/ciclo**, com o resto (< 1 centavo) carregado para o lançamento seguinte. O viés nunca
   acumula. O crédito ao motorista segue a mesma regra, com resto por motorista (não li o lado do
   hub que recebe esse crédito).

**H.5 — Anúncio só com corrida iniciada.** Não existe sinal de corrida iniciada no que li. O botão
"iniciar corrida" do plano do PDF precisa chegar ao tablet (e, de preferência, ao servidor, para
dimensionar a cota pelos tablets realmente ativos). Esta frente não o especifica; ela só depende
dele. Até existir, a cota é dividida entre os tablets pareados.

### Os 7 lugares que leem a tarifa por exibição

Para cada um: o que mudar e o que cada público passa a ver. As telas do app do anunciante eu não
li; a sugestão é de contrato de dados, não de layout.

| # | Lugar | Mudança | Quem ganha visibilidade |
| --- | --- | --- | --- |
| 1 | **Faturamento** — `analytics-reconciliation.processor.ts:170` e `pacing-signal.service.ts:86` | Custo = `pricePerSecondMicros × segundos` (H.2). Gravar no play `seconds`, `pricePerSecondMicros`, `costMicros`, `driverMicros`, `platformMicros`. O acumulador de gasto diário passa a `billableCostMicros` (campo novo, aditivo), sem o `Math.round`. | Admin: em cada play, "15 s × R$ 0,003 = R$ 0,045; motorista R$ x; plataforma R$ y". Contestação futura tem o preço da época. |
| 2 | **Relatório do anunciante** — `reporting-aggregation.service.ts:61-93` | Somar o `costMicros` gravado em vez de `plays × tarifa × multiplicador de zona` (a faixa está fixa em `'T4'`, fator 1,0, então hoje o multiplicador não faz nada). Devolver: exibições, **segundos exibidos**, custo médio por exibição, gasto no período, **saldo restante**, "crédito dura até ~dd/mm" no ritmo atual, e a quebra **por criativo** (imagem de 15 s × cada vídeo). | Anunciante: vê para onde foi o dinheiro e quando acaba. |
| 3 | **Estimativa de inventário** — `advertiser-inventory.service.ts:143-160` | Hoje `maxBillablePlays = total / tarifa`. Passar a `maxBillableSeconds = totalMicros / pricePerSecondMicros` e, por criativo anexado, `floor(totalMicros / (preço × segundos))` exibições. Avisos novos: "seu crédito cobre N exibições de 15 s" e "o saldo não cobre um ciclo de 15 min". | Anunciante, antes de ativar. |
| 4 | **Validação do repasse** — `advertiser/driver-payout.policy.ts:58-153` | Teto de 80% (H.3). O `per_play` passa a ser validado contra os **criativos da campanha**, não contra uma tarifa única (ver "Riscos"). Mensagens com o número exato que falta ou sobra. | Anunciante: "entre 30% e 80%". |
| 5 | **Ciclo de vida da campanha** — `campaign-lifecycle.service.ts:91` e `:211`, mais `create-campaign.dto.ts:31` | `ratePerImpressionCents` vira **opcional e ignorado** nas campanhas novas (o app do anunciante já aprovado ainda o envia, e a API só pode mudar de forma aditiva). Persistir o `pricing` gravado na criação. A resposta devolve `pricePerSecondMicros` e a tabela de preço por duração. A campanha não vai para `active` sem crédito para ao menos um ciclo. | Anunciante vê "seu anúncio de 15 s custa R$ 0,045 por exibição". |
| 6 | **Peso do leilão** — `campaign-eligibility.service.ts:106-113` e `manifest-generator.service.ts:164` | Lógica mantida (decisão 2). Mudar só o insumo: usar o repasse já limitado a 80%, e para `per_play` calcular o percentual efetivo **por item** (`valueCents ÷ custo daquele criativo`), não por campanha, porque o custo agora depende da duração. Expor o peso final e a prioridade resultante no detalhe da campanha no admin. | Admin e anunciante entendem por que uma campanha toca mais ("repasse maior = prioridade até +83%"). |
| 7 | **Criação de campanha** — `create-advertiser-campaign.dto.ts:26` e a tela do app/painel | Trocar o campo de tarifa por uma **tabela de preço somente leitura** e uma calculadora de pacote: duração do criativo × exibições = preço (15 s × 20 mil = R$ 900), com saldo atual e se cobre. Mostrar o repasse numa faixa 30%–80% com o efeito no leilão. Motorista/tablet: ganho por exibição em R$ e em segundos. | Anunciante e motorista. |

### Riscos e perguntas em aberto

- **`per_play` não tem percentual fixo com preço por segundo.** Um valor fixo precisa ficar entre
  30% do preço do criativo **mais caro** (120 s: 36 centavos → 10,8) e 80% do **mais barato** (10 s:
  3 centavos → 2,4). Numa campanha que mistura os dois, **não existe valor que valha para todos**.
  A decisão de manter o código fica de pé; a proposta é validar contra os criativos da campanha
  quando eles são anexados e recusar, sugerindo `percent`, nos casos impossíveis.
- **O PDF projeta 50/50; o código, sem `driverPayout`, repassa o piso de 30%.** Mantido o código, o
  motorista recebe 30% por padrão: o teto de R$ 405/mês com tela 100% vendida do PDF vira R$ 243
  nesse padrão. Vale reconferir a projeção, ou subir o piso para 0,5 no admin.
- **A cota uniforme subentrega** quando poucos tablets estão em corrida: a cota dos parados fica
  sem uso até o ciclo seguinte. Refinamento: ponderar a cota pelo histórico de plays do ciclo
  anterior (e, quando existir, pelo sinal de corrida iniciada).
- **Tablet com APK antigo ignora a cota** e toca além da retenção. A captura fica limitada ao que
  foi retido; o excedente não fatura. Como o APK é instalado por cabo, dá para atualizar a frota
  antes de ligar a regra.
- **Reajuste de preço depois dos 30 dias** (PDF): vale para campanhas novas e renovações, nunca
  para a que está no ar, por causa do preço gravado na criação.

### Esforço e risco

H.1 a H.3 são médios e só de servidor; é o que define *o que* se debita e precisa vir antes do H.4.
O H.4 é o maior: tabela nova, job de ciclo, campos novos no manifest e mudança no tablet (APK por
cabo, sem loja). O risco principal é dinheiro, então: testar a conciliação reenviando lotes de
propósito (`tools/analytics-ingest-load` existe; não o executei) e ligar primeiro com crédito
lançado à mão no admin, como o PDF prevê enquanto o Asaas está em `mock`.

---

## 4. Ordem sugerida

Ordenada por valor dividido por atrito, não por importância isolada.

| # | Frente | Por que nesta posição |
| --- | --- | --- |
| 1 | **B** — provedor de pagamento no catálogo + aviso de `mock` | Pequeno, só servidor, e hoje o sistema pode estar fingindo que cobra. Nada mais importa se o dinheiro não entra. |
| 2 | **E.7** — ligar a Infosimples de verdade | Uma configuração. Sem ela, todo o resto da Frente E opera sobre dados do mock. |
| 3 | **G.1** — cobrança do play atômica e sem lote duplicado | Pequeno, só servidor, e é o único item de escala que mexe em dinheiro. Também é pré-requisito do H.4. |
| 4 | **H.1 a H.3** — preço por segundo em micro-reais, imagem de 15 s, teto de 80% no repasse | Médio, só servidor. Define *o que* se debita, então vem antes do débito. |
| 5 | **A.5/A.6 = H.4** — reserva e débito atômicos por ciclo de 15 min, cota por tablet | Fecha o vazamento de receita com a regra definida em 2026-10-07. Servidor e APK do tablete (por cabo, sem loja). Funciona antes de existir compra de crédito: o crédito pode ser lançado à mão no admin. |
| 6 | **F.1 a F.3** — provar a retomada de download (CORS do storage, validade da URL) | Sobretudo verificação, sem submissão. Hoje ninguém sabe se a retomada retoma. |
| 7 | **E.1 a E.5** — tabela de categoria, classificação, reclassificação, reprocessamento | Servidor e web, sem submissão. Resolve o que você pediu e corrige um buraco operacional. |
| 8 | **A.1 a A.4, A.7** — crédito por **painel web com Pix** (decisão do PDF, não compra no app), rotas de crédito, estornos | Grande. O PDF fechou a dúvida que a Frente A deixava aberta: IAP fica fora. |
| 9 | **H (telas e relatórios, lugares 2, 3, 5 e 7)** — saldo, tabela de preço e calculadora de pacote no app do anunciante | O lado servidor (relatório, estimativa) sai junto do H.1. A tela custa submissão: agrupar com C e D. |
| 10 | **D** — gestão de produto no app + estoque por unidade | Média, custa submissão. Agrupar com a Frente C. |
| 11 | **C** — foto de perfil nos apps | Pequena, custa submissão. Entra junto com a D na mesma leva. |
| 12 | **A.8** — tela de compra de crédito | Só se houver compra no app; pelo PDF a compra é no painel web, então pode nem existir. |
| 13 | **G.2 a G.7** — adapter do Socket.IO, agendadores e ingestão MQTT em uma instância, upload direto | Só quando for subir a segunda instância. Médio e independente entre si. |

---

## 5. O que eu não faria na versão 2

Para ser útil, um plano precisa dizer o que fica fora.

- **Boleto.** Não existe em nenhum repositório e é trabalho real nos dois backends. Pix cobre
  o mesmo caso com liquidação imediata e sem inadimplência.
- **Galeria de fotos de produto.** Aparece como falta, mas uma foto resolve o catálogo. O
  estoque por unidade vale dez vezes mais pelo mesmo esforço.
- **Fechamento por período de repasse.** `driverPayoutSettlement` e `storeCycleSettlementDays`
  existem como configuração sem leitor nenhum. Implementar isso só faz sentido depois de haver
  volume de repasse que justifique fechamento em lote.
- **Device Owner na frota de tablets.** Já registrado em
  `docs/plano-tablet-paisagem-e-motorista.md`: o travamento sem saída exige provisionar o
  aparelho antes de cadastrar conta. É operação de frota, não desenvolvimento.

---

## 6. Ressalvas desta análise

- Li o código; **não executei** nada em produção para esta análise. Em particular, **não
  verifiquei** se `integration_settings` tem as chaves do Asaas e da Infosimples preenchidas.
  Isso muda a prioridade das Frentes B e E.7 — se já estiverem lá, os dois primeiros itens da
  ordem são só a variável de provedor.
- Dos arquivos `asaas.ts` do hub e do opendriver vi os trechos relevantes por busca com números
  de linha, não a leitura integral. A estrutura e as chamadas HTTP estão confirmadas; não
  revisei cada tratamento de erro.
- Nas Frentes F e G li código e specs; não executei nada em produção nem em aparelho. Na F,
  não verifiquei o CORS de `storage.opendriver.com.br`, a validade da URL na retomada nem o
  tamanho dos vídeos. Na G, não rodei carga nem sei o tamanho da frota, e não sei se o RabbitMQ em
  uso suporta `$share`. Uma versão anterior da F estava errada ao dizer que o tablet baixa pela
  rota `/file`: ele baixa pela URL pré-assinada do manifesto.
- Na Frente H li o código do servidor e do tablet e o PDF de monetização; não executei nada. Não
  li as telas do app do anunciante (a seção dos 7 lugares é contrato de dados, não layout), nem o
  lado do hub que recebe o crédito do motorista. Que a imagem hoje fica 10 s na tela vem de
  leitura de código, não de um aparelho. A ausência de um sinal de "corrida iniciada" vem de busca
  por nome, que não é exaustiva.
- Na web do hub confirmei que existe wrapper de API para as 28 rotas de parceiro, mas não abri
  cada página para verificar qual wrapper cada tela chama. "Tudo consumido pela web" vale no
  nível da camada de API, não necessariamente por tela.
