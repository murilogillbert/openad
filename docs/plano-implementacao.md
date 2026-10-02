# OpenAD — plano de adaptação, integração e mobile

> Plataforma de anúncios em telas automotivas (DOOH), assumida de terceiros em 2026-10-02.
> Este documento é o plano de trabalho. O diagnóstico que o originou está na §1; as
> decisões de produto já tomadas estão na §2. Nada aqui foi implementado ainda, com
> exceção do que está marcado como **feito** na Fase 0.

Projetos irmãos no mesmo ecossistema: `hub` (web + API, **em produção**), `hub-mobile`,
`opendriver` (API de corridas + app). O contrato do banco compartilhado entre eles está em
`hub/docs/normalizacao-banco.md` — leia antes de mexer em identidade ou dinheiro.

---

## 1. Ponto de partida

### 1.1 O que o legado é

Monorepo Nx 21.6.10 (pnpm) com quatro aplicações:

| Projeto | Papel | Stack |
|---|---|---|
| `app/openad-api` | Backend único | NestJS 11, MongoDB 7 (Mongoose 9), Redis 7 + BullMQ, RabbitMQ 4 com plugin MQTT, S3, Socket.IO, Prometheus |
| `app/openad-management` | Portal do operador | Angular 21 + PrimeNG 21 + Tailwind 4, SSR |
| `app/openad-ad-client` | Player na tela do carro | Angular 21 + Capacitor 8 Android, kiosk / Device Owner, 19 plugins nativos |
| `libs/{domain,api-contracts,mqtt-contracts}` | Contratos tipados (Zod) | — |

A API tem 395 arquivos TypeScript (~30,5 mil linhas), 28 módulos e 28 collections. Há dez
especificações formais em `specs/001`..`specs/010`, com data-model e contratos. **A
documentação é o maior ativo do legado** — ela explica o desenho muito melhor do que o
código executa.

### 1.2 O que está bom e deve ser preservado

- **Pipeline de analytics**: ingestão em lote com gzip, envelope validado por Zod, upsert
  idempotente, reconciliação por duração observada vs esperada, verificação de geofence,
  antifraude por velocidade implícita e razão de heartbeat, rollup de pacing diário.
- **Ledger espacial** (`specs/005`): recibos por zona, intervalos de residência e
  `lost_opportunity_events` — registra *por que* um anúncio não tocou (tier maior, cooldown,
  velocidade, pacing, loop lock). É prestação de contas acima da média do mercado.
- **MDM de APK** (`specs/009`): upload, canal estável, rollout faseado por grupo ou
  percentual, QR de instalação, relato de versão instalada pelo device.
- **Plano MQTT**: credencial por tablet provisionada no pareamento, ACL por tópico, QoS
  coerente com a natureza de cada mensagem, schedule retido.
- **Mídia VFS** (`specs/007`): upload presignado direto para o storage, árvore de pastas
  com caminho materializado, validação técnica por ffprobe contra um ruleset DOOH.

### 1.3 Os defeitos que bloqueiam o lançamento

Encontrados por leitura de código e, onde indicado, confirmados por execução.

**D1 — A entrega de mídia está desligada.** Existem três gerações de pipeline empilhadas no
player, de três specs diferentes, e as duas obsoletas continuam ativas:

- *Geração 1* (`specs/001`): MQTT `schedule` → `AdPlaybackService.onSchedule` →
  `MediaSyncService.downloadAsset`, que lê o corpo da resposta e **descarta os bytes**;
  nenhum arquivo é escrito, mas `storage.registerDownload()` registra no índice de cache um
  arquivo inexistente. Publica impressões com `campaignId: "rule:{ruleId}"` — ID sintético
  que não corresponde a campanha nenhuma — e `location` sempre nula.
- *Geração 2* (`specs/003`): `GET /devices/:id/manifest?sinceVersion=N`, que lê
  `manifest_versions`. O único escritor dessa collection é `createNextVersion()`, cujo
  comentário diz *"for tests / ops seeding"* — nada em produção o chama, então a rota
  responde sempre `{ version: 0, fullSync: true, added: [], removed: [] }`. Também descarta
  os bytes baixados.
- *Geração 3* (`specs/004`/`005`): `SyncOrchestratorService.syncNow()` → `POST /manifest`,
  delta por JSON Patch, download com Range/resume, **verificação SHA-256**, gravação em
  `media/{mediaId}`, poda, report de `sync-status`, evento → `PlaybackEngineService`
  recarrega e toca do disco. Está completa e correta. **`syncNow()` não tem nenhum
  chamador** em todo o `src`.

