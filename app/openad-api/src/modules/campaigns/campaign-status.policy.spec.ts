import {
  canTransition,
  moderationReasonRequired,
  requiresModeration,
} from './campaign-status.policy';

describe('campaign-status.policy', () => {
  /**
   * O defeito que a politica fecha: `patchStatus` aceitava qualquer destino do enum, entao
   * dava para publicar sem passar por revisao.
   */
  it('nao permite ir ao ar sem revisao', () => {
    expect(canTransition('draft', 'active')).toBe(false);
    expect(canTransition('rejected', 'active')).toBe(false);
  });

  it('a unica porta para o ar e pending_review -> active', () => {
    expect(canTransition('pending_review', 'active')).toBe(true);
  });

  it('permite submeter, recusar e reenviar', () => {
    expect(canTransition('draft', 'pending_review')).toBe(true);
    expect(canTransition('pending_review', 'rejected')).toBe(true);
    expect(canTransition('rejected', 'pending_review')).toBe(true);
  });

  it('permite pausar e retomar campanha no ar', () => {
    expect(canTransition('active', 'paused')).toBe(true);
    expect(canTransition('paused', 'active')).toBe(true);
  });

  it('archived e terminal', () => {
    expect(canTransition('archived', 'draft')).toBe(false);
    expect(canTransition('archived', 'active')).toBe(false);
  });

  it('completed so pode ser arquivada', () => {
    expect(canTransition('completed', 'archived')).toBe(true);
    expect(canTransition('completed', 'active')).toBe(false);
  });

  it('exige moderador apenas nas decisoes de moderacao', () => {
    expect(requiresModeration('pending_review', 'active')).toBe(true);
    expect(requiresModeration('pending_review', 'rejected')).toBe(true);
    expect(requiresModeration('draft', 'pending_review')).toBe(false);
    expect(requiresModeration('active', 'paused')).toBe(false);
  });

  it('recusa exige motivo', () => {
    expect(moderationReasonRequired('rejected')).toBe(true);
    expect(moderationReasonRequired('active')).toBe(false);
  });
});
