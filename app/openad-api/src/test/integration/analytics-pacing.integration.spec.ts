import { getModelToken } from '@nestjs/mongoose';
import request from 'supertest';
import { SpatialManifestBuilderService } from '../../modules/manifest/generators/spatial-manifest-builder.service';
import { Campaign } from '../../modules/campaigns/campaign.schema';
import { GeoZone } from '../../modules/geo-zones/geo-zone.schema';
import { MediaAsset } from '../../modules/media-ingestion/schemas/media-asset.schema';
import { CampaignDailySpend } from '../../modules/analytics/schemas/campaign-daily-spend.schema';
import {
  createTestApp,
  loginAsFleetOperator,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';

describe('Analytics pacing (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('GET pacing returns snapshot for seeded daily spend', async () => {
    const campaignId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
    const token = await loginAsFleetOperator(ctx.app);
    const cm = ctx.app.get(getModelToken(Campaign.name));
    await cm.create({
      campaignId,
      name: 'Pacing',
      advertiserName: 'X',
      status: 'active',
      priority: 1,
      budget: { totalAmount: 10000, currency: 'USD', ratePerImpression: 1 },
      scheduledStart: new Date('2026-04-01'),
      scheduledEnd: new Date('2026-04-30'),
      createdBy: null,
    });
    const dateKey = new Date().toISOString().slice(0, 10);
    const ds = ctx.app.get(getModelToken(CampaignDailySpend.name));
    await ds.create({
      campaignId,
      dateKey,
      billableCostCents: 960,
      budgetCents: 1000,
      pacingState: 'near_cap',
    });

    const res = await request(ctx.app.getHttpServer())
      .get(
        `/api/v1/analytics/v1/campaigns/${encodeURIComponent(campaignId)}/pacing`
      )
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.pacingState).toBe('near_cap');
    expect(res.body.billableCostCents).toBe(960);
  });

  it('spatial manifest multiplies pacingFactor by delivery multiplier (SC-006)', async () => {
    const campaignId = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
    const mediaId = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
    const zoneId = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';

    const cm = ctx.app.get(getModelToken(Campaign.name));
    await cm.create({
      campaignId,
      name: 'Manifest',
      advertiserName: 'Y',
      status: 'active',
      priority: 1,
      budget: { totalAmount: 10000, currency: 'USD', ratePerImpression: 1 },
      scheduledStart: new Date('2026-04-01'),
      scheduledEnd: new Date('2026-04-30'),
      createdBy: null,
    });

    const ma = ctx.app.get(getModelToken(MediaAsset.name));
    await ma.create({
      mediaId,
      hash: 'hash-pacing-int',
      filename: 'a.mp4',
      fileSize: 1000,
      bitrate: 1_000_000,
      width: 1920,
      height: 1080,
      codec: 'h264',
      duration: 30,
      categorization: 'universal',
      storageUrl: 'http://example.local/a.mp4',
      campaignId,
      isActive: true,
    });

    const gz = ctx.app.get(getModelToken(GeoZone.name));
    await gz.create({
      zoneId,
      name: 'Z',
      description: 'pacing integration zone',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0],
          ],
        ],
      },
      city: 'Test',
      tags: [],
      createdBy: null,
      tier: 'T3',
      priorityScore: 1,
      bufferExitMeters: 10,
      isActive: true,
      bindings: [
        {
          mediaId,
          triggerMode: 'entry',
          retriggerCooldownSeconds: 30,
          rotationMode: 'sequential',
          arbitrationWeights: { wp: 1, wd: 1, wh: 1 },
          pacingFactor: 2,
        },
      ],
    });

    const dateKey = new Date().toISOString().slice(0, 10);
    const ds = ctx.app.get(getModelToken(CampaignDailySpend.name));
    await ds.create({
      campaignId,
      dateKey,
      billableCostCents: 960,
      budgetCents: 1000,
      pacingState: 'near_cap',
    });

    const spatial = ctx.app.get(SpatialManifestBuilderService);
    const out = await spatial.build();
    const entry = out.entries.find((e) => e.mediaId === mediaId);
    expect(entry?.arbitration.pacingFactor).toBe(1);
  });
});
