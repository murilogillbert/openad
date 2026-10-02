import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import type { CampaignRow } from './campaigns-api.service';

@Component({
  selector: 'app-campaign-list',
  standalone: true,
  imports: [FormsModule, InputTextModule, NgTemplateOutlet],
  templateUrl: './campaign-list.component.html',
})
export class CampaignListComponent {
  readonly campaigns = input<CampaignRow[]>([]);
  readonly totalCount = input(0);
  readonly loading = input(false);
  readonly searchQuery = input('');
  readonly searchQueryChange = output<string>();
  readonly activate = output<CampaignRow>();
  readonly pauseRequested = output<CampaignRow>();
  readonly resumeRequested = output<CampaignRow>();
  readonly duplicateRequested = output<void>();
  readonly reportRequested = output<void>();
}
