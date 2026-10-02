import { Global, Module, RequestMethod } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';

@Global()
@Module({
  imports: [
    PinoLoggerModule.forRoot({
      // nestjs-pino defaults to '*' → /api/v1/* and LegacyRouteConverter noise; use Nest named splat (middleware wildcards).
      forRoutes: [{ path: '*splat', method: RequestMethod.ALL }],
      pinoHttp: {
        level: (process.env.LOG_LEVEL ?? 'info') as any,
        genReqId: (req: { headers?: Record<string, string | string[] | undefined> }) => {
          const h = req.headers?.['x-correlation-id'];
          const id = Array.isArray(h) ? h[0] : h;
          return id && typeof id === 'string' ? id : randomUUID();
        },
        serializers: {
          req: (req: { id?: string; method?: string; url?: string }) => ({
            id: req.id,
            method: req.method,
            url: req.url,
          }),
        },
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class AppLoggerModule {}
