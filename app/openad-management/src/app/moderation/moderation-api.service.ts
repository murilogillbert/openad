import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CriativoParaRevisao {
  mediaId: string;
  filename: string;
  mimeType: string | null;
  durationSeconds: number;
  width: number;
  height: number;
  fileSize: number;
  validationStatus: string | null;
}

/** Espelha `ItemDaFilaDeModeracao` da API. Valores monetarios em centavos inteiros. */
export interface ItemDaFila {
  campaignId: string;
  name: string;
  advertiserName: string;
  ownerUserId: string | null;
  advertiserId: string | null;
  priority: number;
  budget: {
    totalAmountCents: number;
    currency: string;
    ratePerImpressionCents: number;
  };
  driverPayout: {
    model: 'percent' | 'per_play';
    percent: number | null;
    valueCents: number | null;
  } | null;
  targeting: {
    cities: string[];
    zoneIds: string[];
    tiers: string[];
    vehicleTiers: string[];
    dayparts: string[];
  };
  scheduledStart: string;
  scheduledEnd: string;
  submittedAt: string | null;
  creatives: CriativoParaRevisao[];
  readyToActivate: boolean;
  readinessReason: string | null;
  previousDecision: {
    decision: 'approved' | 'rejected';
    reviewedAt: string;
    reason: string | null;
  } | null;
}

export interface RespostaDaFila {
  data: ItemDaFila[];
  pagination: { total: number; page: number; limit: number };
}

@Injectable({ providedIn: 'root' })
export class ModerationApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  fila(page = 1, limit = 25): Observable<RespostaDaFila> {
    return this.http.get<RespostaDaFila>(`${this.base}/moderation/queue`, {
      params: { page: String(page), limit: String(limit) },
    });
  }

  decidir(
    campaignId: string,
    body: { decision: 'approve' | 'reject'; reason?: string }
  ): Observable<{ campaignId: string; status: string }> {
    return this.http.post<{ campaignId: string; status: string }>(
      `${this.base}/moderation/campaigns/${encodeURIComponent(campaignId)}/decision`,
      body
    );
  }
}