**D2 — A tela do player é inalcançável.** O `app.routes.ts` do ad-client redireciona `''`
para `pairing`, e não existe um único `routerLink`, `router.navigate` ou `navigateByUrl` em
todo o aplicativo. A rota `/playback`, onde vive o `<video>`, só seria alcançável digitando
a URL — impossível em kiosk. O `PlaybackEngineService` *é* instanciado no boot (via
`SpatialRuntimeService` → `SpatialPlaybackBridgeService`), roda sem elemento de vídeo
montado, e como o avanço de clipe é dirigido pelo evento `ended` do `<video>`, nunca avança.

**D3 — Nada de analytics sai do tablet.** `PlayBatchUploaderService` está registrado como
provider no `AnalyticsModule` mas **nada o injeta**, então nunca é instanciado e o
`interval(45s)` de flush nunca começa. Os play records ficam no buffer em disco para sempre.

**D4 — O manifesto não é segmentado nem validado.** `ManifestGeneratorService.build()` faz
`find({ isActive: true })` sobre toda a mídia da plataforma, com `void deviceState`
explícito. Não filtra por status de campanha, janela `scheduledStart`/`scheduledEnd`,
orçamento esgotado, segmentação ou capacidade do device. Campanha em `draft` ou `completed`
continua sendo distribuída.

**D5 — Não existe isolamento por dono.** `GET /campaigns` faz `findMany({})` — lista todas
as campanhas de todos. `MediaScopeService.canAccessCampaigns()` é um stub que retorna
`true` incondicionalmente, com comentário admitindo isso. Abrir para parceiros hoje faria
cada anunciante ver e baixar a mídia dos outros.

**D6 — Download de vídeo acumulado em memória.** `ResumableDownloadService.downloadToBuffer`
monta o arquivo inteiro em `ArrayBuffer`; `SyncStorageManagerService.writeMediaFile` o
converte para base64 (+33%) para gravar via `Filesystem.writeFile`. Um MP4 de 80 MB dá
~190 MB de pico no heap do WebView — OOM provável no hardware alvo.

**D7 — Dois gerenciadores de cache concorrentes.** `StorageManagerService` (LRU por
`lastPlayedAt`) e `SyncStorageManagerService` (poda por `priority`) operam nos mesmos
arquivos com critérios diferentes. E `getAvailableBytes()` cai num fallback de **512 MB
fixo** quando `Filesystem.stat` não traz `free`, que é o caso no Android.

**D8 — Buffer de analytics com perda silenciosa.** `PlayRecordBufferService.enqueuePlay`
reescreve o JSON inteiro a cada registro (até 2000) — amplificação de escrita em flash, que
é o que falha primeiro em tablet embarcado. `markUploaded` só marca, nunca remove, então o
corte em 2000 descarta os **mais antigos ainda não enviados**: um veículo muito tempo
offline perde dado faturável sem avisar.

**D9 — Socket.IO não escala horizontalmente.** `FleetGateway` faz `this.server.emit(...)`
sem adapter de Redis. Só o canal `pubsub:dashboard` passa por Redis. Com duas réplicas da
API, mapa de frota e KPIs só chegam a quem está conectado na mesma instância.

**D10 — Sem caminho de deploy versionado.** O `README` referencia `Dockerfile.api` e
`docker-compose.prod.yml`; nenhum dos dois existe no repositório.

**D11 — Namespace MQTT partido em dois.** `devices/{id}/config|heartbeat|power-state|priority`
e `openad/{id}/telemetry|schedule|commands|impressions|spatial`. Mesma frota, duas raízes:
complica ACL e observabilidade.

**D12 — Versão de Node divergente em três lugares.** `.nvmrc` diz 20.19, `nixpacks.toml`
diz 22.17.0, `engines` aceita 20/22/24. Não há campo `packageManager`.

> Por que a suíte de testes não pega nada disso: ela está **verde** — 97 suítes, 270 testes
> passando, 2 skipped, confirmado por execução. Os defeitos D1–D3 são de *fiação entre
> componentes*, exatamente o que teste unitário com provider mockado não alcança. O
> `command-handler.service.spec.ts`, por exemplo, mocka o `ManifestSyncService`.

---

## 2. Decisões de produto

Validadas com o cliente em 2026-10-02.

