# OpenAD — plano para fechar o ecossistema e o mobile

> Escrito em 2026-10-02, depois de ler `hub` e `opendriver` no código, não na documentação.
> Complementa [`plano-implementacao.md`](./plano-implementacao.md) e **corrige a §4.1 dele**,
> que colocava as tabelas do openad no schema `public`. O estado de execução está em
> [`estado-do-trabalho.md`](./estado-do-trabalho.md).

Alvo: `opendriver.com.br`, servidor `179.236.228.94`, Postgres compartilhado (banco `hub`,
schemas `public` e `opendriver`). O IP `187.77.46.26` é a VM antiga, a ser desligada.

---

## 1. Quatro correções de rumo

Estas vêm de ler os repositórios irmãos. Cada uma muda escopo, e duas reduzem trabalho.

### 1.1 As tabelas do openad **não** vão em `public` — vão num schema `openad`

O plano atual (§4.1) cria `ad_advertisers`, `ad_credit_purchases`, `ad_credit_ledger` e
`ad_payouts` em `public`, e por isso registra como bloqueio: *"são do repositório `hub`, onde
eu não tenho permissão para mexer"*.

O padrão real do ecossistema é outro, e é melhor. O `opendriver` tem **schema próprio no mesmo
banco** e espelha de `public` só as colunas que usa:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")     // ...?schema=opendriver
  schemas  = ["opendriver", "public"]
}
```

São 28 modelos em `@@schema("opendriver")` e 6 espelhos em `@@schema("public")` — de `users`
só 11 colunas. As chaves estrangeiras **atravessam schema** (`REFERENCES "public"."users"`),
sempre com `onDelete: Restrict`, para que o hub não possa apagar um usuário por baixo dos
dados do outro serviço. Nenhuma migration do opendriver contém `CREATE`, `ALTER` ou `DROP`
sobre objeto de `public`; só aparece `public` em cláusula de FK.

**Consequência:** o openad ganha um schema `openad` e deixa de depender de permissão no
repositório `hub`. O bloqueio da §3 do estado do trabalho desaparece.

Um detalhe não óbvio, que custa uma tarde se for descoberto em produção: com `multiSchema` e
o `public` já populado, o `prisma migrate deploy` aborta com *"migration persistence is not
initialized"*, porque não existe tabela de histórico no schema padrão. O opendriver resolve com
`backend/prisma/bootstrap/001_migrations_table.sql`, idempotente, aplicado **antes** do primeiro
deploy. O openad precisa do equivalente criando `"openad"."_prisma_migrations"`.

### 1.2 Dinheiro: o ecossistema **não** usa centavos inteiros

A padronização P2 do plano manda converter para centavos inteiros "como nos outros dois
backends". Isso está errado sobre os outros dois: `hub.users.cashback_balance` e
`cashback_entries.amount` são `Decimal(12,2)` **em reais**, e `commissionRules.ts` opera com
`decimal.js` em reais, não em centavos.

A regra que de fato serve:

- **Dentro do openad**, centavos inteiros. Já é metade do caminho — `campaign_daily_spend`
  conta em `billableCostCents` e `campaigns.driverPayout.valueCents` também.
- **Na fronteira com `public`**, converter para `Decimal` com 2 casas. Nunca escrever centavos
  numa coluna `Decimal(12,2)`, nem reimplementar as fórmulas de `commissionRules.ts`.

Hoje o openad é inconsistente consigo mesmo: `campaigns.budget` é float (`totalAmount`,
`ratePerImpression`) e a única multiplicação explícita por 100 está em
`analytics-reconciliation.processor.ts:98-105`, com um `Math.max(1, …)` que faz qualquer tarifa
abaixo de um centavo faturar um centavo. Pior: `reporting-aggregation.service.ts:60-93` acumula
`revenueTotal += rate * zoneMult` em float sobre N veiculações — erro que cresce com o volume.
E `campaign.schema.ts:149` declara `budget` como `type: Object`, então o Mongoose **não valida
nem converte** nada ali dentro.

Superfície medida: 11 arquivos na API, 4 no portal Angular, 2 schemas, 1 interface de domínio,
1 DTO. Mais um *backfill*: `impression_events.billingValue` já tem histórico gravado em float.

### 1.3 Repasse ao motorista: a infraestrutura já existe, em outro lugar

O plano projeta `ad_payouts` em `public`. Não precisa. O `opendriver` já tem o caminho completo:

- `opendriver.driver_earnings` — livro-caixa do motorista, saldo é a soma dos lançamentos.
  `ride_id` e `payout_id` são anuláveis, então lançamento sem corrida associada já é previsto.
  Tem `@@unique([rideId, type, driverId])`, que é a trava de idempotência.
- `EarningType` — enum `RideEarning | CancellationFee | CancellationPenalty | Payout |
  Adjustment | Tip`. Um valor novo (`AdRevenue`) é migration aditiva de enum.
- `opendriver.payout_requests` + telas `app/driver/payouts.tsx`, `app/driver/pix.tsx`,
  `app/drive/earnings.tsx` — o motorista já pede saque e já vê extrato.

Ou seja: o openad reporta veiculações faturáveis e o repasse aparece no app que o motorista já
usa, sem tela nova e sem mecanismo de pagamento novo. E como `driver_earnings` está no schema
`opendriver`, que não é propriedade do openad, a escrita vai por **HTTP em `/internal/*`**
autenticado por `public.service_api_keys` — superfície que o opendriver já expõe
(`middleware/apiKey.ts`, `modules/account/internal.routes.ts`).

Isso abre uma decisão de produto que **não posso tomar** — está na §4.

### 1.4 A federação de JWT tem uma janela de quebra e um risco de escalonamento

Os três serviços compartilham `JWT_SECRET`. Hub e opendriver assinam HS256 com
`issuer` e `audience` ambos `'opendriverhub'`, payload `{ sub, name, email, role, partnerId? }`.

O openad hoje assina `{ sub, email, role, sid? }` **sem `iss` e sem `aud`**, e o `JwtStrategy`
(`jwt.strategy.ts:10-20`) não verifica nenhum dos dois. Dois problemas:

**(a) Ligar a verificação quebra as sessões vivas.** Se o `JwtStrategy` passar a exigir
`issuer`/`audience`, todo token que o openad já emitiu para o portal e para os tablets passa a
ser rejeitado — e o refresh token do openad dura **30 dias**. A ordem obrigatória é: primeiro
acrescentar `issuer`/`audience` ao `signOptions` e publicar, só depois ligar a verificação, com
a janela respeitando o TTL do refresh.

**(b) Com o segredo compartilhado, o papel do token é confiado literalmente.** O
`JwtStrategy.validate` copia `payload.role` para `req.user` sem consultar banco, e o
`RolesGuard` tem desvio incondicional para `super_admin`. Hoje não é explorável porque os
conjuntos de papéis não se cruzam — o hub emite `Passenger | Driver | Partner | Client | Admin |
Financeiro`, o openad usa `fleet_operator | campaign_manager | content_moderator | fleet_admin |
finance_analyst | super_admin`. Mas a segurança está apoiada em **os nomes não coincidirem por
acaso**, o que não é uma garantia. No dia em que o hub criar um papel chamado `super_admin`,
qualquer usuário do hub vira administrador do openad.

A correção é distinguir a **origem** do token, não o nome do papel: duas estratégias passport
distintas (uma interna, uma federada) e o papel do anunciante derivado da existência da linha
em `openad.ad_advertisers`, nunca do que o token afirma ser.

---

## 2. O que falta, por área

Estado verificado por leitura de código em 2026-10-02.

### 2.1 Postgres no openad — não existe nada

Zero capacidade: nenhum `pg`, `prisma`, `typeorm`, `knex` no `package.json`; nenhuma string de
conexão; nenhum container de Postgres no `docker-compose.yml` (só `rabbitmq`, `mongo`, `redis`,
`minio`). As duas únicas menções a Postgres no código-fonte são comentários.

A fazer: dependência do Prisma, `schema.prisma` com `schemas = ["openad", "public"]`, espelho
mínimo de `public.users`, bootstrap do `_prisma_migrations`, módulo Nest global para o
`PrismaClient` (espelhando `mongodb.module.ts`, que é `@Global()`), e `DATABASE_URL` entrando na
validação de ambiente — que hoje valida **6 chaves** com `.passthrough()` e não cobre nem
`MONGO_URI` nem `JWT_SECRET`.

### 2.2 Isolamento por dono — feito nas rotas de mídia

> **Atualizado em 2026-10-02.** `GET /media`, `GET /media/:mediaId` e `DELETE /media/:mediaId`
> passaram a escopar por dono, o upload grava `ownerUserId`, e o `MediaScopeService` morto foi
> removido. Cinco asserções de integração provam o isolamento contra o banco, incluindo que o
> total da paginação acompanha o escopo e que ativo alheio responde **404, não 403** — "existe,
> mas não é seu" revelaria o ativo e permitiria enumerar o catálogo alheio.
>
> **Correção de fato:** eu havia escrito que `media/vfs/*` estava sem escopo e exposto. Lendo
> os `@Roles` de cada rota, **todas as rotas do VFS são internas** — `fleet_admin`,
> `super_admin`, `campaign_manager`, `fleet_operator`. Nenhuma aceita `advertiser`, então o
> anunciante não as alcança: recebe 403 no guard. Acrescentar escopo lá hoje seria código morto,
> porque papel interno recebe filtro vazio. O caminho de mídia do anunciante é
> `/advertiser/campaigns/:id/media`, que nasce escopado.

`ownerFilterFor` continua sendo a única fonte da regra, e agora tem três consumidores:
`GET /campaigns` e as três rotas de mídia acima.

### 2.3 Rotas de anunciante e de moderação — não existem

Enumerei todos os `@Controller` da API. Não há `/advertiser` nem `/moderation`. Os dados da
moderação estão prontos (subdocumento, índice `moderation_queue`, estados, `canModerate`) e o
commit `08f1775` tornou a decisão alcançável — mas a fila e as telas não existem.

Também: `'advertiser'` não é um valor de `UserRole` em `libs/domain`, então `@Roles('advertiser')`
nem compila hoje. O papel tem de entrar em `UserRole` **sem** entrar em `INTERNAL_USER_ROLES`,
porque `isInternalRole` depende dessa separação.

### 2.4 P8 é real e tem cliente acoplado

`analytics-reporting.controller.ts:25` e `pacing-signal.controller.ts:14` declaram
`@Controller('analytics/v1/campaigns')` sob o prefixo global `api/v1`, produzindo
`/api/v1/analytics/v1/campaigns`. O consumidor é
`openad-management/.../campaign-analytics-api.service.ts` — a correção move os dois lados junto.

### 2.5 Mobile

**Player (Capacitor).** Código completo e testado, APK compila. Falta:

- Rodar em tablete e exercitar o watchdog (R6, R7). **Nunca foi feito.**
- Os três itens da Fase 7, todos confirmados no código:
  - `resumable-download.service.ts:15-54` acumula o arquivo inteiro em memória e
    `storage-manager.service.ts` o converte para base64 antes de gravar. O upload aceita
    `fileSize: 524_288_000`, então o pico é o buffer **mais** ~1,33× dele em string. OOM
    provável. Isto é bloqueio da função principal, não refinamento.
  - Dois gerenciadores de cache **acoplados**, não paralelos: `SyncStorageManagerService`
    importa `StorageManagerService` aliasado e `SyncOrchestratorService` injeta os dois. Duas
    políticas de evicção vivas ao mesmo tempo — LRU e prioridade.
  - `getAvailableBytes()` cai em `512 MB - somaDoCache` quando o `Filesystem.stat` não traz
    `free`, que é o caso no Android. Esse número alimenta `HealthReportingService`, então a
    mentira sobe para a telemetria de frota como `storageFreeGb`.
- Segmentação: `campaigns.targeting` está no schema, mas o gerador de manifesto ainda tem
  `void deviceState`.

**App do anunciante.** Não existe nenhum projeto Expo no repositório. Em compensação, as
convenções a copiar estão todas prontas e testadas em `opendriver/mobile`: Expo 57 +
expo-router com `typedRoutes`, `src/api/{http,client,endpoints,queryKeys,types,errors}.ts`,
React Query v5 + Context (sem Redux) + um store de 30 linhas sobre `useSyncExternalStore`,
`secureTokenStorage.ts` sobre expo-secure-store.

Três detalhes de `opendriver/mobile/src/api/http.ts` que valem ser copiados literalmente, porque
cada um corrige um bug que já aconteceu: *single-flight* no refresh (o endpoint é limitado a
5/min por IP, e N requisições com 401 simultâneo disparariam N refreshes), um contador
`sessionGeneration` para que um refresh iniciado antes do logout não ressuscite a sessão, e a
distinção entre 400/401 do refresh (sessão morta) e 429/5xx (transitório, não desloga).

E o `secureTokenStorage.ts` tem a marca de instalação: o Keychain do iOS **sobrevive à
desinstalação**, então sem esse truque um aplicativo recém-instalado acorda logado na sessão
antiga.

### 2.6 Produção — o openad não tem caminho de deploy

Confirmado: **não existe Dockerfile algum** no repositório (os únicos são templates dentro de
`node_modules`), e o `docker-compose.yml` só sobe infraestrutura de desenvolvimento, sem serviço
de aplicação. O `nixpacks.toml` só fixa a versão do Node.

E a infraestrutura que o openad exige **não existe em produção hoje**: produção tem Postgres e
dois contêineres de backend. O openad precisa de MongoDB, Redis, RabbitMQ com plugin MQTT e
armazenamento S3 para vídeo.

Sobre o DNS que você mandou, uma observação que convém verificar antes de planejar o corte:
`coolify.opendriver.com.br` e `hubstorage.opendriver.com.br` apontam para **187.77.46.26**, a VM
antiga. Ou seja, o painel do Coolify e o armazenamento MinIO estão no servidor que vai sair,
enquanto `hubapi` e `api-app` já estão em `179.236.228.94`. Não há entrada de DNS para o openad.

### 2.7 Exclusão de conta — o openad ficaria órfão

O fan-out de exclusão do hub é **par a par**: `accountSync.ts` conhece só
`OPENDRIVER_API_URL`. Com um terceiro serviço, apagar uma conta no hub deixaria dados do
anunciante vivos no openad — exatamente o que o checklist da §7 de `normalizacao-banco.md`
alerta. Isso é LGPD, não refinamento.

O openad precisa expor `GET /internal/accounts/:id/deletion-blockers` e
`POST /internal/accounts/:id/purge`, e o `hub` precisa de alteração em `accountSync.ts` e
`accountPurgeService.ts` — no repositório dele.

---

## 3. Fases de execução

Ordenadas por dependência e por risco de descobrir tarde que algo não funciona. As estimativas
são de trabalho efetivo, sem espera por decisão ou hardware.

### Fase A — Tablete em bancada (2 a 3 dias, **começar já, corre em paralelo**)

Está na frente de tudo porque é o único item cujo resultado pode invalidar desenho, e porque
depende de comprar hardware. Pareamento, sincronização, reprodução do disco, `power-state`,
Lock Task como Device Owner, watchdog (`deep-sleep`, `safety-loop`, `player-restart`), H.265 em
WebView. O APK já compila; o que falta é o tablete.

*Entregável:* um tablete tocando por 24 h ininterruptas com play records chegando ao servidor.

### Fase B — Postgres e identidade federada (4 a 5 dias)

1. Prisma no `openad-api` com `schemas = ["openad", "public"]`, espelho mínimo de
   `public.users`, FKs com `onDelete: Restrict`, e `bootstrap/001_migrations_table.sql` criando
   `"openad"."_prisma_migrations"`.
2. Tabelas em `openad`: `ad_advertisers`, `ad_credit_purchases` (com o índice único
   `(store, transaction_id)`, que é o que impede o mesmo recibo creditar duas vezes),
   `ad_credit_ledger`.
3. `signOptions` do openad ganha `issuer`/`audience` `'opendriverhub'` — **publicar antes** de
   ligar qualquer verificação (§1.4a).
4. Duas estratégias passport: `jwt-internal` (como hoje) e `jwt-federated` (verifica
   `iss`/`aud`/HS256, resolve `sub` em `openad.ad_advertisers`). Guard composto. O papel de
   anunciante vem da linha no banco, nunca do claim `role`.
5. `'advertiser'` em `UserRole`, fora de `INTERNAL_USER_ROLES`.
6. `DATABASE_URL`, `MONGO_URI`, `JWT_SECRET`, `REDIS_URL` entram no `env.validation.ts`, que
   hoje valida 6 chaves irrelevantes e nenhuma crítica.

*Entregável:* um token emitido pelo hub autentica no openad como anunciante; um token interno
continua funcionando; teste automatizado provando que dois parceiros não se veem.

### Fase C — Escopo completo, rotas e moderação (4 a 5 dias)

1. `ownerFilterFor` em **todas** as rotas de mídia, na consulta e não em memória. Remover o
   `MediaScopeService` morto.
2. `/api/v1/advertiser/*`: `POST|GET /campaigns`, `POST /campaigns/:id/media` (reusa o VFS da
   spec 007), `GET /campaigns/:id/estimate`, `GET /campaigns/:id/report`,
   `GET /inventory/zones`.
3. `/api/v1/moderation/*`: `GET /queue`, `POST /campaigns/:id/decision`.
4. `/internal/accounts/:id/deletion-blockers` e `/purge`, com `requireApiKey` equivalente ao do
   opendriver (SHA-256 contra `public.service_api_keys`, escopos, `active`).
5. Telas de moderação no portal.
6. P8: normalizar `analytics/v1/...`, movendo o serviço Angular no mesmo commit.
7. Segmentação: o gerador consome `campaigns.targeting` e `deviceState` deixa de ser ignorado.

*Entregável:* anunciante cria campanha, sobe criativo, campanha entra na fila, moderador
aprova, e ela é distribuída só para os dispositivos segmentados.

### Fase D — Dinheiro (5 a 7 dias, **o maior risco de regressão**)

Dois commits separados, nesta ordem, nunca misturados:

1. **Centavos internos.** `campaigns.budget` para `totalAmountCents` / `ratePerImpressionCents`
   mais `dailyBudgetCents`; `budget` deixa de ser `type: Object`; migration com backfill dos
   `impression_events` históricos. Os 11 arquivos da API, os 4 do portal, o DTO e a interface de
   domínio. A acumulação em float de `reporting-aggregation.service.ts` morre aqui.
2. **IAP e crédito.** Validação de recibo **no servidor** (App Store Server API, Google Play
   Developer API) e as notificações de servidor das duas lojas, porque reembolso tem de
   suspender campanha e estornar crédito não consumido. Débito amarrado ao pacing.
3. **Repasse.** `boostRepasse` no score da arbitragem com `k` em `platform_config` (`k = 0`
   desliga), `reason: 'revenue_share'` em `lost_opportunity_events`, e a escrita do lançamento
   pela decisão da §4.1 abaixo. Conversão para `Decimal(12,2)` na fronteira.

*Entregável:* comprar um pacote no sandbox credita exatamente uma vez, inclusive reenviando o
mesmo recibo; estorno suspende a campanha; uma veiculação faturável gera lançamento para o
motorista.

### Fase E — App do anunciante em Expo (6 a 8 dias)

Projeto novo, Expo 57 + expo-router, copiando de `opendriver/mobile` a camada `src/api`
inteira (o `http.ts` é livre de React Native e já tem teste), `secureTokenStorage.ts` com
prefixo `openad.`, React Query + `AuthContext` + `lib/store.ts`, `config/env.ts` e
`app.config.ts` com validação https e variantes, primitivos de `components/ui`.

Telas: cadastro de parceiro, criação de campanha com segmentação, upload de criativo, compra de
pacote de crédito via IAP, acompanhamento e proof-of-play.

Duas notas de loja: os SKUs têm de estar cadastrados nos dois consoles **antes** da primeira
build de revisão, com conta de teste que tenha crédito e campanha ativa — revisão que esbarra em
tela vazia volta como "funcionalidade incompleta". E o app do opendriver declara
`NSPrivacyTracking: false` com `NSPrivacyTrackingDomains` vazio; se o openad introduzir
atribuição de anúncio, o manifesto de privacidade **dele** é outro, e o do opendriver não pode
ser alterado por isso.

### Fase F — Robustez do player (4 a 5 dias)

Os três itens da §2.5, com o download em disco primeiro — é o que impede o OOM. Decisão técnica
R4 pendente: `Filesystem.downloadFile` impede o `crypto.subtle.digest` sobre o buffer completo.
Recomendo plugin nativo que calcula SHA-256 de arquivo em disco; agora que o módulo é Kotlin, é
um arquivo novo no mesmo projeto, não uma dependência nova. Mais: unificar os dois
gerenciadores de cache em um, espaço livre real, e religar as janelas de sincronização
(`device_groups.syncWindowRules` existe e só era consumida pela geração 2, já removida).

### Fase G — Deploy e corte de produção (4 a 6 dias)

1. `Dockerfile.api` multi-estágio espelhando o do hub (node:22-alpine, build, `--omit=dev`),
   `Dockerfile` do portal servindo estático, e `docker-compose.prod.yml`. Nada disso existe.
2. Infraestrutura em produção: MongoDB, Redis, RabbitMQ com plugin MQTT. Mídia em **Cloudflare
   R2**, não em volume do servidor — é vídeo, e `hubstorage` ainda está na VM antiga.
3. CI: copiar a forma do opendriver — dois `checkout`, migrations do hub primeiro, bootstrap,
   depois `migrate deploy` em `?schema=openad`. É o que garante que o CI testa contra um banco
   com a mesma topologia da produção.
4. Subdomínios a criar em `179.236.228.94`, seguindo a nomenclatura existente
   (`hubapi`/`api-app`): **`adsapi.opendriver.com.br`** (API), **`ads.opendriver.com.br`**
   (portal do operador e do anunciante). Cinza no Cloudflare até o certificado emitir, depois
   proxy em Full (strict), que é a orientação do `infra/README.md` do opendriver.
5. MQTT **não passa pelo Cloudflare** — proxy HTTP não encaminha 1883/8883. A porta do broker
   precisa ser exposta direto, com TLS próprio, ou via WebSocket em subdomínio dedicado. Vale
   decidir antes de provisionar.
6. Migration em produção pelo protocolo de 5 passos de `opendriver/docs/plano-producao-final.md`:
   backup completo, `pg_dump --schema-only --schema=public` antes, bootstrap, `migrate deploy`,
   `pg_dump` depois e diff — qualquer diferença além do token aleatório de `\restrict` do
   `pg_dump` é motivo para **parar e reportar**.
7. Alteração no `hub`: `accountSync.ts` e `accountPurgeService.ts` passam a conhecer o openad;
   namespace `OpenAd:*` no `CATALOG` de `settingsService.ts`, senão a chave nem é gravável.

### Fase H — Escala e observabilidade (2 a 3 dias)

Adapter de Redis no Socket.IO (D9) antes da segunda réplica, unificação do namespace MQTT
(D11), métricas e alertas.

---

## 4. Decisões que preciso de você

### 4.1 Em qual carteira o motorista recebe o repasse de anúncio?

Existem **duas** carteiras de motorista no ecossistema, e isso não dá para inferir do código:

- **Cashback do hub** (`public.users.cashback_balance` + `cashback_entries`): é o que o plano
  atual assume. É sacável, e o hub já credita comissão de motorista aí.
- **Livro-caixa do opendriver** (`opendriver.driver_earnings` + `payout_requests`): é onde o
  motorista vê "meus ganhos" e pede saque por PIX, com telas prontas.

Minha recomendação é `driver_earnings` com `EarningType` novo, por dois motivos: é onde o
motorista já olha, e mantém a receita de anúncio separada do cashback de compras, o que importa
para contabilidade e para a conversa com as lojas. Custo: uma migration aditiva de enum no
repositório `opendriver` e uma rota `/internal` lá.

### 4.2 R3 — a plataforma antecipa o repasse?

Segue em aberto desde o plano original. O código já está pronto para as duas respostas: o
padrão é `store_cycle` (sem risco de caixa) e ligar a antecipação é um clique no painel. A
decisão trava a Fase D.

### 4.3 O portal do operador também vai para `ads.opendriver.com.br`?

Ou o operador fica em subdomínio separado do anunciante? Afeta CORS e o `app.config.ts` do app.

### 4.4 Confirmação de infraestrutura

O painel do Coolify está na VM antiga (`187.77.46.26`). O openad vai ser implantado pelo mesmo
Coolify gerenciando o servidor novo remotamente, ou o Coolify também migra? E o MongoDB em
produção: contêiner gerenciado pelo Coolify no mesmo servidor, ou serviço externo?

---

> **Fase B concluída em 2026-10-02.** O openad entrou no Postgres compartilhado com schema
> próprio e aceita token do hub; no caminho, uma vulnerabilidade de escalonamento de papel
> entre serviços foi fechada (D22 em `estado-do-trabalho.md`). Restam as outras fases.
>
> A parte **de servidor** de tudo isso — migrations em produção, Asaas, Infosimples,
> infraestrutura e deploy do openad — está separada em
> [`producao-ecossistema.md`](./producao-ecossistema.md), que é o guia a seguir com Kiro
> conectado ao servidor. A publicação dos aplicativos nas lojas está em
> [`publicacao-lojas-ecossistema.md`](./publicacao-lojas-ecossistema.md).

## 5. Soma e ordem recomendada

| Fase | Trabalho | Depende de |
|---|---|---|
| A — Tablete | 2–3 d | comprar hardware |
| B — Postgres e identidade | 4–5 d | — |
| C — Escopo, rotas, moderação | 4–5 d | B |
| D — Dinheiro | 5–7 d | B, decisões 4.1 e 4.2 |
| E — App do anunciante | 6–8 d | C, D |
| F — Robustez do player | 4–5 d | A (idealmente) |
| G — Deploy e corte | 4–6 d | B, decisão 4.4 |
| H — Escala | 2–3 d | G |

**27 a 42 dias de trabalho efetivo.** A e F podem correr em paralelo com B, C e D, porque tocam
o tablete e não a API. Começar por A e B ao mesmo tempo é o que encurta mais o caminho: A é o
único item que pode invalidar desenho, e B destrava C, D e G.

A ordem que eu seguiria: **A e B juntas → C → F → D → G → E → H.** A Fase E vai por último de
propósito, apesar de ser a mais visível: um app de anunciante sem crédito funcionando e sem
proof-of-play real é exatamente a build que a revisão da loja recusa.
