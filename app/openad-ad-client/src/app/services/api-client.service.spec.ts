import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { ApiClientService } from './api-client.service';
import { DeviceSessionService } from './device-session.service';
import { TABLET_ENV } from './tablet-env.token';

/**
 * Estes testes existem por causa de um 404 em producao que custou caro para achar.
 *
 * `API_BASE_URL` ja inclui `/api/v1`, e tres chamadas do player passavam o prefixo de novo:
 * a URL saia como `https://adsapi.opendriver.com.br/api/v1/api/v1/manifest`. O tablete nunca
 * buscava o manifesto, ficava com a tela vazia e o unico sinal no log era `sync.failed` sem
 * detalhe. O que se fixa aqui e a composicao da URL, que e onde o erro ficou invisivel.
 */
function montar(baseUrl: string) {
  const post = vi.fn().mockReturnValue(of({ ok: true }));
  const get = vi.fn().mockReturnValue(of({ ok: true }));

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      ApiClientService,
      { provide: TABLET_ENV, useValue: { API_BASE_URL: baseUrl } },
      { provide: HttpClient, useValue: { post, get } },
      {
        provide: DeviceSessionService,
        useValue: {
          getAccessToken: () => Promise.resolve('token'),
          getFingerprintHash: () => Promise.resolve('fp'),
        },
      },
    ],
  });
  return { svc: TestBed.inject(ApiClientService), post, get };
}

const BASE = 'https://adsapi.opendriver.com.br/api/v1';

describe('ApiClientService.resolveUrl', () => {
  it('monta caminho sem prefixo em cima da base', async () => {
    const { svc, post } = montar(BASE);
    await svc.postWithAuth('/manifest', {});
    expect(post.mock.calls[0][0]).toBe(`${BASE}/manifest`);
  });

  it('nao duplica o prefixo quando o caminho ja o traz', async () => {
    const { svc, post } = montar(BASE);
    await svc.postWithAuth('/api/v1/manifest', {});
    expect(post.mock.calls[0][0]).toBe(`${BASE}/manifest`);
  });

  it('aceita caminho sem barra inicial', async () => {
    const { svc, get } = montar(BASE);
    await svc.getWithAuth('devices/abc/session');
    expect(get.mock.calls[0][0]).toBe(`${BASE}/devices/abc/session`);
  });

  it('remove barra final da base', async () => {
    const { svc, post } = montar(`${BASE}/`);
    await svc.postWithAuth('/manifest', {});
    expect(post.mock.calls[0][0]).toBe(`${BASE}/manifest`);
  });

  it('deixa URL absoluta intacta', async () => {
    const { svc, post } = montar(BASE);
    const absoluta = 'https://storage.opendriver.com.br/openad-media/x.png';
    await svc.postWithAuth(absoluta, {});
    expect(post.mock.calls[0][0]).toBe(absoluta);
  });

  it('nao corta trecho que apenas comeca igual ao prefixo', async () => {
    // `/api/v1beta/x` nao deve virar `/beta/x`: o corte exige o separador.
    const { svc, post } = montar(BASE);
    await svc.postWithAuth('/api/v1beta/x', {});
    expect(post.mock.calls[0][0]).toBe(`${BASE}/api/v1beta/x`);
  });

  it('funciona com base sem prefixo de caminho', async () => {
    const { svc, post } = montar('http://127.0.0.1:3000');
    await svc.postWithAuth('/manifest', {});
    expect(post.mock.calls[0][0]).toBe('http://127.0.0.1:3000/manifest');
  });
});
