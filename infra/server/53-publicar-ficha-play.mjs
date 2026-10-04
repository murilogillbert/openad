#!/usr/bin/env node
/**
 * Sobe o AAB e preenche, pela API, tudo da ficha do Play que a API permite preencher:
 * titulo, breve descricao, descricao completa, icone 512x512, recurso grafico 1024x500 e
 * dados de contato do desenvolvedor.
 *
 * O que esta API **nao** cobre, e por isso nao esta aqui: toda a secao "Conteudo do app"
 * (acesso ao app, politica de privacidade, anuncios, classificacao de conteudo, publico-alvo,
 * seguranca dos dados, recursos financeiros, servico em primeiro plano, localizacao em
 * segundo plano). Conferido no documento de descoberta da v3: os unicos recursos de `edits`
 * sao apks, bundles, countryavailability, deobfuscationfiles, details, expansionfiles,
 * images, listings, testers e tracks. Essas declaracoes sao feitas na interface.
 *
 * Os textos vem de `docs/lojas/ficha-google-play.md`, secao 6 - a mesma fonte que
 * `49-conferir-textos-loja.ps1` mede. Duplicar os textos aqui criaria duas versoes para
 * divergir, e a que vai para a loja seria a que ninguem revisa.
 *
 * Uso:
 *   node 53-publicar-ficha-play.mjs opendriverhub opendriverads
 *   node 53-publicar-ficha-play.mjs opendriverhub --sem-aab    (so ficha e imagens)
 */
import { createSign } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CHAVE_PADRAO =
  'C:\\Users\\Ludimila\\Documents\\google\\lateral-pillar-454914-g5-dedafcca49ac.json';

const RAIZ = 'd:\\Projetos\\openad';
const FICHA = join(RAIZ, 'docs', 'lojas', 'ficha-google-play.md');
const ARTE = join(RAIZ, 'docs', 'lojas', 'google-play');

const IDIOMA = 'pt-BR';
const FAIXA = 'internal';

const CONTATO = {
  contactEmail: 'murilogillbert@gmail.com',
  contactWebsite: 'https://opendriver.com.br',
};

const APPS = {
  opendriver: {
    pacote: 'br.com.opendriver.app',
    secao: '6.1',
    aab: 'd:\\Projetos\\opendriver\\mobile\\android\\app\\build\\outputs\\bundle\\release\\app-release.aab',
    icone: join(ARTE, 'opendriver-icone-512.png'),
    destaque: join(ARTE, 'opendriver-destaque-1024x500.png'),
  },
  opendriverhub: {
    pacote: 'br.com.opendriverhub.app',
    secao: '6.2',
    aab: 'd:\\Projetos\\hub-mobile\\android\\app\\build\\outputs\\bundle\\release\\app-release.aab',
    icone: join(ARTE, 'opendriverhub-icone-512.png'),
    destaque: join(ARTE, 'opendriverhub-destaque-1024x500.png'),
  },
  opendriverads: {
    pacote: 'br.com.opendriver.ads',
    secao: '6.3',
    aab: 'd:\\Projetos\\openad\\app\\openad-advertiser\\android\\app\\build\\outputs\\bundle\\release\\app-release.aab',
    icone: join(ARTE, 'opendriverads-icone-512.png'),
    destaque: join(ARTE, 'opendriverads-destaque-1024x500.png'),
  },
};

const LIMITES = { title: 30, shortDescription: 80, fullDescription: 4000 };

// ---------------------------------------------------------------- argumentos

