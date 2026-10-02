import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageService } from 'primeng/api';
import { MediaVfsApiService } from '../services/media-vfs-api.service';

@Component({
  selector: 'app-media-create-folder-dialog',
  standalone: true,
  imports: [DialogModule, FormsModule, InputTextModule, ButtonModule],
  template: `
    <p-dialog
      header="New folder"
      [modal]="true"
      [draggable]="false"
      [dismissableMask]="true"
      [appendTo]="'body'"
      [style]="{ width: 'min(96vw, 24rem)' }"
      [visible]="visible"
      (visibleChange)="onVisibleChange($event)"
    >
      <label class="mb-2 block text-sm font-medium text-color" for="new-folder-name">
        Folder name
      </label>
      <input
        id="new-folder-name"
        pInputText
        type="text"
        class="w-full"
        [ngModel]="name()"
        (ngModelChange)="name.set($event)"
        (keydown.enter)="submit()"
        autocomplete="off"
      />
      <div class="mt-6 flex justify-end gap-2">
        <p-button label="Cancel" [text]="true" (onClick)="onVisibleChange(false)" />
        <p-button label="Create" icon="pi pi-check" (onClick)="submit()" />
      </div>
    </p-dialog>
  `,
})
export class MediaCreateFolderDialogComponent {
  private readonly api = inject(MediaVfsApiService);
  private readonly message = inject(MessageService);

  @Input({ required: true }) visible = false;
  @Input() parentFolderId: string | null = null;
  @Output() readonly visibleChange = new EventEmitter<boolean>();
  @Output() readonly folderCreated = new EventEmitter<{ id: string }>();

  readonly name = signal('');

  onVisibleChange(v: boolean): void {
    if (!v) {
      this.name.set('');
    }
    this.visibleChange.emit(v);
  }

  async submit(): Promise<void> {
    const label = this.name().trim();
    const parentId = this.parentFolderId;
    if (!label || !parentId) {
      return;
    }
    try {
      const created = await this.api.createFolder({ parentId, name: label });
      this.folderCreated.emit({ id: created.id });
      this.name.set('');
      this.visibleChange.emit(false);
    } catch {
      this.message.add({
        severity: 'error',
        summary: 'Could not create folder',
        detail: 'Check the name and try again.',
      });
    }
  }
}
