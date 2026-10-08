import { Injectable } from '@angular/core';

export interface ResumableDownloadOptions {
  /** Pedacos ja baixados, em ordem. A soma deles **e** o offset. */
  loadPartial: () => Promise<ArrayBuffer[]>;
  /** Acrescenta um pedaco e devolve o total de bytes guardados. */
  appendPartial: (chunk: ArrayBuffer) => Promise<number>;
  /** Apaga o parcial (recomeco do zero, ou conclusao). */
  clearPartial: () => Promise<void>;
  /**
   * Pede uma URL nova quando o storage responde `403`.
   *
   * A URL do manifesto e pre-assinada e vale 1 h. Uma retomada depois disso recebe `403` com
   * `InvalidAccessKeyId` — conferido contra `storage.opendriver.com.br` em 2026-10-09. Sem este
   * gancho, o download morria ali e o tablete ficava sem o criativo ate o ciclo seguinte.
   *
   * Devolver `null` significa "nao consegui renovar": o erro sobe e a retentativa do
   * `DownloadManagerService` decide.
   */
  refreshUrl?: () => Promise<string | null>;
  fetchFn?: typeof fetch;
}

/**
 * Download com `Range`, retomando de onde parou.
 *
 * ============================================================================
 * O defeito que este arquivo tinha
 * ============================================================================
 *
 * A versao anterior guardava **somente o offset**; os bytes ficavam num vetor local
 * (`parts: Uint8Array[]`) que nascia vazio a cada chamada. Na retomada, `getOffset()` devolvia,
 * digamos, 5 MB, o laco pedia `bytes=5242880-`, recebia a cauda, e `concat(parts)` devolvia
 * **apenas a cauda** — sem os 5 MB do inicio.
 *
 * O `DownloadManagerService` conferia o SHA-256, nao fechava, apagava o offset e tentava de
 * novo do zero. Resultado: a retomada custava um download parcial perdido **mais** um download
 * inteiro, e nunca retomava. Nada falhava de forma visivel, que e exatamente por que isso
 * sobreviveu — e nao havia teste deste arquivo.
 *
 * O conserto e guardar os bytes, nao o numero. O offset passa a ser **derivado** do tamanho do
 * que esta guardado, de modo que nao existe o estado em que o offset aponta para alem dos bytes
 * que temos.
 *
 * ============================================================================
 * Sobre o `Content-Range`
 * ============================================================================
 *
 * Medido em 2026-10-09 contra `storage.opendriver.com.br`: o MinIO responde `206` com
 * `content-range` e expoe `Content-Range`, `Accept-Ranges`, `Content-Length` e `Etag` em
 * `access-control-expose-headers`, e o preflight aceita `range`. Ou seja, o CORS **nao** e o
 * problema que se suspeitava.
 *
 * Ainda assim o total passou a ser lido de `Content-Range` **ou** de `Content-Length`: se um dia
 * o cabecalho ficar ilegivel, o laco antes nao tinha como saber que terminou, pedia
 * `bytes=<tamanho>-`, levava `416` e recomecava tudo.
 */
