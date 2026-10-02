# Data Model: Media Orchestration & Manifest Pipeline

**Feature**: 004-media-orchestration-pipeline  
**Date**: 2026-04-05  
**Purpose**: Define entity schemas, relationships, and validation rules

## Overview

This document defines the data models for the Media Orchestration & Manifest Pipeline. The system uses MongoDB for metadata storage with Mongoose schemas. All models follow the domain entities defined in the feature specification.

## Entity Relationship Diagram

```text
┌─────────────────┐
│   MediaAsset    │
│  (Video File)   │
└────────┬────────┘
         │
         │ referenced by
         │
         ▼
┌─────────────────┐       ┌──────────────┐
│    Manifest     │◄──────│   Device     │
│ (Desired State) │  for  │  (Tablet)    │
└────────┬────────┘       └──────────────┘
         │
         │ contains
         │
         ▼
┌─────────────────┐
│  ManifestItem   │
│  (Embedded)     │
└────────┬────────┘
         │
         │ has
         │
         ▼
┌─────────────────┐
│   Constraint    │
│  (Embedded)     │
└─────────────────┘

┌──────────────────┐
│ PriorityCommand  │
│  (MQTT Message)  │
└──────────────────┘
```

## Core Entities

### 1. MediaAsset

Represents a video advertisement file with validation metadata and content hash.

**MongoDB Schema** (`app/openad-api/src/modules/media-ingestion/schemas/media-asset.schema.ts`):

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum MediaCategorization {
  UNIVERSAL = 'universal',
  CONDITIONAL = 'conditional',
}

export enum VideoCodec {
  H264 = 'h264',
  H265 = 'h265',
}

@Schema({ timestamps: true })
export class MediaAsset extends Document {
  @Prop({ required: true, unique: true })
  mediaId: string; // UUID v4
  
  @Prop({ required: true, unique: true, index: true })
  hash: string; // SHA-256 hex string (64 chars)
  
  @Prop({ required: true })
  filename: string; // Original filename
  
  @Prop({ required: true })
  fileSize: number; // Bytes (max 500MB = 524,288,000)
  
  @Prop({ required: true })
  bitrate: number; // Bits per second (max 10,000,000)
  
  @Prop({ required: true })
  width: number; // Pixels (max 1920)
  
  @Prop({ required: true })
  height: number; // Pixels (max 1080)
  
  @Prop({ required: true, enum: VideoCodec })
  codec: VideoCodec;
  
  @Prop({ required: true })
  duration: number; // Seconds (30-120)
  
  @Prop({ required: true, enum: MediaCategorization, index: true })
  categorization: MediaCategorization;
  
  @Prop({ required: true })
  storageUrl: string; // S3 URL (s3://bucket/key)
  
  @Prop({ type: Object })
  constraints?: {
    geofence?: {
      type: 'Polygon';
      coordinates: number[][][]; // GeoJSON Polygon
    };
    timeWindows?: Array<{
      startHour: number; // 0-23 (UTC)
      endHour: number;   // 0-23 (UTC)
    }>;
    speedRange?: {
      minKmh: number;
      maxKmh: number;
    };
  };
  
  @Prop()
  uploadedBy?: string; // User ID (optional, for audit)
  
  @Prop({ default: true })
  isActive: boolean; // Soft delete flag
  
  // Timestamps (createdAt, updatedAt) added by { timestamps: true }
}

export const MediaAssetSchema = SchemaFactory.createForClass(MediaAsset);

