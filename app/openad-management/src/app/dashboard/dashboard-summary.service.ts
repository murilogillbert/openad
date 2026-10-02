import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { DashboardSummaryResponse } from '@openad/api-contracts';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class DashboardSummaryService {
  private readonly http = inject(HttpClient);

  getSummary() {
    return this.http.get<DashboardSummaryResponse>(
      `${environment.apiBaseUrl}/dashboard/summary`
    );
  }
}
