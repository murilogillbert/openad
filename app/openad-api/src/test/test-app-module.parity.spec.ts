import { AppModule } from '../app/app.module';
import { TestAppModule } from './test-app.module';

/**
 * O modulo de teste tem de conter todo modulo de dominio que a producao contem.
 *
 * `TestAppModule` e uma copia mantida a mao de `AppModule`, e por isso ela **sai de sincronia
 * em silencio**: acrescentar um controller novo e esquecer esta lista produz uma suite de
 * integracao que devolve 404 em toda rota do modulo novo. Aconteceu com `AdvertiserModule`,
 * e o sintoma — `Expected 201, received 404` — nao aponta para a causa; custa uma meia hora
 * procurando no guard e no prefixo global antes de alguem olhar para o grafo de modulos.
 *
 * O teste compara pelos modulos **declarados diretamente** em cada um. Diferencas de
 * infraestrutura sao esperadas e estao na lista de excecoes, com o motivo de cada uma: o
 * teste nao sobe health check, nem throttler, e usa `ConfigModule` no lugar do `validateEnv`
 * do boot de producao.
 */
const SO_EM_PRODUCAO = new Set([
  // Sondas HTTP de liveness/readiness: nao ha o que sondar numa suite.
  'HealthModule',
  // Painel operacional; as suites que precisam dele o importam direto.
  'DashboardModule',
  // `ThrottlerGuard` global atrapalharia suite que dispara centenas de requisicoes.
  'ThrottlerModule',
  // Em producao o ambiente e validado por `validateEnv` dentro de uma IIFE no `imports`;
  // no teste a factory define as variaveis antes de compilar o modulo.
  'ScheduleModule',
]);

function modulosDiretos(modulo: unknown): string[] {
  const imports =
    (Reflect.getMetadata('imports', modulo as object) as unknown[]) ?? [];
  return imports
    .map((m) => {
      if (typeof m === 'function') {
        return m.name;
      }
      // `forwardRef` e `registerAsync` devolvem objeto; `DynamicModule` tem `module`.
      const d = m as { module?: { name?: string }; name?: string } | null;
      return d?.module?.name ?? d?.name ?? '';
    })
    .filter((n) => n.length > 0);
}

describe('paridade entre AppModule e TestAppModule', () => {
  it('todo modulo de producao esta no modulo de teste', () => {
    const producao = modulosDiretos(AppModule).filter(
      (n) => !SO_EM_PRODUCAO.has(n)
    );
    const teste = new Set(modulosDiretos(TestAppModule));
    const faltando = producao.filter((n) => !teste.has(n));
    expect(faltando).toEqual([]);
  });

  it('o modulo de teste nao inventa modulo que a producao nao tem', () => {
    // A direcao inversa importa menos, mas pega o caso oposto: suite verde sobre um modulo
    // que nunca e carregado em producao.
    const producao = new Set(modulosDiretos(AppModule));
    const permitidoSoNoTeste = new Set(['ConfigModule', 'ScheduleModule']);
    const sobrando = modulosDiretos(TestAppModule).filter(
      (n) => !producao.has(n) && !permitidoSoNoTeste.has(n)
    );
    expect(sobrando).toEqual([]);
  });
});
