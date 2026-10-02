import { canModerate, isInternalRole, ownerFilterFor } from './access-scope';

describe('access-scope', () => {
  it('reconhece os papeis internos', () => {
    expect(isInternalRole('super_admin')).toBe(true);
    expect(isInternalRole('campaign_manager')).toBe(true);
    expect(isInternalRole('content_moderator')).toBe(true);
  });

  it('nao trata papel desconhecido nem ausente como interno', () => {
    expect(isInternalRole('advertiser')).toBe(false);
    expect(isInternalRole(undefined)).toBe(false);
    expect(isInternalRole('')).toBe(false);
  });

  it('equipe interna consulta sem filtro de dono', () => {
    expect(ownerFilterFor({ userId: 'u-1', role: 'fleet_admin' })).toEqual({});
  });

  /**
   * O defeito que isto fecha: `GET /campaigns` fazia `findMany({})` e `MediaScopeService`
   * devolvia `true` sempre — e nem era chamado. Abrir para parceiros assim faria cada
   * anunciante ver e baixar a midia dos outros.
   */
  it('anunciante consulta escopado pelo proprio id', () => {
    expect(ownerFilterFor({ userId: 'u-9', role: 'advertiser' })).toEqual({
      ownerUserId: 'u-9',
    });
  });

  it('sem userId, o filtro nao casa com nada', () => {
    expect(ownerFilterFor({ userId: null, role: 'advertiser' })).toEqual({
      ownerUserId: '__sem_dono__',
    });
    expect(ownerFilterFor({ userId: undefined, role: undefined })).toEqual({
      ownerUserId: '__sem_dono__',
    });
  });

  it('so moderador e super_admin decidem moderacao', () => {
    expect(canModerate('content_moderator')).toBe(true);
    expect(canModerate('super_admin')).toBe(true);
    expect(canModerate('campaign_manager')).toBe(false);
    expect(canModerate('fleet_admin')).toBe(false);
    expect(canModerate(undefined)).toBe(false);
  });
});
