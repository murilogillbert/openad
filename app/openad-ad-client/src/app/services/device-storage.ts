/**
 * Estimativa de armazenamento do aparelho, numa implementacao so.
 *
 * Por que existe: dois lugares mediam armazenamento e **os dois estavam errados**, do mesmo
 * jeito. `Filesystem.stat({ path: '', directory: Directory.Data })` do Capacitor devolve a
 * estatistica do **diretorio**, e nao do sistema de arquivos: nao existe campo `free` no
 * plugin, e `size` e o tamanho do proprio diretorio.
 *
 * O efeito no tablete, medido:
 *
 * - `StorageManagerService.getAvailableBytes` lia `free` (indefinido), caia no `size` e
 *   devolvia **3452 bytes** como espaco livre. Um criativo de 37 KB nao caberia, e a
 *   sincronizacao abortava com `storage_full` num aparelho com disco praticamente vazio.
 * - `CapabilityManifestService.collectManifest` calculava `totalStorageGb` de 3452 bytes
 *   (virava 1 pelo piso) e deixava `availableStorageGb` no padrao 16. A API recusava com
 *   HTTP 400 `availableStorageGb must not exceed totalStorageGb`, e o aparelho ficava sem
 *   perfil de capacidade registrado.
 *
 * `navigator.storage.estimate()` e a fonte usada agora. No WebView do Android ela devolve
 * `quota` derivada do espaco livre em disco e `usage` do que a origem ja ocupa. Nao e o
 * espaco livre exato do sistema de arquivos — e uma fracao conservadora dele — e isso e
 * adequado aqui: a decisao que depende do numero e "cabe mais um criativo ou preciso
 * descartar o menos tocado?", e errar para baixo descarta um pouco antes do necessario, o que
 * e preferivel a encher o disco do aparelho.
 */

/** Orcamento assumido quando nao ha nenhuma fonte de medicao disponivel. */
const ORCAMENTO_PADRAO_BYTES = 512 * 1024 * 1024;

export interface ArmazenamentoDoAparelho {
  totalBytes: number;
  availableBytes: number;
  /** De onde o numero veio, para o log estruturado. */
  fonte: 'storage_estimate' | 'orcamento_assumido';
}

/**
 * Mede o armazenamento disponivel.
 *
 * `bytesJaEmCache` so e usado no caminho de reserva, para descontar o que o proprio player
 * ja guardou do orcamento assumido.
 */
export async function estimarArmazenamento(
  bytesJaEmCache = 0
): Promise<ArmazenamentoDoAparelho> {
  const nav =
    typeof navigator !== 'undefined'
      ? (navigator as Navigator & {
          storage?: { estimate?: () => Promise<{ quota?: number; usage?: number }> };
        })
      : undefined;

  if (nav?.storage?.estimate) {
    try {
      const { quota, usage } = await nav.storage.estimate();
      if (typeof quota === 'number' && quota > 0) {
        const usado = typeof usage === 'number' && usage > 0 ? usage : 0;
        return {
          totalBytes: quota,
          // Nunca negativo: `usage` pode passar `quota` logo depois de a quota encolher.
          availableBytes: Math.max(0, quota - usado),
          fonte: 'storage_estimate',
        };
      }
    } catch {
      /* cai no orcamento assumido */
    }
  }

  const disponivel = Math.max(0, ORCAMENTO_PADRAO_BYTES - Math.max(0, bytesJaEmCache));
  return {
    totalBytes: ORCAMENTO_PADRAO_BYTES,
    availableBytes: disponivel,
    fonte: 'orcamento_assumido',
  };
}

const BYTES_POR_GB = 1024 ** 3;

/**
 * Converte para gigabytes no formato que `PATCH /devices/:id/capability-manifest` aceita.
 *
 * A invariante `available <= total` e garantida **aqui**, antes de sair do aparelho. A API a
 * valida e responde 400; depender so da validacao remota ja custou o perfil de capacidade de
 * um aparelho em producao, com a requisicao sendo repetida em laco a cada ciclo.
 */
export function emGigabytes(a: ArmazenamentoDoAparelho): {
  totalStorageGb: number;
  availableStorageGb: number;
} {
  const total = Math.max(1, Math.round(a.totalBytes / BYTES_POR_GB));
  const disponivel = Math.min(
    total,
    Math.max(0, Math.round(a.availableBytes / BYTES_POR_GB))
  );
  return { totalStorageGb: total, availableStorageGb: disponivel };
}
