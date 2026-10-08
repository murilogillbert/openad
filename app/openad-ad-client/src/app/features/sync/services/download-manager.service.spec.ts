import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResumableDownloadService } from '../../../services/sync/resumable-download.service';
import { DownloadProgressIdbService } from './download-progress-idb.service';
import { DownloadManagerService } from './download-manager.service';
import { HashVerifierService } from './hash-verifier.service';

describe('DownloadManagerService', () => {
  let svc: DownloadManagerService;
  let resumable: { downloadToBuffer: ReturnType<typeof vi.fn> };
  let idb: {
    getPartial: ReturnType<typeof vi.fn>;
    appendPartial: ReturnType<typeof vi.fn>;
    clearPartial: ReturnType<typeof vi.fn>;
  };
  let hashes: { verifyHex: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    resumable = { downloadToBuffer: vi.fn() };
    /**
     * O armazenamento passou a guardar **bytes**, não só o offset.
     *
     * Antes só o número era persistido, e a retomada devolvia apenas a cauda do arquivo: o
     * hash não fechava e tudo baixava de novo. O conjunto de métodos aqui espelha essa
     * mudança — ver a nota em `resumable-download.service.ts`.
     */
    idb = {
      getPartial: vi.fn().mockResolvedValue(null),
      appendPartial: vi.fn().mockResolvedValue(0),
      clearPartial: vi.fn().mockResolvedValue(undefined),
    };
    hashes = { verifyHex: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        DownloadManagerService,
        { provide: ResumableDownloadService, useValue: resumable },
        { provide: DownloadProgressIdbService, useValue: idb },
        { provide: HashVerifierService, useValue: hashes },
      ],
    });
    svc = TestBed.inject(DownloadManagerService);
  });

  const pedido = (over: Record<string, unknown> = {}) => ({
    url: 'https://example.com/f',
    mediaId: 'm1',
    expectedHash: 'abc',
    expectedSize: 2,
    maxAttempts: 2,
    baseDelayMs: 1,
    ...over,
  });

  it('devolve o buffer quando o download e o hash fecham', async () => {
    const buf = new TextEncoder().encode('ok').buffer;
    resumable.downloadToBuffer.mockResolvedValue(buf);
    hashes.verifyHex.mockResolvedValue(true);

    const out = await svc.downloadVerifiedMedia(pedido());

    expect(out.byteLength).toBe(2);
    /**
     * O parcial **não** é apagado aqui no caminho de sucesso: quem apaga é o
     * `downloadToBuffer`, depois de montar o arquivo. Apagar nos dois lugares faria o segundo
     * operar sobre um registro que já não existe.
     */
    expect(idb.clearPartial).not.toHaveBeenCalled();
  });

  it('hash errado apaga os bytes guardados antes de tentar de novo', async () => {
    /**
     * Sem isto, a tentativa seguinte retomaria de cima de um arquivo que já se sabe corrompido
     * e falharia igual — gastando as cinco tentativas sem nunca baixar de verdade.
     */
    const buf = new TextEncoder().encode('ok').buffer;
    resumable.downloadToBuffer.mockResolvedValue(buf);
    hashes.verifyHex.mockResolvedValue(false);

    await expect(svc.downloadVerifiedMedia(pedido())).rejects.toThrow('hash_mismatch');
    expect(idb.clearPartial).toHaveBeenCalledWith('m1');
  });

  it('tamanho errado tambem apaga os bytes guardados', async () => {
    const buf = new TextEncoder().encode('ok').buffer;
    resumable.downloadToBuffer.mockResolvedValue(buf);
    hashes.verifyHex.mockResolvedValue(true);

    await expect(
      svc.downloadVerifiedMedia(pedido({ expectedSize: 999 }))
    ).rejects.toThrow('size_mismatch');
    expect(idb.clearPartial).toHaveBeenCalledWith('m1');
  });

  it('retenta com espera exponencial e entao conclui', async () => {
    const buf = new TextEncoder().encode('x').buffer;
    resumable.downloadToBuffer
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(buf);
    hashes.verifyHex.mockResolvedValue(true);

    const out = await svc.downloadVerifiedMedia(
      pedido({ mediaId: 'm2', expectedHash: 'h', expectedSize: 1, maxAttempts: 3 })
    );

    expect(resumable.downloadToBuffer).toHaveBeenCalledTimes(2);
    expect(out.byteLength).toBe(1);
    /**
     * Falha de rede **não** apaga o parcial: é exatamente nesse caso que a retomada tem de
     * aproveitar o que já veio. Apagar aqui faria cortar a rede num vídeo grande recomeçar do
     * zero toda vez.
     */
    expect(idb.clearPartial).not.toHaveBeenCalled();
  });

  it('repassa o gancho de renovacao de URL ao downloader', async () => {
    const buf = new TextEncoder().encode('ok').buffer;
    resumable.downloadToBuffer.mockResolvedValue(buf);
    hashes.verifyHex.mockResolvedValue(true);
    const refreshUrl = vi.fn().mockResolvedValue('nova');

    await svc.downloadVerifiedMedia(pedido({ refreshUrl }));

    // A URL pré-assinada vale 1 h; sem este repasse o `403` do storage mataria o download.
    expect(resumable.downloadToBuffer).toHaveBeenCalledWith(
      'https://example.com/f',
      expect.objectContaining({ refreshUrl })
    );
  });
});
