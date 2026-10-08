-- Reserva e débito atômicos do crédito do anunciante, por ciclo de 15 minutos.
--
-- O problema: **campanha veicula sem crédito pago.** A elegibilidade
-- (`CampaignEligibilityService.resolveEligible`) aplica três critérios — status `active`,
-- instante dentro da janela contratada, e pacing diário diferente de `paused` — e nenhum deles
-- consulta saldo. O serviço nem injeta o Prisma: não tem como consultar.
--
-- O teto que pausa a campanha é `campaigns.budget`, um valor **declarado pelo anunciante na
-- criação**, não dinheiro recebido. E o `ad_credit_ledger` existe, é append-only, está bem
-- modelado — e **nada escreve nele**. Enquanto isso o motorista é creditado de verdade. Ou
-- seja: a plataforma paga o motorista com dinheiro que nunca entrou.
--
-- ============================================================================
-- Por que retenção, e não "conferir o saldo antes de veicular"
-- ============================================================================
--
-- Conferir o saldo no instante da elegibilidade não resolve: entre a conferência e a
-- veiculação passam até 15 minutos (o ciclo de sincronização do tablet), e nesse intervalo o
-- mesmo saldo seria prometido a várias campanhas e a vários tablets. O saldo diria "tem
-- dinheiro" para todos, e o débito chegaria depois para descobrir que não tinha.
--
-- O padrão é o de cartão: **retém antes de mostrar, captura o que foi mostrado, devolve o
-- resto.** A retenção é o compromisso; a captura é o fato.
--
-- ============================================================================
-- Por que tabela nova e não colunas no ledger
-- ============================================================================
--
-- O ledger é registro fiscal — o próprio comentário do schema diz isso. Ele deve conter
-- dinheiro que entrou e dinheiro que saiu, nada mais. Retenção é compromisso, não saída: uma
-- reserva que expira sem captura não é um lançamento, é um não-evento, e gravá-la no ledger
-- exigiria um lançamento compensatório para desfazer algo que nunca aconteceu.
--
-- Saldo disponível = soma do ledger − o que resta nas retenções abertas.

CREATE TYPE "openad"."AdCreditHoldStatus" AS ENUM ('open', 'closed');

CREATE TABLE "openad"."ad_credit_holds" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "advertiser_id"  UUID NOT NULL,
  -- `campaigns.campaignId` do MongoDB. Sem FK, pelo mesmo motivo de
  -- `ad_credit_ledger.campaign_id`: a campanha não vive no Postgres.
  "campaign_id"    VARCHAR(64) NOT NULL,

  -- Identificador do ciclo, derivado do instante de abertura arredondado para baixo pelo
  -- tamanho do ciclo (ex.: `2026-10-08T15:30Z`). Determinístico de propósito: duas instâncias
  -- que abram o ciclo ao mesmo tempo calculam o mesmo valor, e o índice único abaixo faz uma
  -- delas perder — que é o resultado certo.
  "cycle_id"       VARCHAR(40) NOT NULL,

  -- Micro-reais, inteiros. Ver `monetization/pricing.policy.ts` para por que não é centavo:
  -- a R$ 0,003/s, uma imagem de 15 s custa 4,5 centavos.
  --
  -- BIGINT e não INTEGER: o teto do INTEGER é ~2,1 bilhões de µR$, que é R$ 2.147. Um
  -- anunciante com R$ 3.000 de crédito estouraria a coluna.
  "amount_micros"   BIGINT NOT NULL,
  "captured_micros" BIGINT NOT NULL DEFAULT 0,

  "status"         "openad"."AdCreditHoldStatus" NOT NULL DEFAULT 'open',

  "opens_at"       TIMESTAMP(3) NOT NULL,
  "closes_at"      TIMESTAMP(3) NOT NULL,
  "closed_at"      TIMESTAMP(3),

  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ad_credit_holds_advertiser_id_fkey"
    FOREIGN KEY ("advertiser_id") REFERENCES "openad"."ad_advertisers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,

  -- Não se captura mais do que se reservou. É a invariante do padrão de retenção, e deixá-la
  -- no banco significa que nenhum caminho de código consegue violá-la.
  CONSTRAINT "ad_credit_holds_captured_dentro_da_reserva"
    CHECK ("captured_micros" >= 0 AND "captured_micros" <= "amount_micros"),
  CONSTRAINT "ad_credit_holds_reserva_positiva" CHECK ("amount_micros" > 0)
);

