-- Compra de crédito de veiculação por **Pix**, num painel web.
--
-- A modelagem de compra já existia e estava pensada para in-app purchase: `ad_credit_purchases`
-- tem `store` (apple|google), `product_sku`, `store_fee_cents`, `transaction_id` e
-- `receipt_status`. Nada escrevia nela, e `receipt_status` nunca saía de `pending`.
--
-- A decisão de 2026-10-07 mudou o caminho: **a compra é no painel web, por Pix**, e o app do
-- anunciante fica só de gestão. Isso evita a taxa de 15 a 30% da loja e dispensa a validação de
-- recibo (que era o item mais pesado da frente) e os webhooks de estorno de loja.
--
-- ============================================================================
-- Por que reusar `ad_credit_purchases` em vez de criar outra tabela
-- ============================================================================
--
-- Porque o que a tabela descreve é "o anunciante pagou X e recebeu Y de crédito", e isso não
-- depende de quem processou o pagamento. Os campos de loja passam a ser opcionais, e `store`
-- ganha o valor `pix`. Uma tabela separada duplicaria o saldo em dois lugares e obrigaria todo
-- leitor de histórico a unir as duas — exatamente o tipo de divisão que depois ninguém lembra
-- de manter em sincronia.
--
-- `transaction_id` continua sendo a chave natural, e o índice único `(store, transaction_id)`
-- continua sendo a trava contra creditar o mesmo pagamento duas vezes. No Pix ele guarda o
-- identificador da cobrança no provedor.

-- `ALTER TYPE ... ADD VALUE` é aditivo e não reescreve a tabela. `IF NOT EXISTS` para a
-- migration ser idempotente.
ALTER TYPE "openad"."AdStore" ADD VALUE IF NOT EXISTS 'pix';

ALTER TABLE "openad"."ad_credit_purchases"
  -- Em Pix não há SKU de loja: o anunciante escolhe o valor. Fica anulável em vez de receber
  -- um texto inventado, para `NULL` significar "não é compra de loja" e não "esqueci de
  -- preencher".
  ALTER COLUMN "product_sku" DROP NOT NULL,

  -- Valor exato em micro-reais, pela mesma razão do resto do dinheiro aqui: o crédito é
  -- consumido a R$ 0,003/s, e o saldo precisa fechar com o gasto sem resto escondido. BIGINT
  -- porque o teto do inteiro de 32 bits é ~R$ 2.147.
  ADD COLUMN IF NOT EXISTS "credit_micros" BIGINT,

  -- Identificador da cobrança no provedor de pagamento (Asaas), e o Pix copia-e-cola.
  --
  -- O copia-e-cola é guardado para o painel poder reexibir a cobrança sem recriá-la: sem ele,
  -- recarregar a página geraria uma segunda cobrança para o mesmo pedido, e o anunciante
  -- acabaria com duas pendentes.
  ADD COLUMN IF NOT EXISTS "charge_external_id" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "pix_copy_paste" TEXT,
  ADD COLUMN IF NOT EXISTS "pix_expires_at" TIMESTAMP(3),

  -- Quem pediu a compra, para auditoria. É `public.users.id`; sem FK porque a coluna é
  -- informativa e uma FK aqui daria ao openad poder de bloquear exclusão de usuário no hub por
  -- um dado que é só registro.
  ADD COLUMN IF NOT EXISTS "requested_by" UUID;

-- Busca da cobrança pelo identificador do provedor: é como a confirmação de pagamento chega.
-- Sem `WHERE ... IS NOT NULL`: em Postgres um indice unico ja trata NULLs como distintos entre
-- si, de modo que o indice total e o parcial sao equivalentes aqui. O total e o que o Prisma
-- emite para `@unique` em coluna anulavel, e manter os dois iguais evita que `migrate diff`
-- acuse deriva num indice que nao tem diferenca de comportamento.
CREATE UNIQUE INDEX IF NOT EXISTS "ad_credit_purchases_charge_external_key"
  ON "openad"."ad_credit_purchases" ("charge_external_id");

-- Fila do painel e do operador: cobranças pendentes do anunciante, mais recentes primeiro.
CREATE INDEX IF NOT EXISTS "ad_credit_purchases_pendentes_idx"
  ON "openad"."ad_credit_purchases" ("advertiser_id", "receipt_status", "created_at" DESC);