| # | Decisão | Consequência técnica |
|---|---|---|
| 1 | **Quem anuncia são parceiros.** Criar conta já torna a pessoa parceira. | Sem fila de aprovação de cadastro. `ad_advertisers` nasce `active`. A conta é a do ecossistema (`public.users`), não uma conta nova. |
| 2 | **Cobrança por in-app purchase.** Decidido em 2026-10-02 após avaliar o risco de revisão do caminho B2B. | Muda o modelo comercial: SKU fixo em vez de valor livre. Ver §2.1. |
| 3 | **Moderação humana existe**, com papel novo de **moderador**. | Role nova, fila de moderação, estados `pending_review`/`rejected`, auditoria de quem decidiu. |
| 4 | **O motorista recebe por veiculação, e o parceiro define quanto**, com piso de plataforma e peso no leilão. | Campo de repasse na campanha + crédito via cashback do hub. Desenho fechado na §2.2. |
| 5 | **App do anunciante é um terceiro app**, integrado ao ecossistema. | Novo projeto Expo/React Native, irmão de `hub-mobile` e `opendriver/mobile`. |

### 2.1 Cobrança por in-app purchase

Decidido: IAP nas duas lojas. Elimina o risco de revisão do enquadramento B2B, ao custo de
15% (programa de pequenos negócios, até US$ 1 M/ano) a 30% da receita comprada pelo app.

Isso **não é só uma taxa** — muda três coisas no produto, e as três precisam estar no
desenho desde a Fase 5:

**a) Valor livre deixa de existir; o modelo passa a ser pacote de crédito.** Produto de IAP
é SKU fixo, cadastrado em App Store Connect e Play Console. Não é possível cobrar
"R$ 1.247,30, que é o custo desta campanha". O anunciante compra **crédito de veiculação**
em pacotes (ex.: 50 / 100 / 500 / 2.000), do tipo *consumable*, e a campanha consome desse
saldo conforme as veiculações viram faturáveis. O pacing diário que já existe
(`campaign_daily_spend`) passa a ser o mecanismo que impede gastar crédito que não há.

**b) O crédito não pode ser conversível em dinheiro.** Se o saldo comprado via IAP virasse
`users.cashback_balance` — que é sacável no hub — a loja interpretaria como valor armazenado
equivalente a dinheiro, e isso é recusado. Portanto o crédito de veiculação é um **ledger
separado**, só gastável em veiculação, sem resgate e sem transferência. Essa é a razão de
`ad_credit_ledger` existir na §4.1 em vez de reaproveitar a carteira do hub.

**c) O repasse ao motorista ganha defasagem de caixa.** A receita de IAP não chega na hora:
Apple e Google repassam ao redor de 30 a 45 dias após o fechamento do mês, já descontada a
comissão. O motorista veicula hoje e a plataforma só tem o dinheiro depois. Duas saídas, e
**esta ainda é decisão do cliente**:

- *A plataforma antecipa*: o motorista recebe no ciclo normal e a empresa financia o
  capital de giro. Melhor para retenção do motorista, exige caixa.
- *O repasse acompanha o ciclo da loja*: `ad_payouts` liquida junto com o repasse da loja,
  com a defasagem explicada no app do motorista. Sem risco de caixa, pior para retenção.

**Implementação.** `react-native-purchases` (RevenueCat) tem config plugin para Expo, cobre
as duas lojas e entrega webhook — é o caminho mais curto. Alternativa sem dependência de
terceiro: `react-native-iap` com validação própria. Em qualquer uma delas, **validação de
recibo é no servidor**, nunca no app, com App Store Server API e Google Play Developer API;
e as notificações de servidor (App Store Server Notifications V2, Real-time Developer
Notifications) são obrigatórias, porque reembolso tem de ser capaz de suspender campanha e
estornar crédito não consumido.

### 2.2 Repasse ao motorista — desenho aprovado

O parceiro define quanto o motorista recebe por veiculação, com dois freios aprovados:

**1. Piso de plataforma.** Percentual mínimo do valor faturável, em `platform_config` —
que já existe, já é Mongo-backed e já é editável em Admin → Plataforma sem redeploy.
Campanha com repasse abaixo do piso é recusada na criação, não na moderação: erro de
validação é mais barato que fila humana.

**2. Peso no leilão.** Repasse maior ganha mais inventário. Sem isso o piso vira só custo
fixo e ninguém paga acima do mínimo. O mecanismo já existe e é reaproveitável: a arbitragem
espacial já combina `tier`, `priorityScore`, `arbitrationWeights { wp, wd, wh }` e
`pacingFactor` em `SpatialManifestBuilderService`. O repasse entra como termo adicional do
score, normalizado contra o piso:

```
boostRepasse = 1 + k * ((repasseOfertado / pisoPlataforma) - 1)
```

