import { Device, Vehicle } from './entities';

describe('domain entities', () => {
  it('exports structural types for compile-time use', () => {
    const d: Pick<Device, 'deviceId' | 'lifecycleState'> = {
      deviceId: '00000000-0000-4000-8000-000000000000',
      lifecycleState: 'Active',
    };
    const v: Pick<Vehicle, 'vehicleId' | 'status'> = {
      vehicleId: '00000000-0000-4000-8000-000000000001',
      status: 'active',
    };
    expect(d.lifecycleState).toBe('Active');
    expect(v.vehicleId).toBeDefined();
  });
});
