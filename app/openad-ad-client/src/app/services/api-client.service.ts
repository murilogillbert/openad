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

  private resolveUrl(path: string): string {
    return path.startsWith('http')
      ? path
      : `${this.baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
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
