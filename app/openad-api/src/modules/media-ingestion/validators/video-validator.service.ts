import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import Ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import sizeOf from 'image-size';
import { PinoLogger } from 'nestjs-pino';
import { VideoCodec } from '@openad/api-contracts';
import { PlatformConfigRuntimeService } from '../../platform-config/platform-config-runtime.service';

/**
 * DOOH video floor / ceiling not shown on the platform UI; fixed API contract for validation.
 * (Platform UI controls min/max duration span via max duration; this is the shortest valid clip.)
 */
// DOOH ads are commonly 10–15s; allow short clips while keeping a floor against corrupt probes.
const VIDEO_MIN_DURATION_SEC = 10;
/** Upper bound for encoded video bitrate when ffprobe reports bit_rate (bps). */
const VIDEO_MAX_BITRATE_BPS = 10_000_000;

export interface ValidatedVideoMetadata {
  bitrate: number;
  width: number;
  height: number;
  codec: VideoCodec;
  duration: number;
}

function ffprobeAsync(path: string): Promise<Ffmpeg.FfprobeData> {
  return new Promise((resolve, reject) => {
    Ffmpeg.ffprobe(path, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(data);
    });
  });
}

@Injectable()
export class VideoValidatorService {
  constructor(
    private readonly platform: PlatformConfigRuntimeService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(VideoValidatorService.name);
  }

  private limits() {
    const m = this.platform.get().mediaLimits;
    return {
      maxBytes: m.maxVideoBytes,
      maxBitrate: VIDEO_MAX_BITRATE_BPS,
      maxWidth: m.maxWidth,
      maxHeight: m.maxHeight,
      minDuration: VIDEO_MIN_DURATION_SEC,
      maxDuration: m.maxDurationSeconds,
    };
  }

  async validateFile(params: {
    filePath: string;
    byteLength: number;
  }): Promise<ValidatedVideoMetadata> {
    const limits = this.limits();
    if (params.byteLength > limits.maxBytes) {
      throw new BadRequestException({
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File size exceeds ${limits.maxBytes} byte limit`,
        },
      });
    }

    let probe: Ffmpeg.FfprobeData;
    try {
      probe = await ffprobeAsync(params.filePath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn({ err: msg }, 'ffprobe failed');
      throw new ServiceUnavailableException({
        error: {
          code: 'PROBE_FAILED',
          message: 'Unable to read video metadata (ffprobe). Ensure FFmpeg is installed on the API host.',
        },
      });
    }

    const video = probe.streams?.find((s) => s.codec_type === 'video');
    if (!video) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'No video stream found',
        },
      });
    }

    const codecName = (video.codec_name ?? '').toLowerCase();
    let codec: VideoCodec;
    if (codecName === 'h264' || codecName === 'avc1') {
      codec = VideoCodec.H264;
    } else if (codecName === 'hevc' || codecName === 'h265') {
      codec = VideoCodec.H265;
    } else {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: `Unsupported codec: ${codecName} (allowed: h264, h265)`,
        },
      });
    }

    const width = video.width ?? 0;
    const height = video.height ?? 0;
    if (width > limits.maxWidth || height > limits.maxHeight) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: `Resolution ${width}x${height} exceeds maximum ${limits.maxWidth}x${limits.maxHeight}`,
          details: { resolution: `${width}x${height}` },
        },
      });
    }

    const duration = Number(probe.format?.duration ?? 0);
    if (
      duration < limits.minDuration ||
      duration > limits.maxDuration ||
      !Number.isFinite(duration)
    ) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: `Duration ${duration}s outside allowed range ${limits.minDuration}-${limits.maxDuration}s`,
        },
      });
    }

    const bitrate = Number(
      video.bit_rate ?? probe.format?.bit_rate ?? 0
    );
    if (!Number.isFinite(bitrate) || bitrate <= 0) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Could not determine video bitrate',
        },
      });
    }
    if (bitrate > limits.maxBitrate) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: `Bitrate ${bitrate} exceeds maximum ${limits.maxBitrate} bps`,
        },
      });
    }

    return {
      bitrate,
      width,
      height,
      codec,
      duration,
    };
  }

  /**
   * Probe a video buffer via temp file (VFS presigned uploads).
   */
  async validateVideoFromBuffer(params: {
    buffer: Buffer;
    byteLength: number;
  }): Promise<ValidatedVideoMetadata> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openad-vfs-vid-'));
    const tmp = path.join(dir, `probe-${randomUUID()}.mp4`);
    try {
      await fs.writeFile(tmp, params.buffer);
      return await this.validateFile({
        filePath: tmp,
        byteLength: params.byteLength,
      });
    } finally {
      await fs.unlink(tmp).catch(() => undefined);
      await fs.rmdir(dir).catch(() => undefined);
    }
  }

  /**
   * Static image dimensions for JPEG/PNG (DOOH resolution gate).
   */
  async validateImageFromBuffer(params: {
    buffer: Buffer;
    byteLength: number;
  }): Promise<ValidatedVideoMetadata> {
    const limits = this.limits();
    if (params.byteLength > limits.maxBytes) {
      throw new BadRequestException({
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File size exceeds ${limits.maxBytes} byte limit`,
        },
      });
    }
    let dim: { width?: number; height?: number };
    try {
      dim = sizeOf(params.buffer);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException({
        error: {
          code: 'IMAGE_PROBE_FAILED',
          message: msg,
        },
      });
    }
    const width = dim.width ?? 0;
    const height = dim.height ?? 0;
    if (width > limits.maxWidth || height > limits.maxHeight) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: `Resolution ${width}x${height} exceeds maximum ${limits.maxWidth}x${limits.maxHeight}`,
        },
      });
    }
    return {
      bitrate: 1_000_000,
      width,
      height,
      codec: VideoCodec.H264,
      /**
       * Segundos que a imagem fica na tela, da configuração da plataforma.
       *
       * Era `10` cravado aqui, e isso produzia uma divergência real: a regra de monetização
       * cobra 15 s por imagem, o manifesto repassa este `duration` ao tablet, e o tablet o usa
       * para decidir quanto tempo exibir. Com 10 gravado, a imagem ficava 10 s na tela e seria
       * cobrada por 15 — ou cobrada por 10, dependendo de qual dos dois números se olhasse.
       *
       * Agora os dois lados saem da mesma chave (`monetization.imageDisplaySeconds`), então
       * mudar o tempo de exibição é uma edição no admin e não um deploy.
       *
       * As imagens enviadas **antes** desta mudança continuam com 10 gravado. O faturamento
       * não depende disso: ele deriva o tipo do criativo e usa a configuração para imagem (ver
       * `monetization/pricing.policy.ts`). O que essas imagens antigas têm de errado é só o
       * tempo de tela, até serem reenviadas.
       */
      duration: Math.max(
        1,
        Math.floor(this.platform.get().monetization.imageDisplaySeconds)
      ),
    };
  }
}
