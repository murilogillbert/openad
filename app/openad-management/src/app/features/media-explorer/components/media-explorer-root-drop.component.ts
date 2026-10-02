import { CommonModule } from '@angular/common';
import {
  Component,
  ContentChild,
  EventEmitter,
  Input,
  Output,
  TemplateRef,
  ViewChild,
  inject,
} from '@angular/core';
import { FileUpload, FileUploadModule } from 'primeng/fileupload';
import type { FileUploadHandlerEvent } from 'primeng/types/fileupload';
import { MEDIA_CLIENT_LIMITS } from '../media-limits';
import { MediaVfsUploadRunnerService } from '../services/media-vfs-upload-runner.service';

/**
 * Wraps the media explorer main pane with PrimeNG {@link FileUpload} (advanced +
 * custom upload). Drag/drop uses PrimeNG’s `.p-fileupload-content` handling.
 *
 * Project the explorer UI as:
 * ```html
 * <ng-template #mediaExplorerDropBody>...</ng-template>
 * ```
 */
@Component({
  selector: 'app-media-explorer-root-drop',
  standalone: true,
  imports: [CommonModule, FileUploadModule],
  template: `
    <p-fileupload
      #fu
      mode="advanced"
      name="mediaExplorer[]"
      url="/media/vfs/uploads"
      [customUpload]="true"
      [auto]="true"
      [multiple]="true"
      [showUploadButton]="false"
      [showCancelButton]="false"
      accept=".mp4,.jpg,.jpeg,.png"
      [maxFileSize]="limits.maxBytes"
      [unstyled]="true"
      [styleClass]="
        'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ' +
        '[&>input]:sr-only [&>input]:pointer-events-none [&_.p-fileupload-header]:hidden ' +
        '[&_.p-fileupload-content]:flex [&_.p-fileupload-content]:min-h-0 [&_.p-fileupload-content]:min-w-0 ' +
        '[&_.p-fileupload-content]:flex-1 [&_.p-fileupload-content]:flex-col [&_.p-fileupload-content]:overflow-hidden ' +
        '[&_.p-fileupload-content]:border-none [&_.p-fileupload-content]:bg-transparent [&_.p-fileupload-content]:p-0'
      "
      (uploadHandler)="onUploadHandler($event)"
    >
      <ng-template pTemplate="header"></ng-template>
      <ng-template pTemplate="content">
        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ng-container *ngTemplateOutlet="bodyTpl ?? null" />
        </div>
      </ng-template>
    </p-fileupload>
  `,
})
export class MediaExplorerRootDropComponent {
  private readonly runner = inject(MediaVfsUploadRunnerService);

  readonly limits = MEDIA_CLIENT_LIMITS;

  @ContentChild('mediaExplorerDropBody', { static: true })
  bodyTpl?: TemplateRef<unknown>;

  @ViewChild('fu') private fu?: FileUpload;

  @Input() folderId: string | null = null;
  @Output() readonly uploadFinished = new EventEmitter<void>();

  async onUploadHandler(event: FileUploadHandlerEvent): Promise<void> {
    const files = event.files ?? [];
    if (!files.length) {
      return;
    }
    await this.runner.uploadDroppedFilesWithFeedback(
      files,
      this.folderId,
      () => this.uploadFinished.emit()
    );
    this.fu?.clear();
  }
}