// Indexes
MediaAssetSchema.index({ hash: 1 }, { unique: true });
MediaAssetSchema.index({ categorization: 1, createdAt: -1 });
MediaAssetSchema.index({ isActive: 1 });
```

**Validation Rules**:
- `mediaId`: UUID v4 format
- `hash`: 64-character hex string (SHA-256)
- `fileSize`: 1 ≤ fileSize ≤ 524,288,000 (500MB)
- `bitrate`: 1 ≤ bitrate ≤ 10,000,000 (10 Mbps)
- `width`: 1 ≤ width ≤ 1920
- `height`: 1 ≤ height ≤ 1080
- `codec`: Must be 'h264' or 'h265'
- `duration`: 30 ≤ duration ≤ 120 (seconds)
- `constraints.geofence`: Valid GeoJSON Polygon
- `constraints.timeWindows`: 0 ≤ hour ≤ 23, startHour < endHour
- `constraints.speedRange`: 0 ≤ minKmh < maxKmh ≤ 200

**State Transitions**:
- `isActive: true` → Video available for distribution
- `isActive: false` → Video soft-deleted, excluded from new manifests

### 2. Manifest

Represents the desired media state for a specific device (tablet).

**MongoDB Schema** (`app/openad-api/src/modules/manifest/schemas/manifest.schema.ts`):

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export class ManifestItem {
  @Prop({ required: true })
  mediaId: string; // References MediaAsset.mediaId
  
  @Prop({ required: true })
  hash: string; // SHA-256 for integrity verification
  
  @Prop({ required: true })
  priority: number; // 1-100 (higher = more important)
  
  @Prop({ required: true })
  downloadUrl: string; // Pre-signed S3 URL (expires in 1 hour)
  
  @Prop({ type: Object })
  constraints?: {
    timeWindows?: Array<{
      startHour: number;
      endHour: number;
    }>;
    speedRange?: {
      minKmh: number;
      maxKmh: number;
    };
  };
}

@Schema({ timestamps: true })
export class Manifest extends Document {
  @Prop({ required: true, index: true })
  deviceId: string; // References Device.deviceId
  
  @Prop({ required: true })
  version: string; // ISO 8601 timestamp (e.g., "2026-04-05T14:30:00Z")
  
  @Prop({ type: [ManifestItem], default: [] })
  media: ManifestItem[];
  
  @Prop()
  previousVersion?: string; // For delta calculation
  
  @Prop({ default: false })
  isDelta: boolean; // True if this is a delta manifest
  
  @Prop({ type: Object })
  deviceState?: {
    latitude?: number;
    longitude?: number;
    speed?: number; // km/h
    timestamp?: Date;
  };
  
  // Timestamps (createdAt, updatedAt) added by { timestamps: true }
}

export const ManifestSchema = SchemaFactory.createForClass(Manifest);

// Indexes
ManifestSchema.index({ deviceId: 1, version: -1 });
ManifestSchema.index({ deviceId: 1, createdAt: -1 });
```

**Validation Rules**:
- `deviceId`: Must reference existing Device
- `version`: ISO 8601 timestamp format
- `media`: Array of ManifestItem (0-100 items)
- `media[].priority`: 1 ≤ priority ≤ 100
- `media[].downloadUrl`: Valid HTTPS URL
- `deviceState.latitude`: -90 ≤ lat ≤ 90
- `deviceState.longitude`: -180 ≤ lon ≤ 180
- `deviceState.speed`: 0 ≤ speed ≤ 200

**State Transitions**:
- New manifest created → `version` = current timestamp
- Delta manifest → `isDelta: true`, `previousVersion` set
- Full manifest → `isDelta: false`, `previousVersion` null

### 3. Device

Represents a tablet device in the fleet.

**MongoDB Schema** (`app/openad-api/src/modules/devices/schemas/device.schema.ts`):

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum DeviceStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  MAINTENANCE = 'maintenance',
}

@Schema({ timestamps: true })
export class Device extends Document {
  @Prop({ required: true, unique: true, index: true })
  deviceId: string; // UUID v4
  
  @Prop({ required: true })
  name: string; // Human-readable name (e.g., "Vehicle 001")
  
  @Prop({ required: true, enum: DeviceStatus })
  status: DeviceStatus;
  
  @Prop()
  lastManifestVersion?: string; // ISO 8601 timestamp
  
  @Prop()
  lastSyncAt?: Date; // Last successful manifest fetch
  
  @Prop({ type: Object })
  lastKnownState?: {
    latitude?: number;
    longitude?: number;
    speed?: number; // km/h
    timestamp?: Date;
  };
  
  @Prop()
  storageCapacity?: number; // Bytes (e.g., 5GB = 5,368,709,120)
  
  @Prop()
  storageUsed?: number; // Bytes (updated by tablet)
  
  @Prop()
  vehicleId?: string; // Optional reference to Vehicle entity
  
  // Timestamps (createdAt, updatedAt) added by { timestamps: true }
}

export const DeviceSchema = SchemaFactory.createForClass(Device);

