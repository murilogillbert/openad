-- Para onde apontam as referencias de arquivo guardadas no banco. Somente leitura.
--
-- Decide uma pergunta concreta de migracao: `hubstorage.opendriver.com.br` fica na VM antiga
-- (`187.77.46.26`), mas os dois backends usam `MINIO_ENDPOINT=http://hub-minio:9000`, que e o
-- MinIO desta VPS. Se houver linha apontando para `hubstorage`, aquele arquivo mora na VM
-- antiga e o link quebra quando ela for desligada.
--
-- `pix_key`, `hashed_key`, `key_preview` e `integration_settings.key` entraram na varredura
-- anterior por causa do nome, mas **nao sao arquivo** — ficam de fora aqui de proposito.

\echo '=== colunas de arquivo: quantas linhas preenchidas, e um exemplo ==='

SELECT 'opendriver.driver_profiles.cnh_photo_key' AS coluna,
       count(cnh_photo_key) AS preenchidas,
       left(min(cnh_photo_key), 90) AS exemplo
  FROM opendriver.driver_profiles
UNION ALL
SELECT 'opendriver.driver_profiles.selfie_key',
       count(selfie_key), left(min(selfie_key), 90)
  FROM opendriver.driver_profiles
UNION ALL
SELECT 'opendriver.vehicles.crlv_key',
       count(crlv_key), left(min(crlv_key), 90)
  FROM opendriver.vehicles
UNION ALL
SELECT 'opendriver.incident_attachments.storage_key',
       count(storage_key), left(min(storage_key), 90)
  FROM opendriver.incident_attachments
UNION ALL
SELECT 'opendriver.ride_recordings.storage_key',
       count(storage_key), left(min(storage_key), 90)
  FROM opendriver.ride_recordings
UNION ALL
SELECT 'public.users.avatar_url',
       count(avatar_url), left(min(avatar_url), 90)
  FROM public.users
UNION ALL
SELECT 'public.products.image_url',
       count(image_url), left(min(image_url), 90)
  FROM public.products
UNION ALL
SELECT 'public.partners.logo_url',
       count(logo_url), left(min(logo_url), 90)
  FROM public.partners
UNION ALL
SELECT 'public.partner_stores.image_url',
       count(image_url), left(min(image_url), 90)
  FROM public.partner_stores
UNION ALL
SELECT 'public.order_items.image_url',
       count(image_url), left(min(image_url), 90)
  FROM public.order_items
UNION ALL
SELECT 'public.campaign_materials.file_url',
       count(file_url), left(min(file_url), 90)
  FROM public.campaign_materials
UNION ALL
SELECT 'public.survey_video_deliveries.video_url',
       count(video_url), left(min(video_url), 90)
  FROM public.survey_video_deliveries
ORDER BY 2 DESC, 1;

\echo ''
\echo '=== alguma referencia aponta para a VM antiga (hubstorage)? ==='

SELECT 'users.avatar_url' AS onde, count(*) AS n FROM public.users
 WHERE avatar_url ILIKE '%hubstorage%'
UNION ALL
SELECT 'products.image_url', count(*) FROM public.products
 WHERE image_url ILIKE '%hubstorage%'
UNION ALL
SELECT 'partners.logo_url', count(*) FROM public.partners
 WHERE logo_url ILIKE '%hubstorage%'
UNION ALL
SELECT 'partner_stores.image_url', count(*) FROM public.partner_stores
 WHERE image_url ILIKE '%hubstorage%'
UNION ALL
SELECT 'order_items.image_url', count(*) FROM public.order_items
 WHERE image_url ILIKE '%hubstorage%'
UNION ALL
SELECT 'campaign_materials.file_url', count(*) FROM public.campaign_materials
 WHERE file_url ILIKE '%hubstorage%'
UNION ALL
SELECT 'survey_video_deliveries.video_url', count(*) FROM public.survey_video_deliveries
 WHERE video_url ILIKE '%hubstorage%';

\echo ''
\echo '=== e para o dominio temporario sslip.io? (quebra quando o dominio final entrar) ==='

SELECT 'users.avatar_url' AS onde, count(*) AS n FROM public.users
 WHERE avatar_url ILIKE '%sslip.io%'
UNION ALL
SELECT 'products.image_url', count(*) FROM public.products
 WHERE image_url ILIKE '%sslip.io%'
UNION ALL
SELECT 'partners.logo_url', count(*) FROM public.partners
 WHERE logo_url ILIKE '%sslip.io%'
UNION ALL
SELECT 'partner_stores.image_url', count(*) FROM public.partner_stores
 WHERE image_url ILIKE '%sslip.io%'
UNION ALL
SELECT 'order_items.image_url', count(*) FROM public.order_items
 WHERE image_url ILIKE '%sslip.io%'
UNION ALL
SELECT 'campaign_materials.file_url', count(*) FROM public.campaign_materials
 WHERE file_url ILIKE '%sslip.io%'
UNION ALL
SELECT 'survey_video_deliveries.video_url', count(*) FROM public.survey_video_deliveries
 WHERE video_url ILIKE '%sslip.io%';
