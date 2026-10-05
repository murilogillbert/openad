import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { PlayRecordPayload } from '@openad/api-contracts';

const PENDING_FILE = 'analytics/pending_plays.ndjson';
const LS_KEY = 'openad_analytics_pending_plays_v2';

/** Teto de registros guardados localmente. */
const MAX_ROWS = 2000;

interface PendingRow extends PlayRecordPayload {
  uploaded: 0 | 1;
  createdAt: string;
}

/**
 * Buffer durável de play records, em NDJSON (um JSON por linha).
 *
 * Era um unico documento JSON reescrito por inteiro a cada `enqueuePlay`. Com o teto de
 * 2000 registros isso dava comportamento quadratico — serializar e desserializar a lista
 * inteira a cada veiculacao — e, num tablet, amplificacao de escrita em flash, que e o
 * componente que falha primeiro. O proprio teste de teto estourava o timeout.
 *
 * Append resolve as duas coisas: custo constante por registro e persistencia imediata, que
 * importa porque num carro o desligamento normal **e** o corte de energia. Reescrita total
 * acontece so na compactacao, que roda quando lote sobe ou quando o teto e atingido.
 */
@Injectable()
export class PlayRecordBufferService {
  private readonly platformId = inject(PLATFORM_ID);

  /** Numero de linhas gravadas, para decidir compactacao sem reler o arquivo. */
  private rowCount: number | null = null;

  /** Memoiza a criacao de `analytics/`: uma chamada por processo, nao uma por veiculacao. */
  private pastaPronta: Promise<void> | null = null;

  /**
   * Garante que `analytics/` existe antes de qualquer escrita.
   *
   * `Filesystem.appendFile` **nao aceita** `recursive` — o tipo e
   * `Omit<WriteFileOptions, 'recursive'>` — entao, ao contrario de `writeFile`, ele nao cria
   * o diretorio pai e falha com `OS-PLUG-FILE-0011` ("Missing parent directory"). Em um
   * aparelho novo a pasta nunca existia, porque `writeRows` (que passa `recursive: true`) so
   * roda na compactacao, e a compactacao depende de ja haver linhas.
   *
   * O custo disso foi total: `enqueuePlay` lancava, a excecao morria no `catch` de
   * `recordManifestPlayCommitted` ("analytics buffer must not break playback"), e **toda**
   * veiculacao faturavel era perdida. O tablete exibia anuncio, o laco girava, e
   * `play_records` ficava em zero sem um unico erro visivel — nem no log do aparelho, nem no
   * servidor.
   */
  private async garantirPasta(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    this.pastaPronta ??= (async () => {
      try {
        await Filesystem.mkdir({
          path: 'analytics',
          directory: Directory.Data,
          recursive: true,
        });
      } catch {
        // Ja existe. O plugin nao distingue isso de falha real no codigo de erro, e tentar
        // criar de novo e inofensivo, entao nao ha o que tratar aqui.
      }
    })();
    return this.pastaPronta;
  }

  async enqueuePlay(record: PlayRecordPayload): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const row: PendingRow = {
      ...record,
      uploaded: 0,
      createdAt: new Date().toISOString(),
    };
    await this.appendLine(JSON.stringify(row));

    if (this.rowCount === null) {
      this.rowCount = (await this.readRows()).length;
    } else {
      this.rowCount += 1;
    }

    if (this.rowCount > MAX_ROWS) {
      await this.compact();
    }
  }

  async peekPendingNotUploaded(limit: number): Promise<PendingRow[]> {
    if (!isPlatformBrowser(this.platformId)) {
      return [];
    }
    const rows = await this.readRows();
    return rows.filter((p) => p.uploaded === 0).slice(0, limit);
  }

  /**
   * Marca como enviados e **remove** as linhas correspondentes.
   *
   * Antes so virava a flag, sem remover: as linhas enviadas continuavam ocupando o teto de
   * 2000, e o corte por teto descartava os registros mais antigos **ainda nao enviados**.
   * Um veiculo muito tempo sem rede perdia veiculacao faturavel sem nenhum sinal.
   */
  async markUploaded(uniqueEventIds: string[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || uniqueEventIds.length === 0) {
      return;
    }
    const sent = new Set(uniqueEventIds);
    const rows = await this.readRows();
    const kept = rows.filter((p) => !sent.has(p.uniqueEventId));
    if (kept.length === rows.length) {
      return;
    }
    await this.writeRows(kept);
  }

  /** Total guardado, incluindo o que ja subiu e ainda nao foi compactado. */
  async count(): Promise<number> {
    if (!isPlatformBrowser(this.platformId)) {
      return 0;
    }
    return (await this.readRows()).length;
  }

  /**
   * Aplica o teto descartando primeiro o que ja subiu e, so depois, o mais antigo ainda
   * pendente — nessa ordem, perder dado faturavel e o ultimo recurso.
   */
  private async compact(): Promise<void> {
    const rows = await this.readRows();
    const pending = rows.filter((p) => p.uploaded === 0);
    const kept =
      pending.length <= MAX_ROWS
        ? pending
        : pending.slice(pending.length - MAX_ROWS);
    await this.writeRows(kept);
  }

  private async readRows(): Promise<PendingRow[]> {
    const text = await this.readRaw();
    if (!text) {
      this.rowCount = 0;
      return [];
    }
    const rows: PendingRow[] = [];
    for (const line of text.split('\n')) {
      if (line.length === 0) {
        continue;
      }
      try {
        rows.push(JSON.parse(line) as PendingRow);
      } catch {
        // Linha truncada por corte de energia no meio da escrita: descarta so ela.
      }
    }
    this.rowCount = rows.length;
    return rows;
  }

  private async writeRows(rows: PendingRow[]): Promise<void> {
    const text = rows.map((r) => JSON.stringify(r)).join('\n');
    const data = text.length > 0 ? `${text}\n` : '';
    if (Capacitor.isNativePlatform()) {
      await this.garantirPasta();
      await Filesystem.writeFile({
        path: PENDING_FILE,
        directory: Directory.Data,
        data,
        encoding: Encoding.UTF8,
        recursive: true,
      });
    } else {
      try {
        globalThis.localStorage?.setItem(LS_KEY, data);
      } catch {
        /* ignore */
      }
    }
    this.rowCount = rows.length;
  }

  private async appendLine(line: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await this.garantirPasta();
      await Filesystem.appendFile({
        path: PENDING_FILE,
        directory: Directory.Data,
        data: `${line}\n`,
        encoding: Encoding.UTF8,
      });
      return;
    }
    try {
      const prev = globalThis.localStorage?.getItem(LS_KEY) ?? '';
      globalThis.localStorage?.setItem(LS_KEY, `${prev}${line}\n`);
    } catch {
      /* ignore */
    }
  }

  private async readRaw(): Promise<string> {
    if (Capacitor.isNativePlatform()) {
      try {
        const { data } = await Filesystem.readFile({
          path: PENDING_FILE,
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
        return typeof data === 'string' ? data : String(data);
      } catch {
        return '';
      }
    }
    try {
      return globalThis.localStorage?.getItem(LS_KEY) ?? '';
    } catch {
      return '';
    }
  }
}