const argv = process.argv.slice(2);
const semAab = argv.includes('--sem-aab');
const alvos = argv.filter((a) => !a.startsWith('--'));
if (!alvos.length) {
  console.error('uso: node 53-publicar-ficha-play.mjs <app> [app...] [--sem-aab]');
  console.error(`apps: ${Object.keys(APPS).join(', ')}`);
  process.exit(1);
}
for (const a of alvos) {
  if (!APPS[a]) {
    console.error(`app desconhecido: ${a}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- textos

/**
 * Extrai titulo, breve descricao e descricao completa da secao 6.x do documento.
 *
 * O documento tem um bloco de codigo por campo, na ordem nome / breve / completa. A secao 6.3
 * tem um paragrafo entre o primeiro e o segundo bloco (a alternativa de nome), e por isso a
 * leitura e por ordem de ocorrencia dentro da secao, nao por posicao fixa.
 */
function textosDaFicha(secao) {
  const doc = readFileSync(FICHA, 'utf8');
  const re = new RegExp(`^### ${secao.replace('.', '\\.')} (.+?)\\r?\\n([\\s\\S]*?)(?=^### |^---)`, 'm');
  const m = doc.match(re);
  if (!m) throw new Error(`secao ${secao} nao encontrada em ${FICHA}`);

  const blocos = [...m[2].matchAll(/^```\r?\n([\s\S]*?)\r?\n```/gm)].map((b) => b[1]);
  if (blocos.length < 3) {
    throw new Error(`secao ${secao}: esperava 3 blocos de texto, achei ${blocos.length}`);
  }

  const textos = {
    title: blocos[0].trim(),
    shortDescription: blocos[1].trim(),
    fullDescription: blocos[2],
  };

  for (const [campo, limite] of Object.entries(LIMITES)) {
    if (textos[campo].length > limite) {
      throw new Error(`secao ${secao}: ${campo} tem ${textos[campo].length} caracteres (limite ${limite})`);
    }
  }
  return textos;
}

// ---------------------------------------------------------------- auth

const b64 = (b) =>
  Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

async function obterToken(chave) {
  const agora = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const p = b64(
    JSON.stringify({
      iss: chave.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      iat: agora,
      exp: agora + 3600,
    })
  );
  const s = createSign('RSA-SHA256').update(`${h}.${p}`).sign(chave.private_key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${h}.${p}.${b64(s)}`,
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`OAuth ${res.status}: ${j.error_description ?? j.error}`);
  return j.access_token;
}

// ---------------------------------------------------------------- http

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const UPLOAD = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications';

async function chamar(url, { metodo = 'GET', corpo, token, bytes, tipo } = {}) {
  const cabecalhos = { Authorization: `Bearer ${token}` };
  let body;
  if (bytes) {
    cabecalhos['Content-Type'] = tipo;
    cabecalhos['Content-Length'] = String(bytes.length);
    body = bytes;
  } else if (corpo !== undefined) {
    cabecalhos['Content-Type'] = 'application/json';
    body = JSON.stringify(corpo);
  }
  const res = await fetch(url, { method: metodo, headers: cabecalhos, body });
  const texto = await res.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = { bruto: texto.slice(0, 400) };
  }
  if (!res.ok) {
    const msg = json?.error?.message ?? JSON.stringify(json).slice(0, 400);
    throw new Error(`${metodo} ${url.replace(/^https:\/\/[^/]+/, '')} -> ${res.status}: ${msg}`);
  }
  return json;
}

// ---------------------------------------------------------------- execucao

const cores = { ok: '\x1b[32m', erro: '\x1b[31m', aviso: '\x1b[33m', fim: '\x1b[0m' };
const ok = (t) => console.log(`  ${cores.ok}ok${cores.fim}    ${t}`);
const aviso = (t) => console.log(`  ${cores.aviso}aviso${cores.fim} ${t}`);

const chave = JSON.parse(readFileSync(process.env.PLAY_KEY ?? CHAVE_PADRAO, 'utf8'));
const token = await obterToken(chave);

let falhou = 0;

for (const alvo of alvos) {
  const app = APPS[alvo];
  const base = `${API}/${app.pacote}`;
  const subida = `${UPLOAD}/${app.pacote}`;
  console.log(`\n=== ${alvo}  (${app.pacote})`);

  try {
    /**
     * Tudo que vem do disco e lido **antes** de abrir a edicao.
     *
     * A edicao do Play tem validade curta, e ler 87 MB de disco enquanto a edicao esta aberta
     * ja custou um `This edit has expired, please create a new Edit` no meio de um envio que
     * levou 76 segundos. Com os bytes em memoria, o unico tempo gasto dentro da edicao e o da
     * rede.
     */
    const textos = textosDaFicha(app.secao);
    const icone = readFileSync(app.icone);
    const destaque = readFileSync(app.destaque);
    let aab = null;
    if (!semAab) {
      aab = readFileSync(app.aab);
      ok(`AAB lido: ${(statSync(app.aab).size / 1024 / 1024).toFixed(1)} MB`);
    }
    ok(`textos da secao ${app.secao}: "${textos.title}" / ${textos.shortDescription.length} / ${textos.fullDescription.length} caracteres`);

    const { id: edicao } = await chamar(`${base}/edits`, { metodo: 'POST', token });
    ok(`edicao aberta: ${edicao}`);

    try {
      // 1) Bundle primeiro: e a operacao longa, e a que mais sofre com edicao expirando.
      if (aab) {
        const t0 = Date.now();
        const b = await chamar(`${subida}/edits/${edicao}/bundles?uploadType=media`, {
          metodo: 'POST',
          token,
          bytes: aab,
          tipo: 'application/octet-stream',
        });
        ok(`bundle enviado: versionCode ${b.versionCode} em ${Math.round((Date.now() - t0) / 1000)} s`);

        await chamar(`${base}/edits/${edicao}/tracks/${FAIXA}`, {
          metodo: 'PUT',
          token,
          corpo: {
            track: FAIXA,
            releases: [
              {
                versionCodes: [String(b.versionCode)],
                status: 'completed',
                releaseNotes: [
                  {
                    language: IDIOMA,
                    text: 'Primeira versao publica. Correcoes de permissoes e paginas legais proprias.',
                  },
                ],
              },
            ],
          },
        });
        ok(`faixa ${FAIXA} aponta para versionCode ${b.versionCode}`);
      }

      // 2) Ficha de texto.
      await chamar(`${base}/edits/${edicao}/listings/${IDIOMA}`, {
        metodo: 'PUT',
        token,
        corpo: { language: IDIOMA, ...textos },
      });
      ok(`ficha ${IDIOMA} gravada`);

      // 3) Imagens. `deleteall` antes de subir: icone e recurso grafico aceitam **um** arquivo
      //    cada, e subir sem limpar devolve erro de limite em vez de substituir.
      for (const [tipo, bytes, arquivo] of [
        ['icon', icone, app.icone],
        ['featureGraphic', destaque, app.destaque],
      ]) {
        await chamar(`${base}/edits/${edicao}/listings/${IDIOMA}/${tipo}`, { metodo: 'DELETE', token });
        const r = await chamar(`${subida}/edits/${edicao}/listings/${IDIOMA}/${tipo}?uploadType=media`, {
          metodo: 'POST',
          token,
          bytes,
          tipo: 'image/png',
        });
        ok(`${tipo}: ${arquivo.split('\\').pop()} (${r.image?.sha256 ? 'sha256 confirmado' : 'enviado'})`);
      }

      // 4) Dados de contato. PUT substitui o recurso, por isso o idioma padrao vai junto -
      //    omiti-lo apagaria a configuracao de idioma padrao do app.
      await chamar(`${base}/edits/${edicao}/details`, {
        metodo: 'PUT',
        token,
        corpo: { defaultLanguage: IDIOMA, ...CONTATO },
      });
      ok(`contato: ${CONTATO.contactEmail} / ${CONTATO.contactWebsite}`);

      // 5) Valida a edicao antes de publicar: `validate` roda as mesmas verificacoes do
      //    `commit` sem gravar, e devolve a mensagem de erro com a edicao ainda intacta.
      await chamar(`${base}/edits/${edicao}:validate`, { metodo: 'POST', token });
      ok('edicao validada');

      await chamar(`${base}/edits/${edicao}:commit`, { metodo: 'POST', token });
      ok('edicao publicada');
    } catch (e) {
      await chamar(`${base}/edits/${edicao}`, { metodo: 'DELETE', token }).catch(() => {});
      throw e;
    }
  } catch (e) {
    falhou += 1;
    console.log(`  ${cores.erro}FALHOU${cores.fim} ${e.message}`);
  }
}

console.log('');
if (falhou) {
  console.log(`${cores.erro}${falhou} app(s) com erro.${cores.fim}`);
  process.exit(1);
}
console.log(`${cores.ok}Pronto. Confira com: node 52-ler-ficha-play.mjs${cores.fim}`);
console.log(
  `${cores.aviso}Falta, e so pela interface:${cores.fim} capturas de tela (minimo 2) e toda a secao "Conteudo do app".`
);