@Injectable({ providedIn: 'root' })
export class ResumableDownloadService {
  async downloadToBuffer(url: string, opts: ResumableDownloadOptions): Promise<ArrayBuffer> {
    const fetchFn = opts.fetchFn ?? fetch;
    let enderecoAtual = url;
    let renovou = false;

    let offset = this.somaDe(await opts.loadPartial());

    /**
     * Sinal de retomada, em log estruturado.
     *
     * Existe porque a falha anterior era **silenciosa**: a retomada não retomava e o único
     * sintoma era consumo de rede. Com esta linha, `adb logcat | grep download.` responde
     * "retomou de onde?" sem depurador — e foi assim que a correção foi verificada no tablete.
     */
    if (offset > 0) {
      console.info(JSON.stringify({ event: 'download.retomando', offset }));
    }

    while (true) {
      const headers: Record<string, string> = {};
      if (offset > 0) {
        headers['Range'] = `bytes=${offset}-`;
      }
      const res = await fetchFn(enderecoAtual, { headers });

      console.info(
        JSON.stringify({
          event: 'download.resposta',
          status: res.status,
          pediuRange: offset > 0,
          contentRange: res.headers.get('Content-Range'),
          offset,
        })
      );

      /**
       * `416` significa que o offset passou do fim do arquivo — o parcial guardado nao serve
       * (arquivo trocado no servidor, ou gravacao parcial). Recomeca limpando os bytes, e nao
       * so o numero.
       */
      if (res.status === 416 && offset > 0) {
        await opts.clearPartial();
        offset = 0;
        continue;
      }

      /**
       * `403` e URL pre-assinada vencida. Renova **uma vez** por chamada: renovar em laco
       * transformaria uma credencial errada num pedido infinito ao manifesto.
       */
      if (res.status === 403 && opts.refreshUrl && !renovou) {
        renovou = true;
        const nova = await opts.refreshUrl();
        if (nova) {
          enderecoAtual = nova;
          continue;
        }
      }

      if (!res.ok && res.status !== 206) {
        throw new Error(`HTTP ${res.status}`);
      }

      /**
       * `200` com offset — o servidor ignorou o `Range` e mandou o arquivo inteiro.
       *
       * Acontece de verdade (proxy que nao repassa `Range`). O corpo recebido e o arquivo
       * completo, entao o parcial guardado tem de ser **descartado**: junta-lo produziria um
       * arquivo com o prefixo duplicado, e o hash so pegaria isso depois de gravar.
       */
      if (res.status === 200) {
        if (offset > 0) {
          await opts.clearPartial();
        }
        const buf = await res.arrayBuffer();
        await opts.appendPartial(buf);
        const inteiro = await this.montar(opts);
        await opts.clearPartial();
        return inteiro;
      }

      const chunk = await res.arrayBuffer();
      if (chunk.byteLength === 0) {
        /**
         * `206` sem bytes nao avanca nada. Sem esta saida o laco giraria para sempre pedindo o
         * mesmo trecho.
         */
        throw new Error('resposta 206 sem conteudo');
      }
      offset = await opts.appendPartial(chunk);

      const total =
        this.totalDoContentRange(res.headers.get('Content-Range')) ??
        this.totalDoContentLength(res.headers.get('Content-Length'), chunk.byteLength, offset);

      if (total !== null && offset >= total) {
        const inteiro = await this.montar(opts);
        await opts.clearPartial();
        console.info(
          JSON.stringify({ event: 'download.concluido', bytes: inteiro.byteLength })
        );
        return inteiro;
      }
    }
  }

  /** Le o total de `bytes 0-99/855019`. */
  private totalDoContentRange(header: string | null): number | null {
    if (!header) {
      return null;
    }
    const m = /\/(\d+)/.exec(header);
    return m?.[1] ? Number(m[1]) : null;
  }

  /**
   * Total a partir do `Content-Length` desta resposta.
   *
   * Em `206`, `Content-Length` e o tamanho **do trecho**, nao do arquivo. Como o pedido foi
   * `bytes=<inicio>-` (aberto a direita), o trecho vai ate o fim do arquivo — entao o offset
   * depois de gravar ja e o total. Serve so como rede de seguranca para `Content-Range`
   * ilegivel; com ele presente, este caminho nao e usado.
   */
  private totalDoContentLength(
    header: string | null,
    tamanhoDoTrecho: number,
    offsetDepois: number
  ): number | null {
    if (!header) {
      return null;
    }
    const n = Number(header);
    return Number.isFinite(n) && n === tamanhoDoTrecho ? offsetDepois : null;
  }

  private somaDe(pedacos: ArrayBuffer[]): number {
    return pedacos.reduce((a, p) => a + p.byteLength, 0);
  }

  /** Junta os pedacos guardados num arquivo so. */
  private async montar(opts: ResumableDownloadOptions): Promise<ArrayBuffer> {
    const pedacos = await opts.loadPartial();
    if (pedacos.length === 0) {
      throw new Error('parcial desapareceu antes de montar o arquivo');
    }
    const total = this.somaDe(pedacos);
    const saida = new Uint8Array(total);
    let o = 0;
    for (const p of pedacos) {
      saida.set(new Uint8Array(p), o);
      o += p.byteLength;
    }
    return saida.buffer;
  }
}
