# OpenAD — estado do trabalho e pendências

> Documento de passagem, escrito em 2026-10-02 para troca de máquina e **retomado na máquina
> nova no mesmo dia**: ambiente remontado, suíte pendente da Fase 3 executada e corrigida, o
> caminho A da §5 (nativo em Kotlin) implementado e a identidade federada concluída.
>
> Os outros documentos desta pasta:
> - [`plano-implementacao.md`](./plano-implementacao.md) — o plano original, com duas seções
>   corrigidas depois de ler os repositórios irmãos no código.
> - [`plano-ecossistema-e-mobile.md`](./plano-ecossistema-e-mobile.md) — o que falta para
>   fechar o ecossistema e o mobile, em fases, com estimativa.
> - [`producao-ecossistema.md`](./producao-ecossistema.md) — **guia de execução no servidor**,
>   cobrindo os quatro repositórios, com precauções e protocolo de migration.
> - [`publicacao-lojas-ecossistema.md`](./publicacao-lojas-ecossistema.md) — publicação do
>   `hub-mobile` e do `opendriver/mobile` nas lojas, com os bloqueadores encontrados.

---

## 1. Como montar o ambiente na máquina nova

Nada disso está no `README` do projeto. Validado por execução na máquina nova em 2026-10-02.

```
# 1. Node e pnpm
#    A divergência de versão (D12) foi fechada: `.nvmrc` 22.17.0, `engines` >=22.12 <23,
#    `nixpacks.toml` 22.17.0 e campo `packageManager` fixado em pnpm@10.34.6.
#    O campo `packageManager` é o que importa: sem ele o pnpm 12 ignora o bloco `pnpm` do
#    package.json, não vê os `overrides` e recusa o lockfile com ERR_PNPM_LOCKFILE_CONFIG_MISMATCH.
corepack enable && corepack install   # ou: npm install -g pnpm@10
pnpm install --frozen-lockfile

# 2. Infraestrutura local
#    NÃO use `pnpm docker:up`: ele passa por `scripts/with-monorepo-env.sh`, que é bash e
#    não roda no Windows (só existe o bash do WSL, que não resolve caminho do host).
docker compose --env-file docker/.env.dev up -d

# 3. Bucket de mídia
node scripts/init-media-bucket.mjs

# 4. Testes
$env:NODE_ENV='test'; pnpm exec nx run openad-api:test
pnpm exec nx run openad-ad-client:test

# 5. APK do player (já funciona; ver abaixo o que precisa estar instalado)
pnpm exec nx run openad-ad-client:cap-sync
pnpm exec nx run openad-ad-client:cap-build-android
```

**Toolchain Android desta máquina.** Instalada em 2026-10-02, fora do repositório:

| Item | Caminho | Por que esta versão |
|---|---|---|
| JDK 21 (Temurin 21.0.12) | `D:\dev\jdk\jdk-21.0.12.1+1` | O Gradle 8.14.3 do wrapper **não suporta JVM 25 ou maior** (a máquina tem JDK 25 e 26); Java 25 exigiria Gradle 9.1. E o Capacitor 8 compila em Java 21 |
| Android SDK | `D:\dev\android-sdk` | `platforms;android-36`, `build-tools;36.0.0`, `platform-tools` |
| Cache do Gradle | `D:\dev\gradle` | `GRADLE_USER_HOME`, para não encher o disco C |

O caminho do SDK está em `android/local.properties`, que é ignorado pelo git. Para o build é
preciso `JAVA_HOME` apontando para o JDK 21 — se ficar no JDK 25 padrão da máquina, o Gradle
falha antes de configurar.

Portas do stack: Mongo 27017, Redis 6379, MQTT 1884, RabbitMQ management 15672,
S3 9000, UI do filer 9001. API em 3000, portal em 4200.

**Armadilhas conhecidas deste ambiente:**

- O `docker-compose.yml` original fixava `minio/minio:RELEASE.2025-04-22T22-12-26Z`, que
  **não é mais puxável** (Docker Hub nega, `quay.io/minio/minio` responde 401, `bitnami`
  saiu do catálogo gratuito). Como o compose puxa em paralelo e aborta no erro, Mongo,
  Redis e RabbitMQ também não subiam. Trocado por SeaweedFS, mesma API S3, mesma porta,
  mesmas credenciais — nenhum `.env` mudou. Produção usa Cloudflare R2, não é afetada.
