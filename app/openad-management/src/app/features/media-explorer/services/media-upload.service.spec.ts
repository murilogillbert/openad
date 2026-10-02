import { MediaUploadService } from './media-upload.service';
import { MEDIA_CLIENT_LIMITS } from '../media-limits';

describe('MediaUploadService', () => {
  const svc = new MediaUploadService();

  it('rejects oversize files', () => {
    const file = new File([new Uint8Array(10)], 'x.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'size', { value: MEDIA_CLIENT_LIMITS.maxBytes + 1 });
    const r = svc.preflight(file);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('MB');
    }
  });

  it('rejects bad extensions', () => {
    const file = new File([new Uint8Array(4)], 'x.exe', {
      type: 'application/octet-stream',
    });
    const r = svc.preflight(file);
    expect(r.ok).toBe(false);
  });

  it('accepts mp4', () => {
    const file = new File([new Uint8Array(100)], 'a.mp4', { type: 'video/mp4' });
    expect(svc.preflight(file)).toEqual({ ok: true });
  });
});
