/**
 * Generates `openapi.json` from the live Nest app (Swagger).
 * Includes all registered controllers (campaigns, devices, **media-vfs** upload/folders/assets, etc.).
 * Usage (from repo root, with Mongo/Redis available):
 *   pnpm exec ts-node -P app/openad-api/tsconfig.app.json app/openad-api/scripts/generate-openapi.ts
 *
 * Or: start the API and `curl -s http://127.0.0.1:3000/api/docs-json > app/openad-api/openapi.json`
 */
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app/app.module';

async function main(): Promise<void> {
  process.env.MQTT_HEALTH_DISABLED ??= 'true';
  process.env.SKIP_ASSET_ROTATION ??= 'true';
  process.env.S3_BUCKET ??= 'openapi-gen';
  process.env.S3_REGION ??= 'us-east-1';
  process.env.S3_ACCESS_KEY_ID ??= 'test';
  process.env.S3_SECRET_ACCESS_KEY ??= 'test';

  const app = await NestFactory.create(AppModule, { logger: false });
  const cfg = new DocumentBuilder()
    .setTitle('OpenAD API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, cfg);
  const out = path.join(__dirname, '..', 'openapi.json');
  fs.writeFileSync(out, JSON.stringify(document, null, 2));
  await app.close();
  // eslint-disable-next-line no-console
  console.log(`Wrote ${out}`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