com `k` em `platform_config` para calibrar quanto o repasse pesa sem permitir que dinheiro
atropele relevância geográfica. `k = 0` desliga o leilão e mantém só o piso, o que dá uma
saída segura se o comportamento em produção surpreender.

Toda supressão continua registrada em `lost_opportunity_events` com `reason`, que já tem o
valor `pacing` e ganha `revenue_share`. Isso é o que permite explicar a um parceiro por que
a campanha dele tocou menos — sem esse registro, leilão é caixa-preta e gera disputa.

---

## 3. Arquitetura alvo

### 3.1 Identidade e dinheiro no Postgres, operação e telemetria no Mongo

**Não migrar o openad para Postgres.** As cinco collections de evento são append-only de
alto volume, as zonas dependem de índice `2dsphere`, o `platform_config` é JSON livre por
desenho, e são 28 collections espalhadas por 395 arquivos. PostGIS resolveria a geometria,
mas reescrever o acesso a dados exigiria revalidar reconciliação, antifraude e ledger
espacial — que são justamente o diferencial do produto. Mongo é a ferramenta certa para o
que ele guarda.

A fratura real com o ecossistema é a **identidade**: `openad.users` é uma collection própria,
com papéis próprios e `JWT_SECRET` próprio, enquanto `hub` e `opendriver` compartilham
`public.users` no Postgres e o **mesmo** `JWT_SECRET` — token de um vale no outro.

A federação proposta segue a mesma direção já normalizada entre hub e opendriver:

```
public.users            uma conta para todo o ecossistema (dono: hub)
  └─ ad_advertisers     vínculo conta → parceiro anunciante
       └─ ad_campaign_orders   dinheiro da veiculação (Asaas, via hub)
  └─ ad_payouts         repasse ao motorista (crédito via cashback do hub)

openad.users            SOMENTE equipe interna (operador, moderador, admin)
openad.campaigns        campanha, com ownerUserId apontando para public.users.id
openad.*                frota, mídia, entrega, eventos, telemetria
```

Regra de propriedade, no mesmo espírito da §1 de `hub/docs/normalizacao-banco.md`:
**só o hub altera a estrutura de `public`; só o openad altera a estrutura de `openad`.**
O openad nunca escreve em `users`; reporta veiculações faturáveis e o hub credita.

### 3.2 Autenticação federada

`JwtStrategy` passa a ter dois caminhos, com o **mesmo** `JWT_SECRET` do ecossistema:

- **Token de equipe interna**: `sub` resolve em `openad.users` (como hoje).
- **Token de anunciante**: `sub` = `public.users.id`, resolvido para `ad_advertisers`.

Server-to-server reusa `public.service_api_keys` — hash SHA-256, escopos, revogação em
Admin → Chaves de API. O middleware, o catálogo de escopos e a tela já existem nos dois
lados; só acrescentar `ads:campaign:write`, `ads:payout:read`.

### 3.3 Tempo real

- **MQTT fica** no plano de dispositivo. É a escolha certa: QoS, retenção, tolerância a
  link ruim. Unificar o namespace (D11) sob `openad/{deviceId}/…` com escuta dupla no
  servidor durante a migração.
- **Socket.IO ganha adapter de Redis** (D9) antes da segunda réplica da API.
- **O app do anunciante não precisa de WebSocket.** REST com cache, e push (aprovação de
  campanha, orçamento esgotado, relatório pronto) pela infra que já montamos no hub:
  `push_tokens` + `infra/push.ts`.

---

## 4. Modelo de dados

### 4.1 Novas tabelas em `public` (dono: hub, migration aditiva)

```
ad_advertisers        id, user_id → users.id, legal_name, document_enc, document_hash,
                      status (active|suspended), created_at, updated_at

ad_credit_purchases   id, advertiser_id → ad_advertisers.id, store (apple|google),
                      product_sku, credit_cents, price_cents, store_fee_cents,
                      transaction_id (unico por loja), receipt_status
                      (pending|validated|refunded), validated_at, refunded_at

ad_credit_ledger      id, advertiser_id, direction (credit|debit), amount_cents,
                      reason (purchase|campaign_spend|refund|adjustment),
                      purchase_id (nullable), campaign_id (nullable), created_at

ad_payouts            id, driver_user_id → users.id, period_start, period_end,
                      billable_plays, gross_cents, net_cents, status, settled_at
```

Nenhuma coluna existente muda.

