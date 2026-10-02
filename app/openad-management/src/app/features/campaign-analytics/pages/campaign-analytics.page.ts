import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TableModule } from 'primeng/table';
import {
  CampaignAnalyticsApiService,
  type CampaignReportingSummaryDto,
} from '../services/campaign-analytics-api.service';

@Component({
  selector: 'app-campaign-analytics-page',
  standalone: true,
  imports: [
    CardModule,
    TableModule,
    ButtonModule,
    ProgressSpinnerModule,
    DatePipe,
    DecimalPipe,
  ],
  templateUrl: './campaign-analytics.page.html',
})
export class CampaignAnalyticsPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(CampaignAnalyticsApiService);
  private readonly messages = inject(MessageService);

  protected readonly loading = signal(false);
  protected readonly data = signal<CampaignReportingSummaryDto | null>(null);

  protected windowFrom = signal(new Date(Date.now() - 7 * 86400_000));
  protected windowTo = signal(new Date());

  ngOnInit(): void {
    void this.load();
  }

  protected load(): void {
    const campaignId = this.route.snapshot.paramMap.get('campaignId');
    if (!campaignId) {
      return;
    }
    this.loading.set(true);
    this.api
      .getCampaignSummary(campaignId, this.windowFrom(), this.windowTo())
      .subscribe({
        next: (res) => {
          this.data.set(res);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.messages.add({
            severity: 'error',
            summary: 'Failed to load campaign analytics',
          });
        },
      });
  }
}
