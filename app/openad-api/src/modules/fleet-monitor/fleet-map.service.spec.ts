import { PinoLogger } from 'nestjs-pino';
import { AssetUrlService } from '../campaigns/asset-url.service';
import { CampaignsRepository } from '../campaigns/campaigns.repository';
import { CreativeAssetsRepository } from '../campaigns/creative-assets.repository';
import { DevicesRepository } from '../devices/devices.repository';
import { GeoZonesRepository } from '../geo-zones/geo-zones.repository';
import { ImpressionEventsRepository } from '../impressions/impression-events.repository';
import { FleetStatusRepository } from '../vehicles/fleet-status.repository';
import { VehiclesRepository } from '../vehicles/vehicles.repository';
import { FleetMapService } from './fleet-map.service';

describe('FleetMapService', () => {
  let service: FleetMapService;
  let vehicles: { findMany: jest.Mock };

  beforeEach(() => {
    vehicles = { findMany: jest.fn().mockResolvedValue([]) };

    service = new FleetMapService(
      { setContext: jest.fn(), debug: jest.fn() } as unknown as PinoLogger,
      { findByDeviceIds: jest.fn().mockResolvedValue([]) } as unknown as FleetStatusRepository,
      vehicles as unknown as VehiclesRepository,
      { findByBoundVehicleIds: jest.fn().mockResolvedValue([]) } as unknown as DevicesRepository,
      { findActive: jest.fn().mockResolvedValue([]) } as unknown as GeoZonesRepository,
      {} as unknown as CampaignsRepository,
      {} as unknown as ImpressionEventsRepository,
      {} as unknown as CreativeAssetsRepository,
      {} as unknown as AssetUrlService
    );
  });

  it('getSnapshot only loads active vehicles with paired devices (excludes decommissioned)', async () => {
    await service.getSnapshot({});

    expect(vehicles.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'active',
        pairedDeviceIds: { $exists: true, $not: { $size: 0 } },
      })
    );
  });
});