**Por que o crédito tem ledger próprio e não entra na carteira do hub:** o saldo comprado
via IAP não pode ser conversível em dinheiro (§2.1b). `users.cashback_balance` é sacável,
então misturar os dois transformaria crédito de veiculação em valor armazenado — o que as
lojas recusam. `ad_credit_ledger` é append-only e só debita por veiculação.

O **repasse ao motorista**, ao contrário, continua sendo cashback normal: entra em
`users.cashback_balance` + `cashback_entries` pelas regras de
`hub/backend/src/domain/commissionRules.ts`. O openad **não** reimplementa conta de
dinheiro; ele reporta veiculações faturáveis e o hub credita. `ad_payouts` é só o
fechamento por período.

Índice único obrigatório em `ad_credit_purchases (store, transaction_id)` — é o que impede
que o mesmo recibo credite duas vezes quando o app reenvia a compra (e ele reenvia, porque
é assim que IAP se recupera de app fechado no meio da transação).

### 4.2 Mudanças no Mongo (dono: openad)

| Collection | Mudança | Motivo |
|---|---|---|
| `campaigns` | `+ ownerUserId`, `+ advertiserId`, `+ orderId` | D5 — sem isso não há isolamento |
| `campaigns.status` | `+ pending_review`, `+ rejected` | Decisão 3 |
| `campaigns` | `+ moderation { reviewedByUserId, reviewedAt, decision, reason }` | Rastreabilidade da decisão |
| `campaigns` | `+ targeting { cities[], zoneIds[], tiers[], vehicleTiers[], dayparts[] }` | D4 — hoje não há segmentação |
| `campaigns` | `+ driverPayout { model, valueCents?, percent? }` | Decisão 4 |
| `campaigns.budget` | centavos inteiros + `dailyBudgetCents` | Float em dinheiro é dívida; o pacing já conta em centavos |
| `media_assets` | `+ ownerUserId` | Mesmo motivo de `campaigns` |
| `vehicles.driverId` | passa a referenciar `public.users.id` | Hoje é string livre; é a ponte do repasse |
| `users.role` | `+ content_moderator` | Decisão 3 |
| `users` | mantida, só para equipe interna | Anunciante autentica pelo Postgres |
| `lost_opportunity_events.reason` | `+ revenue_share` | Explicar supressão por leilão de repasse (§2.2) |

Índices novos: `campaigns { ownerUserId, status, updatedAt }`,
`media_assets { ownerUserId, isActive }`, `campaigns { status, 'moderation.reviewedAt' }`.

### 4.3 Rotas novas

Prefixo separado, para não misturar com o portal interno:

```
POST   /api/v1/advertiser/campaigns                 cria em pending_review
GET    /api/v1/advertiser/campaigns                 escopo = ownerUserId
POST   /api/v1/advertiser/campaigns/:id/media       upload presignado (reusa VFS 007)
GET    /api/v1/advertiser/campaigns/:id/estimate    alcance e custo previstos
GET    /api/v1/advertiser/campaigns/:id/report      proof-of-play do dono
GET    /api/v1/advertiser/inventory/zones           zonas e tiers disponíveis
GET    /api/v1/moderation/queue                     role content_moderator
POST   /api/v1/moderation/campaigns/:id/decision    aprovar/reprovar com motivo
GET    /api/v1/internal/ads/payouts                 consumido pelo hub (service key)
```

---

## 5. Padronização de código

> Interpretação: "o código está em **Nest**" — o backend do openad é NestJS, enquanto `hub`
> e `opendriver` são Express + Prisma. Se a intenção era outra, esta seção muda.

### 5.1 O que **não** fazer: reescrever NestJS para Express

São 30,5 mil linhas, 28 módulos e 395 arquivos construídos sobre injeção de dependência.
Além do custo, a reescrita re-arrisca reconciliação, antifraude e ledger espacial — o
diferencial do produto. E o NestJS entrega pronto o que os outros dois serviços fazem à
mão: DI, guards, integração BullMQ, gateways WebSocket, geração de Swagger, health checks.
Sair dele significa reimplementar tudo isso.

O custo real da divergência não é o framework: é o vocabulário que um desenvolvedor precisa
reaprender ao trocar de repositório. É isso que vale convergir.

### 5.2 O que converge, por ordem de valor

Comparação medida dos três backends:

| | hub | opendriver | openad |
|---|---|---|---|
| Runtime | Express, ESM | Express, ESM | NestJS, CJS (webpack) |
| Banco | Prisma/Postgres | Prisma/Postgres | Mongoose/Mongo |
| Validação | Zod | Zod | **class-validator + Zod** |
| Dinheiro | `decimal.js`, centavos | `decimal.js`, centavos | **float** |
| Testes | Vitest | Vitest | **Jest** |
| JWT | `jsonwebtoken` | `jsonwebtoken` | `@nestjs/jwt` + passport |
| Env | `dotenv` + `config.ts` com Zod | idem | **dotenvx + wrapper bash** |
| Idioma dos comentários | português | português | **inglês** |

