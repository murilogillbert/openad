import {
  booleanAttribute,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { BreadcrumbModule } from 'primeng/breadcrumb';
import { TooltipModule } from 'primeng/tooltip';
import type { MenuItem } from 'primeng/api';

@Component({
  selector: 'app-media-explorer-toolbar',
  standalone: true,
  imports: [
    FormsModule,
    InputTextModule,
    ButtonModule,
    IconFieldModule,
    InputIconModule,
    BreadcrumbModule,
    TooltipModule,
  ],
  template: `
    <div
      class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between w-full min-h-[3rem]"
    >
      @if (searchMode) {
        <div class="flex min-w-0 flex-col gap-1 lg:max-w-[min(100%,28rem)]">
          <span class="text-xs font-bold uppercase tracking-wider text-muted-color">Search results</span>
          <span class="truncate text-sm text-muted-color">
            In
            <span class="font-semibold text-color">{{ scopeLabel || 'folder' }}</span>
          </span>
        </div>
      } @else if (showBreadcrumb && crumbs.length > 0) {
        <p-breadcrumb [model]="crumbs" styleClass="bg-transparent border-none p-0" />
      }
      <div class="flex flex-1 flex-wrap items-center gap-3 justify-stretch lg:justify-end min-w-0">
        <p-iconfield class="flex-1 min-w-[12rem] max-w-xl">
          <p-inputicon class="pi pi-search" />
          <input
            pInputText
            type="search"
            placeholder="Search folders and files…"
            [(ngModel)]="searchText"
            (ngModelChange)="searchChange.emit($event)"
            class="w-full rounded-xl shadow-sm"
          />
        </p-iconfield>
        <div class="flex items-center gap-2 shrink-0">
          <p-button
            icon="pi pi-th-large"
            [rounded]="true"
            [outlined]="view !== 'grid'"
            (onClick)="viewChange.emit('grid')"
            pTooltip="Grid"
            tooltipPosition="bottom"
            aria-label="Grid view"
          />
          <p-button
            icon="pi pi-list"
            [rounded]="true"
            [outlined]="view !== 'list'"
            (onClick)="viewChange.emit('list')"
            pTooltip="List"
            tooltipPosition="bottom"
            aria-label="List view"
          />
        </div>
      </div>
    </div>
  `,
})
export class MediaExplorerToolbarComponent {
  /** When false, only search + view toggles are shown (breadcrumbs rendered elsewhere). */
  @Input({ transform: booleanAttribute }) showBreadcrumb = true;
  /** Explorer-style search: hide path breadcrumb and show scope hint. */
  @Input({ transform: booleanAttribute }) searchMode = false;
  @Input() scopeLabel = '';
  @Input() crumbs: MenuItem[] = [];
  @Input() view: 'grid' | 'list' = 'grid';
  @Input() searchText = '';
  @Output() searchChange = new EventEmitter<string>();
  @Output() viewChange = new EventEmitter<'grid' | 'list'>();
}
