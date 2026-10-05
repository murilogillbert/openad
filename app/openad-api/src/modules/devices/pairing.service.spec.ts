import { ConflictException, NotFoundException } from '@nestjs/common';
import { PairingService } from './pairing.service';

/**
 * Regressao do defeito que prendeu um tablet em producao.
 *
 * O `register` gerava um `deviceId` aleatorio a cada chamada e so depois inseria em
 * `devices`. Com indice unico em `serialNumber`, o segundo registro do mesmo aparelho
 * colidia e devolvia 409 — mas a linha de `pairing_requests` ja tinha sido criada e nao era
 * desfeita. Producao acumulou 5 solicitacoes `Pending` orfas, apontando para `deviceId` sem
 * aparelho; a fila do operador (que le de `devices`) aparecia vazia, o aparelho real estava
 * `Active`, e `generateSecret` recusava por exigir `Pending`. Nao havia saida pela interface.
 *
 * Os testes abaixo fixam: identidade por hardware, uma unica solicitacao pendente, nenhuma
 * orfa quando a insercao falha, e recusa explicita (nao silenciosa) para aparelho ja ativo.
 */

const FP = {
  imei: '350000000000001',
  serialNumber: 'e03224a69637fac7',
  macAddress: 'aa:bb:cc:dd:ee:ff',
};

/** Colecao em memoria com o minimo que o servico usa. */
function colecaoFalsa(inicial: Record<string, unknown>[] = []) {
  let docs = inicial.map((d) => ({ ...d }));
  const casa = (filtro: Record<string, unknown>, d: Record<string, unknown>) =>
    Object.entries(filtro).every(([k, v]) => {
      if (v && typeof v === 'object' && '$in' in (v as object)) {
        return (v as { $in: unknown[] }).$in.includes(d[k]);
      }
      if (v && typeof v === 'object' && '$ne' in (v as object)) {
        return d[k] !== (v as { $ne: unknown }).$ne;
      }
      return d[k] === v;
    });

  return {
    docs: () => docs,
    create: jest.fn(async (doc: Record<string, unknown>) => {
      docs.push({ ...doc });
      return doc;
    }),
    findOne: jest.fn((filtro: Record<string, unknown>) => ({
      exec: async () => {
        const achado = docs.find((d) => casa(filtro, d));
        if (!achado) return null;
        return {
          ...achado,
          save: jest.fn(async () => undefined),
        };
      },
    })),
    find: jest.fn((filtro: Record<string, unknown>) => ({
      exec: async () => docs.filter((d) => casa(filtro, d)),
    })),
    updateMany: jest.fn((filtro: Record<string, unknown>, patch: Record<string, unknown>) => ({
      exec: async () => {
        let n = 0;
        docs = docs.map((d) => {
          if (!casa(filtro, d)) return d;
          n += 1;
          return { ...d, ...((patch['$set'] as Record<string, unknown>) ?? {}) };
        });
        return { modifiedCount: n };
      },
    })),
    deleteMany: jest.fn((filtro: Record<string, unknown>) => ({
      exec: async () => {
        const antes = docs.length;
        docs = docs.filter((d) => !casa(filtro, d));
        return { deletedCount: antes - docs.length };
      },
    })),
  };
}

