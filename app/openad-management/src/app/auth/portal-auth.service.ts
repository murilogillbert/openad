import { isPlatformBrowser } from '@angular/common';
import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  Observable,
  catchError,
  finalize,
  map,
  of,
  shareReplay,
  tap,
  throwError,
} from 'rxjs';
import type { AdminMeResponse } from '@openad/api-contracts';
import { environment } from '../../environments/environment';
import { isJwtExpired } from './jwt.util';

const PORTAL_USER_STORAGE_KEY = 'portalUser';
const PORTAL_DEVICE_ID_STORAGE_KEY = 'portalDeviceId';

export interface LoginUser {
  userId: string;
  displayName: string;
  role: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: LoginUser;
}

@Injectable({ providedIn: 'root' })
export class PortalAuthService {
  private readonly http = inject(HttpClient);
  private readonly httpBackend = inject(HttpBackend);
  /** Avoid interceptor loop / stale Authorization on refresh calls. */
  private readonly bareHttp = new HttpClient(this.httpBackend);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly me = signal<AdminMeResponse | null>(null);
  readonly meDisplayName = computed(() => this.me()?.displayName?.trim() || null);

  /**
   * In-memory access token mirror. Cleared on logout; hydrated from storage when reading if unset.
   * Guards treat "logged in" as a non-expired access token (memory or storage after hydrate).
   */
  private accessTokenMem: string | null | undefined = undefined;

  private refreshInFlight$: Observable<LoginResponse> | null = null;

  private getOrCreateDeviceId(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    const existing = localStorage.getItem(PORTAL_DEVICE_ID_STORAGE_KEY);
    if (existing?.trim()) return existing;
    // crypto.randomUUID is available in modern browsers; fallback kept simple.
    const created =
      (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(PORTAL_DEVICE_ID_STORAGE_KEY, created);
    return created;
  }

  login(email: string, password: string): Observable<LoginResponse> {
    const deviceId = this.getOrCreateDeviceId();
    return this.http
      .post<LoginResponse>(
        `${environment.apiBaseUrl}/auth/login`,
        { email, password },
        deviceId ? { headers: { 'x-openad-device-id': deviceId } } : undefined
      )
      .pipe(
        tap((res) => {
          this.persistTokens(res);
          // Keep shell display name in sync with DB values, not the login token snapshot.
          this.refreshMe().subscribe({ error: () => undefined });
        })
      );
  }

  persistTokens(res: LoginResponse): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.setItem('accessToken', res.accessToken);
    localStorage.setItem('refreshToken', res.refreshToken);
    localStorage.setItem(PORTAL_USER_STORAGE_KEY, JSON.stringify(res.user));
    this.accessTokenMem = res.accessToken;
  }

  clearSession(): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem(PORTAL_USER_STORAGE_KEY);
    }
    this.accessTokenMem = null;
    this.me.set(null);
  }

  /** Profile from last login or refresh (for shell UI). */
  getPortalUser(): LoginUser | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    const raw = localStorage.getItem(PORTAL_USER_STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as LoginUser;
    } catch {
      return null;
    }
  }

  getAccessToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    if (this.accessTokenMem !== undefined) {
      return this.accessTokenMem;
    }
    const t = localStorage.getItem('accessToken');
    this.accessTokenMem = t;
    return t;
  }

  getRefreshToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    return localStorage.getItem('refreshToken');
  }

  /** True when a non-expired access token is in memory or storage. */
  hasValidAccessToken(): boolean {
    const t = this.getAccessToken();
    return !!t && !isJwtExpired(t);
  }

  /**
   * Ensures a usable access token: uses current if valid, otherwise refreshes when a refresh token exists.
   */
  ensureValidSession(): Observable<boolean> {
    if (!isPlatformBrowser(this.platformId)) {
      return of(false);
    }
    if (this.hasValidAccessToken()) {
      return of(true);
    }
    const refresh = this.getRefreshToken();
    if (!refresh) {
      if (this.getAccessToken()) {
        this.clearSession();
      }
      return of(false);
    }
    return this.refreshSession().pipe(
      tap(() => {
        this.refreshMe().subscribe({ error: () => undefined });
      }),
      map(() => true),
      catchError(() => {
        this.clearSession();
        return of(false);
      })
    );
  }

  /**
   * POST /auth/refresh (no app interceptors). Single-flight when called concurrently.
   */
  refreshSession(): Observable<LoginResponse> {
    if (!isPlatformBrowser(this.platformId)) {
      return throwError(() => new Error('Not in browser'));
    }
    const refresh = this.getRefreshToken();
    if (!refresh) {
      return throwError(() => new Error('No refresh token'));
    }
    if (this.refreshInFlight$) {
      return this.refreshInFlight$;
    }
    const deviceId = this.getOrCreateDeviceId();
    this.refreshInFlight$ = this.bareHttp
      .post<LoginResponse>(
        `${environment.apiBaseUrl}/auth/refresh`,
        { refreshToken: refresh },
        deviceId ? { headers: { 'x-openad-device-id': deviceId } } : undefined
      )
      .pipe(
        tap((res) => this.persistTokens(res)),
        catchError((err) => {
          this.clearSession();
          return throwError(() => err);
        }),
        finalize(() => {
          this.refreshInFlight$ = null;
        }),
        shareReplay({ bufferSize: 1, refCount: true })
      );
    return this.refreshInFlight$;
  }

  logout(): void {
    this.clearSession();
    void this.router.navigateByUrl('/login');
  }

  /**
   * Live DB profile snapshot for shell UI.
   * Uses normal HttpClient so auth interceptor attaches the access token.
   */
  refreshMe(): Observable<AdminMeResponse> {
    if (!isPlatformBrowser(this.platformId)) {
      return throwError(() => new Error('Not in browser'));
    }
    if (!this.getAccessToken()) {
      return throwError(() => new Error('No access token'));
    }
    return this.http.get<AdminMeResponse>(`${environment.apiBaseUrl}/admin/me`).pipe(
      tap((m) => this.me.set(m))
    );
  }

  /** Prefer DB value; fallback to login snapshot. */
  shellDisplayName(): string {
    return (
      this.meDisplayName() ||
      this.getPortalUser()?.displayName?.trim() ||
      'Signed in'
    );
  }

  /** @deprecated Prefer hasValidAccessToken or ensureValidSession */
  isLoggedIn(): boolean {
    return this.hasValidAccessToken();
  }
}
