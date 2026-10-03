#!/usr/bin/env bash
#
# Procura, no banco, referencias a arquivo e descobre para qual armazenamento elas apontam.
# **Somente leitura.**
#
# A pergunta: `hubstorage.opendriver.com.br` fica na VM antiga, mas os dois backends estao
# configurados com `MINIO_ENDPOINT=http://hub-minio:9000`, que e o MinIO **desta** VPS. Se o
# banco tem URL apontando para `hubstorage`, esses arquivos moram na VM antiga e precisam
# ser migrados — senao o link quebra no dia em que ela for desligada.
#
# O inverso tambem importa: se nenhuma linha referencia `hubstorage`, ele e vestigial e a
# decisao de deixa-lo na VM antiga nao custa nada.
set -uo pipefail

PG_CONTAINER="${PG_CONTAINER:-l5bcr9slmgtmeefkqwg5amia}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-hub}"

q() { docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -At -c "$1" 2>&1; }

secao() { printf '\n========== %s ==========\n' "$1"; }

secao 'COLUNAS DE TEXTO QUE PODEM GUARDAR CAMINHO DE ARQUIVO'
q "SELECT table_schema || '.' || table_name || '.' || column_name
     FROM information_schema.columns
    WHERE table_schema IN ('public','opendriver')
      AND data_type IN ('text','character varying')
      AND (column_name ~* '(url|path|file|photo|image|doc|attach|avatar|key|storage|media|receipt|proof)')
    ORDER BY 1"

secao 'ONDE AS REFERENCIAS APONTAM'
# Varre cada coluna candidata e classifica o destino. Em vez de supor o esquema de nomes,
# conta por padrao encontrado.
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -At <<'SQL' 2>&1
DO $$
DECLARE
  c record;
  n bigint;
  amostra text;
BEGIN
  FOR c IN
    SELECT table_schema s, table_name t, column_name col
      FROM information_schema.columns
     WHERE table_schema IN ('public','opendriver')
       AND data_type IN ('text','character varying')
       AND (column_name ~* '(url|path|file|photo|image|doc|attach|avatar|key|storage|media|receipt|proof)')
  LOOP
    EXECUTE format(
      'SELECT count(*), min(%I) FROM %I.%I WHERE %I IS NOT NULL AND %I <> %L',
      c.col, c.s, c.t, c.col, c.col, ''
    ) INTO n, amostra;
    IF n > 0 THEN
      RAISE NOTICE '% . % . % | % linha(s) | exemplo: %',
        c.s, c.t, c.col, n, left(coalesce(amostra,''), 120);
    END IF;
  END LOOP;
END $$;
SQL

secao 'CONTAGEM POR DESTINO DE ARMAZENAMENTO'
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -At <<'SQL' 2>&1
DO $$
DECLARE
  c record;
  n bigint;
  total_hubstorage bigint := 0;
  total_sslip bigint := 0;
  total_r2 bigint := 0;
  total_relativo bigint := 0;
BEGIN
  FOR c IN
    SELECT table_schema s, table_name t, column_name col
      FROM information_schema.columns
     WHERE table_schema IN ('public','opendriver')
       AND data_type IN ('text','character varying')
       AND (column_name ~* '(url|path|file|photo|image|doc|attach|avatar|key|storage|media|receipt|proof)')
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I ILIKE %L', c.s, c.t, c.col, '%hubstorage%') INTO n;
    total_hubstorage := total_hubstorage + n;
    IF n > 0 THEN RAISE NOTICE 'hubstorage em % . % . % : %', c.s, c.t, c.col, n; END IF;

    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I ILIKE %L', c.s, c.t, c.col, '%sslip.io%') INTO n;
    total_sslip := total_sslip + n;
    IF n > 0 THEN RAISE NOTICE 'sslip.io em % . % . % : %', c.s, c.t, c.col, n; END IF;

    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I ILIKE %L', c.s, c.t, c.col, '%r2.cloudflarestorage%') INTO n;
    total_r2 := total_r2 + n;
    IF n > 0 THEN RAISE NOTICE 'r2 em % . % . % : %', c.s, c.t, c.col, n; END IF;

    EXECUTE format(
      'SELECT count(*) FROM %I.%I WHERE %I IS NOT NULL AND %I <> %L AND %I NOT ILIKE %L',
      c.s, c.t, c.col, c.col, '', c.col, 'http%'
    ) INTO n;
    total_relativo := total_relativo + n;
  END LOOP;

  RAISE NOTICE '--- TOTAIS ---';
  RAISE NOTICE 'apontando para hubstorage (VM ANTIGA): %', total_hubstorage;
  RAISE NOTICE 'apontando para sslip.io (dominio temporario): %', total_sslip;
  RAISE NOTICE 'apontando para Cloudflare R2: %', total_r2;
  RAISE NOTICE 'caminho relativo / chave de objeto (sem host): %', total_relativo;
END $$;
SQL

secao 'FIM'
