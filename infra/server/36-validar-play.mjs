/**
 * Prova que a conta de serviço alcança a API do Google Play, nos três apps.
 *
 * Por que validar antes de construir: montar assinatura, gerar AAB e descobrir no upload que a
 * conta não tem permissão é jogar meia hora de build no lixo. E o modo de falhar é confuso —
 * "o convite foi aceito?" não é observável no Play Console, porque conta de serviço não
 * aparece na lista de usuários pendentes.
 *
 * `edits.insert` é a chamada escolhida porque é a que todo upload começa fazendo: se ela passa,
 * a cadeia inteira (projeto do Cloud, API ativada, convite aceito, permissão de lançamento)
 * está correta. A edição criada é descartada em seguida com `edits.delete`, então nada muda no
 * app.
 *
 * Sem dependência externa: assina o JWT com `crypto` do Node e troca por token de acesso no
 * endpoint OAuth do Google. Instalar `googleapis` (dezenas de megabytes) para fazer duas
 * chamadas HTTP seria desproporcional.
 *
 * Uso: node infra/server/36-validar-play.mjs "C:\caminho\para\chave.json"
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PACOTES = [
  { pacote: 'br.com.opendriver.app', nome: 'OpenDriver' },
  { pacote: 'br.com.opendriverhub.app', nome: 'OpenDriver HUB' },
  { pacote: 'br.com.opendriver.ads', nome: 'OpenDriver AD' },
];

const ESCOPO = 'https://www.googleapis.com/auth/androidpublisher';

function base64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Monta e assina o JWT que o Google troca por token de acesso (fluxo de conta de serviço). */
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
  const jwt = `${cabecalho}.${corpo}.${base64url(assinatura)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `OAuth recusou (${res.status}): ${json.error ?? ''} ${json.error_description ?? ''}`
    );
  }
  return json.access_token;
}

const caminho = process.argv[2];
if (!caminho) {
  console.error('uso: node 36-validar-play.mjs "<caminho do json da conta de servico>"');
  process.exit(1);
}

const chave = JSON.parse(readFileSync(caminho, 'utf8'));
console.log(`conta de servico: ${chave.client_email}`);
console.log(`projeto do cloud: ${chave.project_id}\n`);

let token;
try {
  token = await obterToken(chave);
  console.log(`ok   token de acesso obtido (${token.length} caracteres)\n`);
} catch (e) {
  console.error(`FALHA ao obter token: ${e.message}`);
  console.error('\nCausa tipica: a chave foi revogada, ou o relogio do sistema esta errado');
  console.error('(o JWT tem janela de validade e o Google recusa `iat` no futuro).');
  process.exit(1);
}

let falhas = 0;

for (const { pacote, nome } of PACOTES) {
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pacote}`;
  const cabecalhos = { Authorization: `Bearer ${token}` };

  const res = await fetch(`${base}/edits`, { method: 'POST', headers: cabecalhos });
  const corpo = await res.text();

  if (res.ok) {
    const { id } = JSON.parse(corpo);
    console.log(`ok   ${pacote.padEnd(28)} ${nome}  (edicao ${id})`);
    // Descarta a edição: ela não deve ficar aberta, senão aparece como alteração pendente.
    await fetch(`${base}/edits/${id}`, { method: 'DELETE', headers: cabecalhos });
  } else {
    falhas++;
    let motivo = corpo.slice(0, 300);
    try {
      motivo = JSON.parse(corpo).error?.message ?? motivo;
    } catch {
      /* corpo não era JSON */
    }
    console.log(`FALHA ${pacote.padEnd(28)} ${nome}`);
    console.log(`      ${res.status}: ${motivo}`);
    if (res.status === 401) {
      console.log('      -> a API Google Play Android Developer pode nao estar ativada no projeto');
    }
    if (res.status === 403) {
      console.log('      -> a conta de servico nao foi convidada, ou nao tem permissao neste app');
    }
    if (res.status === 404) {
      console.log('      -> o pacote nao existe nesta conta de desenvolvedor (confira a grafia)');
    }
  }
}

console.log('');
if (falhas === 0) {
  console.log('Os tres apps estao alcancaveis. A credencial serve para subir versao.');
  process.exit(0);
}
console.log(`${falhas} app(s) inalcancavel(is).`);
process.exit(1);
