import type { StatusDeCampanha } from '@/api/types';
import type { Tone } from '@/theme/tokens';

/** `2026-10-03T13:00:00Z` → `03/10/2026`. Texto vazio quando a data é inválida. */
export function formatarData(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** `03/10/2026 10:00`. */
export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatarData(iso)} ${d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/** `dd/mm/aaaa` digitado → ISO 8601, ou `null` se a data não existe no calendário. */
export function dataBrParaIso(texto: string, horas = 0, minutos = 0): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto.trim());
  if (!m) return null;
  const [, dd, mm, aaaa] = m;
  const dia = Number(dd);
  const mes = Number(mm);
  const ano = Number(aaaa);
  const d = new Date(Date.UTC(ano, mes - 1, dia, horas, minutos, 0));
  // `new Date(2026, 1, 31)` não lança: vira 3 de março. A comparação de volta é o que recusa
  // data inexistente em vez de aceitar silenciosamente outra.
  if (
    d.getUTCFullYear() !== ano ||
    d.getUTCMonth() !== mes - 1 ||
    d.getUTCDate() !== dia
  ) {
    return null;
  }
  return d.toISOString();
}

/** Rótulo e cor de cada estado, para o anunciante entender onde a campanha está. */
const estados: Record<StatusDeCampanha, { rotulo: string; tom: Tone }> = {
  draft: { rotulo: 'Rascunho', tom: 'neutral' },
  pending_review: { rotulo: 'Em revisão', tom: 'warning' },
  approved: { rotulo: 'Aprovada', tom: 'info' },
  active: { rotulo: 'No ar', tom: 'success' },
  paused: { rotulo: 'Pausada', tom: 'warning' },
  completed: { rotulo: 'Encerrada', tom: 'neutral' },
  rejected: { rotulo: 'Recusada', tom: 'danger' },
  archived: { rotulo: 'Arquivada', tom: 'neutral' },
};

export function estadoDaCampanha(status: string): { rotulo: string; tom: Tone } {
  return estados[status as StatusDeCampanha] ?? { rotulo: status, tom: 'neutral' };
}

/**
 * O que o anunciante pode fazer agora, em uma frase.
 *
 * Existe porque "rascunho" não diz a ninguém o que fazer a seguir, e a maior causa de campanha
 * parada é o anunciante não saber que falta subir criativo.
 */
export function proximoPasso(c: {
  status: string;
  creativeCount: number;
  moderation: { reason: string | null } | null;
}): string | null {
  if (c.status === 'draft') {
    return c.creativeCount === 0
      ? 'Suba um criativo para poder enviar para revisão.'
      : 'Pronta para enviar para revisão.';
  }
  if (c.status === 'pending_review') return 'Aguardando a revisão da equipe.';
  if (c.status === 'rejected') {
    return c.moderation?.reason
      ? `Recusada: ${c.moderation.reason}`
      : 'Recusada na revisão. Troque o criativo e envie de novo.';
  }
  if (c.status === 'approved') return 'Aprovada. Entra no ar na data agendada.';
  return null;
}
