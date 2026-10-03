/**
 * Sobe um AAB para uma faixa do Google Play, pela API.
 *
 * O fluxo da API do Play e transacional e e preciso respeitar a ordem, senao o upload fica
 * invisivel no console:
 *
 *   1. `edits.insert`           abre uma edicao (transacao)
 *   2. `edits.bundles.upload`   envia o AAB (upload simples, `application/octet-stream`)
 *   3. `edits.tracks.update`    atribui o versionCode da edicao a uma faixa
 *   4. `edits.commit`           publica a edicao
 *
 * Sem o passo 3, o bundle sobe mas nao fica em faixa nenhuma: aparece na biblioteca de
 * artefatos e em lugar nenhum util. Sem o passo 4, nada do que foi feito vale.
 *
 * Faixa padrao: `internal`. Teste interno **nao passa por revisao** e aceita ate 100
 * testadores, entao e onde se descobre que o app instala e abre contra a API de producao antes
 * de qualquer avaliador olhar. Promover para `alpha`/`beta`/`production` e so repetir com
 * outra faixa.
 *
 * Sem dependencia externa: JWT assinado com `crypto` e duas chamadas `fetch`.
 *
 * Uso:
 *   node 39-subir-play.mjs <app> <caminho.aab> [faixa]
 *   node 39-subir-play.mjs opendriverads "...\app-release.aab" internal
 */
import { createSign } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const CHAVE_PADRAO =
  'C:\\Users\\Ludimila\\Documents\\google\\lateral-pillar-454914-g5-dedafcca49ac.json';

const PACOTES = {
  opendriver: 'br.com.opendriver.app',
  opendriverhub: 'br.com.opendriverhub.app',
  opendriverads: 'br.com.opendriver.ads',
};

const ESCOPO = 'https://www.googleapis.com/auth/androidpublisher';

function base64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function obterToken(chave) {
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = base64url(
    JSON.stringify({
      iss: chave.client_email,
      scope: ESCOPO,
      aud: 'https://oauth2.googleapis.com/token',
      iat: agora,
      exp: agora + 3600,
    })
  );
  const assinatura = createSign('RSA-SHA256')
    .update(`${cabecalho}.${corpo}`)
    .sign(chave.private_key);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${cabecalho}.${corpo}.${base64url(assinatura)}`,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`OAuth ${res.status}: ${json.error_description ?? json.error}`);
  return json.access_token;
}

const [app, caminhoAab, faixa = 'internal'] = process.argv.slice(2);
const pacote = PACOTES[app];

if (!pacote || !caminhoAab) {
  console.error('uso: node 39-subir-play.mjs <opendriver|opendriverhub|opendriverads> <caminho.aab> [faixa]');
  process.exit(1);
}

const tamanho = statSync(caminhoAab).size;
console.log(`app    : ${app} (${pacote})`);
console.log(`aab    : ${caminhoAab}`);
console.log(`tamanho: ${(tamanho / 1024 / 1024).toFixed(1)} MB`);
console.log(`faixa  : ${faixa}\n`);

const chave = JSON.parse(readFileSync(process.env.PLAY_KEY ?? CHAVE_PADRAO, 'utf8'));
const token = await obterToken(chave);
const auth = { Authorization: `Bearer ${token}` };
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pacote}`;

async function json(res, oque) {
  const texto = await res.text();
  if (!res.ok) {
    let msg = texto.slice(0, 500);
    try {
      msg = JSON.parse(texto).error?.message ?? msg;
    } catch {
      /* nao era JSON */
    }
    throw new Error(`${oque} falhou (${res.status}): ${msg}`);
  }
  return texto ? JSON.parse(texto) : {};
}

/**
 * O arquivo e lido **antes** de abrir a edicao.
 *
 * A edicao do Play tem janela de validade curta, e ler 87 MB do disco dentro dela gasta parte
 * dessa janela sem necessidade. Foi assim que o upload do hub-mobile falhou com
 * "This edit has expired": o de 72 MB caiu dentro da janela, o de 87 MB nao.
 */
const bytes = readFileSync(caminhoAab);
console.log(`arquivo lido: ${bytes.length} bytes\n`);

/**
 * Uma tentativa completa: abre a edicao, envia, atribui a faixa e publica.
 *
 * A sequencia inteira vive dentro da tentativa de proposito. Reusar uma edicao expirada para
 * refazer so o upload nao funciona -- a edicao e a transacao, e quando ela expira todos os
 * passos seguintes falham. Entao a unidade de repeticao e a transacao, nao a chamada.
 */
async function tentar(n) {
  const t0 = Date.now();
  const edicao = await json(
    await fetch(`${base}/edits`, { method: 'POST', headers: auth }),
    'edits.insert'
  );
  console.log(`[tentativa ${n}] edicao ${edicao.id}`);

  try {
    console.log(`[tentativa ${n}] enviando ${(bytes.length / 1024 / 1024).toFixed(1)} MB...`);
    const bundle = await json(
      await fetch(
        `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${pacote}/edits/${edicao.id}/bundles?uploadType=media`,
        {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/octet-stream' },
          body: bytes,
        }
      ),
      'bundles.upload'
    );
    const seg = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(
      `[tentativa ${n}] enviado em ${seg}s: versionCode ${bundle.versionCode}, sha1 ${bundle.sha1}`
    );

    // Atribui a faixa. Sem isto o bundle sobe e nao fica em faixa nenhuma: aparece na
    // biblioteca de artefatos e em lugar nenhum util, e o console nao avisa.
    // `status: completed` = 100% dos testadores da faixa.
    await json(
      await fetch(`${base}/edits/${edicao.id}/tracks/${faixa}`, {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track: faixa,
          releases: [{ versionCodes: [String(bundle.versionCode)], status: 'completed' }],
        }),
      }),
      'tracks.update'
    );
    console.log(`[tentativa ${n}] atribuido a faixa ${faixa}`);

    const commit = await json(
      await fetch(`${base}/edits/${edicao.id}:commit`, { method: 'POST', headers: auth }),
      'edits.commit'
    );
    console.log(`[tentativa ${n}] publicado (${commit.id})`);
    return true;
  } catch (e) {
    // Descarta a edicao: edicao aberta e abandonada aparece como alteracao pendente no console
    // e bloqueia a proxima.
    await fetch(`${base}/edits/${edicao.id}`, { method: 'DELETE', headers: auth }).catch(() => {});
    throw e;
  }
}

const MAX = 3;
for (let n = 1; n <= MAX; n++) {
  try {
    await tentar(n);
    console.log(
      `\nVeja em: https://play.google.com/console -> ${pacote} -> Teste -> Teste interno`
    );
    process.exit(0);
  } catch (e) {
    const expirou = /expired/i.test(e.message);
    console.error(`\nFALHA na tentativa ${n}: ${e.message}`);

    // Repete so o que vale repetir. Permissao negada ou AAB invalido nao melhoram na segunda
    // tentativa; edicao expirada, sim.
    if (!expirou || n === MAX) {
      if (expirou) {
        console.error(
          '\nA edicao expirou nas tres tentativas. O envio esta demorando mais que a janela\n' +
            'de validade do Play. Caminhos: subir de uma rede mais rapida, ou trocar este\n' +
            'script para upload retomavel (`uploadType=resumable`), que sobrevive a interrupcao.'
        );
      }
      console.error('nada foi publicado.');
      process.exit(1);
    }
    console.error('edicao expirada: abrindo uma nova e tentando de novo.\n');
  }
}
