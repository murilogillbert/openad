import {
  HttpClient,
  HttpEvent,
  HttpEventType,
  HttpResponse,
} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { filter, map, tap } from 'rxjs/operators';
import type {
  CreateMediaFolderRequest,
  MediaFolderNode,
  PatchMediaFolderRequest,
  UploadSessionInitResponse,
} from '@openad/api-contracts';
import { environment } from '../../../../environments/environment';
import { messageFromApiHttpError } from '../utils/media-api-error';

@Injectable({ providedIn: 'root' })
export class MediaVfsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  async patchFolder(
    folderId: string,
    body: PatchMediaFolderRequest
  ): Promise<MediaFolderNode> {
    const r = await firstValueFrom(
      this.http.patch<{ success: boolean; data: MediaFolderNode }>(
        `${this.base}/media/vfs/folders/${encodeURIComponent(folderId)}`,
        body
      )
    );
    return r.data;
  }

  async deleteFolder(folderId: string): Promise<void> {
    await firstValueFrom(
      this.http.delete<{ success: boolean }>(
        `${this.base}/media/vfs/folders/${encodeURIComponent(folderId)}`
      )
    );
  }

  async createFolder(body: CreateMediaFolderRequest): Promise<MediaFolderNode> {
    const r = await firstValueFrom(
      this.http.post<{ success: boolean; data: MediaFolderNode }>(
        `${this.base}/media/vfs/folders`,
        body
      )
    );
    return r.data;
  }

  async listFolderTree(): Promise<MediaFolderNode[]> {
    const r = await firstValueFrom(
      this.http.get<{ success: boolean; data: MediaFolderNode[] }>(
        `${this.base}/media/vfs/folders/tree`
      )
    );
    return r.data;
  }

  async listChildren(folderId: string, q?: string): Promise<MediaFolderNode[]> {
    const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
    const r = await firstValueFrom(
      this.http.get<{ success: boolean; data: MediaFolderNode[] }>(
        `${this.base}/media/vfs/folders/${encodeURIComponent(folderId)}/children${qs}`
      )
    );
    return r.data;
  }

  /**
   * Recursive search under `scopeFolderId`: matching subfolder names and file names in the subtree.
   */
  async vfsSearch(
    scopeFolderId: string,
    q: string
  ): Promise<{ folders: MediaFolderNode[]; files: unknown[] }> {
    const sp = new URLSearchParams();
    sp.set('scopeFolderId', scopeFolderId);
    sp.set('q', q.trim());
    const r = await firstValueFrom(
      this.http.get<{
        success: boolean;
        data: { folders: MediaFolderNode[]; files: unknown[] };
      }>(`${this.base}/media/vfs/folders/search?${sp.toString()}`)
    );
    return r.data;
  }

  async listFolderAssets(
    folderId: string,
    params?: { page?: number; limit?: number; q?: string }
  ): Promise<{ data: unknown[]; pagination: { total: number; page: number; limit: number } }> {
    const sp = new URLSearchParams();
    if (params?.page) {
      sp.set('page', String(params.page));
    }
    if (params?.limit) {
      sp.set('limit', String(params.limit));
    }
    if (params?.q?.trim()) {
      sp.set('q', params.q.trim());
    }
    const qs = sp.toString() ? `?${sp.toString()}` : '';
    const r = await firstValueFrom(
      this.http.get<{
        success: boolean;
        data: {
          data: unknown[];
          pagination: { total: number; page: number; limit: number };
        };
      }>(
        `${this.base}/media/vfs/folders/${encodeURIComponent(folderId)}/assets${qs}`
      )
    );
    return r.data;
  }

  async initUpload(body: {
    filename: string;
    contentType: string;
    campaignIds?: string[];
    folderId?: string;
    campaignId?: string;
  }): Promise<UploadSessionInitResponse> {
    try {
      const r = await firstValueFrom(
        this.http.post<{ success: boolean; data: UploadSessionInitResponse }>(
          `${this.base}/media/vfs/uploads`,
          body
        )
      );
      return r.data;
    } catch (e) {
      throw new Error(messageFromApiHttpError(e));
    }
  }

  /**
   * Upload session bytes via API (multipart); object storage is reached only server-side.
   */
  async uploadSessionViaProxy(
    sessionId: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    try {
      await firstValueFrom(
        this.http
          .post(
            `${this.base}/media/vfs/uploads/${encodeURIComponent(sessionId)}/proxy`,
            formData,
            { reportProgress: true, observe: 'events' }
          )
          .pipe(
            tap((e) => {
              if (
                e.type === HttpEventType.UploadProgress &&
                e.total != null &&
                onProgress
              ) {
                onProgress(e.loaded, e.total);
              }
            }),
            filter(
              (e: HttpEvent<unknown>): e is HttpResponse<unknown> =>
                e.type === HttpEventType.Response
            ),
            map((e: HttpResponse<unknown>) => {
              if (e.status >= 200 && e.status < 300) {
                return;
              }
              throw new Error(`Upload failed: HTTP ${e.status}`);
            })
          )
      );
    } catch (e) {
      throw new Error(messageFromApiHttpError(e));
    }
  }

  async completeUpload(sessionId: string): Promise<Record<string, unknown>> {
    try {
      const r = await firstValueFrom(
        this.http.post<{ success: boolean; data: Record<string, unknown> }>(
          `${this.base}/media/vfs/uploads/${encodeURIComponent(sessionId)}/complete`,
          {}
        )
      );
      return r.data;
    } catch (e) {
      throw new Error(messageFromApiHttpError(e));
    }
  }

  async getAsset(mediaId: string): Promise<Record<string, unknown> & { referenceCount?: number }> {
    const r = await firstValueFrom(
      this.http.get<{ success: boolean; data: Record<string, unknown> }>(
        `${this.base}/media/vfs/assets/${encodeURIComponent(mediaId)}`
      )
    );
    return r.data as Record<string, unknown> & { referenceCount?: number };
  }

  async cloneAsset(
    mediaId: string,
    body: { targetFolderId: string; filename?: string }
  ): Promise<{ mediaId: string }> {
    const r = await firstValueFrom(
      this.http.post<{ success: boolean; data: { mediaId: string } }>(
        `${this.base}/media/vfs/assets/${encodeURIComponent(mediaId)}/clone`,
        body
      )
    );
    return r.data;
  }

  async patchAsset(
    mediaId: string,
    body: { filename?: string; folderId?: string }
  ): Promise<unknown> {
    const r = await firstValueFrom(
      this.http.patch<{ success: boolean; data: unknown }>(
        `${this.base}/media/vfs/assets/${encodeURIComponent(mediaId)}`,
        body
      )
    );
    return r.data;
  }

  async deleteAsset(mediaId: string): Promise<void> {
    await firstValueFrom(
      this.http.delete<{ success: boolean }>(
        `${this.base}/media/vfs/assets/${encodeURIComponent(mediaId)}`
      )
    );
  }
}
