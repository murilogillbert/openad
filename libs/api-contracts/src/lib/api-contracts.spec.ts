import type { LoginResponse, Paginated, VehicleListItem } from './types';

describe('api-contracts types', () => {
  it('allows constructing typed contract objects', () => {
    const login: LoginResponse = {
      accessToken: 'a',
      refreshToken: 'r',
      user: {
        userId: 'u1',
        displayName: 'Test',
        role: 'fleet_operator',
      },
    };
    const page: Paginated<VehicleListItem> = {
      data: [],
      pagination: { total: 0, page: 1, limit: 50 },
    };
    expect(login.user.role).toBe('fleet_operator');
    expect(page.pagination.limit).toBe(50);
  });
});
