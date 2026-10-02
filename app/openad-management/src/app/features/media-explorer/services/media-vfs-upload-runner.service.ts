import { Injectable, inject } from '@angular/core';
import { MessageService } from 'primeng/api';
import { MediaUploadService } from './media-upload.service';
import { MediaVfsApiService } from './media-vfs-api.service';

/**
 * Shared VFS upload pipeline (init → proxy → complete) used by the dialog dropzone
 * and the explorer root drop target.
 */
@Injectable({ providedIn: 'root' })
export class MediaVfsUploadRunnerService {
  private readonly upload = inject(MediaUploadService);
  private readonly api = inject(MediaVfsApiService);
  private readonly messages = inject(MessageService);

  /**
   * Single file; throws on failure. No toasts (callers handle UX).
   * Returns the complete-upload payload (e.g. validation status).
   */
  async uploadOneFile(
    file: File,
    folderId: string | null,
    onProgress?: (percent: number) => void
  ): Promise<Record<string, unknown>> {
    const contentType = this.upload.guessContentType(file);
    const init = await this.api.initUpload({
      filename: file.name,
      contentType,
      ...(folderId ? { folderId } : {}),
    });
    await this.api.uploadSessionViaProxy(init.sessionId, file, (loaded, total) => {
      onProgress?.(Math.round((loaded / total) * 100));
    });
    return (await this.api.completeUpload(
      init.sessionId
    )) as Record<string, unknown>;
  }

  /**
   * Explorer root: preflight, toasts, optional reload callback after each success.
   */
  async uploadDroppedFilesWithFeedback(
    files: File[],
    folderId: string | null,
    onEachSuccess?: () => void
  ): Promise<void> {
    for (const file of files) {
      const pre = await this.upload.preflightAsync(file);
      if (!pre.ok) {
        this.messages.add({
          severity: 'warn',
          summary: 'File skipped',
          detail: `${file.name}: ${pre.reason}`,
        });
        continue;
      }
      try {
        await this.uploadOneFile(file, folderId);
        this.messages.add({
          severity: 'success',
          summary: 'Upload complete',
          detail: file.name,
        });
        onEachSuccess?.();
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Upload failed';
        this.messages.add({
          severity: 'error',
          summary: 'Upload failed',
          detail: msg,
        });
      }
    }
  }
}
