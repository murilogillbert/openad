import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  BillingReportResponse,
  ImpressionEventDetail,
  ProofOfPlayRequest,
  ReportJobAccepted,
  ReportJobStatus,
} from '@openad/api-contracts';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ReportsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  requestProofOfPlay(body: ProofOfPlayRequest): Observable<ReportJobAccepted> {
    return this.http.post<ReportJobAccepted>(
      `${this.base}/reports/proof-of-play`,
      body
    );
  }

  getJob(jobId: string): Observable<ReportJobStatus> {
    return this.http.get<ReportJobStatus>(
      `${this.base}/reports/${encodeURIComponent(jobId)}`
    );
  }

  getImpression(eventId: string): Observable<ImpressionEventDetail> {
    return this.http.get<ImpressionEventDetail>(
      `${this.base}/reports/impressions/${encodeURIComponent(eventId)}`
    );
  }

  getBilling(from: Date, to: Date): Observable<BillingReportResponse> {
    const params = new HttpParams()
      .set('from', from.toISOString())
      .set('to', to.toISOString());
    return this.http.get<BillingReportResponse>(`${this.base}/reports/billing`, {
      params,
    });
  }
}
