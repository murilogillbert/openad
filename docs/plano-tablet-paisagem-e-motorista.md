# Plano: tablet em paisagem, quiosque com destravamento, e vínculo de motorista

Registro de execução iniciado em 2026-10-05 ~03:40 (UTC-3). Janela de trabalho: ~85 min
(o PC desliga automaticamente). Este documento é a continuidade: se o trabalho for
interrompido, o estado está na seção **Diário de execução**, no fim.

## Restrição que não pode ser violada

Três aplicativos estão em revisão no Google Play e **não podem ser tocados**:

- `app/openad-advertiser` (pacote `br.com.opendriver.ads`) — app do anunciante
- OpenDriver (repositório externo, não está neste monorepo)
- OpenDriver HUB (repositório externo)

Consequência prática: toda mudança de API tem de ser **aditiva**. Campo novo em resposta,
rota nova, sim. Campo removido, campo que vira obrigatório em requisição, mudança de
semântica de rota existente, não.

Liberado para mexer: `app/openad-api` (VPS), `app/openad-management` (portal de
administração), `app/openad-ad-client` (APK do tablete, instalado por cabo).

## Decisões tomadas pelo usuário (2026-10-05)

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Retrato ou paisagem? | **Paisagem** (tablet deitado). Casa com o criativo 16:9 que o app publicado já produz; `cover` não corta nada. |
| 2 | Vínculo direto ou via veículo? | **Via veículo** (opção A), desde que nada mude no app do OpenDriver. |
| 3 | Como achar o motorista? | Pesquisa no banco do ecossistema, exibindo **nome e e-mail** (e-mail é único). Um motorista pode ter **0..N dispositivos**. |
| 4 | Onde exibir o ganho? | Tela de **Ganhos** do OpenDriver, somado à corrida. Participação de **30%**. Cálculo por quantidade de anúncios exibidos durante o trajeto. |
| 5 | Durações | Imagem **10 s**. Vídeo **no máximo 120 s**. |

## O que já existe (não reimplementar)

Levantado por leitura do código, não por suposição:

- **Remuneração inteira e parametrizada.** `internal/driver-payout.policy.ts` tem
  `repasseEmCentavos` (piso de 30% em `platform_config.monetization.driverPayoutMinPercent`),
  `boostDeRepasse` (leilão, `k = 0,5`) e `percentEfetivoDoRepasse`.
- **Crédito automático.** `analytics-reconciliation.processor.ts` credita no instante em que
  a veiculação vira faturável (transição `pending → billable`, acontece uma vez por play
  record), chamando `DriverEarningClient` → `POST {OPENDRIVER_API_URL}/api/v1/internal/driver-earnings/ad-revenue`
  com `{ driverUserId, amountCents, referenceId, campaignId, description }`.
  `referenceId = campaignId:uniqueEventId` é a trava de idempotência do outro lado.
- **Conferência.** `GET /internal/ads/payouts?from&to` recalcula do zero por motorista.
- **Vínculo veículo↔aparelho.** `POST /vehicles/:id/pair`, `vehicles.pairedDeviceIds` (array,
  logo um veículo aceita N tablets), `devices.boundVehicleId`, auditoria em
  `vehicle_binding_audit_events`.
- **Espelho de identidade.** Prisma `User` → `public.users` (somente leitura), com
  `role = Driver`. `FederatedIdentityService` já usa esse espelho para anunciante.
- **Quiosque.** `tablet-native-integration.service.ts` com `CapacitorAndroidKiosk`,
  `temporarilyDisableKiosk(segundos)` (limite 30 s a 1 h) e reentrada automática agendada.
- **Teto de 120 s de vídeo.** `platform_config.mediaLimits.maxDurationSeconds = 120`, já
  aplicado por `video-validator.service.ts` no envio.

## O que falta (o trabalho desta leva)

### A. Tablete em paisagem, criativo cobrindo a tela — `openad-ad-client`

1. `AndroidManifest.xml`: `android:screenOrientation="landscape"` na `MainActivity`.
   Hoje não há atributo nenhum, então a orientação segue o sensor.
2. `object-fit: cover` no criativo atual (`playback-controller.component.ts` e
   `video-player.component.ts`). Com paisagem + criativo 16:9 não há recorte.
3. Parada de segurança para vídeo: se `ended` não chegar (arquivo truncado, decodificador
   travado), o laço congela para sempre. Temporizador de `min(duration, 120) + 5 s`.

### B. Diretório de motorista e vínculo — `openad-api`

