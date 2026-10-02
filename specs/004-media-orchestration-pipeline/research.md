# Research: Media Orchestration & Manifest Pipeline

**Feature**: 004-media-orchestration-pipeline  
**Date**: 2026-04-05  
**Purpose**: Document technical decisions, best practices, and implementation patterns

## 1. Video Validation & Processing

### Decision: FFprobe for Video Metadata Extraction

**Rationale**: 
- FFprobe (part of FFmpeg suite) is the industry standard for video metadata extraction
- Provides accurate bitrate, resolution, codec, and duration information
- Available as system dependency in Docker containers
- Can be invoked via child_process in Node.js

**Implementation Approach**:
- Install ffmpeg in Docker container (Alpine: `apk add ffmpeg`)
- Use `fluent-ffmpeg` npm package as Node.js wrapper
- Extract metadata before file upload completes (stream-based validation)
- Validation constraints from spec assumptions:
  - Max bitrate: 10 Mbps (10,000,000 bps)
  - Max resolution: 1920x1080 (Full HD)
  - Codecs: H.264 (avc1) or H.265 (hevc)
  - Max file size: 500MB
  - Duration: 30-120 seconds (standard ad length)

**Alternatives Considered**:
- **mediainfo**: Less commonly available, harder to integrate
- **Native Node.js libraries** (e.g., node-ffprobe): Wrapper around FFprobe anyway, adds dependency layer
- **Client-side validation**: Cannot be trusted (security risk)

**Best Practices**:
- Validate file size BEFORE processing (reject immediately if >500MB)
- Use streaming validation to avoid loading entire file into memory
- Set timeout for FFprobe execution (30 seconds max)
- Log validation failures with specific constraint violations
- Return structured error responses indicating which constraint failed

### Decision: SHA-256 for Content Hashing

**Rationale**:
- SHA-256 is cryptographically secure and industry standard
- Built into Node.js crypto module (no external dependencies)
- 256-bit hash provides sufficient collision resistance for media catalog
- Fast enough for large files when used with streaming

**Implementation Approach**:
```typescript
import { createHash } from 'crypto';
import { createReadStream } from 'fs';

function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
```

**Alternatives Considered**:
- **MD5**: Faster but cryptographically broken (collision attacks possible)
- **SHA-512**: Overkill for this use case, slower, larger hash size
- **BLAKE3**: Faster but requires external library, less widely supported

**Best Practices**:
- Calculate hash during upload (streaming) to avoid re-reading file
- Store hash in lowercase hex format for consistency
- Use hash as content-addressable storage key (deduplication)
- Verify hash on tablet after download (integrity check)

## 2. Manifest Delta Calculation

### Decision: Version-Based Delta with JSON Patch

**Rationale**:
- Manifests are JSON documents, making JSON Patch (RFC 6902) a natural fit
- Version-based approach: each manifest has a version number/timestamp
- Delta = operations to transform version N to version N+1
- Reduces bandwidth by 70-90% for typical updates (1-2 ads changed out of 20)

**Implementation Approach**:
- Store last manifest version per device in MongoDB
- On manifest request, compare current state to desired state
- Generate delta operations: `add`, `remove`, `replace`
- Client applies delta to local manifest copy
- Fallback to full manifest if delta calculation fails or version mismatch

**Delta Format**:
```json
{
  "version": "2026-04-05T14:30:00Z",
  "previousVersion": "2026-04-04T10:15:00Z",
  "operations": [
    { "op": "add", "path": "/media/-", "value": { "id": "abc123", "hash": "...", "priority": 5 } },
    { "op": "remove", "path": "/media/2" }
  ]
}
```

**Alternatives Considered**:
- **Full manifest always**: Simple but wastes bandwidth (fails SC-007 requirement)
- **Custom diff format**: Reinventing the wheel, JSON Patch is standardized
- **Binary diff (bsdiff)**: Overkill for JSON, requires native libraries

