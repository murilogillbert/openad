import { describe, expect, it, vi } from 'vitest';
import {
  ResumableDownloadService,
  type ResumableDownloadOptions,
} from './resumable-download.service';

/**
 * Retomada de download.
 *
 * ============================================================================
 * Por que este arquivo existe
 * ============================================================================
 *
 * Porque nao existia. `resumable-download.service.ts` nao tinha teste, e isso deixou passar um
 * defeito que tornava a retomada inutil: o offset era persistido mas os **bytes nao**, de modo
 * que retomar devolvia apenas a cauda do arquivo. O hash nao fechava, o parcial era descartado
 * e o arquivo inteiro baixava de novo — sem nada falhar de forma visivel.
 *
 * O caso `retomada entrega o arquivo inteiro` abaixo e exatamente o que faltava.
 */

/**
 * `ArrayBuffer` cru dos bytes.
 *
 * Necessario porque o TypeScript 5.7 distingue `Uint8Array<ArrayBufferLike>` de
 * `Uint8Array<ArrayBuffer>`, e `BlobPart`/`BodyInit` so aceitam o segundo. Cada vetor aqui e
 * alocado com o tamanho exato, entao `.buffer` e precisamente o conteudo.
 */
const cru = (u: Uint8Array): ArrayBuffer => u.buffer as ArrayBuffer;

/** Armazenamento em memoria com a mesma semantica do `DownloadProgressIdbService`. */
function armazem(inicial?: Uint8Array) {
  let pedacos: ArrayBuffer[] = inicial ? [cru(inicial)] : [];
  const soma = () => pedacos.reduce((a, p) => a + p.byteLength, 0);
  return {
    opts: {
      loadPartial: async () => pedacos,
      appendPartial: async (chunk: ArrayBuffer) => {
        pedacos = [...pedacos, chunk];
        return soma();
      },
      clearPartial: async () => {
        pedacos = [];
      },
    } satisfies Omit<ResumableDownloadOptions, 'fetchFn' | 'refreshUrl'>,
    tamanho: soma,
  };
}

const bytes = (de: number, ate: number) =>
  new Uint8Array(Array.from({ length: ate - de }, (_, i) => (de + i) % 256));

function resposta(
  corpo: Uint8Array,
  init: { status: number; headers?: Record<string, string> }
): Response {
  return new Response(corpo.length > 0 ? cru(corpo) : null, {
    status: init.status,
    headers: init.headers,
  });
}

const svc = new ResumableDownloadService();

