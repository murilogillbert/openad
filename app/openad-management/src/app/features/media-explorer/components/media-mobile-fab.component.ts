import { Component, OnInit, output } from '@angular/core';
import { MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { SpeedDialModule } from 'primeng/speeddial';

/** Touch-friendly FAB dimensions (SpeedDial default actions use `size="small"`). */
const FAB_BTN_DIM = { width: '3.75rem', height: '3.75rem' } as const;

@Component({
  selector: 'app-media-mobile-fab',
  standalone: true,
  imports: [ButtonModule, SpeedDialModule],
  template: `
    <p-speeddial
      [model]="items"
      type="linear"
      direction="up"
      [mask]="true"
      [(visible)]="dialVisible"
      ariaLabel="Media actions"
      [style]="{
        position: 'fixed',
        right: '1.25rem',
        bottom: '6rem',
        zIndex: 50,
      }"
      [tooltipOptions]="{ tooltipPosition: 'left' }"
    >
      <ng-template pTemplate="button" let-toggleCallback="toggleCallback">
        <p-button
          type="button"
          severity="primary"
          rounded
          size="large"
          [style]="fabBtnDim"
          [icon]="dialVisible ? 'pi pi-times' : 'pi pi-plus'"
          [attr.aria-expanded]="dialVisible"
          [attr.aria-label]="dialVisible ? 'Close media actions' : 'Open media actions'"
          (click)="toggleCallback($event)"
        />
      </ng-template>
      <ng-template pTemplate="item" let-item let-toggleCallback="toggleCallback">
        <p-button
          type="button"
          severity="secondary"
          rounded
          size="large"
          [style]="fabBtnDim"
          [icon]="item.icon ?? ''"
          [attr.aria-label]="item.label"
          (click)="toggleCallback($event, item)"
        />
      </ng-template>
    </p-speeddial>
  `,
})
export class MediaMobileFabComponent implements OnInit {
  readonly openUpload = output<void>();
  readonly openCreateFolder = output<void>();

  /** Synced with SpeedDial so the main toggle can swap plus/close icons. */
  dialVisible = false;

  protected readonly fabBtnDim = FAB_BTN_DIM;

  items: MenuItem[] = [];

  ngOnInit(): void {
    this.items = [
      {
        label: 'New folder',
        icon: 'pi pi-folder-plus',
        command: () => this.openCreateFolder.emit(),
      },
      {
        label: 'Upload file',
        icon: 'pi pi-upload',
        command: () => this.openUpload.emit(),
      },
    ];
  }
}
