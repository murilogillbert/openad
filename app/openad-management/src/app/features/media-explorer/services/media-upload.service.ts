import { Injectable } from '@angular/core';
import { MEDIA_CLIENT_LIMITS } from '../media-limits';

export type PreflightResult =
  | { ok: true }
  | { ok: false; reason: string };

@Injectable({ providedIn: 'root' })
export class MediaUploadService {
  preflight(file: File): PreflightResult {
    if (file.size > MEDIA_CLIENT_LIMITS.maxBytes) {
      return {
        ok: false,
        reason: `File exceeds ${Math.floor(MEDIA_CLIENT_LIMITS.maxBytes / 1_000_000)} MB limit`,
      };
    }
    const lower = file.name.toLowerCase();
    const allowed = MEDIA_CLIENT_LIMITS.allowedExtensions.some((ext) =>
      lower.endsWith(ext)
    );
    if (!allowed) {
      return {
        ok: false,
        reason: `Allowed types: ${MEDIA_CLIENT_LIMITS.allowedExtensions.join(', ')}`,
      };
    }
    return { ok: true };
  }

  /**
   * Size + extension + dimensions (images / video metadata). Matches API probe rules when limits align.
   */
  async preflightAsync(file: File): Promise<PreflightResult> {
    const sync = this.preflight(file);
    if (!sync.ok) {
      return sync;
    }
    const ct = this.guessContentType(file);
    const { maxWidth: mw, maxHeight: mh } = MEDIA_CLIENT_LIMITS;
    try {
      if (ct === 'image/jpeg' || ct === 'image/png') {
        const { width, height } = await this.probeImageDimensions(file);
        if (width > mw || height > mh) {
          return {
            ok: false,
            reason: `Resolution ${width}×${height} exceeds max ${mw}×${mh}`,
          };
        }
      } else if (ct === 'video/mp4') {
        const { width, height } = await this.probeVideoDimensions(file);
        if (width > mw || height > mh) {
          return {
            ok: false,
            reason: `Resolution ${width}×${height} exceeds max ${mw}×${mh}`,
          };
        }
      }
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not read file';
      return { ok: false, reason: msg };
    }
  }

  private probeImageDimensions(file: File): Promise<{ width: number; height: number }> {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file).then((bmp) => {
        try {
          return { width: bmp.width, height: bmp.height };
        } finally {
          bmp.close();
        }
      });
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read image dimensions'));
      };
      img.src = url;
    });
  }

  private probeVideoDimensions(file: File): Promise<{
    width: number;
    height: number;
  }> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.playsInline = true;
      v.onloadedmetadata = () => {
        const width = v.videoWidth;
        const height = v.videoHeight;
        URL.revokeObjectURL(url);
        v.remove();
        if (!width || !height) {
          reject(new Error('Could not read video dimensions'));
          return;
        }
        resolve({ width, height });
      };
      v.onerror = () => {
        URL.revokeObjectURL(url);
        v.remove();
        reject(new Error('Could not read video metadata'));
      };
      v.src = url;
    });
  }

  guessContentType(file: File): string {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.mp4')) {
      return 'video/mp4';
    }
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      return 'image/jpeg';
    }
    if (lower.endsWith('.png')) {
      return 'image/png';
    }
    return file.type || 'application/octet-stream';
  }
}