**P1 — Validação única em Zod.** *Maior valor.* Hoje o openad usa class-validator nos DTOs
HTTP e Zod nos contratos MQTT/analytics: duas gramáticas no mesmo serviço. Converger em Zod
(via `ZodValidationPipe`) elimina `class-validator` e `class-transformer`, alinha com os
outros dois backends e — o ganho decisivo — permite **compartilhar o schema com o app
mobile**, como `libs/api-contracts` já faz.

**P2 — Dinheiro em inteiro de centavos.** `campaigns.budget` em float contra `decimal.js` +
centavos nos outros dois. `campaign_daily_spend` já conta em `billableCostCents`, então o
openad já é inconsistente internamente. Converter na migration da §4.2.

**P3 — Envelope de resposta e erros.** O openad é inconsistente consigo mesmo: parte das
rotas devolve `{ success, data }`, parte devolve o objeto cru. Unificar no formato do hub, e
alinhar `domain-http.exception` / `normalize-http-exception` ao mapeamento de erro do
ecossistema.

**P4 — Carregamento de ambiente sem bash.** `scripts/with-monorepo-env.sh` é um wrapper
dotenvx em bash: **não roda no ambiente de desenvolvimento Windows** (só há WSL bash, que
não resolve caminhos do host). Converger no padrão dos outros dois: um `config.ts` validado
por Zod no boot, com `dotenv` opcional. O `env.validation.ts` atual já usa Zod, mas valida
só 6 chaves com `.passthrough()` — ampliar para todas as obrigatórias e falhar cedo.

**P5 — Vitest.** Converger o runner. O monorepo já tem Vitest nas devDependencies (usado no
unit-test do Angular). Fazer por projeto, não de uma vez: `libs/*` primeiro (são puros),
`openad-api` depois. A suíte atual está verde com 270 testes — não vale perdê-la num
big-bang.

**P6 — Versão de Node e gerenciador de pacotes.** Fixar uma (D12): `.nvmrc`, `engines`,
`nixpacks.toml` e campo `packageManager` concordando. Recomendo Node 22 LTS, que satisfaz
Angular 21 e NestJS 11 e é compatível com os outros dois serviços.

**P7 — Idioma.** Converger em português no código novo e no que for tocado. **Sem varredura
em massa**: reescrever 30 mil linhas de comentário gera um diff que esconde mudança real de
comportamento por meses.

**P8 — Versionamento de rota.** `analytics/v1/campaigns` sob o prefixo global `api/v1`
produz `/api/v1/analytics/v1/campaigns`. Normalizar para `/api/v1/...` como nos outros dois.

**P9 — Scripts de automação em Node, não em bash.** Já aplicado ao
`scripts/init-media-bucket.mjs` (Fase 0). Fazer o mesmo com os `docker:*`.

**P10 — Lint e format.** Unificar `.prettierrc` e a config flat do ESLint com os outros
repositórios.

### 5.3 O player continua Capacitor — e por quê

Pergunta levantada em 2026-10-02: há Java no projeto, e o player deveria seguir o padrão
dos outros apps?

Há, em quatro arquivos (373 linhas), todos em
`app/openad-ad-client/android/app/src/main/java/com/openad/`:

| Arquivo | Função |
|---|---|
| `MainActivity.java` | Quando o app é Device Owner, configura allowlist de Lock Task e `LOCK_TASK_FEATURE_NONE` — kiosk sem nenhuma UI de sistema |
| `OpenAdDeviceAdminReceiver.java` | Receiver DPC que torna possível `dpm set-device-owner` |
| `OpenAdSilentInstallPlugin.java` | Autoatualização silenciosa de APK via `PackageInstaller`, sem confirmação do usuário |
| `PowerStatePlugin.java` | Detecção de motor ligado/desligado |

A distinção que resolve a questão: `hub-mobile` e `opendriver/mobile` são apps de
consumidor, publicados em loja e instalados pela pessoa. **O player não é um app, é um
appliance**: entra num tablet zerado via `dpm set-device-owner`, nunca vai para o Play
Store, e se atualiza sozinho pelo MDM que vive neste repositório (`specs/009`).

