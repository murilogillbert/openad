# Quickstart Guide: Media Orchestration & Manifest Pipeline

**Feature**: 004-media-orchestration-pipeline  
**Date**: 2026-04-05  
**Audience**: Developers implementing this feature

## Overview

This guide provides step-by-step instructions for implementing the Media Orchestration & Manifest Pipeline feature. Follow these steps in order to build the system incrementally, with tests written before implementation (TDD approach).

## Prerequisites

- Node.js 20 LTS installed
- pnpm package manager
- Docker and Docker Compose (for local MongoDB, Redis, S3)
- FFmpeg installed locally (for video validation testing)
- Android Studio (for tablet client development)

## Phase 1: Backend Setup

### Step 1: Install Dependencies

```bash
# Navigate to workspace root
cd /path/to/openad-monorepo

# Install new dependencies for media processing
pnpm add fluent-ffmpeg @aws-sdk/client-s3 mqtt
pnpm add -D @types/fluent-ffmpeg

# Verify existing dependencies are installed
# (mongoose, @nestjs/jwt, @nestjs/mongoose, bullmq, ioredis already in package.json)
```

### Step 2: Set Up Local Development Environment

The root `docker-compose.yml` includes **MinIO** (S3 API on `${MINIO_API_PORT:-9000}`, embedded web console on `${MINIO_CONSOLE_PORT:-9001}`; image pinned before upstream removed the bundled UI). For MQTT, use **RabbitMQ** from the same file (`MQTT_URL=mqtt://openad:openad-dev-mqtt@127.0.0.1:1884` per `.env.example`).

```bash
pnpm docker:up
pnpm minio:init-media-bucket   # after MinIO is healthy; requires aws CLI
```

### Step 3: Configure Environment Variables

Add to `.env`:

```bash
# S3 Storage (MinIO for dev — match docker/.env.dev / compose MINIO_ROOT_*)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
S3_ENDPOINT=http://127.0.0.1:9000
S3_FORCE_PATH_STYLE=true
S3_BUCKET=openad-media

# MQTT Broker (RabbitMQ MQTT from docker-compose)
MQTT_URL=mqtt://openad:openad-dev-mqtt@127.0.0.1:1884

# Media Validation
MAX_FILE_SIZE_MB=500
MAX_BITRATE_MBPS=10
MAX_RESOLUTION_WIDTH=1920
MAX_RESOLUTION_HEIGHT=1080
```

### Step 4: Create S3 Bucket (MinIO)

```bash
# Create bucket in MinIO (or use pnpm minio:init-media-bucket)
aws --endpoint-url=http://127.0.0.1:9000 s3 mb s3://openad-media
```

## Phase 2: Media Ingestion Module

### Step 5: Generate Module Structure

```bash
# Generate media-ingestion module
pnpm exec nx g @nx/nest:module media-ingestion --project=openad-api --directory=modules/media-ingestion

# Generate service and controller
pnpm exec nx g @nx/nest:service media-ingestion --project=openad-api --directory=modules/media-ingestion
pnpm exec nx g @nx/nest:controller media-ingestion --project=openad-api --directory=modules/media-ingestion
```

### Step 6: Write Tests First (TDD)

Create `app/openad-api/src/modules/media-ingestion/validators/video-validator.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { VideoValidatorService } from './video-validator.service';

describe('VideoValidatorService', () => {
  let service: VideoValidatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VideoValidatorService],
    }).compile();

    service = module.get<VideoValidatorService>(VideoValidatorService);
  });

  describe('validateVideo', () => {
    it('should accept valid H.264 video within constraints', async () => {
      const result = await service.validateVideo('./test/fixtures/valid-ad.mp4');
      
      expect(result.isValid).toBe(true);
      expect(result.metadata.codec).toBe('h264');
      expect(result.metadata.bitrate).toBeLessThanOrEqual(10_000_000);
      expect(result.metadata.width).toBeLessThanOrEqual(1920);
      expect(result.metadata.height).toBeLessThanOrEqual(1080);
    });

    it('should reject video with excessive bitrate', async () => {
      const result = await service.validateVideo('./test/fixtures/high-bitrate.mp4');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Bitrate exceeds maximum 10 Mbps');
    });

    it('should reject video with unsupported codec', async () => {
      const result = await service.validateVideo('./test/fixtures/vp9-video.webm');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Codec must be H.264 or H.265');
    });
  });
});
```

