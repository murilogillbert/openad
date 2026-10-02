/**
 * Prepara o Postgres compartilhado do ecossistema, na mesma ordem da producao.
 *
 * O banco e um so e tem tres donos: `public` e do hub, `opendriver` do opendriver e `openad`
 * deste repositorio. Como `openad.ad_advertisers` tem chave estrangeira para
 * `public.users`, o schema do hub tem de existir **antes** das migrations do openad — e so o
 * hub sabe criar o `public`.
 *
 * Por isso este script, em vez de um `.sql` de init no compose:
 *   1. aplica as migrations do **hub**, do repositorio irmao, criando `public`;
 *   2. aplica o bootstrap do historico do openad (sem ele o `migrate deploy` do Prisma 6
 *      aborta com "migration persistence is not initialized", porque `public` ja esta
 *      populado e o schema padrao ainda nao tem tabela de historico);
 *   3. aplica as migrations do **openad**.
 *
 * E a mesma receita que o CI do opendriver usa com dois `checkout`. Nenhuma etapa daqui
 * altera a estrutura de `public`: a etapa 1 roda o Prisma *do hub*, no repositorio dele.
 *
 * Uso:
 *   node scripts/init-postgres-schemas.mjs
 *   HUB_REPO_PATH=D:/Projetos/hub node scripts/init-postgres-schemas.mjs
 *
 * Variaveis:
 *   DATABASE_URL   conexao do openad, com `?schema=openad` (tem um padrao de dev)
 *   HUB_REPO_PATH  raiz do repositorio do hub (padrao: ../hub ao lado deste)
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NO_WINDOWS = process.platform === 'win32';

const URL_DO_OPENAD =
  process.env.DATABASE_URL ??
  'postgresql://openad:openad-dev-postgres@127.0.0.1:5432/hub?schema=openad';

/** A conexao do hub e a mesma, sem `?schema`: as tabelas dele moram no `public`. */
const URL_DO_HUB = URL_DO_OPENAD.replace(/[?&]schema=[^&]*/, '');

const CAMINHO_DO_HUB = resolve(process.env.HUB_REPO_PATH ?? join(RAIZ, '..', 'hub'));

function executar(comando, argumentos, opcoes = {}) {
  const resultado = spawnSync(comando, argumentos, {
    stdio: 'inherit',
    shell: NO_WINDOWS,
    ...opcoes,
    env: { ...process.env, ...(opcoes.env ?? {}) },
  });
  if (resultado.status !== 0) {
    console.error(`init-postgres-schemas: falhou em \`${comando} ${argumentos.join(' ')}\``);
    process.exit(resultado.status ?? 1);
  }
}

// 1. Migrations do hub, que criam e sao donas do `public`.
const backendDoHub = join(CAMINHO_DO_HUB, 'backend');
if (!existsSync(join(backendDoHub, 'prisma', 'schema.prisma'))) {
  console.error(
    `init-postgres-schemas: nao encontrei o Prisma do hub em ${backendDoHub}.\n` +
      'Aponte HUB_REPO_PATH para a raiz do repositorio do hub. O schema `public` e dele, e\n' +
      '`openad.ad_advertisers` tem chave estrangeira para `public.users` — sem isso a\n' +
      'migration do openad falha, e com razao.'
  );
  process.exit(1);
}
console.log('init-postgres-schemas: aplicando as migrations do hub (schema public)');
executar('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: backendDoHub,
  env: { DATABASE_URL: URL_DO_HUB, DIRECT_URL: URL_DO_HUB },
});

// 2. Bootstrap do historico do openad.
console.log('init-postgres-schemas: criando openad._prisma_migrations');
executar(
  'pnpm',
  [
    'exec',
    'prisma',
    'db',
    'execute',
    '--url',
    URL_DO_OPENAD,
    '--file',
    join('app', 'openad-api', 'prisma', 'bootstrap', '001_migrations_table.sql'),
  ],
  { cwd: RAIZ }
);

// 3. Migrations do openad.
console.log('init-postgres-schemas: aplicando as migrations do openad (schema openad)');
executar(
  'pnpm',
  ['exec', 'prisma', 'migrate', 'deploy', '--schema', join('app', 'openad-api', 'prisma', 'schema.prisma')],
  { cwd: RAIZ, env: { DATABASE_URL: URL_DO_OPENAD } }
);

console.log('init-postgres-schemas: pronto — schemas public e openad no mesmo banco');