describe('ResumableDownloadService', () => {
  it('download inteiro em uma resposta 200', async () => {
    const a = armazem();
    const todos = bytes(0, 100);
    const fetchFn = vi.fn(async () => resposta(todos, { status: 200 }));

    const buf = await svc.downloadToBuffer('u', { ...a.opts, fetchFn: fetchFn as never });

    expect(new Uint8Array(buf)).toEqual(todos);
    // Sem `Range` no primeiro pedido: nao havia nada guardado.
    expect((fetchFn.mock.calls[0] as unknown[])[1]).toEqual({ headers: {} });
    // Parcial limpo no fim: deixá-lo faria o download seguinte do mesmo arquivo "retomar" de um
    // download que já terminou.
    expect(a.tamanho()).toBe(0);
  });

  it('retomada entrega o arquivo INTEIRO, nao so a cauda', async () => {
    /**
     * O defeito original. Com 40 bytes guardados, a versao antiga devolvia apenas os 60 da
     * cauda — e o chamador gravava um arquivo sem o inicio.
     */
    const prefixo = bytes(0, 40);
    const a = armazem(prefixo);
    const cauda = bytes(40, 100);
    const fetchFn = vi.fn(async () =>
      resposta(cauda, {
        status: 206,
        headers: { 'Content-Range': 'bytes 40-99/100' },
      })
    );

    const buf = await svc.downloadToBuffer('u', { ...a.opts, fetchFn: fetchFn as never });

    expect(buf.byteLength).toBe(100);
    expect(new Uint8Array(buf)).toEqual(bytes(0, 100));
    // Pediu a partir de onde parou.
    expect((fetchFn.mock.calls[0] as unknown[])[1]).toEqual({
      headers: { Range: 'bytes=40-' },
    });
  });

  it('junta varios pedacos ate o total do Content-Range', async () => {
    const a = armazem();
    const respostas = [
      resposta(bytes(0, 30), { status: 206, headers: { 'Content-Range': 'bytes 0-29/90' } }),
      resposta(bytes(30, 60), { status: 206, headers: { 'Content-Range': 'bytes 30-59/90' } }),
      resposta(bytes(60, 90), { status: 206, headers: { 'Content-Range': 'bytes 60-89/90' } }),
    ];
    let i = 0;
    const fetchFn = vi.fn(async () => respostas[i++]!);

    const buf = await svc.downloadToBuffer('u', { ...a.opts, fetchFn: fetchFn as never });

    expect(new Uint8Array(buf)).toEqual(bytes(0, 90));
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('416 descarta os bytes guardados e recomeca', async () => {
    /**
     * `416` significa que o offset passou do fim — arquivo trocado no servidor, ou gravacao
     * parcial. Limpar **os bytes**, e nao so o numero, e o que impede o recomeco de montar um
     * arquivo com prefixo velho.
     */
    const a = armazem(bytes(0, 200));
    const todos = bytes(0, 50);
    let chamada = 0;
    const fetchFn = vi.fn(async () => {
      chamada += 1;
      if (chamada === 1) return resposta(new Uint8Array(), { status: 416 });
      return resposta(todos, { status: 200 });
    });

    const buf = await svc.downloadToBuffer('u', { ...a.opts, fetchFn: fetchFn as never });

    expect(new Uint8Array(buf)).toEqual(todos);
    // O segundo pedido saiu sem `Range`, porque o parcial foi descartado.
    expect((fetchFn.mock.calls[1] as unknown[])[1]).toEqual({ headers: {} });
  });

  it('200 com offset descarta o parcial em vez de duplicar o prefixo', async () => {
    /**
     * Acontece quando um proxy nao repassa o `Range`: o corpo e o arquivo inteiro. Juntar ao
     * parcial produziria um arquivo com o inicio duplicado, e o hash so pegaria isso depois de
     * gravar.
     */
    const a = armazem(bytes(0, 40));
    const todos = bytes(0, 100);
    const fetchFn = vi.fn(async () => resposta(todos, { status: 200 }));

    const buf = await svc.downloadToBuffer('u', { ...a.opts, fetchFn: fetchFn as never });

    expect(buf.byteLength).toBe(100);
    expect(new Uint8Array(buf)).toEqual(todos);
  });

  it('403 renova a URL e continua de onde parou', async () => {
    /**
     * A URL pre-assinada do manifesto vale 1 h; conferido contra o storage em 2026-10-09, uma
     * assinatura vencida responde `403 InvalidAccessKeyId`.
     */
    const a = armazem(bytes(0, 40));
    const cauda = bytes(40, 100);
    const vistos: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      vistos.push(url);
      if (url === 'vencida') return resposta(new Uint8Array(), { status: 403 });
      return resposta(cauda, {
        status: 206,
        headers: { 'Content-Range': 'bytes 40-99/100' },
      });
    });
    const refreshUrl = vi.fn(async () => 'nova');

    const buf = await svc.downloadToBuffer('vencida', {
      ...a.opts,
      refreshUrl,
      fetchFn: fetchFn as never,
    });

    expect(new Uint8Array(buf)).toEqual(bytes(0, 100));
    expect(vistos).toEqual(['vencida', 'nova']);
    // Os bytes já baixados são preservados: a renovação não é um recomeço.
    expect(refreshUrl).toHaveBeenCalledTimes(1);
  });

  it('403 renova no maximo uma vez', async () => {
    /**
     * Credencial errada (nao vencida) responderia `403` para sempre. Renovar em laco viraria um
     * pedido infinito ao manifesto.
     */
    const a = armazem();
    const fetchFn = vi.fn(async () => resposta(new Uint8Array(), { status: 403 }));
    const refreshUrl = vi.fn(async () => 'outra');

    await expect(
      svc.downloadToBuffer('u', { ...a.opts, refreshUrl, fetchFn: fetchFn as never })
    ).rejects.toThrow('HTTP 403');
    expect(refreshUrl).toHaveBeenCalledTimes(1);
  });

  it('403 sem conseguir renovar propaga o erro', async () => {
    const a = armazem();
    const fetchFn = vi.fn(async () => resposta(new Uint8Array(), { status: 403 }));
    // `null` = "nao consegui renovar". A retentativa do DownloadManagerService decide.
    const refreshUrl = vi.fn(async () => null);

    await expect(
      svc.downloadToBuffer('u', { ...a.opts, refreshUrl, fetchFn: fetchFn as never })
    ).rejects.toThrow('HTTP 403');
  });

  it('sem Content-Range legivel, usa o Content-Length para saber que terminou', async () => {
    /**
     * Rede de seguranca. O CORS do storage expõe `Content-Range` (medido em 2026-10-09), mas se
     * um dia ficar ilegivel o laco antes nao tinha como saber que acabou: pedia
     * `bytes=<tamanho>-`, levava `416` e recomecava o arquivo inteiro.
     */
    const a = armazem();
    const todos = bytes(0, 70);
    const fetchFn = vi.fn(async () =>
      resposta(todos, { status: 206, headers: { 'Content-Length': '70' } })
    );

    const buf = await svc.downloadToBuffer('u', { ...a.opts, fetchFn: fetchFn as never });

    expect(new Uint8Array(buf)).toEqual(todos);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('206 sem conteudo falha em vez de girar para sempre', async () => {
    const a = armazem(bytes(0, 10));
    const fetchFn = vi.fn(async () =>
      resposta(new Uint8Array(), {
        status: 206,
        headers: { 'Content-Range': 'bytes 10-10/100' },
      })
    );

    await expect(
      svc.downloadToBuffer('u', { ...a.opts, fetchFn: fetchFn as never })
    ).rejects.toThrow(/206 sem conteudo/);
  });

  it('erro de rede deixa os bytes guardados para a proxima tentativa', async () => {
    /**
     * É o ponto da retomada: a queda no meio do download **não** pode descartar o que já veio,
     * senão cortar a rede num vídeo grande recomeça do zero toda vez.
     */
    const a = armazem();
    let chamada = 0;
    const fetchFn = vi.fn(async () => {
      chamada += 1;
      if (chamada === 1) {
        return resposta(bytes(0, 30), {
          status: 206,
          headers: { 'Content-Range': 'bytes 0-29/100' },
        });
      }
      throw new TypeError('Failed to fetch');
    });

    await expect(
      svc.downloadToBuffer('u', { ...a.opts, fetchFn: fetchFn as never })
    ).rejects.toThrow();
    expect(a.tamanho()).toBe(30);

    // A tentativa seguinte retoma de 30 e completa.
    const fetch2 = vi.fn(async () =>
      resposta(bytes(30, 100), {
        status: 206,
        headers: { 'Content-Range': 'bytes 30-99/100' },
      })
    );
    const buf = await svc.downloadToBuffer('u', { ...a.opts, fetchFn: fetch2 as never });
    expect(new Uint8Array(buf)).toEqual(bytes(0, 100));
    expect((fetch2.mock.calls[0] as unknown[])[1]).toEqual({
      headers: { Range: 'bytes=30-' },
    });
  });

  it('outros erros HTTP propagam', async () => {
    const a = armazem();
    const fetchFn = vi.fn(async () => resposta(new Uint8Array(), { status: 500 }));
    await expect(
      svc.downloadToBuffer('u', { ...a.opts, fetchFn: fetchFn as never })
    ).rejects.toThrow('HTTP 500');
  });
});