**Best Practices**:
- Cache last manifest per device in Redis (fast lookup)
- Set TTL on cached manifests (7 days) to prevent unbounded growth
- Include version in manifest request (client sends last known version)
- Server validates version before calculating delta
- If version mismatch or too old, send full manifest
- Client validates delta application (hash check on result)

### Decision: Constraint Evaluation on Server

**Rationale**:
- Server evaluates geofence, time, speed constraints when generating manifest
- Reduces tablet complexity (no need to filter locally)
- Ensures tablets only download relevant ads (saves storage and bandwidth)
- Enables dynamic targeting based on real-time device state

**Implementation Approach**:
- Tablet reports GPS location, speed, and timestamp in manifest request
- Server evaluates constraints for each ad:
  - **Geofence**: Point-in-polygon test (use turf.js or similar)
  - **Time**: Compare current time to time windows (UTC-based)
  - **Speed**: Compare current speed to min/max range
- Only include ads that pass all applicable constraints
- Universal ads (no constraints) always included

**Alternatives Considered**:
- **Client-side filtering**: Requires downloading all ads first (wastes storage)
- **Hybrid approach**: Complex, hard to debug, inconsistent state

**Best Practices**:
- Use UTC for all time comparisons (avoid timezone issues)
- Implement constraint evaluation as separate service (testable, reusable)
- Cache constraint evaluation results (Redis) if device state unchanged
- Log constraint evaluation decisions for debugging
- Handle missing device state gracefully (default to universal ads only)

## 3. Resumable Downloads

### Decision: HTTP Range Requests (RFC 7233)

**Rationale**:
- Standard HTTP feature supported by all CDNs and S3-compatible storage
- Client sends `Range: bytes=X-Y` header to request partial content
- Server responds with `206 Partial Content` and requested byte range
- Enables resuming downloads from last successfully received byte

**Implementation Approach**:
- **Server**: Ensure S3 storage supports byte-range requests (enabled by default)
- **Client**: Track download progress in local database (IndexedDB or SQLite)
- On download interruption, save last received byte offset
- On retry, send `Range: bytes={lastOffset}-` header
- Verify hash after complete download (not partial chunks)

**Storage of Download Progress**:
```typescript
interface DownloadProgress {
  mediaId: string;
  url: string;
  totalBytes: number;
  downloadedBytes: number;
  filePath: string;
  hash: string;
  lastUpdated: Date;
  status: 'in-progress' | 'paused' | 'completed' | 'failed';
}
```

**Alternatives Considered**:
- **Custom chunking protocol**: Reinventing HTTP, unnecessary complexity
- **No resumption**: Fails FR-020, FR-021 requirements
- **WebRTC data channels**: Overkill, requires signaling server

**Best Practices**:
- Validate `Accept-Ranges: bytes` header before attempting resumption
- Implement exponential backoff for retries (1s, 2s, 4s, 8s, max 60s)
- Set timeout for each chunk download (30 seconds)
- Limit concurrent downloads (3-5 max) to avoid overwhelming network
- Clean up partial downloads after 24 hours if not resumed (FR-004)
- Use native HTTP client with streaming support (Angular HttpClient with responseType: 'blob')

### Decision: Capacitor Filesystem API for Local Storage

**Rationale**:
- Capacitor Filesystem plugin provides cross-platform file I/O
- Supports Android native storage (app-specific directory)
- Handles permissions automatically
- Provides async API compatible with Angular/RxJS

**Implementation Approach**:
- Store media files in `Filesystem.Directory.Data` (app-specific, not user-accessible)
- Use media ID as filename: `{mediaId}.mp4`
- Track file metadata in IndexedDB (faster than filesystem queries)
- Implement storage quota management (FR-024)