- ~~**Não é possível gerar o APK**~~ — **resolvido em 2026-10-02.** A máquina anterior tinha
  apenas JRE 1.8. Com JDK 21 e o SDK instalados, `assembleDebug` conclui em 4m40s e produz
  `app-debug.apk` de 6,99 MB. Continua pendente apenas rodar em tablete real (R6).
- Os alvos `cap-sync` e `cap-build-android` **não rodavam no Windows**: usavam `ln -sfn`,
  substituição de comando `$(...)` do bash, `cd X && Y` e `./gradlew`. Reescritos em Node
  (`tools/cap-sync.mjs` e `tools/gradle-android.mjs`), seguindo o P9 do plano.
- A suíte da API falhava no `globalSetup` em máquina fria: o `mongodb-memory-server` tem
  timeout padrão de 10 s e, sem o binário em cache, não sobe nesse prazo — e o erro derruba
  as 101 suítes antes do primeiro teste. O teto passou a 60 s em `src/test/memory-mongo.ts`.
- **Rode `cap-sync` antes de compilar o Android, sempre.** `capacitor.settings.gradle` e
  `app/capacitor.build.gradle` são gerados e embutem o caminho de cada plugin dentro do store
  do pnpm. O pnpm encurta esses nomes com hash quando passam do limite de caminho do Windows,
  então o conteúdo difere por máquina — os caminhos que estavam versionados nem existiam
  aqui. Os dois saíram do versionamento (D20).
- Se um teste de MQTT falhar com `waitUntil timeout`, costuma ser estado residual de uma
  execução interrompida. `docker restart openad-rabbitmq` resolve.
- **`prisma migrate diff --shadow-database-url` apontado para um banco real o apaga.** O
  Prisma reseta o shadow antes de usá-lo. Aconteceu aqui: o comando destruiu o Postgres de
  desenvolvimento que acabara de ser montado. Para verificar desvio de schema, use um banco
  descartável — ou melhor, o `pg_dump --schema-only --schema=public` antes e depois, que é o
  critério do protocolo de produção.
- **D21 — `shutdownTestApp` faz `flushall` no Redis inteiro**, que é compartilhado por todos
  os workers do Jest. Duas consequências: o custo do desligamento cresce com o número de
  suítes em paralelo (foi o que levou a suíte de PDF a estourar o `afterAll` quando o total
  passou de 101 para 105), e uma suíte apaga o Redis de outra que ainda está rodando. Hoje
  passa porque nenhuma suíte depende de estado no Redis entre testes; é flakiness à espera de
  acontecer. A correção é escopar por prefixo de chave por suíte em vez de `flushall`.

---

## 2. O que já foi entregue

Commits em `main`, do mais antigo para o mais recente:

| Commit | O que é |
|---|---|
| `ec9c707` | Baseline do código de terceiros, sem nenhuma alteração nossa (1114 arquivos). O repositório não tinha commit algum. |
| `382e331` | Stack local volta a subir (MinIO → SeaweedFS) + `init-media-bucket.mjs` portável. |
| `5e7d71b` | Plano de adaptação, integração e mobile. |
| `324cc57` | Decisões fechadas: IAP, repasse com piso e leilão, player em Capacitor. |
| `41c6184` | **D13** — typecheck quebrado impedia `build` e `test` do player. |
| `f2a3fc1` | **Fase 1** — liga a entrega de mídia e o envio de analytics no player. |
| `6f74af6` | Guardas de regressão: fiação do bootstrap e serialização da sincronização. |
| `9de9e3d` | Documenta D13 e D14. |
| `3bbc808` | **D15** — zera os cinco erros de lint pré-existentes da API. |
| `4765952` | Remove a geração 2 do pipeline de manifesto no servidor. |
| `79ed067` | **Fase 2** — manifesto seleciona por campanha, janela e orçamento. |
| `e0c3b03` | Documenta Fase 1 e Fase 2 concluídas. |
| `52a14df` | **Fase 3, parcial** — identidade, moderação e isolamento por dono. |
| `a48e408` | Documento de passagem para a troca de máquina. |
| `a8620b3` | **Caminho A** — nativo do player reescrito em Kotlin; D16, D17 e D18. |
| `08f1775` | **D19** — `content_moderator` liberado na rota de status; moderação deixa de ser inalcançável. |
| `f07e116` | **D12** e **P9** — versão de Node e pnpm fixada, build mobile portável no Windows. |
| `fe6063e` | **D20** — gradle gerados pelo `cap sync` saem do versionamento. |

