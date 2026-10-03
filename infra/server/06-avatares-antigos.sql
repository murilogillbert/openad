-- As quatro referencias que apontam para a VM antiga. Somente leitura.
--
-- Sao avatares de usuario em `hubstorage.opendriver.com.br`, que por decisao de 2026-10-03
-- permanece em `187.77.46.26`. Como os dois backends ja gravam no MinIO **desta** VPS
-- (`MINIO_ENDPOINT=http://hub-minio:9000`), estes quatro sao historico: o arquivo esta la e
-- nada novo vai para la.
--
-- O link continua funcionando enquanto a VM antiga estiver no ar. Quebra no dia em que ela
-- for desligada — e e por isso que eles precisam ser copiados antes, ou substituidos.
SELECT id, email, avatar_url
  FROM public.users
 WHERE avatar_url ILIKE '%hubstorage%'
 ORDER BY email;