E o argumento técnico decisivo: Expo *suporta* código nativo, via config plugin e prebuild.
Mas a migração terminaria com **os mesmos quatro arquivos Java**, apenas movidos para
dentro de um config plugin — ganho nenhum — e custaria os 19 plugins Capacitor já
integrados (kiosk, brilho, sensor de luz, bússola, acelerômetro, wifi, volume, privacy
screen, keep-awake, MQTT nativo), que seriam reimplementados um por um.

**Decisão:** o player fica em Capacitor. A consistência com os outros apps é buscada onde
ela de fato reduz custo de manutenção — P1 a P10 acima, que são convenções de TypeScript,
contratos e validação, não framework. O app do anunciante (Fase 6) nasce em Expo, igual aos
outros dois.

### 5.4 Como aplicar

P1, P3 e P7 são **transversais**: aplicados módulo a módulo conforme cada um é tocado pelas
fases seguintes, nunca como refatoração isolada. P2, P4, P6, P8 e P10 são pontuais e cabem
na Fase 0/1. P5 é por projeto. P9 é incremental.

A regra: nenhum commit mistura padronização com mudança de comportamento. Diff de
padronização é grande e chato de revisar; diff de comportamento precisa ser lido linha por
linha. Misturar os dois é como se perde bug em revisão.

---

## 6. Fases

Ordenadas por dependência e por risco de descobrir tarde que algo não funciona.

### Fase 0 — Ambiente e baseline

- **feito** Commit de baseline (`ec9c707`): 1114 arquivos, árvore do terceiro sem nenhuma
  alteração nossa. O repositório não tinha commit algum; sem isso não havia ponto de retorno.
- **feito** Stack local voltou a subir (`1c2df22`). A imagem fixada da MinIO não é mais
  puxável (Docker Hub nega, `quay.io` responde 401, `bitnami` saiu do catálogo gratuito) e,
  como o compose puxa em paralelo e aborta no erro, Mongo/Redis/RabbitMQ também não subiam.
  Trocada por SeaweedFS: mesma API S3, mesma porta, mesmas credenciais, nenhum `.env` alterado.
- **feito** `scripts/init-media-bucket.mjs` substituindo o script bash que exigia `aws` CLI.
- **feito** Baseline de execução: 97 suítes, 270 testes passando, 2 skipped.
- P6 (versão de Node), P10 (lint/format), `Dockerfile.api` e `docker-compose.prod.yml` (D10).
- CI no GitHub Actions espelhando o dos outros repositórios.

### Fase 1 — Fazer o player tocar

Sem isto não há produto para vender, e é o que mais rápido revela problema de hardware.

1. Montar o `PlaybackControllerComponent` como shell do app, com pareamento como estado
   condicional e não como rota de entrada (D2).
2. Disparar `SyncOrchestratorService.syncNow()`: no boot após pareamento, periodicamente, e
   nos comandos `SYNC_SCHEDULE` e `EMERGENCY_SYNC` — hoje `SYNC_SCHEDULE` só responde ack e
   não faz nada (D1).
3. Injetar `PlayBatchUploaderService` em algo instanciado no boot (D3).
4. Remover gerações 1 e 2: `MediaSyncService`, `ManifestSyncService`, a rota de manifesto
   delta, `manifest_versions` e o `registerDownload()` que mente sobre arquivos inexistentes
   e corrompe a contabilidade usada pela geração 3 (D1, D7).
5. **Teste de integração que a suíte atual não tem**: manifesto → download → arquivo em
   disco → play record no servidor, sem mock no meio. É o teste que teria pego D1–D3.

*Entregável:* tablet pareia, sincroniza, toca do disco e os play records chegam ao servidor.

### Fase 2 — Seleção correta de manifesto

Reescrever `ManifestGeneratorService.build()` (D4) para resolver campanhas `active` ∩ dentro
da janela ∩ com orçamento (`campaign_daily_spend.pacingState != 'paused'`) ∩ compatíveis com
o `targeting` versus device/veículo/zona. O `SpatialManifestBuilderService` já faz parte
disso bem, inclusive aplicando multiplicador de pacing — serve de modelo.

*Entregável:* uma campanha pausada, vencida ou sem orçamento para de ser distribuída.

### Fase 3 — Identidade federada e isolamento

`JWT_SECRET` compartilhado, resolução de anunciante, `ownerUserId` em toda query de campanha
e mídia, `MediaScopeService` com verificação real (D5), escopos novos em `service_api_keys`.

*Entregável:* dois parceiros no mesmo ambiente não veem nada um do outro. Teste automatizado
provando isso.

### Fase 4 — Moderação