### Fase 1 — fazer o player tocar (feita, exceto hardware)

O player tinha **três gerações** de pipeline de entrega empilhadas, e a correta estava
desligada: `SyncOrchestratorService.syncNow()` não tinha nenhum chamador. As duas obsoletas
baixavam os bytes e os descartavam sem gravar arquivo, e ainda registravam no índice de
cache arquivos inexistentes.

Também: a rota `/playback`, onde vive o `<video>`, era **inalcançável** — não existe nenhuma
navegação no app, e a rota padrão caía em `pairing`. E `PlayBatchUploaderService` estava
declarado como provider sem que nada o injetasse, então nada de analytics saía do tablet.

Resolvido com `PlayerShellComponent` (estado em vez de rota), `SyncSchedulerService` (boot,
pareamento, 15 min, volta de rede, comando MQTT, tudo serializado num único *in-flight*) e
`start()` explícito no uploader. `SYNC_SCHEDULE` passou a sincronizar de fato — antes
respondia ack de sucesso e não fazia nada. A telemetria deixou de ser ficção: vinha da regra
de maior prioridade do schedule retido, com `campaignId: "rule:{ruleId}"`.

Corrigidos no caminho, porque ligar o pipeline sem eles seria pior do que deixá-lo
desligado: **D14** (rebaixava o catálogo inteiro a cada sincronização — dezenas de GB/dia por
tablet) e **D8** (buffer de analytics quadrático, trocado por NDJSON com append;
`markUploaded` passou a remover as linhas enviadas, que antes seguiam ocupando o teto e
faziam o corte descartar registros ainda **não** enviados).

### Fase 2 — seleção correta de manifesto (feita)

O gerador fazia `find({ isActive: true })` sobre toda a mídia da plataforma. Campanha em
rascunho, encerrada, vencida ou com orçamento diário esgotado continuava sendo distribuída —
o pacing já era calculado em `campaign_daily_spend` e ninguém consultava.

`CampaignEligibilityService` resolve por status `active`, janela contratada e
`pacingState != 'paused'` (`near_cap` segue apto de propósito: desacelera, não para). A
prioridade passou a vir de `campaigns.priority` em vez da posição na lista — é ela que o
player usa para decidir o que descartar quando o armazenamento aperta.

### Estado de qualidade verificado por execução

| | Antes (baseline recebida) | Agora |
|---|---|---|
| `openad-api:test` | 97 suítes, 270 testes | 101 suítes, 2 skipped |
| `openad-api:lint` | **5 erros** | 0 erros |
| `openad-ad-client:test` | **não compilava** | 29 arquivos, 73 testes |
| `openad-ad-client:lint` | 0 erros | 0 erros |
| `assembleDebug` (APK) | **não compilava** (JRE 1.8) | `BUILD SUCCESSFUL`, APK de 6,99 MB |

No estado recebido **nenhum dos dois alvos de qualidade passava**: o lint da API falhava e o
build/test do player não rodava. O que havia de verde era a suíte da API, e só.

---

## 3. Fase 3 — em andamento, no último commit

> **Resolvido na retomada.** A suíte foi rodada na máquina nova e a leva da Fase 3 estava
> incompleta, como se temia: duas suítes falhavam (`campaigns.contract` e
> `campaign-scheduling.integration`), as duas com 403 `Insufficient role` no
> `PATCH /campaigns/:id/status`. A política de transição e os testes estavam corretos; o que
> faltava era `content_moderator` no `@Roles` da rota, então o guard recusava o moderador
> antes de a política ser consultada — a moderação estava escrita e inalcançável. Corrigido;
> as duas suítes passam.

Entregue nesta leva:

