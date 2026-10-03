/**
 * Gera os PNG mínimos que o build nativo exige.
 *
 * Por que existe: `expo prebuild` **falha** se `icon`, `adaptiveIcon.foregroundImage` ou a
 * imagem do splash não existirem — não é aviso, é erro de build. Sem arte final, a alternativa
 * seria remover essas entradas do `app.config.ts` e esquecer de recolocá-las, ou copiar o ícone
 * do app do OpenDriver, que mostraria a marca errada numa loja.
 *
 * O que gera: quadrados sólidos na paleta do produto, com um bloco central contrastante — o
 * suficiente para o app instalar, abrir e ser reconhecível na gaveta durante os testes.
 * **Arte final substitui estes arquivos**; os nomes e tamanhos já estão certos.
 *
 * Sem dependência externa: codifica PNG na mão (IHDR + IDAT comprimido com zlib + IEND).
 * Instalar uma biblioteca de imagem para gerar quadrado de cor sólida seria desproporcional.
 *
 * Uso: npm run icones
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(AQUI, '..', 'assets');

const NAVY = [0x0a, 0x17, 0x26];
const LIME = [0xb5, 0xdc, 0x2f];
const BRANCO = [0xff, 0xff, 0xff];
const TRANSPARENTE = [0, 0, 0, 0];

// -------------------------------------------------------------------------- CRC32
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pedaco(tipo, dados) {
  const comprimento = Buffer.alloc(4);
  comprimento.writeUInt32BE(dados.length, 0);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo), 0);
  return Buffer.concat([comprimento, corpo, crc]);
}

/**
 * Codifica RGBA em PNG.
 *
 * Tipo de cor 6 (RGBA) sempre, mesmo quando a imagem é opaca: o canal alfa é obrigatório para
 * o ícone monocromático do Android, e usar um formato só evita dois caminhos de código.
 * Filtro 0 (nenhum) por linha — o `deflate` já reduz bem um quadrado de cor sólida.
 */
function png(largura, altura, pintar) {
  const bruto = Buffer.alloc(altura * (1 + largura * 4));
  let p = 0;
  for (let y = 0; y < altura; y++) {
    bruto[p++] = 0; // tipo de filtro da linha
    for (let x = 0; x < largura; x++) {
      const cor = pintar(x, y, largura, altura);
      bruto[p++] = cor[0];
      bruto[p++] = cor[1];
      bruto[p++] = cor[2];
      bruto[p++] = cor.length > 3 ? cor[3] : 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filtro adaptativo
  ihdr[12] = 0; // sem entrelaçamento

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', ihdr),
    pedaco('IDAT', deflateSync(bruto, { level: 9 })),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}

/** Fundo `fundo` com um retângulo arredondado de `frente` no meio. */
function marca(fundo, frente, escala = 0.42) {
  return (x, y, w, h) => {
    const meioX = w / 2;
    const meioY = h / 2;
    const lado = Math.min(w, h) * escala;
    const dx = Math.abs(x - meioX + 0.5);
    const dy = Math.abs(y - meioY + 0.5);
    const raio = lado * 0.22;
    const limiteX = lado / 2;
    const limiteY = lado / 2;

    let dentro;
    if (dx <= limiteX - raio || dy <= limiteY - raio) {
      dentro = dx <= limiteX && dy <= limiteY;
    } else {
      const ex = dx - (limiteX - raio);
      const ey = dy - (limiteY - raio);
      dentro = ex * ex + ey * ey <= raio * raio;
    }
    return dentro ? frente : fundo;
  };
}

/** Só a marca, fundo transparente — exigido pelo ícone adaptativo e pelo monocromático. */
function marcaTransparente(frente) {
  const base = marca(TRANSPARENTE, frente, 0.5);
  return (x, y, w, h) => base(x, y, w, h);
}

const arquivos = [
  // Ícone principal da loja e da gaveta.
  ['icon.png', 1024, marca(NAVY, LIME)],
  // Camada de frente do ícone adaptativo do Android: 1024 com a marca dentro da área segura
  // (o sistema recorta até 33% das bordas, daí a escala menor).
  ['android-icon-foreground.png', 1024, marcaTransparente(LIME)],
  // Versão monocromática (tema dinâmico do Android 13+): o sistema recolore, então só a
  // silhueta importa.
  ['android-icon-monochrome.png', 1024, marcaTransparente(BRANCO)],
  ['splash-icon.png', 512, marcaTransparente(LIME)],
  ['favicon.png', 48, marca(NAVY, LIME)],
];

mkdirSync(ASSETS, { recursive: true });
for (const [nome, tamanho, pintar] of arquivos) {
  const destino = join(ASSETS, nome);
  writeFileSync(destino, png(tamanho, tamanho, pintar));
  console.log(`gerado ${nome} (${tamanho}x${tamanho})`);
}
console.log('\nPlaceholder funcional. Substitua por arte final mantendo nomes e tamanhos.');
