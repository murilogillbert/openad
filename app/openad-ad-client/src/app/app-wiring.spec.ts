import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guarda de fiacao: afirma que o app **liga** os loops de background.
 *
 * Os dois defeitos mais graves do player eram deste tipo.
 * `SyncOrchestratorService.syncNow()` nao tinha nenhum chamador e
 * `PlayBatchUploaderService` estava declarado como provider sem que nada o injetasse —
 * resultado: o tablet nunca baixava midia e nada de analytics saía dele. Nenhum teste
 * unitario pega isso, porque os dois servicos tinham spec propria passando com os
 * colaboradores mockados. O que faltava era alguem afirmar a ligacao.
 *
 * A verificacao e textual de proposito. A versao anterior importava o `appConfig` real
 * para inspecionar os `deps` dos `APP_INITIALIZER`, e isso puxava o grafo de modulos
 * inteiro do app para dentro de um teste unitario — o suficiente para quebrar o
 * `vi.mock('@capacitor/filesystem')` de `capability-manifest.service.spec.ts` por ordem
 * de inicializacao. Ler o arquivo nao tem efeito colateral nenhum sobre o grafo.
 */
describe('fiacao do app', () => {
  // `fileURLToPath`, nunca `new URL(...).pathname`: em diretorio com espaco o segundo
  // devolve a forma percent-encoded, que nao existe no disco.
  const appConfigPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    'app.config.ts'
  );
  const source = readFileSync(appConfigPath, 'utf8');

  it.each([
    ['SyncSchedulerService', 'sync.start()'],
    ['PlayBatchUploaderService', 'uploader.start()'],
  ])(
    '%s esta injetado e tem start() chamado no bootstrap',
    (token, startCall) => {
      expect(source).toContain(token);
      expect(source).toContain(startCall);
    }
  );

  it('o shell e a rota raiz, para o player nao depender de navegacao', () => {
    const routesPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      'app.routes.ts'
    );
    const routes = readFileSync(routesPath, 'utf8');
    expect(routes).toContain('PlayerShellComponent');
    expect(routes).toMatch(/path:\s*''/);
  });
});
