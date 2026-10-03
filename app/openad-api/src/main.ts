import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module';
import { aplicarPrefixoGlobal } from './app/global-prefix';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  app.useLogger(app.get(Logger));
  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableCors({ origin: true, credentials: true });
  app.useWebSocketAdapter(new IoAdapter(app));

  // Prefixo e exclusões vêm de `app/global-prefix.ts`, compartilhado com o factory de teste:
  // as duas configurações têm de ser idênticas, senão uma rota responde num caminho no teste
  // e em outro em produção.
  aplicarPrefixoGlobal(app);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('OpenAD API')
    .setDescription(
      'Transit advertising platform — device inventory, lifecycle & config, campaigns, fleet monitor, proof-of-play.'
    )
    .setVersion('1.1')
    .addBearerAuth()
    .addTag('releases', 'MDM APK distribution, manifests, staged rollout')
    .addTag('device-state-machine', 'Device lifecycle, capability manifest, retired blacklist')
    .addTag('configuration-profiles', 'Exhibition rules and connectivity profiles')
    .addTag('device-groups', 'Device grouping and membership')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    customSiteTitle: 'OpenAD API',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    })
  );
  const port = process.env.PORT || 3000;
  await app.listen(port);
  app.get(Logger).log(`Listening on http://localhost:${port}/api/v1`);
  app.get(Logger).log(`Swagger UI http://localhost:${port}/api/docs`);
}

bootstrap();