**Decisão de caixa do repasse (R3), aplicada como recomendado.** Bloco `monetization` novo em
`platform_config`, com `driverPayoutMinPercent` (piso), `driverPayoutAuctionWeight` (o `k` do
leilão, `0` desliga), `driverPayoutSettlement` e `storeCycleSettlementDays`. O padrão é
`store_cycle` — sem risco de caixa — e ligar a antecipação é um clique no painel, não um
deploy. A razão é a §2.1c do plano: a receita de IAP chega 30 a 45 dias depois, então o
motorista veicula hoje e a plataforma só tem o dinheiro depois.

**Schema (tudo aditivo, nenhuma coluna existente alterada):**

- `campaigns`: `ownerUserId` (→ `public.users.id`), `advertiserId`, `orderId`, subdocumentos
  `moderation`, `targeting` e `driverPayout`, e dois índices novos (listagem do anunciante e
  fila de moderação).
- `campaigns.status`: `+pending_review`, `+rejected`.
- `media_assets`: `ownerUserId` + índice.
- `users.role`: `+content_moderator`, e a lista de papéis internos passou a vir de
  `INTERNAL_USER_ROLES` em `@openad/domain` em vez de um enum literal duplicado no schema.
- `lost_opportunity_events.reason`: `+revenue_share`, também no contrato Zod de MQTT — sem
  isso a ingestão rejeitaria o evento de supressão por leilão.

**Moderação com máquina de estados.** `campaign-status.policy.ts` substitui o "aceita
qualquer destino do enum" que permitia ir de `draft` direto a `active`, sem revisão.
`pending_review → active` é a única porta para o ar, e só `content_moderator` ou
`super_admin` a abrem — gerente de campanha não aprova a própria campanha. Recusa exige
motivo, registrado em `campaigns.moderation`.

**Isolamento por dono.** `MediaScopeService` era um stub que devolvia `true` e — pior —
**nunca era chamado**. A regra agora vive em `auth/access-scope.ts` como função pura
(`ownerFilterFor`), porque `campaigns` e `media-ingestion` precisam dela e um serviço
injetável criaria ciclo entre os módulos. `GET /campaigns` passou a filtrar na consulta, não
depois: escopar em memória faria a primeira página de um parceiro vir vazia porque foi
preenchida com registros de outro e descartada.

**Fixture de configuração.** Quatro specs mantinham cópias literais do objeto
`PlatformConfig` e todas quebraram ao acrescentar `monetization`. `defaults()` virou a função
pura `platformConfigDefaults()`, e os specs partem dela com *spread*.

### O que falta da Fase 3

1. ~~**Identidade federada.**~~ **Feita em 2026-10-02.** Duas estratégias passport em vez de
   uma: `jwt-internal` resolve o `sub` em `openad.users` e `jwt-federated` resolve em
   `openad.ad_advertisers`, com `issuer`/`aud` do ecossistema e HS256 fixado. O `JwtAuthGuard`
   combina as duas, e cada uma devolve `null` quando não reconhece o `sub`, que é o que
   permite a segunda ser tentada.

   No caminho, uma **vulnerabilidade latente** foi fechada. A estratégia antiga copiava
   `payload.role` para `req.user` sem consultar banco nenhum. Como o `JWT_SECRET` é
   compartilhado com o hub e o opendriver, o que impedia um usuário do hub de virar
   administrador do openad era apenas os conjuntos de papéis não se cruzarem por acaso —
   `Admin` lá, `super_admin` aqui — e o `RolesGuard` tem desvio incondicional para
   `super_admin`. No dia em que o hub criasse um papel com esse nome, qualquer usuário dele
   teria acesso total. Agora o papel vem do banco: um `sub` que não existe em `openad.users`
   é recusado, e o principal federado recebe a constante `'advertiser'`, nunca o que o token
   afirma. Efeito colateral desejado: trocar o papel de alguém passa a valer na hora.

   A separação também passou a ser garantida pelo compilador. `UserRole` virou
   `InternalUserRole | FederatedUserRole` e `INTERNAL_USER_ROLES` é tipado
   `readonly InternalUserRole[]`, de modo que acrescentar `'advertiser'` ali **não compila**.
   Antes a garantia era um comentário — e é garantia que importa, porque `isInternalRole`
   decide se a consulta é escopada: papel tratado como interno recebe filtro vazio e vê tudo
   de todos.
2. **Rotas do anunciante** (`/api/v1/advertiser/*`) e **de moderação**
   (`/api/v1/moderation/*`) — listadas na §4.3 do plano.