Role `content_moderator`, estados `pending_review`/`rejected`, fila, decisão com motivo
registrado, telas no portal (`designs/management-panel/` já tem o padrão visual), e bloqueio
no `patchStatus` para que nada vá ao ar sem aprovação.

### Fase 5 — Crédito, IAP e repasse

- Tabelas da §4.1, com o índice único `(store, transaction_id)`.
- Validação de recibo **no servidor** (App Store Server API, Google Play Developer API) e
  consumo das notificações de servidor das duas lojas, para reembolso suspender campanha e
  estornar crédito não consumido.
- Débito de crédito amarrado ao pacing: `campaign_daily_spend` passa a ser o que impede
  gastar saldo inexistente.
- Repasse com piso em `platform_config` e `boostRepasse` entrando no score da arbitragem
  (§2.2), com `k = 0` como desligamento seguro.
- `reason: 'revenue_share'` em `lost_opportunity_events`.
- `GET /internal/ads/payouts` consumido pelo hub, que credita via `commissionRules.ts`.

*Entregável:* comprar um pacote no sandbox da loja credita saldo exatamente uma vez,
inclusive com reenvio do mesmo recibo; estorno suspende a campanha.

### Fase 6 — App do anunciante

Terceiro app, Expo + `expo-router`, camada `src/api` tipada espelhando `libs/api-contracts`,
nas mesmas convenções de `hub-mobile`. Telas: cadastro de parceiro, criação de campanha com
segmentação, upload de criativo, compra de pacote de crédito via IAP, acompanhamento de
veiculação e proof-of-play.

Nota de loja: SKUs cadastrados nos dois consoles antes da primeira build de review, e conta
de teste com crédito e campanha ativa — revisão que esbarra em tela vazia costuma voltar
como rejeição por "funcionalidade incompleta".

### Fase 7 — Robustez do player

- `Filesystem.downloadFile()` em vez de buffer em memória + base64 (D6). **Decisão
  pendente:** isso impede o `crypto.subtle.digest` sobre o buffer completo. Opções: (i)
  verificar tamanho + ETag; (ii) plugin nativo que calcula SHA-256 de arquivo em disco;
  (iii) hash incremental em blocos. Recomendo (ii) — a verificação de checksum é o que
  impede criativo corrompido de virar impressão faturada.
- Um gerenciador de cache só, com espaço livre real (D7).
- Buffer de analytics em append com compactação, e poda do que já subiu (D8).
- Religar janelas de sincronização e `connectivityMode` na geração 3: preferir Wi-Fi, janela
  noturna, teto de bytes por dia. A lógica existe (`device_groups.syncWindowRules`,
  `SyncWindowSchedulerService`) e só era consumida pela geração 2, agora removida.
- Validar `<video>` em WebView com o codec do hardware alvo — `media_assets.codec` aceita
  `h265`, cujo suporte em WebView é irregular.

### Fase 8 — Escala e observabilidade

Adapter de Redis no Socket.IO (D9), unificação do namespace MQTT (D11), métricas e alertas.

---

## 7. Riscos e pendências

| # | Item | Situação |
|---|---|---|
| R1 | Cobrança | **Resolvido**: IAP (§2.1). Consequências a e b já no desenho |
| R2 | Piso de repasse e peso no leilão | **Resolvido**: aprovado, desenho na §2.2 |
| R3 | Defasagem de caixa do repasse: plataforma antecipa ou acompanha o ciclo da loja (§2.1c) | **Decisão do cliente**, antes da Fase 5 |
| R4 | Verificação de integridade após `downloadFile` | **Decisão técnica**, antes da Fase 7 |
| R5 | APK não compilável neste ambiente | Confirmado: só há **JRE 1.8** (nem JDK), e o wrapper pede Gradle 8.14.3 com AGP que exige JDK 17+. Instalar JDK 17 antes de gerar APK |
| R6 | Nunca rodou em hardware real, pelo que o código indica | Conseguir um tablet alvo antes de fechar a Fase 1 |
| R7 | Watchdog (`deep-sleep`, `safety-loop`, `player-restart`) não exercitado | Validar na Fase 1 |
| R8 | Framework do player | **Resolvido**: fica em Capacitor (§5.3) |
| R9 | Codec `h265` aceito em `media_assets` tem suporte irregular em WebView | Validar na Fase 7 com o hardware alvo |

Nada foi aplicado em produção, e o `hub` — que está no ar — não foi tocado. As migrations
da §4.1 seguem o protocolo de backup descrito em `opendriver/docs/plano-producao-final.md`.
