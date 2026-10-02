/**
 * Roda uma tarefa do Gradle no projeto Android do player, escolhendo o wrapper certo para o
 * sistema operacional.
 *
 * O alvo `cap-build-android` chamava `./gradlew`, que no Windows nao executa: a forma
 * valida e `gradlew.bat`.
 *
 * Uso: `node tools/gradle-android.mjs assembleDebug`
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR_ANDROID = join(RAIZ, 'app', 'openad-ad-client', 'android');
const NO_WINDOWS = process.platform === 'win32';

const tarefas = process.argv.slice(2);
if (tarefas.length === 0) {
  console.error('gradle-android: informe ao menos uma tarefa, por exemplo assembleDebug');
  process.exit(1);
}

/**
 * O Gradle 8.14.3 do wrapper nao executa em JVM 25 ou maior (Java 25 exigiria Gradle 9.1).
 * Sem esta checagem o build falha com erro de bytecode, que nao diz o que fazer. Avisa em
 * vez de abortar: a decisao de qual JDK usar e do desenvolvedor.
 */
function avisarSeOJdkForIncompativel() {
  const javaHome = process.env.JAVA_HOME;
  if (!javaHome) {
    console.warn(
      'gradle-android: JAVA_HOME nao esta definido. O Gradle vai usar o java do PATH, ' +
        'que precisa ser um JDK entre 17 e 24.'
    );
    return;
  }
  const major = Number(/(?:jdk-?|openjdk-?)(\d+)/i.exec(javaHome)?.[1]);
  if (Number.isFinite(major) && major > 24) {
    console.warn(
      `gradle-android: JAVA_HOME aponta para um JDK ${major}. O Gradle 8.14.3 suporta ` +
        'no maximo o 24 — use um JDK 21.'
    );
  }
}

avisarSeOJdkForIncompativel();

const wrapper = join(DIR_ANDROID, NO_WINDOWS ? 'gradlew.bat' : 'gradlew');
const resultado = spawnSync(wrapper, tarefas, {
  cwd: DIR_ANDROID,
  stdio: 'inherit',
  shell: NO_WINDOWS,
});
process.exit(resultado.status ?? 1);