4. `DriverDirectoryService`: pesquisa em `public.users` por `role = Driver`, por nome ou
   e-mail, via Prisma. Somente leitura. Devolve `{ userId, name, email }`.
5. `GET /admin/drivers/search?q=` — papéis `fleet_operator|fleet_admin|super_admin`.
6. `PUT /admin/devices/:deviceId/driver` com `{ driverUserId }`: resolve o veículo vinculado
   ao aparelho e grava `vehicles.driverId`, **validando** que o UUID é um `Driver` de
   verdade. Hoje `driverId` aceita qualquer UUID (`@IsUUID()` e nada mais).
   `DELETE` do mesmo caminho desvincula.
7. `GET /admin/devices/:deviceId/driver` — devolve nome/e-mail do motorista vinculado, para
   a tela.

Por que pelo aparelho e não pelo veículo: foi o que o usuário pediu ("vincular ao
dispositivo"), e é o objeto que o operador tem na mão. O armazenamento continua em
`vehicles.driverId`, que é de onde o repasse e o relatório já leem — mudar isso
exigiria tocar no contrato de analytics.

### C. Anúncios por trajeto — `openad-api`

8. `GET /internal/ads/driver-plays?driverUserId=&from=&to=` — veiculações faturáveis do
   motorista na janela, com `playedAt`, `campaignId`, `payoutCents`. É o que permite ao
   backend do OpenDriver somar os anúncios de uma corrida ao ganho dela.

**Limite honesto:** o openad não tem conceito de corrida. A atribuição "anúncios deste
trajeto" só pode ser fechada pelo lado do OpenDriver, que conhece início e fim da corrida e
pode consultar esta rota pela janela de tempo. O que falta não está neste repositório.

### D. Destravamento do quiosque — `openad-ad-client`

9. `MainActivity`: interceptar `KEYCODE_VOLUME_DOWN` em `onKeyDown`/`onKeyUp` e repassar ao
   WebView como evento de janela. Necessário porque em lock task a WebView **não** recebe
   evento de volume no JavaScript.
10. Serviço no Angular: toque mantido na tela **e** volume para baixo mantido, sobrepostos
    por 5 s → `temporarilyDisableKiosk`. Reaproveita o que existe.

### E. Portal de administração — `openad-management`

11. Tela de vínculo de motorista na página de aparelhos: pesquisa por nome/e-mail, vincula,
    desvincula, e mostra o repasse combinado.

### F. Verificação em produção

12. Conferir `OPENDRIVER_API_URL` e `ECOSYSTEM_SERVICE_API_KEY` no contêiner da API. Sem as
    duas, `DriverEarningClient.habilitado()` é `false` e **o repasse não é creditado, em
    silêncio** — por decisão documentada. É o risco mais alto desta leva.
13. Cadastrar o veículo real, parear o tablete, vincular o motorista, e confirmar
    `play_records > 0` e crédito enviado.

## Ordem de execução (prioridade por risco e visibilidade)

1. A (paisagem + cover + parada de vídeo) — resultado visível no tablete
2. F.12 (conferir env do repasse) — barato e decide se o resto rende dinheiro
3. B (diretório + vínculo) — habilita `play_records`
4. C (anúncios por janela)
5. D (destravamento)
6. E (portal)
7. F.13 (fim a fim em produção)

---

## Diário de execução

(preenchido durante o trabalho; é o que dá continuidade se isto for interrompido)

### Estado antes de começar

- `bc032f7` em `main`, com push. API reconstruída e implantada; manifesto entrega
  `mimeType: image/jpeg`. APK instalado no Vaio_TL10 (`4AH47852E`) exibindo criativo,
  confirmado por captura de tela.
- Produção: 4 criativos (todos imagem), 3 campanhas ativas, 1 aparelho
  (`c5ba917f-56fd-4c36-94f9-9b0f9045da5a`), **`vehicles` = 0**, `play_records` = 0.
- Orientação do tablete: livre (segue sensor). Criativo com `object-fit: contain`.

### Execução concluída — 2026-10-05

Tudo que o plano previa está feito e verificado em produção, com uma exceção registrada no
fim. Commits: `c2de1e7`, `c0c2a10` e o desta leva.

| Item | Estado | Evidência |
|---|---|---|
| A.1 paisagem travada | feito | captura do aparelho em **2000×1200** |
| A.2 `cover` | feito | **0,6%** de pixel quase-preto, 1505 cores distintas |
| A.3 parada de vídeo | feito | `prazoMaximoDeVideoMs`, testes 114→116 |
| B diretório + vínculo | feito | `GET /admin/drivers/search` 200 com 32 motoristas |
| C anúncios por janela | feito | `GET /internal/ads/driver-plays` responde 401 sem chave |
| D destravamento | feito (código) | ver ressalva abaixo |
| E portal | feito | 4 trechos novos no bundle servido pelo nginx |
| F.12 repasse ligado | conferido | `OPENDRIVER_API_URL` e `ECOSYSTEM_SERVICE_API_KEY` presentes |
| F.13 fim a fim | **feito** | ver abaixo |

#### O caminho do dinheiro está fechado

Sequência real, em produção:

1. Veículo **DEM1A23** (Chevrolet Onix 2022, `f74a5508-59e5-4625-ac5a-40f308ce0d7f`) criado
   já pareado ao tablete `c5ba917f-56fd-4c36-94f9-9b0f9045da5a`. Placa e modelo vêm da ficha
   do Play, onde esse é o veículo aprovado do motorista de demonstração — não foram
   inventados.
2. Motorista `play.motorista@opendriver.com.br` (`0efd58a2-1fe8-4941-8168-87c5a982d054`)
   vinculado pela rota nova. Trilha gravada: `driver_bind` por `admin@opendriver.com.br`.
3. **71 play records, todos `reconciliationStatus: billable`.**
4. `repasse.creditado` de **7 centavos por veiculação** — `floor(25 × 0,3)`, com tarifa de 25
   centavos e repasse de 30% — confirmado pelo opendriver.

#### O defeito que só apareceu aqui

`play_records` continuou em zero depois do vínculo, e a causa era independente de tudo que
este plano previa: `Filesystem.appendFile` **não aceita** `recursive` (o tipo é
`Omit<WriteFileOptions, 'recursive'>`), então não criava `analytics/` e falhava com
`OS-PLUG-FILE-0011`. Num aparelho novo a pasta nunca existia, porque `writeFile` — que a
criaria — só roda na compactação, e a compactação depende de já haver linhas. Impasse
permanente.

A exceção morria no `catch` vazio de `recordManifestPlayCommitted`. O tablete exibia anúncio,
o laço girava, e **toda** veiculação faturável era perdida sem um único sinal. Corrigido com
`mkdir` memoizado e com log de `playrecord.enqueue.failed` — engolir exceção para proteger a
exibição está certo, engolir sem registrar transforma perda de receita em silêncio.

Mesma classe do defeito de `writeMediaFile` corrigido em `bc032f7`. Dois casos em dois dias;
daí a suíte `PlayRecordBufferService (nativo)`.

#### Ressalva: o gesto de destravamento não foi testado com a mão

`OpenAdVolumeKeyPlugin` + `onKeyDown`/`onKeyUp` em `MainActivity` estão compilados e
instalados, e o quiosque está ativo (`isInKioskMode: true` no log). Mas o gesto exige **toque
mantido na tela junto com volume para baixo por 5 s**, e `adb shell input` não sustenta as
duas entradas em paralelo — não há como provar por automação. O que falta é um teste com o
dedo no aparelho.

Se não funcionar, o caminho de diagnóstico é: `adb logcat | grep kiosk` deve mostrar
`kiosk.unlocked` ao completar o gesto. Se nada aparecer, conferir se
`Capacitor.isPluginAvailable('OpenAdVolumeKey')` é verdadeiro — é a condição que o serviço
usa para registrar a escuta. A saída de emergência continua existindo: o comando remoto
`TEMP_DISABLE_KIOSK` pelo portal.

#### Pendências que este plano não cobriu

- **Bloco `monetization` ainda não é editável na tela de Admin → Plataforma.** O piso de 30%
  e o `k` do leilão só mudam chamando `PUT /platform-config` direto. Os valores sobrevivem ao
  salvamento da página (ela faz `PUT` do objeto inteiro), mas não há controle para eles.
- **Atribuição à corrida depende do opendriver.** `GET /internal/ads/driver-plays` entrega os
  anúncios de uma janela de tempo; quem sabe o início e o fim do trajeto é o opendriver, e
  somar isso ao ganho da corrida é trabalho naquele repositório, que não está neste monorepo.
- **`driverPayoutSettlement` e `storeCycleSettlementDays` continuam sem leitor no código.**
  Configuração sem consumidor: não há fechamento por período nem data prevista calculada.
- O veículo DEM1A23 é o do motorista de demonstração. Para frota real, cadastrar os veículos
  de verdade e vincular pela tela nova — `infra/server/68-vincular-motorista.sh` faz a
  sequência inteira por linha de comando, se preferir.
