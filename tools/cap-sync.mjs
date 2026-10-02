/**
 * Prepara o projeto Android do player e roda `cap sync`.
 *
 * Substitui a cadeia de comandos shell que havia no alvo `cap-sync` do `project.json`, que
 * nao rodava no Windows por tres motivos: `ln -sfn` nao existe, `$(node -p ...)` e
 * substituicao de comando do bash, e `cd X && Y` nao encadeia diretorio no PowerShell.
 *
 * Passos, na ordem em que o Capacitor exige:
 *   1. liga `app/openad-ad-client/node_modules` ao do workspace, porque a CLI do Capacitor
 *      resolve os plugins a partir do diretorio do app, nao da raiz do monorepo;
 *   2. compila o bundle web;
 *   3. renomeia `index.csr.html` para `index.html`, que e o que o `webDir` precisa;
 *   4. sincroniza o projeto Android.
 *
 * Uso: `node tools/cap-sync.mjs [--configuration=production]`
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR_DO_APP = join(RAIZ, 'app', 'openad-ad-client');
const NO_WINDOWS = process.platform === 'win32';

function executar(comando, argumentos, cwd = RAIZ) {
  const resultado = spawnSync(comando, argumentos, {
    cwd,
    stdio: 'inherit',
    // Necessario no Windows para resolver `pnpm.cmd` e `cap.cmd`.
    shell: NO_WINDOWS,
  });
  if (resultado.status !== 0) {
    console.error(`cap-sync: falhou em \`${comando} ${argumentos.join(' ')}\``);
    process.exit(resultado.status ?? 1);
  }
}

/**
 * No Windows usa junction em vez de symlink: symlink de diretorio exige privilegio de
 * administrador ou modo de desenvolvedor, junction nao exige nada.
 */
function ligarNodeModulesDoApp() {
  const destino = join(DIR_DO_APP, 'node_modules');
  if (existsSync(destino)) {
    const info = lstatSync(destino);
    if (info.isSymbolicLink() || info.isDirectory()) {
      return;
    }
    unlinkSync(destino);
  }
  symlinkSync(join(RAIZ, 'node_modules'), destino, NO_WINDOWS ? 'junction' : 'dir');
  console.log('cap-sync: node_modules do app ligado ao do workspace');
}

const argumentoDeConfiguracao = process.argv
  .slice(2)
  .find((a) => a.startsWith('--configuration='));
const configuracao =
  argumentoDeConfiguracao?.split('=')[1] ??
  (process.env.NODE_ENV === 'production' ? 'production' : 'development');

ligarNodeModulesDoApp();
executar('pnpm', ['exec', 'nx', 'run', `openad-ad-client:build`, `--configuration=${configuracao}`]);
executar('node', [join('tools', 'copy-capacitor-web-index.cjs')]);
// Caminho explicito para o binario do workspace, para nao depender do PATH.
const CLI_DO_CAPACITOR = join(RAIZ, 'node_modules', '.bin', NO_WINDOWS ? 'cap.cmd' : 'cap');
executar(CLI_DO_CAPACITOR, ['sync', 'android'], DIR_DO_APP);
console.log('cap-sync: projeto Android sincronizado');