function montar(opcoes?: {
  devicesIniciais?: Record<string, unknown>[];
  erroNaCriacao?: unknown;
}) {
  const devicesDocs = (opcoes?.devicesIniciais ?? []).map((d) => ({ ...d }));

  const devices = {
    findByDeviceId: jest.fn(
      async (id: string) => devicesDocs.find((d) => d['deviceId'] === id) ?? null
    ),
    findBySerial: jest.fn(
      async (s: string) => devicesDocs.find((d) => d['serialNumber'] === s) ?? null
    ),
    findOne: jest.fn(
      async (f: Record<string, unknown>) =>
        devicesDocs.find((d) =>
          Object.entries(f).every(([k, v]) => d[k] === v)
        ) ?? null
    ),
    create: jest.fn(async (doc: Record<string, unknown>) => {
      if (opcoes?.erroNaCriacao) throw opcoes.erroNaCriacao;
      devicesDocs.push({ ...doc });
      return doc;
    }),
    updateOne: jest.fn(async () => true),
    deleteOne: jest.fn(async () => true),
  };

  const pairingRequests = colecaoFalsa();
  const pairingSecrets = colecaoFalsa();

  const servico = new PairingService(
    { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
    devices as never,
    { sign: jest.fn(() => 'token-de-teste') } as never,
    { record: jest.fn(async () => undefined) } as never,
    { provisioningEnabled: () => false } as never,
    pairingRequests as never,
    pairingSecrets as never
  );

  return { servico, devices, pairingRequests, pairingSecrets, devicesDocs };
}

describe('PairingService.register', () => {
  it('primeiro registro cria aparelho e UMA solicitacao pendente', async () => {
    const { servico, pairingRequests, devices } = montar();

    const r = await servico.register({ hardwareFingerprint: FP } as never);

    expect(r.status).toBe('Pending');
    expect(devices.create).toHaveBeenCalledTimes(1);
    expect(pairingRequests.docs().filter((d) => d['status'] === 'Pending')).toHaveLength(1);
  });

  it('registro repetido do MESMO hardware reaproveita o aparelho, sem duplicar', async () => {
    const { servico, pairingRequests, devices } = montar();

    const primeiro = await servico.register({ hardwareFingerprint: FP } as never);
    const segundo = await servico.register({ hardwareFingerprint: FP } as never);
    const terceiro = await servico.register({ hardwareFingerprint: FP } as never);

    expect(segundo.deviceId).toBe(primeiro.deviceId);
    expect(terceiro.deviceId).toBe(primeiro.deviceId);
    // O aparelho e criado uma vez so.
    expect(devices.create).toHaveBeenCalledTimes(1);
    // E a fila do operador nao enche de duplicatas — era o sintoma em producao.
    expect(pairingRequests.docs().filter((d) => d['status'] === 'Pending')).toHaveLength(1);
  });

  it('nao deixa solicitacao orfa quando a insercao do aparelho falha', async () => {
    // 11000 = chave duplicada do Mongo, o erro exato que producao viu.
    const { servico, pairingRequests } = montar({ erroNaCriacao: { code: 11000 } });

    await expect(servico.register({ hardwareFingerprint: FP } as never)).rejects.toBeInstanceOf(
      ConflictException
    );

    expect(pairingRequests.docs()).toHaveLength(0);
  });

  it('aparelho ja Active e recusado com codigo e deviceId, nao com 409 generico', async () => {
    const { servico } = montar({
      devicesIniciais: [
        {
          deviceId: 'dev-existente',
          serialNumber: FP.serialNumber,
          lifecycleState: 'Active',
          hardwareFingerprintHash: 'qualquer',
        },
      ],
    });

    try {
      await servico.register({ hardwareFingerprint: FP } as never);
      throw new Error('deveria ter recusado');
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictException);
      const corpo = (e as ConflictException).getResponse() as {
        error: { code: string; deviceId: string; lifecycleState: string };
      };
      // O operador precisa saber QUAL aparelho e em que estado, para agir.
      expect(corpo.error.code).toBe('DEVICE_ALREADY_REGISTERED');
      expect(corpo.error.deviceId).toBe('dev-existente');
      expect(corpo.error.lifecycleState).toBe('Active');
    }
  });

  it('aparelho existente em Pending e reaproveitado, nao recusado', async () => {
    const { servico, devices } = montar({
      devicesIniciais: [
        {
          deviceId: 'dev-pendente',
          serialNumber: FP.serialNumber,
          lifecycleState: 'Pending',
          hardwareFingerprintHash: 'antigo',
        },
      ],
    });

    const r = await servico.register({ hardwareFingerprint: FP } as never);

    expect(r.deviceId).toBe('dev-pendente');
    expect(devices.create).not.toHaveBeenCalled();
  });
});