// Indexes
DeviceSchema.index({ deviceId: 1 }, { unique: true });
DeviceSchema.index({ status: 1 });
DeviceSchema.index({ lastSyncAt: -1 });
```

**Validation Rules**:
- `deviceId`: UUID v4 format
- `name`: 1-100 characters
- `status`: Must be 'active', 'inactive', or 'maintenance'
- `storageCapacity`: 1 ≤ capacity ≤ 10,737,418,240 (10GB)
- `storageUsed`: 0 ≤ used ≤ storageCapacity

**State Transitions**:
- `ACTIVE` → Device online and syncing
- `INACTIVE` → Device offline or not responding
- `MAINTENANCE` → Device temporarily out of service

### 4. PriorityCommand

Represents an MQTT command for priority/emergency ad playback.

**Domain Model** (`libs/domain/src/media/priority-command.model.ts`):

```typescript
export enum PriorityLevel {
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  URGENT = 4,
  EMERGENCY = 5,
}

export interface PriorityCommand {
  commandId: string; // UUID v4
  deviceId: string; // Target device (or '*' for broadcast)
  mediaId: string; // Media to play
  priority: PriorityLevel;
  expiresAt: Date; // ISO 8601 timestamp
  createdAt: Date;
}
```

**Validation Rules**:
- `commandId`: UUID v4 format
- `deviceId`: UUID v4 or '*' (broadcast)
- `mediaId`: Must reference existing MediaAsset
- `priority`: 1 ≤ priority ≤ 5
- `expiresAt`: Must be future timestamp (> now)

**State Transitions**:
- Command sent → Tablet receives via MQTT
- Command expired → Ignored by tablet (expiresAt < now)
- Command executed → Logged as impression

## Client-Side Models (Tablet)

### 5. SyncState

Tracks synchronization state on the tablet.

**TypeScript Interface** (`app/openad-ad-client/src/app/features/sync/models/sync-state.model.ts`):

```typescript
export enum SyncStatus {
  IDLE = 'idle',
  FETCHING_MANIFEST = 'fetching-manifest',
  DOWNLOADING = 'downloading',
  VERIFYING = 'verifying',
  PRUNING = 'pruning',
  COMPLETED = 'completed',
  ERROR = 'error',
}

export interface SyncState {
  status: SyncStatus;
  currentManifestVersion: string | null;
  lastSyncAt: Date | null;
  downloadProgress: DownloadProgress[];
  errors: SyncError[];
}

export interface DownloadProgress {
  mediaId: string;
  url: string;
  totalBytes: number;
  downloadedBytes: number;
  filePath: string;
  hash: string;
  status: 'pending' | 'downloading' | 'paused' | 'verifying' | 'completed' | 'failed';
  lastUpdated: Date;
  retryCount: number;
}

export interface SyncError {
  mediaId: string;
  error: string;
  timestamp: Date;
}
```

### 6. PlaybackState

Tracks playback state on the tablet.

**TypeScript Interface** (`app/openad-ad-client/src/app/features/playback/models/playback-state.model.ts`):

```typescript
export enum PlaybackStatus {
  IDLE = 'idle',
  PLAYING = 'playing',
  PAUSED = 'paused',
  LOADING = 'loading',
  ERROR = 'error',
}

export interface PlaybackState {
  status: PlaybackStatus;
  currentAd: Ad | null;
  queue: Ad[];
  lastPlayedId: string | null;
  isFactoryDefault: boolean;
  priorityQueue: PriorityAd[];
}

export interface Ad {
  mediaId: string;
  filePath: string;
  hash: string;
  priority: number;
  duration: number;
  constraints?: {
    timeWindows?: Array<{ startHour: number; endHour: number }>;
    speedRange?: { minKmh: number; maxKmh: number };
  };
}

export interface PriorityAd extends Ad {
  priorityLevel: number; // 1-5
  expiresAt: Date;
  commandId: string;
}
```

## Shared Contracts (Zod Schemas)

### 7. API Contracts

**Media Asset Contract** (`libs/api-contracts/src/media/media-asset.contract.ts`):

```typescript
import { z } from 'zod';

export const MediaCategorizationSchema = z.enum(['universal', 'conditional']);

export const VideoCodecSchema = z.enum(['h264', 'h265']);

export const GeofenceSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.array(z.number()))),
});

export const TimeWindowSchema = z.object({
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23),
});

export const SpeedRangeSchema = z.object({
  minKmh: z.number().min(0),
  maxKmh: z.number().max(200),
});