3. ~~**Tabelas em `public`**, que seriam do repositório `hub`~~ — **deixou de ser bloqueio em
   2026-10-02.** O padrão do ecossistema é schema próprio por serviço, não tabela nova em
   `public`: o openad ganha um schema `openad` no mesmo banco e espelha de `public` só as
   colunas de `users` que usa. Nada a fazer no repositório `hub` para isso. E `ad_payouts` não
   precisa existir — ver `plano-ecossistema-e-mobile.md` §1.1 e §1.3.
4. **Escopo por dono nas rotas de mídia** (`/media`, `/media/vfs/*`): a função pura está
   pronta, falta aplicá-la nos controllers de mídia.
5. **Dinheiro em centavos inteiros** (P2 da padronização). `campaigns.budget.totalAmount` é
   float e `campaign_daily_spend` já conta em `billableCostCents` — o serviço já é
   inconsistente consigo mesmo. A conversão toca pacing, reconciliação, relatório de
   faturamento, DTOs e o portal Angular; merece commit próprio pelo risco de regressão.

---

## 4. Pendências por fase

> O plano de execução das fases seguintes, já corrigido contra o que os repositórios irmãos
> de fato fazem, está em [`plano-ecossistema-e-mobile.md`](./plano-ecossistema-e-mobile.md).

| Fase | Estado | O que falta |
|---|---|---|
| 0 — Ambiente | feita | `Dockerfile.api` e `docker-compose.prod.yml` (citados no README, **não existem**); CI no GitHub Actions. D12 fechado |
| 1 — Player toca | feita no código, APK compila | Rodar em tablete e exercitar o watchdog (R6, R7) |
| 2 — Manifesto | feita | Segmentação por device/veículo/zona, que depende de `campaigns.targeting` — o campo já existe no schema, falta o gerador consumi-lo e `deviceState` deixar de ser ignorado |
| 3 — Identidade e isolamento | em andamento | §3 acima |
| 4 — Moderação | parcial | Máquina de estados e papel prontos; faltam a fila (`GET /moderation/queue`), a decisão por rota própria e as telas no portal |
| 5 — Crédito, IAP e repasse | não iniciada | Validação de recibo no servidor (App Store Server API, Google Play Developer API), notificações de servidor das duas lojas, débito amarrado ao pacing, `boostRepasse` no score da arbitragem, `GET /internal/ads/payouts` |
| 6 — App do anunciante | não iniciada | Projeto Expo novo. SKUs de IAP cadastrados nos dois consoles antes da primeira build de review |
| 7 — Robustez do player | não iniciada | `Filesystem.downloadFile` em vez de buffer em memória + base64 (D6); um gerenciador de cache só, com espaço livre real (D7); religar janelas de sincronização; validar H.265 em WebView |
| 8 — Escala | não iniciada | Adapter de Redis no Socket.IO (D9); unificar namespace MQTT (D11) |

---

## 5. Decisão fechada: caminho A — Capacitor com o nativo em Kotlin

**Escolhido e executado em 2026-10-02.** O player continua em Capacitor e os quatro arquivos
nativos passaram de Java para Kotlin. Não resta nenhuma linha de Java no módulo do
aplicativo: o build registra `:app:compileDebugJavaWithJavac NO-SOURCE`.

| Arquivo | Resultado |
|---|---|
| `MainActivity.kt` | Lock Task e `LOCK_TASK_FEATURE_NONE`, agora com guarda de API 28 |
| `OpenAdDeviceAdminReceiver.kt` | Receiver DPC, conversão direta |
| `OpenAdSilentInstallPlugin.kt` | Sessão de `PackageInstaller`, com o erro de compilação do original corrigido |
| `PowerStatePlugin.kt` | Detecção de alimentação, com o flag de receiver exigido por targetSdk 34+ |

Mudanças de build: `kotlin-gradle-plugin` 2.4.20 no classpath (faixa suportada para AGP
8.13.0 e Gradle 8.14.3), `apply plugin: 'kotlin-android'` e `jvmTarget` em 21 para acompanhar
o `sourceCompatibility` que o `capacitor.build.gradle` já fixa. Nenhum plugin Capacitor foi
perdido: os 18 continuam resolvidos pelo `cap sync`.

