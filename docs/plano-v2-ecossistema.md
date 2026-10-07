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

## 4. Ordem sugerida

Ordenada por valor dividido por atrito, não por importância isolada.

| # | Frente | Por que nesta posição |
| --- | --- | --- |
| 1 | **B** — provedor de pagamento no catálogo + aviso de `mock` | Pequeno, só servidor, e hoje o sistema pode estar fingindo que cobra. Nada mais importa se o dinheiro não entra. |
| 2 | **E.7** — ligar a Infosimples de verdade | Uma configuração. Sem ela, todo o resto da Frente E opera sobre dados do mock. |
| 3 | **A.5/A.6** — portão de saldo e débito no ledger | Fecha o vazamento de receita. Só servidor. Mesmo antes de existir forma de comprar crédito, bloquear veiculação sem saldo é o comportamento correto. |
| 4 | **E.1 a E.5** — tabela de categoria, classificação, reclassificação, reprocessamento | Servidor e web, sem submissão. Resolve o que você pediu e corrige um buraco operacional. |
| 5 | **A.1 a A.4, A.7** — validação de recibo, rotas de crédito, webhooks de estorno | Grande, com dependência de loja. Decidir antes IAP ou painel web (ver a alternativa na Frente A). |
| 6 | **D** — gestão de produto no app + estoque por unidade | Média, custa submissão. Agrupar com a Frente C. |
| 7 | **C** — foto de perfil nos apps | Pequena, custa submissão. Entra junto com a D na mesma leva. |
| 8 | **A.8** — tela de compra no app do anunciante | Última, porque depende de 5 estar pronto e testado. |

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
- Na web do hub confirmei que existe wrapper de API para as 28 rotas de parceiro, mas não abri
  cada página para verificar qual wrapper cada tela chama. "Tudo consumido pela web" vale no
  nível da camada de API, não necessariamente por tela.
