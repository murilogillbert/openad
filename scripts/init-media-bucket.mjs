#!/usr/bin/env node
/**
 * Cria o bucket de midia no storage S3 local (rodar depois do `docker compose up`).
 *
 * Substitui `scripts/minio-init-media-bucket.sh`, que dependia de bash e do `aws` CLI
 * instalado na maquina. Este usa o `@aws-sdk/client-s3` que ja esta nas dependencias do
 * monorepo, entao funciona igual em Windows, macOS e Linux.
 *
 *   node scripts/init-media-bucket.mjs
 *
 * Variaveis (todas opcionais, com os mesmos defaults do stack local):
 *   S3_ENDPOINT / MINIO_ENDPOINT   http://127.0.0.1:9000
 *   S3_BUCKET                      openad-media
 *   S3_ACCESS_KEY_ID               minioadmin
 *   S3_SECRET_ACCESS_KEY           minioadmin
 *   S3_REGION                      us-east-1
 */
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const endpoint =
  process.env.S3_ENDPOINT ?? process.env.MINIO_ENDPOINT ?? 'http://127.0.0.1:9000';
const bucket = process.env.S3_BUCKET ?? 'openad-media';

const client = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  endpoint,
  // Storage local nao resolve bucket por subdominio.
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  },
});

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log(`Bucket ja existe: s3://${bucket} (${endpoint})`);
} catch {
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`Bucket criado: s3://${bucket} (${endpoint})`);
  } catch (err) {
    console.error(
      `Falha ao criar s3://${bucket} em ${endpoint}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    console.error('O storage esta no ar? `docker compose ps minio`');
    process.exit(1);
  }
}
