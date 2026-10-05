import { RabbitmqManagementService } from './rabbitmq-management.service';

/**
 * Regressao do defeito que travou o pareamento do tablet em producao.
 *
 * `putUser` nao enviava `tags`, e o RabbitMQ 4 responde `400 bad_request` com
 * `{"reason":"tags_not_present"}`. O `bind` entao lancava 503 — **depois** de ja ter marcado
 * o aparelho como pareado — e o tablet ficava sem sessao, com o servidor achando que estava
 * tudo certo.
 *
 * O campo havia sido retirado por um motivo real e oposto: enviar `tags: ''` no usuario
 * administrador apaga a tag `administrator` e derruba a propria API de gestao com 401. Por
 * isso o teste fixa as duas pontas: o campo existe, e o valor padrao e vetor vazio.
 */
function montar(resposta: { ok: boolean; status: number; corpo?: string }) {
  const chamadas: { url: string; metodo: string; corpo: unknown }[] = [];
  const servico = new RabbitmqManagementService();

  process.env.MQTT_MANAGEMENT_URL = 'http://broker.teste:15672';
  process.env.MQTT_MANAGEMENT_USER = 'openad';
  process.env.MQTT_MANAGEMENT_PASSWORD = 'segredo';
  servico.onModuleInit();

  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    chamadas.push({
      url: String(url),
      metodo: String(init.method),
      corpo: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return {
      ok: resposta.ok,
      status: resposta.status,
      text: async () => resposta.corpo ?? '',
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return { servico, chamadas };
}

describe('RabbitmqManagementService.putUser', () => {
  it('envia o campo tags — sem ele o RabbitMQ 4 devolve tags_not_present', async () => {
    const { servico, chamadas } = montar({ ok: true, status: 204 });

    await servico.putUser('openad-tablet-abc', 'senha-forte');

    const corpo = chamadas[0]?.corpo as { password: string; tags: string[] };
    expect(corpo).toHaveProperty('tags');
    expect(Array.isArray(corpo.tags)).toBe(true);
  });

  it('tags padrao e VETOR VAZIO, nunca string vazia', async () => {
    // `tags: ''` aplicado ao usuario administrador apaga a tag `administrator` e derruba a
    // API de gestao com 401, sem caminho de volta pela propria API.
    const { servico, chamadas } = montar({ ok: true, status: 204 });

    await servico.putUser('openad-tablet-abc', 'senha-forte');

    const corpo = chamadas[0]?.corpo as { tags: unknown };
    expect(corpo.tags).toEqual([]);
    expect(corpo.tags).not.toBe('');
  });

  it('tablet nao recebe tag de gestao', async () => {
    const { servico, chamadas } = montar({ ok: true, status: 204 });
    await servico.putUser('openad-tablet-abc', 'senha-forte');
    const corpo = chamadas[0]?.corpo as { tags: string[] };
    expect(corpo.tags).not.toContain('administrator');
    expect(corpo.tags).not.toContain('management');
  });

  it('permite tags explicitas quando o chamador precisar', async () => {
    const { servico, chamadas } = montar({ ok: true, status: 204 });
    await servico.putUser('operador', 'senha', ['monitoring']);
    const corpo = chamadas[0]?.corpo as { tags: string[] };
    expect(corpo.tags).toEqual(['monitoring']);
  });

  it('propaga o motivo do broker na mensagem de erro', async () => {
    const { servico } = montar({
      ok: false,
      status: 400,
      corpo: '{"error":"bad_request","reason":"tags_not_present"}',
    });

    await expect(servico.putUser('openad-tablet-abc', 'senha')).rejects.toThrow(
      /tags_not_present/
    );
  });
});