Create test fixtures:

```bash
mkdir -p app/openad-api/test/fixtures
# Generate small test videos with FFmpeg
ffmpeg -f lavfi -i testsrc=duration=10:size=1280x720:rate=30 \
  -c:v libx264 -b:v 5M -pix_fmt yuv420p \
  app/openad-api/test/fixtures/valid-ad.mp4
```

### Step 7: Implement Video Validator

Create `app/openad-api/src/modules/media-ingestion/validators/video-validator.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import * as ffmpeg from 'fluent-ffmpeg';

export interface VideoMetadata {
  codec: string;
  bitrate: number;
  width: number;
  height: number;
  duration: number;
  fileSize: number;
}

export interface ValidationResult {
  isValid: boolean;
  metadata?: VideoMetadata;
  errors: string[];
}

@Injectable()
export class VideoValidatorService {
  private readonly MAX_BITRATE = 10_000_000; // 10 Mbps
  private readonly MAX_WIDTH = 1920;
  private readonly MAX_HEIGHT = 1080;
  private readonly MIN_DURATION = 30;
  private readonly MAX_DURATION = 120;
  private readonly ALLOWED_CODECS = ['h264', 'hevc'];

  async validateVideo(filePath: string): Promise<ValidationResult> {
    const errors: string[] = [];

    try {
      const metadata = await this.extractMetadata(filePath);

      // Validate codec
      if (!this.ALLOWED_CODECS.includes(metadata.codec)) {
        errors.push('Codec must be H.264 or H.265');
      }

      // Validate bitrate
      if (metadata.bitrate > this.MAX_BITRATE) {
        errors.push(`Bitrate ${metadata.bitrate} exceeds maximum ${this.MAX_BITRATE} bps`);
      }

      // Validate resolution
      if (metadata.width > this.MAX_WIDTH || metadata.height > this.MAX_HEIGHT) {
        errors.push(`Resolution ${metadata.width}x${metadata.height} exceeds maximum ${this.MAX_WIDTH}x${this.MAX_HEIGHT}`);
      }

      // Validate duration
      if (metadata.duration < this.MIN_DURATION || metadata.duration > this.MAX_DURATION) {
        errors.push(`Duration ${metadata.duration}s must be between ${this.MIN_DURATION}-${this.MAX_DURATION}s`);
      }

      return {
        isValid: errors.length === 0,
        metadata,
        errors,
      };
    } catch (error) {
      return {
        isValid: false,
        errors: [`Failed to validate video: ${error.message}`],
      };
    }
  }

  private async extractMetadata(filePath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }

        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        if (!videoStream) {
          reject(new Error('No video stream found'));
          return;
        }

        resolve({
          codec: videoStream.codec_name,
          bitrate: parseInt(videoStream.bit_rate || metadata.format.bit_rate),
          width: videoStream.width,
          height: videoStream.height,
          duration: parseFloat(metadata.format.duration),
          fileSize: parseInt(metadata.format.size),
        });
      });
    });
  }
}
```

### Step 8: Run Tests

```bash
pnpm exec nx test openad-api --testFile=video-validator.service.spec.ts
```

**Expected**: Tests pass (Green phase of TDD)

### Step 9: Implement Hash Generator

Write test first:

```typescript
// app/openad-api/src/modules/media-ingestion/validators/hash-generator.service.spec.ts
describe('HashGeneratorService', () => {
  it('should generate consistent SHA-256 hash for same file', async () => {
    const hash1 = await service.generateHash('./test/fixtures/valid-ad.mp4');
    const hash2 = await service.generateHash('./test/fixtures/valid-ad.mp4');
    
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
    expect(hash1).toMatch(/^[a-f0-9]+$/);
  });
});
```

Implement:

```typescript
// app/openad-api/src/modules/media-ingestion/validators/hash-generator.service.ts
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';

@Injectable()
export class HashGeneratorService {
  async generateHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
}
```

### Step 10: Implement S3 Storage Service

Write test:

```typescript
// app/openad-api/src/modules/media-ingestion/storage/s3-storage.service.spec.ts
describe('S3StorageService', () => {
  it('should upload file to S3 and return URL', async () => {
    const url = await service.uploadFile('./test/fixtures/valid-ad.mp4', 'test-media-id.mp4');
    
    expect(url).toContain('s3://openad-media/test-media-id.mp4');
  });

  it('should generate pre-signed URL with 1 hour expiration', async () => {
    const url = await service.getPresignedUrl('test-media-id.mp4');
    
    expect(url).toContain('X-Amz-Expires=3600');
  });
});
```

Implement:

```typescript
// app/openad-api/src/modules/media-ingestion/storage/s3-storage.service.ts
import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { readFileSync } from 'fs';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class S3StorageService {
  private s3Client: S3Client;
  private bucket: string;

  constructor(private configService: ConfigService) {
    this.s3Client = new S3Client({
      region: this.configService.get('AWS_REGION'),
      endpoint: this.configService.get('AWS_ENDPOINT'),
      credentials: {
        accessKeyId: this.configService.get('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.get('AWS_SECRET_ACCESS_KEY'),
      },
    });
    this.bucket = this.configService.get('S3_BUCKET');
  }

  async uploadFile(filePath: string, key: string): Promise<string> {
    const fileContent = readFileSync(filePath);

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: fileContent,
        ContentType: 'video/mp4',
      })
    );

    return `s3://${this.bucket}/${key}`;
  }

  async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.s3Client, command, { expiresIn });
  }
}
```

## Phase 3: Manifest Module

### Step 11: Generate Manifest Module

```bash
pnpm exec nx g @nx/nest:module manifest --project=openad-api --directory=modules/manifest
pnpm exec nx g @nx/nest:service manifest --project=openad-api --directory=modules/manifest
pnpm exec nx g @nx/nest:controller manifest --project=openad-api --directory=modules/manifest
```

### Step 12: Implement Delta Calculator (TDD)

Write test:

```typescript
// app/openad-api/src/modules/manifest/generators/delta-calculator.service.spec.ts
describe('DeltaCalculatorService', () => {
  it('should calculate delta when one ad added', () => {
    const oldManifest = { media: [{ mediaId: 'ad1', priority: 10 }] };
    const newManifest = { media: [{ mediaId: 'ad1', priority: 10 }, { mediaId: 'ad2', priority: 8 }] };

    const delta = service.calculateDelta(oldManifest, newManifest);

    expect(delta.operations).toHaveLength(1);
    expect(delta.operations[0].op).toBe('add');
    expect(delta.operations[0].value.mediaId).toBe('ad2');
  });

  it('should calculate delta when one ad removed', () => {
    const oldManifest = { media: [{ mediaId: 'ad1' }, { mediaId: 'ad2' }] };
    const newManifest = { media: [{ mediaId: 'ad1' }] };

    const delta = service.calculateDelta(oldManifest, newManifest);

    expect(delta.operations).toHaveLength(1);
    expect(delta.operations[0].op).toBe('remove');
  });
});
```

Implement delta calculator following the test requirements.

## Phase 4: Tablet Client

### Step 13: Generate Sync Module

```bash
pnpm exec nx g @nx/angular:module features/sync --project=openad-ad-client
pnpm exec nx g @nx/angular:service features/sync/services/sync-orchestrator --project=openad-ad-client
```

### Step 14: Implement Download Manager (TDD)

Write test:

```typescript
// app/openad-ad-client/src/app/features/sync/services/download-manager.service.spec.ts
describe('DownloadManagerService', () => {
  it('should download file with progress tracking', async () => {
    const progress$ = service.downloadFile('https://example.com/ad.mp4', '/local/path/ad.mp4');

    const progressUpdates: number[] = [];
    progress$.subscribe(p => progressUpdates.push(p.downloadedBytes));

    await lastValueFrom(progress$);

    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[progressUpdates.length - 1]).toBe(totalFileSize);
  });

  it('should resume download from last byte on interruption', async () => {
    // Simulate download interrupted at 60%
    await service.downloadFile(url, path).pipe(take(60)).toPromise();

    // Resume download
    const progress$ = service.resumeDownload(url, path);

    // Verify Range header sent with last byte offset
    expect(httpClient.get).toHaveBeenCalledWith(url, {
      headers: { Range: 'bytes=600000-' }
    });
  });
});
```

Implement download manager with resumable downloads using Angular HttpClient and Capacitor Filesystem.

### Step 15: Implement Playback Engine

Write test:

```typescript
// app/openad-ad-client/src/app/features/playback/services/playback-engine.service.spec.ts
describe('PlaybackEngineService', () => {
  it('should prevent same ad playing twice in a row', async () => {
    const queue = [
      { mediaId: 'ad1', priority: 10 },
      { mediaId: 'ad2', priority: 10 },
      { mediaId: 'ad3', priority: 8 },
    ];

    service.loadQueue(queue);

    const first = await service.getNextAd();
    const second = await service.getNextAd();

    expect(first.mediaId).not.toBe(second.mediaId);
  });

  it('should play factory default when no ads available', async () => {
    service.loadQueue([]);

    const ad = await service.getNextAd();

    expect(ad.isFactoryDefault).toBe(true);
  });
});
```

Implement playback engine with priority queue and constraint filtering.

## Phase 5: Integration & Testing

### Step 16: Run Integration Tests

```bash
# Backend integration tests
pnpm exec nx test openad-api