**Storage Management Strategy**:
```typescript
// When storage full, delete lowest-priority ads
async function pruneStorage(requiredBytes: number): Promise<void> {
  const availableSpace = await getAvailableSpace();
  if (availableSpace >= requiredBytes) return;
  
  const localAds = await getLocalAds(); // From IndexedDB
  const sortedByPriority = localAds.sort((a, b) => a.priority - b.priority);
  
  let freedSpace = 0;
  for (const ad of sortedByPriority) {
    if (freedSpace >= requiredBytes) break;
    await deleteFile(ad.filePath);
    freedSpace += ad.fileSize;
  }
}
```

**Alternatives Considered**:
- **IndexedDB for files**: Limited to ~50MB per file, not suitable for video
- **Native Android storage APIs**: Requires custom Capacitor plugin, more complex
- **External storage (SD card)**: Requires permissions, not reliable

**Best Practices**:
- Check available storage before starting download
- Prune storage proactively (before download, not during)
- Keep factory default ads in assets (read-only, not deletable)
- Implement storage health check on app startup
- Log storage operations for debugging

## 4. Playback Loop Logic

### Decision: Priority Queue with Constraint Filtering

**Rationale**:
- Ads have priority values (manifest-defined)
- Higher priority = plays more frequently
- Constraints (time, geofence, speed) filter eligible ads
- Loop prevents same ad twice in a row (unless only ad available)

**Implementation Approach**:
- Load manifest into memory on app startup
- Build priority queue: ads sorted by priority (descending)
- On each ad completion:
  1. Filter ads by current constraints (time, GPS, speed)
  2. Select next ad from filtered queue (highest priority)
  3. If selected ad == last played ad, select second-highest
  4. If no eligible ads, play factory default loop
- Priority queue rebuilds on manifest update

**Priority Queue Algorithm**:
```typescript
class AdQueue {
  private ads: Ad[];
  private lastPlayedId: string | null = null;
  
  getNext(constraints: Constraints): Ad | null {
    const eligible = this.ads.filter(ad => this.meetsConstraints(ad, constraints));
    if (eligible.length === 0) return null;
    
    // Sort by priority descending
    eligible.sort((a, b) => b.priority - a.priority);
    
    // Avoid repeating last ad
    if (eligible.length > 1 && eligible[0].id === this.lastPlayedId) {
      return eligible[1];
    }
    
    return eligible[0];
  }
  
  markPlayed(adId: string): void {
    this.lastPlayedId = adId;
  }
}
```

**Alternatives Considered**:
- **Random selection**: Doesn't respect priority (fails FR-025)
- **Round-robin**: Doesn't respect priority, complex with constraints
- **Weighted random**: Unnecessarily complex for this use case

**Best Practices**:
- Rebuild queue on manifest update (not just append/remove)
- Handle edge case: all ads filtered out by constraints (play factory default)
- Preload next ad while current ad playing (seamless transition)
- Log playback events for impression tracking
- Handle video playback errors gracefully (skip to next ad)

### Decision: Factory Default Loop in APK Assets

**Rationale**:
- Ensures passengers never see empty screen (FR-033, FR-034)
- Embedded in APK at build time (always available, even offline)
- 2-3 generic ads (brand awareness, safety messages)
- Total size: ~50-100MB (acceptable APK size increase)

**Implementation Approach**:
- Store default ads in `app/openad-ad-client/capacitor/assets/factory-default-ads/`
- Copy to Capacitor assets during build (accessible via Filesystem API)
- Load default loop on app startup (before manifest fetch)
- Switch to downloaded ads once manifest sync completes
- Fallback to default loop if no downloaded ads available

**Best Practices**:
- Use low-bitrate videos for defaults (reduce APK size)
- Compress with H.264 baseline profile (maximum compatibility)
- Test default loop on fresh install (no network)
- Update default ads with app releases (not dynamically)

## 5. MQTT Priority Commands

### Decision: MQTT.js Client with QoS 1

**Rationale**:
- MQTT is lightweight pub/sub protocol ideal for IoT/mobile
- QoS 1 (at least once delivery) ensures priority commands not lost
- Topic-based routing: `/devices/{deviceId}/priority` for targeted commands
- Persistent session: client reconnects automatically after network loss