-- Uma retenção por campanha por ciclo. É o que torna a abertura do ciclo idempotente: rodar o
-- job duas vezes, ou em duas instâncias, não reserva o dobro.
CREATE UNIQUE INDEX "ad_credit_holds_campaign_cycle_key"
  ON "openad"."ad_credit_holds" ("campaign_id", "cycle_id");

-- Cálculo do saldo disponível: soma do que resta nas retenções abertas do anunciante.
CREATE INDEX "ad_credit_holds_abertas_idx"
  ON "openad"."ad_credit_holds" ("advertiser_id", "status");

-- Fechamento do ciclo: varre o que já passou de `closes_at` e ainda está aberto.
CREATE INDEX "ad_credit_holds_fechamento_idx"
  ON "openad"."ad_credit_holds" ("status", "closes_at");

-- ============================================================================
-- Débito idempotente no ledger
-- ============================================================================
--
-- `reference_id` é a chave natural do débito: `campanha:uniqueEventId`, única por veiculação.
-- O índice único transforma "repetir o débito" num erro de unicidade que o chamador trata como
-- sucesso — o mesmo desenho que o repasse ao motorista já usa do outro lado.
--
-- Isto é necessário porque **Mongo e Postgres não compartilham transação.** A veiculação vira
-- faturável no Mongo e o débito acontece no Postgres; não há como fazer os dois atomicamente.
-- A garantia vem de três peças: transição única no Mongo (`billingAppliedAt`), débito
-- idempotente aqui, e um job que refaz o débito de qualquer veiculação faturável sem
-- lançamento. É o padrão *outbox*.
ALTER TABLE "openad"."ad_credit_ledger"
  ADD COLUMN IF NOT EXISTS "reference_id" VARCHAR(120),
  -- Valor exato em micro-reais. `amount_cents` continua sendo a coluna fiscal, derivada deste
  -- por `floor`; os dois conviverem é o que permite lançamento de 4,5 centavos sem perder meio
  -- centavo e sem quebrar nenhum leitor que já conta centavos.
  ADD COLUMN IF NOT EXISTS "amount_micros" BIGINT,
  -- Retenção que originou o débito, quando houver. Ajuste manual e compra não têm.
  ADD COLUMN IF NOT EXISTS "hold_id" UUID;

-- Único **parcial**: só onde `reference_id` existe. Lançamento antigo e lançamento sem
-- referência natural (compra, ajuste do operador) têm `NULL`, e no Postgres NULL não colide
-- em índice único — mas o índice parcial deixa a intenção explícita em vez de depender disso.
CREATE UNIQUE INDEX IF NOT EXISTS "ad_credit_ledger_reference_key"
  ON "openad"."ad_credit_ledger" ("reference_id")
  WHERE "reference_id" IS NOT NULL;

ALTER TABLE "openad"."ad_credit_ledger"
  ADD CONSTRAINT "ad_credit_ledger_hold_id_fkey"
    FOREIGN KEY ("hold_id") REFERENCES "openad"."ad_credit_holds"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reconciliação do ledger a partir da veiculação: o job de *outbox* pergunta "este
-- `reference_id` já foi lançado?".
CREATE INDEX IF NOT EXISTS "ad_credit_ledger_hold_idx"
  ON "openad"."ad_credit_ledger" ("hold_id");
