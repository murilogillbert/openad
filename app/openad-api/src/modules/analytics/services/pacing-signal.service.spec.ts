import { PacingSignalService } from './pacing-signal.service';
import type { CampaignDailySpend } from '../schemas/campaign-daily-spend.schema';

describe('PacingSignalService', () => {
  const campaignId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

  function chainFindOne(result: CampaignDailySpend | null) {
    return {
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(result),
      }),
      exec: jest.fn().mockResolvedValue(result),
    };
  }

  function makeService(overrides: {
    findOneResults?: Array<CampaignDailySpend | null>;
    campaign?: {
      budget?: { totalAmountCents?: number; dailyBudgetCents?: number | null };
      scheduledStart?: Date;
      scheduledEnd?: Date;
    } | null;
  }) {
    const findQueue = [...(overrides.findOneResults ?? [null])];
    const findOne = jest.fn(() => chainFindOne(findQueue.shift() ?? null));
    const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    const dailySpend = { findOne, updateOne };
    const campaigns = {
      findByCampaignId: jest.fn().mockResolvedValue(overrides.campaign ?? null),
    };
    return {
      svc: new PacingSignalService(dailySpend as never, campaigns as never),
      findOne,
      updateOne,
      campaigns,
    };
  }

  it('getPacingDeliveryMultiplier returns 1 when no daily row', async () => {
    const { svc } = makeService({ findOneResults: [null] });
    await expect(svc.getPacingDeliveryMultiplier(campaignId)).resolves.toBe(1);
  });

  it('getPacingDeliveryMultiplier returns 0.5 for near_cap', async () => {
    const row = {
      campaignId,
      dateKey: '2026-04-05',
      billableCostCents: 950,
      budgetCents: 1000,
      pacingState: 'near_cap' as const,
    };
    const { svc } = makeService({ findOneResults: [row] });
    await expect(svc.getPacingDeliveryMultiplier(campaignId)).resolves.toBe(0.5);
  });

  it('getPacingDeliveryMultiplier returns 0.1 for paused', async () => {
    const row = {
      campaignId,
      dateKey: '2026-04-05',
      billableCostCents: 1000,
      budgetCents: 1000,
      pacingState: 'paused' as const,
    };
    const { svc } = makeService({ findOneResults: [row] });
    await expect(svc.getPacingDeliveryMultiplier(campaignId)).resolves.toBe(0.1);
  });

  it('recordBillablePlayCost upserts spend and moves to near_cap at 95%', async () => {
    const campaign = {
      // 10.000 centavos em 10 dias contratados = 1.000 centavos por dia, que e o
      // `budgetCents` que o upsert deve gravar. A versao anterior lia `totalAmount` em reais
      // e comparava com `billableCostCents`: 10.000 reais viravam 1.000 "centavos" de teto
      // diario — cem vezes menos do que o contratado, e a campanha pausava na largada.
      budget: { totalAmountCents: 10000, dailyBudgetCents: null },
      scheduledStart: new Date('2026-04-01'),
      scheduledEnd: new Date('2026-04-11'),
    };
    const afterUpsert = {
      campaignId,
      dateKey: new Date().toISOString().slice(0, 10),
      billableCostCents: 960,
      budgetCents: 1000,
      pacingState: 'normal' as const,
    };
    const { svc, updateOne } = makeService({
      findOneResults: [afterUpsert],
      campaign,
    });
    await svc.recordBillablePlayCost({
      campaignId,
      costCents: 10,
      at: new Date(),
    });
    expect(updateOne).toHaveBeenCalled();
    const pacingUpdate = updateOne.mock.calls.find(
      (c) => (c[1] as { $set?: { pacingState?: string } }).$set?.pacingState
    );
    expect(pacingUpdate?.[1]).toEqual(
      expect.objectContaining({
        $set: { pacingState: 'near_cap' },
      })
    );
  });

  it('deriva o teto diario do total contratado, em centavos, sem fator 100', async () => {
    const { svc, updateOne } = makeService({
      findOneResults: [null],
      campaign: {
        budget: { totalAmountCents: 10000, dailyBudgetCents: null },
        scheduledStart: new Date('2026-04-01'),
        scheduledEnd: new Date('2026-04-11'),
      },
    });
    await svc.recordBillablePlayCost({
      campaignId,
      costCents: 10,
      at: new Date(),
    });
    const upsert = updateOne.mock.calls[0]?.[1] as {
      $setOnInsert?: { budgetCents?: number };
    };
    expect(upsert.$setOnInsert?.budgetCents).toBe(1000);
  });

  it('teto diario explicito tem precedencia sobre a divisao pelos dias', async () => {
    const { svc, updateOne } = makeService({
      findOneResults: [null],
      campaign: {
        // Mesmo total e mesma janela do teste acima, mas o anunciante pediu para gastar
        // devagar: 250 por dia em vez dos 1.000 que a divisao daria.
        budget: { totalAmountCents: 10000, dailyBudgetCents: 250 },
        scheduledStart: new Date('2026-04-01'),
        scheduledEnd: new Date('2026-04-11'),
      },
    });
    await svc.recordBillablePlayCost({
      campaignId,
      costCents: 10,
      at: new Date(),
    });
    const upsert = updateOne.mock.calls[0]?.[1] as {
      $setOnInsert?: { budgetCents?: number };
    };
    expect(upsert.$setOnInsert?.budgetCents).toBe(250);
  });
});
