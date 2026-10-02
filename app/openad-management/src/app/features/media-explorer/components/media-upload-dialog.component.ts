import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DialogModule } from 'primeng/dialog';
import { FieldsetModule } from 'primeng/fieldset';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { MediaUploadDropzoneComponent } from './media-upload-dropzone.component';

@Component({
  selector: 'app-media-upload-dialog',
  standalone: true,
  imports: [DialogModule, FieldsetModule, ToastModule, MediaUploadDropzoneComponent],
  providers: [MessageService],
  template: `
    <p-toast position="top-center" />
    <p-dialog
      [header]="'Upload media'"
      [modal]="true"
      [draggable]="false"
      [dismissableMask]="true"
      [style]="{ width: 'min(96vw, 36rem)' }"
      [visible]="visible"
      (visibleChange)="visibleChange.emit($event)"
    >
      <p-fieldset legend="To current folder" [toggleable]="true">
        <p class="text-muted-color text-sm mb-3">
          Files are stored in the folder selected in the tree.
        </p>
        <app-media-upload-dropzone
          [folderId]="folderId"
          (uploadFinished)="vfsUploadFinished.emit()"
        />
      </p-fieldset>
    </p-dialog>
  `,
})
export class MediaUploadDialogComponent {
  @Input({ required: true }) visible = false;
  @Input() folderId: string | null = null;
  @Output() readonly visibleChange = new EventEmitter<boolean>();
  @Output() readonly vfsUploadFinished = new EventEmitter<void>();
}
