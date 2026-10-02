import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface CampaignReportingSummaryDto {
  campaignId: string;
  window: { from: string; to: string };
  impressions: number;
  reach: number;
  revenueTotal: number;
  currency: string;
  revenueLines: Array<{ label: string; plays: number; amount: number }>;
}

@Injectable({ providedIn: 'root' })
export class CampaignAnalyticsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  getCampaignSummary(
    campaignId: string,
    from: Date,
    to: Date
  ): Observable<CampaignReportingSummaryDto> {
    const params = new HttpParams()
      .set('from', from.toISOString())
      .set('to', to.toISOString());
    return this.http.get<CampaignReportingSummaryDto>(
      `${this.base}/analytics/v1/campaigns/${encodeURIComponent(campaignId)}/reporting/summary`,
      { params }
    );
  }
}