export const ConstraintsSchema = z.object({
  geofence: GeofenceSchema.optional(),
  timeWindows: z.array(TimeWindowSchema).optional(),
  speedRange: SpeedRangeSchema.optional(),
}).optional();

export const MediaAssetSchema = z.object({
  mediaId: z.string().uuid(),
  hash: z.string().length(64).regex(/^[a-f0-9]+$/),
  filename: z.string().min(1).max(255),
  fileSize: z.number().int().min(1).max(524_288_000),
  bitrate: z.number().int().min(1).max(10_000_000),
  width: z.number().int().min(1).max(1920),
  height: z.number().int().min(1).max(1080),
  codec: VideoCodecSchema,
  duration: z.number().min(30).max(120),
  categorization: MediaCategorizationSchema,
  storageUrl: z.string().url(),
  constraints: ConstraintsSchema,
  uploadedBy: z.string().optional(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type MediaAsset = z.infer<typeof MediaAssetSchema>;
```

**Manifest Contract** (`libs/api-contracts/src/media/manifest.contract.ts`):

```typescript
import { z } from 'zod';

export const ManifestItemSchema = z.object({
  mediaId: z.string().uuid(),
  hash: z.string().length(64).regex(/^[a-f0-9]+$/),
  priority: z.number().int().min(1).max(100),
  downloadUrl: z.string().url(),
  constraints: z.object({
    timeWindows: z.array(z.object({
      startHour: z.number().int().min(0).max(23),
      endHour: z.number().int().min(0).max(23),
    })).optional(),
    speedRange: z.object({
      minKmh: z.number().min(0),
      maxKmh: z.number().max(200),
    }).optional(),
  }).optional(),
});

export const ManifestSchema = z.object({
  deviceId: z.string().uuid(),
  version: z.string().datetime(),
  media: z.array(ManifestItemSchema).max(100),
  previousVersion: z.string().datetime().optional(),
  isDelta: z.boolean(),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestItem = z.infer<typeof ManifestItemSchema>;
```

### 8. MQTT Contracts

**Priority Command Contract** (`libs/mqtt-contracts/src/priority-command.contract.ts`):

```typescript
import { z } from 'zod';

export const PriorityLevelSchema = z.number().int().min(1).max(5);

export const PriorityCommandSchema = z.object({
  commandId: z.string().uuid(),
  deviceId: z.string().uuid().or(z.literal('*')),
  mediaId: z.string().uuid(),
  priority: PriorityLevelSchema,
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export type PriorityCommand = z.infer<typeof PriorityCommandSchema>;
```

## Validation Constraints Summary

| Entity | Field | Constraint | Rationale |
|--------|-------|------------|-----------|
| MediaAsset | fileSize | ≤ 500MB | Prevent storage exhaustion, mobile data limits |
| MediaAsset | bitrate | ≤ 10 Mbps | Ensure smooth playback on mobile processors |
| MediaAsset | resolution | ≤ 1920x1080 | Match typical tablet display resolution |
| MediaAsset | duration | 30-120s | Standard ad duration range |
| Manifest | media | ≤ 100 items | Prevent manifest bloat, reasonable ad rotation |
| ManifestItem | priority | 1-100 | Sufficient granularity for ad prioritization |
| Device | storageCapacity | ≤ 10GB | Realistic tablet storage allocation |
| PriorityCommand | priority | 1-5 | Five levels sufficient for emergency classification |

## Indexes and Query Patterns

### Common Queries

1. **Find media by hash** (deduplication):
   ```typescript
   MediaAsset.findOne({ hash: '...' });
   ```
   Index: `{ hash: 1 }` (unique)

2. **Get active universal media** (manifest generation):
   ```typescript
   MediaAsset.find({ categorization: 'universal', isActive: true });
   ```
   Index: `{ categorization: 1, isActive: 1 }`

3. **Get latest manifest for device**:
   ```typescript
   Manifest.findOne({ deviceId: '...' }).sort({ version: -1 });
   ```
   Index: `{ deviceId: 1, version: -1 }`

4. **Find devices not synced recently** (monitoring):
   ```typescript
   Device.find({ lastSyncAt: { $lt: new Date(Date.now() - 3600000) } });
   ```
   Index: `{ lastSyncAt: -1 }`

## Next Steps

Proceed to contract documentation:
- Define REST API endpoints
- Define MQTT topics and message formats
- Create quickstart guide for developers
