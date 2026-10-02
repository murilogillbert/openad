import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MediaVfsApiService } from '../services/media-vfs-api.service';

@Component({
  selector: 'app-media-asset-actions',
  standalone: true,
  imports: [ButtonModule, DialogModule, FormsModule, InputTextModule],
  template: `
    <div class="flex flex-wrap gap-2 pt-2">
      <p-button
        label="Clone here"
        icon="pi pi-copy"
        [outlined]="true"
        size="small"
        (onClick)="clone()"
      />
      <p-button
        label="Rename…"
        icon="pi pi-pencil"
        [outlined]="true"
        size="small"
        (onClick)="openRename()"
      />
      <p-button
        label="Delete"
        icon="pi pi-trash"
        severity="danger"
        [outlined]="true"
        size="small"
        (onClick)="confirmDelete()"
      />
    </div>

    <p-dialog
      header="Rename"
      [visible]="renameOpen()"
      (visibleChange)="renameOpen.set($event)"
      [modal]="true"
      [style]="{ width: 'min(100vw, 24rem)' }"
    >
      <div class="flex flex-col gap-3">
        <input
          pInputText
          class="w-full"
          [(ngModel)]="renameDraft"
          placeholder="Filename"
        />
        <p-button label="Save" (onClick)="saveRename()" />
      </div>
    </p-dialog>
  `,
})
export class MediaAssetActionsComponent {
  private readonly api = inject(MediaVfsApiService);
  private readonly messages = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);

  @Input({ required: true }) mediaId!: string;
  @Input({ required: true }) folderId!: string;
  @Input() filename = '';
  @Output() changed = new EventEmitter<void>();

  readonly renameOpen = signal(false);
  renameDraft = '';

  openRename(): void {
    this.renameDraft = this.filename;
    this.renameOpen.set(true);
  }

  async clone(): Promise<void> {
    try {
      await this.api.cloneAsset(this.mediaId, { targetFolderId: this.folderId });
      this.messages.add({
        severity: 'success',
        summary: 'Cloned',
        detail: 'Placement duplicated in this folder',
      });
      this.changed.emit();
    } catch (e) {
      this.messages.add({
        severity: 'error',
        summary: 'Clone failed',
        detail: e instanceof Error ? e.message : 'Error',
      });
    }
  }

  async saveRename(): Promise<void> {
    const name = this.renameDraft.trim();
    if (!name) {
      return;
    }
    try {
      await this.api.patchAsset(this.mediaId, { filename: name });
      this.renameOpen.set(false);
      this.messages.add({ severity: 'success', summary: 'Renamed' });
      this.changed.emit();
    } catch (e) {
      this.messages.add({
        severity: 'error',
        summary: 'Rename failed',
        detail: e instanceof Error ? e.message : 'Error',
      });
    }
  }

  confirmDelete(): void {
    this.confirmation.confirm({
      message: 'Remove this placement from the folder? Storage is deleted only when no copies remain.',
      header: 'Delete media placement',
      icon: 'pi pi-exclamation-triangle',
      accept: () => void this.runDelete(),
    });
  }

  private async runDelete(): Promise<void> {
    try {
      await this.api.deleteAsset(this.mediaId);
      this.messages.add({ severity: 'success', summary: 'Deleted' });
      this.changed.emit();
    } catch (e) {
      this.messages.add({
        severity: 'error',
        summary: 'Delete failed',
        detail: e instanceof Error ? e.message : 'Error',
      });
    }
  }
}
