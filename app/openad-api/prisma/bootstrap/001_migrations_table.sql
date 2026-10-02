-- Bootstrap do historico de migrations do openad. Idempotente; rode **antes** do primeiro
-- `prisma migrate deploy` em qualquer banco onde o schema `public` do hub ja exista.
--
-- Por que e necessario: o datasource usa multiSchema (["openad", "public"]). Com `public`
-- ja populado pelo hub e sem tabela de historico no schema padrao `openad`, o
-- `migrate deploy` do Prisma 6 aborta com "migration persistence is not initialized" — ele
-- nao sabe se o banco esta vazio ou se tem um historico que ele nao consegue ler.
--
-- Mesmo arquivo, mesmo motivo, que opendriver/backend/prisma/bootstrap/001_migrations_table.sql.
-- A diferenca e so o nome do schema.

CREATE SCHEMA IF NOT EXISTS "openad";

CREATE TABLE IF NOT EXISTS "openad"."_prisma_migrations" (
    "id"                  VARCHAR(36)  NOT NULL PRIMARY KEY,
    "checksum"            VARCHAR(64)  NOT NULL,
    "finished_at"         TIMESTAMPTZ,
    "migration_name"      VARCHAR(255) NOT NULL,
    "logs"                TEXT,
    "rolled_back_at"      TIMESTAMPTZ,
    "started_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER      NOT NULL DEFAULT 0
);
