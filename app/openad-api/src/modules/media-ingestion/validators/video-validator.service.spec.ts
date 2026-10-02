import { BadRequestException } from '@nestjs/common';
import Ffmpeg from 'fluent-ffmpeg';
import { PinoLogger } from 'nestjs-pino';
import { VideoCodec } from '@openad/api-contracts';
import { PlatformConfigRuntimeService } from '../../platform-config/platform-config-runtime.service';
import { VideoValidatorService } from './video-validator.service';

jest.mock('fluent-ffmpeg', () => ({
  __esModule: true,
  default: {
    ffprobe: jest.fn(),
  },
}));

describe('VideoValidatorService', () => {
  const ffprobeMock = Ffmpeg.ffprobe as jest.Mock;

  const makeService = () => {
    const platform = {
      get: () => ({
        mediaLimits: {
          maxVideoBytes: 999_999_999,
          maxWidth: 1920,
          maxHeight: 1080,
          maxDurationSeconds: 600,
        },
      }),
    } as unknown as PlatformConfigRuntimeService;
    const logger = {
      setContext: jest.fn(),
      warn: jest.fn(),
    } as unknown as PinoLogger;
    return new VideoValidatorService(platform, logger);
  };

  beforeEach(() => {
    ffprobeMock.mockReset();
  });

  it('returns metadata for a valid H.264 stream', async () => {
    ffprobeMock.mockImplementation(
      (_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [
            {
              codec_type: 'video',
              codec_name: 'h264',
              width: 1280,
              height: 720,
              bit_rate: '5000000',
            },
          ],
          format: { duration: '60', bit_rate: '5000000' },
        });
      }
    );
    const svc = makeService();
    const r = await svc.validateFile({
      filePath: '/tmp/x.mp4',
      byteLength: 1000,
    });
    expect(r.codec).toBe(VideoCodec.H264);
    expect(r.width).toBe(1280);
    expect(r.duration).toBe(60);
  });

  it('rejects when bitrate exceeds limit', async () => {
    ffprobeMock.mockImplementation(
      (_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [
            {
              codec_type: 'video',
              codec_name: 'h264',
              width: 1280,
              height: 720,
              bit_rate: '20000000',
            },
          ],
          format: { duration: '60', bit_rate: '20000000' },
        });
      }
    );
    const svc = makeService();
    await expect(
      svc.validateFile({ filePath: '/tmp/x.mp4', byteLength: 1000 })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