Vale registrar o que o build revelou: **cinco dos plugins Capacitor já são escritos em
Kotlin** (filesystem, geolocation, light-sensor, fullscreen, volume-control). O Kotlin já
estava no grafo de compilação do projeto; o módulo do aplicativo era a exceção.

Verificado por execução nesta máquina: `BUILD SUCCESSFUL in 4m 40s` e
`app/build/outputs/apk/debug/app-debug.apk`.

O tamanho do APK varia com a configuração do bundle web, não com o nativo: 6,99 MB quando o
`build` do Angular roda em `production` e 8,97 MB em `development`, que é o que o `cap-sync`
escolhe quando `NODE_ENV` não é `production`. Mesmo código nativo nos dois.

**Não existe keystore de release.** O `app/build.gradle` já lê `OPENAD_RELEASE_STORE_FILE` e
as variáveis irmãs, mas a chave nunca foi criada, então só há APK de debug. Isso é
pré-requisito do primeiro tablete em campo, e merece processo: a autoatualização silenciosa
por `PackageInstaller` **exige que o APK novo tenha a mesma assinatura do instalado**. Perder
essa chave significa reprovisionar a frota inteira à mão, tablete por tablete — não existe
recuperação.

### iOS: o player é appliance Android, por desenho

Não existe projeto iOS no repositório e não deve existir. O `capacitor.config.ts` declara só
`android`, e `@capacitor/ios` estava no `package.json` sem nunca ter sido usado — removido.

Não é descuido. Nenhuma das quatro funções nativas tem contraparte no iOS: não há Device
Owner (o análogo é Autonomous Single App Mode, que exige aparelho supervisionado e perfil de
MDM), não há receiver DPC, e **instalação silenciosa é impossível** no iOS em qualquer
circunstância. O MDM da `specs/009` inteiro — subir APK, rollout faseado, QR de instalação —
não tem equivalente. A escolha de Kotlin não tem relação com isso: o impedimento é a
plataforma.

Quem precisa de iOS é o app do anunciante (Fase 6), que é Expo e TypeScript, sem nenhuma
linha de Kotlin.

### Por que não o caminho B (Expo)

Fica registrado o motivo, porque a conta não é óbvia: **migrar para Expo não eliminaria o
Java.**

O que os 4 arquivos nativos fazem (373 linhas em Java, agora 4 arquivos Kotlin em
`app/openad-ad-client/android/app/src/main/java/com/openad/`):

| Arquivo | Função | Existe API JS? |
|---|---|---|
| `MainActivity` | Allowlist de Lock Task e `LOCK_TASK_FEATURE_NONE` quando o app é Device Owner — kiosk sem UI de sistema | Não |
| `OpenAdDeviceAdminReceiver` | Receiver DPC que torna possível `dpm set-device-owner` | Não |
| `OpenAdSilentInstallPlugin` | Autoatualização de APK via `PackageInstaller`, sem confirmação | Não |
| `PowerStatePlugin` | Detecção de motor ligado/desligado | Parcial |

`DevicePolicyManager` e `PackageInstaller` não têm binding em JavaScript, nem no React
Native nem no Expo. Para fazer isso em Expo seria preciso escrever um módulo nativo e
embalá-lo num config plugin — **em Java ou Kotlin**. Expo relocalizaria o código nativo e
acrescentaria a troca de framework por cima, sem remover a linguagem; além disso custaria a
reescrita das 19 dependências Capacitor hoje integradas (kiosk, brilho, sensor de luz,
bússola, acelerômetro, wifi, volume, privacy screen, keep-awake, MQTT nativo, background
task, filesystem, geolocation, preferences, device, network, app, fullscreen, volume
control). Semanas, contra os dois a três dias do caminho A.

O app do anunciante (Fase 6) continua nascendo em Expo, igual a `hub-mobile` e
`opendriver/mobile`. A decisão acima é só sobre o player, que é appliance e não app de loja.

### Defeitos encontrados durante a conversão

Os três só apareceram porque o código nativo foi compilado pela primeira vez — na máquina
anterior havia apenas JRE 1.8.