**Implementation Approach**:
- Use `@capgo/capacitor-mqtt` plugin (Capacitor-compatible MQTT client)
- Subscribe to device-specific topic on app startup
- On priority command received:
  1. Parse command payload (media ID, priority level, expiration)
  2. Verify media file exists locally (download if missing)
  3. Queue priority ad to play after current ad completes
  4. Resume normal loop after priority ad finishes
- Maintain priority queue separate from normal queue

**Message Format**:
```json
{
  "type": "priority",
  "mediaId": "abc123",
  "priority": 1,
  "expiresAt": "2026-04-05T15:00:00Z"
}
```

**Alternatives Considered**:
- **WebSocket**: Requires custom server, more complex than MQTT
- **Push notifications**: Not real-time enough, requires user interaction
- **Polling**: Wastes bandwidth, high latency

**Best Practices**:
- Authenticate MQTT connection with JWT token (same as API)
- Use TLS for MQTT connection (mqtts://)
- Implement reconnection logic with exponential backoff
- Handle expired priority commands (check expiresAt before playing)
- Log priority command events for debugging
- Limit priority queue size (max 5 pending) to prevent abuse

## 6. Testing Strategy

### Decision: Test Pyramid with Contract Testing

**Rationale**:
- **Unit tests** (70%): Fast, isolated, test business logic
- **Integration tests** (20%): Test module interactions, database, external services
- **E2E tests** (10%): Test critical user flows end-to-end
- **Contract tests**: Validate API/MQTT contracts between services

**Test Coverage Targets**:
- Unit tests: 90% coverage for services, validators, calculators
- Integration tests: All API endpoints, database operations, MQTT handlers
- E2E tests: P1 user stories (upload, sync, playback)

**Testing Tools**:
- **Backend**: Jest with mongodb-memory-server, redis-memory-server
- **Frontend**: Vitest for unit tests, Playwright for e2e
- **Contract**: Zod schema validation in CI

**Key Test Scenarios**:
1. **Media Ingestion**:
   - Valid video upload → hash generated, stored in catalog
   - Invalid bitrate → rejected with error
   - Duplicate hash → deduplicated
   
2. **Manifest Generation**:
   - First request → full manifest
   - Subsequent request → delta manifest
   - Version mismatch → full manifest fallback
   
3. **Download Resumption**:
   - Download interrupted at 60% → resumes from 60%
   - Hash verification fails → re-download
   
4. **Playback Loop**:
   - 4 ads in queue → plays sequentially without repeat
   - All ads filtered by constraints → plays factory default
   - Priority command received → plays after current ad

**Best Practices**:
- Write tests before implementation (TDD, Principle VI)
- Use test fixtures for video files (small samples, <1MB)
- Mock external services (S3, MQTT broker) in unit tests
- Use real services in integration tests (memory servers)
- Run e2e tests in CI on every commit
- Measure and enforce coverage thresholds (80% minimum)

## 7. Security Considerations

### Decision: Multi-Layer Security

**Rationale**:
- **Authentication**: JWT tokens for API and MQTT
- **Authorization**: Role-based access control (admin, device)
- **Input validation**: Strict file upload limits, schema validation
- **File integrity**: SHA-256 hash verification prevents tampering
- **Network security**: TLS for all connections (HTTPS, MQTTS)

**Implementation Approach**:
- **API**: Use existing `@nestjs/jwt` and `@nestjs/passport` setup
- **File uploads**: Validate file type (MIME), size, and content (FFprobe)
- **S3 storage**: Use pre-signed URLs with expiration (1 hour)
- **MQTT**: Authenticate with JWT token in MQTT username field
- **Tablet**: Store JWT in secure storage (Capacitor Preferences with encryption)

**Security Checklist**:
- [ ] File upload size limit enforced (500MB)
- [ ] File type validation (video/mp4, video/quicktime)
- [ ] FFprobe validation prevents malicious files
- [ ] S3 pre-signed URLs expire after 1 hour
- [ ] JWT tokens expire after 24 hours (refresh required)
- [ ] MQTT connection uses TLS (mqtts://)
- [ ] Hash verification prevents file tampering
- [ ] Rate limiting on API endpoints (100 req/min per device)

**Best Practices**:
- Never trust client-provided metadata (always validate server-side)
- Log security events (failed auth, invalid uploads)
- Implement rate limiting to prevent abuse
- Use environment variables for secrets (never hardcode)
- Rotate JWT signing keys periodically (quarterly)

## 8. Performance Optimization

### Decision: Caching Strategy

**Rationale**:
- **Redis caching**: Manifests cached per device (fast lookup)
- **CDN**: S3 + CloudFront for media file delivery (low latency)
- **Database indexing**: Indexes on frequently queried fields
- **Lazy loading**: Tablet loads manifest on startup, not all metadata

**Caching Strategy**:
- **Manifest cache**: Redis, TTL 1 hour, key: `manifest:{deviceId}`
- **Constraint evaluation cache**: Redis, TTL 5 minutes, key: `constraints:{deviceId}:{adId}`
- **Media metadata cache**: Redis, TTL 24 hours, key: `media:{mediaId}`

**Database Indexes**:
```typescript
// MongoDB indexes
MediaAsset.index({ hash: 1 }, { unique: true });
MediaAsset.index({ categorization: 1, createdAt: -1 });
Manifest.index({ deviceId: 1, version: -1 });
Device.index({ deviceId: 1 }, { unique: true });
```

**Best Practices**:
- Cache manifest after generation (avoid recalculation)
- Invalidate cache on manifest update (pub/sub pattern)
- Use Redis pipelining for bulk operations
- Monitor cache hit rate (target: >90%)
- Set appropriate TTLs (balance freshness vs performance)

### Decision: Async Processing with BullMQ

**Rationale**:
- **Hash calculation**: CPU-intensive, run in background job
- **Manifest generation**: Can be async for non-real-time requests
- **File cleanup**: Delete old files in background
- **Impression logging**: Async write to avoid blocking playback

**Job Queues**:
- `media-ingestion`: Hash calculation, metadata extraction
- `manifest-generation`: Bulk manifest updates for fleet
- `file-cleanup`: Delete expired or removed media files
- `impression-tracking`: Log ad impressions from tablets

**Best Practices**:
- Use BullMQ for all async operations (already in dependencies)
- Set job timeouts (5 minutes max)
- Implement retry logic with exponential backoff
- Monitor queue health (length, processing time)
- Use separate queues for different priorities

## Summary of Key Decisions

| Area | Decision | Rationale |
|------|----------|-----------|
| Video Validation | FFprobe + fluent-ffmpeg | Industry standard, accurate metadata extraction |
| Content Hashing | SHA-256 (Node.js crypto) | Cryptographically secure, built-in, fast |
| Manifest Delta | JSON Patch (RFC 6902) | Standardized, 70-90% bandwidth reduction |
| Constraint Evaluation | Server-side | Reduces tablet complexity, saves storage |
| Resumable Downloads | HTTP Range Requests | Standard HTTP feature, CDN-supported |
| Local Storage | Capacitor Filesystem | Cross-platform, handles permissions |
| Playback Loop | Priority Queue + Filtering | Respects priority, handles constraints |
| Factory Default | Embedded in APK Assets | Always available, even offline |
| Priority Commands | MQTT with QoS 1 | Lightweight, reliable, real-time |
| Caching | Redis (manifests, constraints) | Fast lookup, reduces DB load |
| Async Processing | BullMQ job queues | Non-blocking, scalable |
| Security | JWT + TLS + Hash Verification | Multi-layer defense, integrity checks |

## Next Steps

Proceed to Phase 1: Design & Contracts
- Define data models (MongoDB schemas)
- Document API endpoints (REST + MQTT)
- Create quickstart guide for developers
