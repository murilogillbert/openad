-- Identidade federada e credito de veiculacao: schema `openad` no banco compartilhado.
--
-- **Nada aqui altera o schema `public`.** O `public` e do hub, e a unica mencao a ele e em
-- clausula de chave estrangeira apontando para `public.users`. Todos os identificadores sao
-- qualificados por schema de proposito: o DDL que o `prisma migrate diff` gera vem sem
-- qualificacao, apoiado no `search_path` de `?schema=openad`, e aplicar isso com outro
-- `search_path` criaria as tabelas no schema errado.
--
-- Aplicar sempre com `prisma migrate deploy`, e somente depois do protocolo de backup de
-- opendriver/docs/plano-producao-final.md: backup completo, `pg_dump --schema-only
-- --schema=public` antes, bootstrap, deploy, `pg_dump` depois e diff. Qualquer diferenca em
-- `public` alem do token aleatorio de `\restrict` e motivo para parar e reportar.

CREATE SCHEMA IF NOT EXISTS "openad";

-- CreateEnum
CREATE TYPE "openad"."AdAdvertiserStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "openad"."AdStore" AS ENUM ('apple', 'google');

-- CreateEnum
CREATE TYPE "openad"."AdReceiptStatus" AS ENUM ('pending', 'validated', 'refunded');

-- CreateEnum
CREATE TYPE "openad"."AdLedgerDirection" AS ENUM ('credit', 'debit');

-- CreateEnum
CREATE TYPE "openad"."AdLedgerReason" AS ENUM ('purchase', 'campaign_spend', 'refund', 'adjustment');

-- CreateTable
CREATE TABLE "openad"."ad_advertisers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "legal_name" VARCHAR(180) NOT NULL,
    "document_enc" TEXT,
    "document_hash" VARCHAR(64),
    "status" "openad"."AdAdvertiserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_advertisers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "openad"."ad_credit_purchases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "advertiser_id" UUID NOT NULL,
    "store" "openad"."AdStore" NOT NULL,
    "product_sku" VARCHAR(120) NOT NULL,
    "credit_cents" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "store_fee_cents" INTEGER NOT NULL,
    "transaction_id" VARCHAR(200) NOT NULL,
    "receipt_status" "openad"."AdReceiptStatus" NOT NULL DEFAULT 'pending',
    "validated_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_credit_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "openad"."ad_credit_ledger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "advertiser_id" UUID NOT NULL,
    "direction" "openad"."AdLedgerDirection" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reason" "openad"."AdLedgerReason" NOT NULL,
    "purchase_id" UUID,
    "campaign_id" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ad_advertisers_user_id_key" ON "openad"."ad_advertisers"("user_id");

-- CreateIndex
CREATE INDEX "ad_advertisers_status_created_at_idx" ON "openad"."ad_advertisers"("status", "created_at");

-- CreateIndex
CREATE INDEX "ad_credit_purchases_advertiser_id_created_at_idx" ON "openad"."ad_credit_purchases"("advertiser_id", "created_at");

-- CreateIndex
CREATE INDEX "ad_credit_purchases_receipt_status_idx" ON "openad"."ad_credit_purchases"("receipt_status");

-- CreateIndex
-- Trava de idempotencia do IAP: o mesmo recibo nunca credita duas vezes, e ele **e**
-- reenviado, porque e assim que a loja se recupera de aplicativo fechado no meio da compra.
CREATE UNIQUE INDEX "ad_credit_purchases_store_transaction_key" ON "openad"."ad_credit_purchases"("store", "transaction_id");

-- CreateIndex
CREATE INDEX "ad_credit_ledger_advertiser_id_created_at_idx" ON "openad"."ad_credit_ledger"("advertiser_id", "created_at");

-- CreateIndex
CREATE INDEX "ad_credit_ledger_campaign_id_idx" ON "openad"."ad_credit_ledger"("campaign_id");

-- AddForeignKey
-- RESTRICT e deliberado: o hub nao pode apagar um usuario por baixo dos dados do openad.
-- Exclusao de conta e orquestrada por HTTP em `/internal/accounts/:id/purge`.
ALTER TABLE "openad"."ad_advertisers" ADD CONSTRAINT "ad_advertisers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "openad"."ad_credit_purchases" ADD CONSTRAINT "ad_credit_purchases_advertiser_id_fkey" FOREIGN KEY ("advertiser_id") REFERENCES "openad"."ad_advertisers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "openad"."ad_credit_ledger" ADD CONSTRAINT "ad_credit_ledger_advertiser_id_fkey" FOREIGN KEY ("advertiser_id") REFERENCES "openad"."ad_advertisers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "openad"."ad_credit_ledger" ADD CONSTRAINT "ad_credit_ledger_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "openad"."ad_credit_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