describe('PairingService.excluirRegistro', () => {
  it('recusa aparelho vinculado a veiculo, apontando o proximo passo', async () => {
    const { servico } = montar({
      devicesIniciais: [
        {
          deviceId: 'dev-1',
          serialNumber: FP.serialNumber,
          lifecycleState: 'Active',
          boundVehicleId: 'veiculo-9',
        },
      ],
    });

    try {
      await servico.excluirRegistro('dev-1');
      throw new Error('deveria ter recusado');
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictException);
      const corpo = (e as ConflictException).getResponse() as {
        error: { code: string; boundVehicleId: string };
      };
      expect(corpo.error.code).toBe('DEVICE_BOUND');
      expect(corpo.error.boundVehicleId).toBe('veiculo-9');
    }
  });

  it('exclui aparelho sem vinculo, junto com os rastros de pareamento', async () => {
    const { servico, devices, pairingRequests } = montar({
      devicesIniciais: [
        {
          deviceId: 'dev-2',
          serialNumber: FP.serialNumber,
          lifecycleState: 'Pending',
          boundVehicleId: null,
        },
      ],
    });
    await pairingRequests.create({ requestId: 'r1', deviceId: 'dev-2', status: 'Pending' });

    const r = await servico.excluirRegistro('dev-2');

    expect(r.deviceId).toBe('dev-2');
    expect(devices.deleteOne).toHaveBeenCalledWith({ deviceId: 'dev-2' });
    expect(pairingRequests.deleteMany).toHaveBeenCalledWith({ deviceId: 'dev-2' });
  });

  it('aparelho inexistente da 404', async () => {
    const { servico } = montar();
    await expect(servico.excluirRegistro('nao-existe')).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});

describe('PairingService.reiniciarPareamento', () => {
  it('devolve para Pending e informa o estado anterior', async () => {
    const { servico, devices } = montar({
      devicesIniciais: [
        {
          deviceId: 'dev-3',
          serialNumber: FP.serialNumber,
          lifecycleState: 'Active',
          hardwareFingerprintHash: 'hash-1',
        },
      ],
    });

    const r = await servico.reiniciarPareamento('dev-3');

    expect(r.anterior).toBe('Active');
    expect(r.lifecycleState).toBe('Pending');
    expect(devices.updateOne).toHaveBeenCalledWith(
      { deviceId: 'dev-3' },
      expect.objectContaining({
        $set: expect.objectContaining({ lifecycleState: 'Pending' }),
      })
    );
  });

  it('invalida segredo SO deste aparelho, nunca os de outros', async () => {
    // Um `updateMany({ usedAt: null })` sem escopo queimaria o codigo de outro tecnico
    // pareando outro carro no mesmo instante, que veria SECRET_REPLAY sem ter feito nada.
    const { servico, pairingRequests, pairingSecrets } = montar({
      devicesIniciais: [
        { deviceId: 'dev-4', serialNumber: FP.serialNumber, lifecycleState: 'Active' },
      ],
    });
    await pairingRequests.create({ requestId: 'r-meu', deviceId: 'dev-4', status: 'Pending' });
    await pairingRequests.create({ requestId: 'r-outro', deviceId: 'dev-outro', status: 'Pending' });
    await pairingSecrets.create({ requestId: 'r-meu', usedAt: null });
    await pairingSecrets.create({ requestId: 'r-outro', usedAt: null });

    await servico.reiniciarPareamento('dev-4');

    const chamada = pairingSecrets.updateMany.mock.calls[0]?.[0] as {
      requestId: { $in: string[] };
    };
    expect(chamada.requestId.$in).toEqual(['r-meu']);
    expect(chamada.requestId.$in).not.toContain('r-outro');
  });
});

describe('PairingService.limparSolicitacoesOrfas', () => {
  it('remove so as solicitacoes cujo aparelho nao existe', async () => {
    const { servico, pairingRequests } = montar({
      devicesIniciais: [
        { deviceId: 'dev-vivo', serialNumber: FP.serialNumber, lifecycleState: 'Pending' },
      ],
    });
    await pairingRequests.create({ requestId: 'r-ok', deviceId: 'dev-vivo', status: 'Pending' });
    await pairingRequests.create({ requestId: 'r-orfa-1', deviceId: 'fantasma-1', status: 'Pending' });
    await pairingRequests.create({ requestId: 'r-orfa-2', deviceId: 'fantasma-2', status: 'Pending' });

    const r = await servico.limparSolicitacoesOrfas();

    expect(r.removidas).toBe(2);
    expect(r.deviceIds.sort()).toEqual(['fantasma-1', 'fantasma-2']);
    // A do aparelho vivo fica.
    expect(pairingRequests.docs().some((d) => d['requestId'] === 'r-ok')).toBe(true);
  });

  it('nao faz nada quando nao ha orfa', async () => {
    const { servico, pairingSecrets } = montar();
    const r = await servico.limparSolicitacoesOrfas();
    expect(r.removidas).toBe(0);
    expect(pairingSecrets.deleteMany).not.toHaveBeenCalled();
  });
});
