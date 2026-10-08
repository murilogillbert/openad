/**
 * Chaves do TanStack Query, em um lugar só.
 *
 * Chave montada na tela é a forma de ter dois componentes lendo o mesmo dado com chaves
 * diferentes — dois cache, duas requisições, e a invalidação depois de uma mutação acertando
 * só um dos dois. O prefixo hierárquico permite invalidar por ramo:
 * `invalidateQueries({ queryKey: chaves.campanhas.todas })` alcança lista e detalhe.
 */
export const chaves = {
  adesao: ['adesao'] as const,

  campanhas: {
    todas: ['campanhas'] as const,
    lista: (page: number, limit: number) => ['campanhas', 'lista', page, limit] as const,
    detalhe: (id: string) => ['campanhas', 'detalhe', id] as const,
    estimativa: (id: string) => ['campanhas', 'estimativa', id] as const,
    relatorio: (id: string, from?: string, to?: string) =>
      ['campanhas', 'relatorio', id, from ?? null, to ?? null] as const,
  },

  inventario: {
    zonas: (city?: string, tier?: string) =>
      ['inventario', 'zonas', city ?? null, tier ?? null] as const,
  },

  credito: {
    saldo: ['credito', 'saldo'] as const,
  },

  conta: ['conta'] as const,
} as const;