- **D16 — `OpenAdSilentInstallPlugin.java` não compilava.** `File.getCanonicalPath()` declara
  `throws IOException`, e as duas chamadas estavam fora de qualquer `try`, num método que não
  declarava `throws`. Erro de compilação, não aviso: o módulo do aplicativo **nunca** foi
  compilado. Em Kotlin `IOException` não é verificada, e o caminho canônico agora é resolvido
  dentro de um `try` que, em caso de falha, trata como fora do cache e recusa a instalação.
- **D17 — `setLockTaskFeatures` sem guarda de versão.** O método existe a partir da API 28 e
  o `minSdk` do projeto é 24. Em Android 7 ou 8 a chamada lança `NoSuchMethodError`, que é
  `Error` e não `Exception` — ou seja, não era contida pelos `catch` do método e derrubaria o
  aplicativo no boot, justamente em tablet provisionado como Device Owner. Agora só é
  chamado em API 28 ou maior; abaixo disso registra log e mantém o padrão do sistema.
- **D18 — receiver registrado sem flag de exportação.** Com `targetSdk` 36, registrar
  receiver em tempo de execução exige declarar `RECEIVER_EXPORTED` ou `RECEIVER_NOT_EXPORTED`.
  Os dois plugins passaram a usar `ContextCompat.registerReceiver` com `RECEIVER_NOT_EXPORTED`,
  que é o correto porque só o sistema emite esses broadcasts.

---

## 6. Catálogo de defeitos encontrados

Vinte e dois. Quinze corrigidos, seis pendentes. D16 a D18 apareceram ao compilar o código
nativo pela primeira vez, D19 ao rodar a suíte completa, e D21 e D22 ao federar a identidade.
O D22 é o mais grave do conjunto: era um caminho de escalonamento de privilégio entre
serviços, latente porque dependia de os nomes de papéis não coincidirem.

| # | Defeito | Estado |
|---|---|---|
| D1 | Três gerações de pipeline; a correta sem chamador | corrigido |
| D2 | Rota do player inalcançável | corrigido |
| D3 | Uploader de analytics nunca instanciado | corrigido |
| D4 | Manifesto sem filtro de campanha, janela ou orçamento | corrigido |
| D5 | Sem isolamento por dono | corrigido no código, falta exercitar com token de anunciante |
| D6 | Download de vídeo acumulado em memória + base64 | **pendente** (Fase 7) |
| D7 | Dois gerenciadores de cache concorrentes; espaço livre falso | **pendente** (Fase 7) |
| D8 | Buffer de analytics quadrático, com perda silenciosa | corrigido |
| D9 | Socket.IO sem adapter de Redis | **pendente** (Fase 8) |
| D10 | Sem caminho de deploy versionado | **pendente** (Fase 0) |
| D11 | Namespace MQTT partido em dois | **pendente** (Fase 8) |
| D12 | Versão de Node divergente em três lugares | **pendente** (Fase 0) |
| D13 | Typecheck quebrado impedia build e test do player | corrigido |
| D14 | Rebaixava o catálogo inteiro a cada sincronização | corrigido |
| D15 | Lint da API falhava na baseline | corrigido |
| D16 | `OpenAdSilentInstallPlugin.java` não compilava (`IOException` não tratada) | corrigido na conversão |
| D17 | `setLockTaskFeatures` sem guarda de API 28 — `NoSuchMethodError` no boot em Android 7 e 8 | corrigido na conversão |
| D18 | Receiver registrado sem flag de exportação, exigido por `targetSdk` 34+ | corrigido na conversão |
| D19 | `content_moderator` ausente no `@Roles` de `PATCH /campaigns/:id/status`: moderação inalcançável | corrigido |
| D20 | `capacitor.settings.gradle` e `capacitor.build.gradle` versionados, com caminho de máquina | corrigido (saíram do versionamento) |
| D21 | `shutdownTestApp` faz `flushall` no Redis compartilhado entre workers | **pendente** — escopar por prefixo de chave |
| D22 | `JwtStrategy` confiava no `role` do token com `JWT_SECRET` compartilhado entre três serviços | corrigido (papel vem do banco) |

---

## 7. Nada foi aplicado em produção

O `hub` está no ar e **não foi tocado**. Nenhuma migration foi aplicada em produção. As
tabelas em `public` da §3 precisam ser criadas no repositório `hub`, seguindo o protocolo de
backup de `opendriver/docs/plano-producao-final.md`.
