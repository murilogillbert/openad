import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ReportingAggregationService } from './reporting-aggregation.service';
import { CampaignsRepository } from '../../campaigns/campaigns.repository';
import { PlayRecord } from '../schemas/play-record.schema';

describe('ReportingAggregationService', () => {
  it('aggregates impressions, reach (distinct vehicles), and revenue lines', async () => {
    const campaignId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const v1 = '11111111-1111-4111-8111-111111111111';
    const v2 = '22222222-2222-4222-8222-222222222222';
    const plays = [
      {
        campaignId,
        vehicleId: v1,
        billable: true,
        reconciliationStatus: 'billable' as const,
        timestampStart: new Date('2026-04-05T10:00:00Z'),
      },
      {
        campaignId,
        vehicleId: v1,
        billable: true,
        reconciliationStatus: 'billable' as const,
        timestampStart: new Date('2026-04-05T11:00:00Z'),
      },
      {
        campaignId,
        vehicleId: v2,
        billable: true,
        reconciliationStatus: 'billable' as const,
        timestampStart: new Date('2026-04-05T12:00:00Z'),
      },
    ];

    const findMock = jest.fn().mockReturnValue({
      lean: () => ({
        exec: async () => plays,
      }),
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportingAggregationService,
        {
          provide: getModelToken(PlayRecord.name),
          useValue: { find: findMock },
        },
        {
          provide: CampaignsRepository,
          useValue: {
            findByCampaignId: jest.fn().mockResolvedValue({
              campaignId,
              budget: {
                totalAmount: 1000,
                currency: 'USD',
                ratePerImpression: 100,
              },
            }),
          },
        },
      ],
    }).compile();

    const svc = moduleRef.get(ReportingAggregationService);
    const from = new Date('2026-04-05T00:00:00Z');
    const to = new Date('2026-04-06T00:00:00Z');
    const summary = await svc.summarizeCampaign(campaignId, from, to);

    expect(summary.impressions).toBe(3);
    expect(summary.reach).toBe(2);
    expect(summary.currency).toBe('USD');
    expect(summary.revenueTotal).toBeCloseTo(300);
    expect(findMock).toHaveBeenCalled();
  });
});
