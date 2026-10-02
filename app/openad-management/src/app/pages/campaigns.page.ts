import {
  Component,
  computed,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { CampaignListComponent } from '../campaigns/campaign-list.component';
import { CampaignWizardComponent } from '../campaigns/campaign-wizard.component';
import {
  CampaignsApiService,
  type CampaignRow,
} from '../campaigns/campaigns-api.service';

@Component({
  selector: 'app-campaigns-page',
  standalone: true,
  imports: [CampaignListComponent, CampaignWizardComponent],
  templateUrl: './campaigns.page.html',
})
export class CampaignsPage implements OnInit {
  private readonly api = inject(CampaignsApiService);
  private readonly message = inject(MessageService);
  private readonly router = inject(Router);
  protected readonly wizRef = viewChild<CampaignWizardComponent>('wiz');
  protected readonly rows = signal<CampaignRow[]>([]);
  protected readonly loading = signal(false);
  protected readonly searchQuery = signal('');

  protected readonly filtered = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const rows = this.rows();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.advertiserName.toLowerCase().includes(q)
    );
  });

  protected readonly kpiActive = computed(
    () => this.rows().filter((c) => c.status === 'active').length
  );

  ngOnInit(): void {
    this.refresh();
  }

  protected refresh(): void {
    this.loading.set(true);
    this.api.listCampaigns().subscribe({
      next: (res) => {
        this.rows.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.rows.set([]);
        this.loading.set(false);
      },
    });
  }

  protected updateSearch(q: string): void {
    this.searchQuery.set(q);
  }

  protected onActivate(row: CampaignRow): void {
    this.api
      .patchCampaignStatus(row.campaignId, { status: 'active' })
      .subscribe({
        next: () => this.refresh(),
      });
  }

  protected onPause(row: CampaignRow): void {
    this.api
      .patchCampaignStatus(row.campaignId, { status: 'paused' })
      .subscribe({
        next: () => this.refresh(),
      });
  }

  protected onResume(row: CampaignRow): void {
    this.api
      .patchCampaignStatus(row.campaignId, { status: 'active' })
      .subscribe({
        next: () => this.refresh(),
      });
  }

  protected onDuplicate(): void {
    this.message.add({
      severity: 'info',
      summary: 'Coming soon',
      detail: 'Campaign duplication is not available yet.',
    });
  }

  protected onReport(): void {
    void this.router.navigateByUrl('/reports');
  }
}