# Frontend unit tests
pnpm exec nx test openad-ad-client

# E2E tests
pnpm exec nx e2e openad-api-e2e
```

### Step 17: Manual Testing Workflow

1. **Upload Media**:
   ```bash
   curl -X POST http://localhost:3000/v1/media/upload \
     -H "Authorization: Bearer <admin_jwt>" \
     -F "file=@test-ad.mp4" \
     -F "categorization=universal"
   ```

2. **Fetch Manifest** (from tablet):
   ```bash
   curl -X POST http://localhost:3000/v1/manifest \
     -H "Authorization: Bearer <device_jwt>" \
     -H "Content-Type: application/json" \
     -d '{"deviceId":"test-device","deviceState":{"latitude":40.7128,"longitude":-74.0060}}'
   ```

3. **Send Priority Command** (via MQTT):
   ```bash
   mosquitto_pub -h localhost -t devices/test-device/priority \
     -m '{"commandId":"cmd-001","deviceId":"test-device","mediaId":"ad-001","priority":5,"expiresAt":"2026-04-05T15:00:00Z","createdAt":"2026-04-05T14:30:00Z"}'
   ```

4. **Test Tablet Sync**:
   - Open tablet app in Android emulator
   - Verify manifest fetched on startup
   - Verify ads download with progress
   - Verify hash verification
   - Verify playback loop starts

## Phase 6: Update Agent Context

### Step 18: Run Agent Context Update Script

```bash
cd /path/to/openad-monorepo
.specify/scripts/bash/update-agent-context.sh cursor-agent
```

This updates `.cursor/rules/specify-rules.mdc` with the new technologies and patterns from this feature.

## Troubleshooting

### FFmpeg Not Found

```bash
# Ubuntu/Debian
sudo apt-get install ffmpeg

# macOS
brew install ffmpeg
```

### MinIO S3 connection issues

```bash
# Verify MinIO API is up
curl -sf http://127.0.0.1:9000/minio/health/live

# Web console (embedded UI; pinned image — see docker-compose.yml)
# http://127.0.0.1:9001 — login with S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY from docker/.env.dev

# List buckets
aws --endpoint-url=http://127.0.0.1:9000 s3 ls
```

### MQTT Connection Issues

```bash
# Test MQTT connection
mosquitto_sub -h localhost -t test/topic -v

# Check Mosquitto logs
docker logs openad-mosquitto
```

## Next Steps

After completing the quickstart:

1. Review code coverage (target: 80%+)
2. Run linter: `pnpm exec nx lint openad-api`
3. Generate OpenAPI docs: `pnpm exec nx run openad-api:openapi`
4. Deploy to staging environment
5. Run load tests (1000 concurrent manifest requests)
6. Monitor performance metrics (manifest generation time, download speeds)

## Resources

- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- [AWS SDK for JavaScript](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
- [MQTT.js Documentation](https://github.com/mqttjs/MQTT.js)
- [Capacitor Filesystem API](https://capacitorjs.com/docs/apis/filesystem)
- [NestJS Testing](https://docs.nestjs.com/fundamentals/testing)
- [Angular Testing](https://angular.io/guide/testing)
