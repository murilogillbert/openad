import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DeviceSessionService } from './device-session.service';
import { TABLET_ENV, type TabletEnv } from './tablet-env.token';

@Injectable({ providedIn: 'root' })
export class ApiClientService {
  private readonly http = inject(HttpClient);
  private readonly env = inject<TabletEnv>(TABLET_ENV);
  private readonly session = inject(DeviceSessionService);

  private baseUrl(): string {
    return this.env.API_BASE_URL?.replace(/\/$/, '') ?? '';
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};
    const token = await this.session.getAccessToken();
    const fp = await this.session.getFingerprintHash();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (fp) {
      headers['X-Device-Fingerprint-Hash'] = fp;
    }
    return headers;
  }

  /**
   * Monta a URL final a partir de `API_BASE_URL`, que **ja inclui** o prefixo da API
   * (`https://adsapi.opendriver.com.br/api/v1`).
   *
   * A normalizacao do prefixo repetido nao e capricho: tres chamadas do player passavam
   * `/api/v1/...` e a URL resultante era
   * `https://adsapi.opendriver.com.br/api/v1/api/v1/manifest`, que devolve 404. O manifesto
   * nunca era buscado, o aparelho ficava com `lastManifestVersion: 0` e a tela vazia — e no
   * log isso aparecia so como `sync.failed`, porque o erro do Angular nao e `Error` e era
   * registrado como `[object Object]`.
   *
   * As tres chamadas foram corrigidas. Esta normalizacao fica como rede: a convencao
   * "caminho sem prefixo" nao e obvia olhando so o chamador, e o custo de errar e um 404 em
   * producao que ninguem ve.
   */
  private resolveUrl(path: string): string {
    if (path.startsWith('http')) {
      return path;
    }
    const base = this.baseUrl();
    let caminho = path.startsWith('/') ? path : `/${path}`;

    const prefixo = new URL(base, 'http://x').pathname.replace(/\/$/, '');
    if (prefixo && prefixo !== '/' && caminho.startsWith(`${prefixo}/`)) {
      caminho = caminho.slice(prefixo.length);
    }

    return `${base}${caminho}`;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = this.resolveUrl(path);
    return firstValueFrom(this.http.post<T>(url, body));
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    const url = this.resolveUrl(path);
    const headers = await this.authHeaders();
    return firstValueFrom(this.http.patch<T>(url, body, { headers }));
  }

  async putWithAuth<T>(path: string, body: unknown): Promise<T> {
    const url = this.resolveUrl(path);
    const headers = await this.authHeaders();
    return firstValueFrom(this.http.put<T>(url, body, { headers }));
  }

  /** GET with device JWT + fingerprint headers (manifest, etc.). */
  async getWithAuth<T>(path: string): Promise<T> {
    const url = this.resolveUrl(path);
    const headers = await this.authHeaders();
    return firstValueFrom(this.http.get<T>(url, { headers }));
  }

  /** POST JSON with device JWT + fingerprint headers. */
  async postWithAuth<T>(path: string, body: unknown): Promise<T> {
    const url = this.resolveUrl(path);
    const headers = await this.authHeaders();
    return firstValueFrom(this.http.post<T>(url, body, { headers }));
  }

  /** POST JSON with device auth (screenshot upload, etc.). */
  async postWithAuthJson(
    pathOrUrl: string,
    body: unknown,
    init?: { signal?: AbortSignal }
  ): Promise<Response> {
    const url = this.resolveUrl(pathOrUrl);
    const h = await this.authHeaders();
    return fetch(url, {
      method: 'POST',
      headers: {
        ...h,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: init?.signal,
    });
  }
}
