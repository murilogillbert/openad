import type { CampaignStatus } from './campaign.schema';

/**
 * Transicoes permitidas de status de campanha.
 *
 * Antes `PATCH /campaigns/:id/status` aceitava qualquer destino do enum: dava para ir de
 * `draft` direto para `active`, sem passar por revisao. Com moderacao humana no fluxo, isso
 * e o buraco que permite um criativo ir ao ar sem aprovacao.
 *
 * `pending_review -> active` e a unica porta de entrada para o ar, e ela exige papel de
 * moderador (ver {@link requiresModeration}).
 */
const ALLOWED: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> = {
  draft: ['pending_review', 'archived'],
  pending_review: ['active', 'rejected', 'draft'],
  rejected: ['pending_review', 'draft', 'archived'],
  active: ['paused', 'completed', 'archived'],
  paused: ['active', 'completed', 'archived'],
  completed: ['archived'],
  archived: [],
};

/** Transicoes que so moderador (ou super_admin) pode executar. */
const MODERATION_TRANSITIONS: ReadonlySet<string> = new Set([
  'pending_review->active',
  'pending_review->rejected',
]);

export function canTransition(
  from: CampaignStatus,
  to: CampaignStatus
): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function allowedTransitionsFrom(
  from: CampaignStatus
): readonly CampaignStatus[] {
  return ALLOWED[from] ?? [];
}

export function requiresModeration(
  from: CampaignStatus,
  to: CampaignStatus
): boolean {
  return MODERATION_TRANSITIONS.has(`${from}->${to}`);
}

/** Decisao de moderacao precisa de motivo quando recusa. */
export function moderationReasonRequired(to: CampaignStatus): boolean {
  return to === 'rejected';
}
