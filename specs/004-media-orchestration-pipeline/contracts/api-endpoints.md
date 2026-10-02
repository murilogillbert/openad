# API Endpoints: Media Orchestration & Manifest Pipeline

**Feature**: 004-media-orchestration-pipeline  
**Date**: 2026-04-05  
**Base URL**: `https://api.openad.example.com/v1`

## Overview

This document defines the REST API endpoints for media ingestion and manifest delivery. All endpoints require JWT authentication unless otherwise noted.

## Authentication

All requests must include a JWT token in the `Authorization` header:

```http
Authorization: Bearer <jwt_token>
```

**Token Claims**:
- `sub`: User or device ID
- `role`: `admin` (for media upload) or `device` (for manifest fetch)
- `exp`: Expiration timestamp (24 hours from issue)

## Media Ingestion Endpoints

### 1. Upload Media

Upload a video advertisement file for validation and ingestion.

**Endpoint**: `POST /media/upload`  
**Auth**: Required (role: `admin`)  
**Content-Type**: `multipart/form-data`

**Request**:
```http
POST /v1/media/upload HTTP/1.1
Host: api.openad.example.com
Authorization: Bearer <admin_jwt>
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="file"; filename="ad-video.mp4"
Content-Type: video/mp4

<binary video data>
------WebKitFormBoundary
Content-Disposition: form-data; name="categorization"

universal
------WebKitFormBoundary
Content-Disposition: form-data; name="constraints"

{"timeWindows":[{"startHour":6,"endHour":10}]}
------WebKitFormBoundary--
```

**Request Fields**:
- `file` (required): Video file (max 500MB)
- `categorization` (required): `universal` or `conditional`
- `constraints` (optional): JSON object with geofence, timeWindows, speedRange

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "mediaId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "filename": "ad-video.mp4",
    "fileSize": 45678901,
    "bitrate": 8500000,
    "width": 1920,
    "height": 1080,
    "codec": "h264",
    "duration": 60,
    "categorization": "universal",
    "storageUrl": "s3://openad-media/a1b2c3d4-e5f6-7890-abcd-ef1234567890.mp4",
    "constraints": {
      "timeWindows": [
        { "startHour": 6, "endHour": 10 }
      ]
    },
    "createdAt": "2026-04-05T14:30:00Z"
  }
}
```

**Error Responses**:

**400 Bad Request** (Validation Failed):
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Video validation failed",
    "details": {
      "bitrate": "Bitrate 12000000 exceeds maximum 10000000 bps",
      "resolution": "Resolution 3840x2160 exceeds maximum 1920x1080"
    }
  }
}
```

**413 Payload Too Large**:
```json
{
  "success": false,
  "error": {
    "code": "FILE_TOO_LARGE",
    "message": "File size exceeds 500MB limit"
  }
}
```

**409 Conflict** (Duplicate Hash):
```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_MEDIA",
    "message": "Media with this hash already exists",
    "existingMediaId": "existing-uuid"
  }
}
```

### 2. Get Media Catalog

Retrieve list of all active media assets.

**Endpoint**: `GET /media`  
**Auth**: Required (role: `admin`)

**Query Parameters**:
- `categorization` (optional): Filter by `universal` or `conditional`
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 50, max: 100)

**Request**:
```http
GET /v1/media?categorization=universal&page=1&limit=20 HTTP/1.1
Host: api.openad.example.com
Authorization: Bearer <admin_jwt>
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "mediaId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "filename": "ad-video.mp4",
        "fileSize": 45678901,
        "duration": 60,
        "categorization": "universal",
        "createdAt": "2026-04-05T14:30:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 150,
      "pages": 8
    }
  }
}
```

### 3. Get Media Details

Retrieve detailed information about a specific media asset.

**Endpoint**: `GET /media/:mediaId`  
**Auth**: Required (role: `admin`)

**Request**:
```http
GET /v1/media/a1b2c3d4-e5f6-7890-abcd-ef1234567890 HTTP/1.1
Host: api.openad.example.com
Authorization: Bearer <admin_jwt>
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "mediaId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "filename": "ad-video.mp4",
    "fileSize": 45678901,
    "bitrate": 8500000,
    "width": 1920,
    "height": 1080,
    "codec": "h264",
    "duration": 60,
    "categorization": "universal",
    "storageUrl": "s3://openad-media/a1b2c3d4-e5f6-7890-abcd-ef1234567890.mp4",
    "constraints": {
      "timeWindows": [
        { "startHour": 6, "endHour": 10 }
      ]
    },
    "isActive": true,
    "createdAt": "2026-04-05T14:30:00Z",
    "updatedAt": "2026-04-05T14:30:00Z"
  }
}
```

**Error Response** (404 Not Found):
```json
{
  "success": false,
  "error": {
    "code": "MEDIA_NOT_FOUND",
    "message": "Media asset not found"
  }
}
```

### 4. Delete Media

Soft-delete a media asset (sets `isActive: false`).

**Endpoint**: `DELETE /media/:mediaId`  
**Auth**: Required (role: `admin`)

**Request**:
```http
DELETE /v1/media/a1b2c3d4-e5f6-7890-abcd-ef1234567890 HTTP/1.1
Host: api.openad.example.com
Authorization: Bearer <admin_jwt>
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Media asset deleted successfully"
}
```

## Manifest Delivery Endpoints

### 5. Get Manifest

Retrieve the manifest for a specific device (tablet).

**Endpoint**: `POST /manifest`  
**Auth**: Required (role: `device`)

**Request**:
```http
POST /v1/manifest HTTP/1.1
Host: api.openad.example.com
Authorization: Bearer <device_jwt>
Content-Type: application/json

{
  "deviceId": "device-uuid",
  "lastManifestVersion": "2026-04-04T10:15:00Z",
  "deviceState": {
    "latitude": 40.7128,
    "longitude": -74.0060,
    "speed": 45,
    "timestamp": "2026-04-05T14:30:00Z"
  }
}
```

**Request Fields**:
- `deviceId` (required): Device UUID
- `lastManifestVersion` (optional): Last known manifest version (for delta calculation)
- `deviceState` (optional): Current device state for constraint evaluation
  - `latitude`: GPS latitude (-90 to 90)
  - `longitude`: GPS longitude (-180 to 180)
  - `speed`: Current speed in km/h (0 to 200)
  - `timestamp`: State timestamp (ISO 8601)

**Response** (200 OK) - Full Manifest:
```json
{
  "success": true,
  "data": {
    "deviceId": "device-uuid",
    "version": "2026-04-05T14:30:00Z",
    "isDelta": false,
    "media": [
      {
        "mediaId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "priority": 10,
        "downloadUrl": "https://s3.amazonaws.com/openad-media/a1b2c3d4.mp4?X-Amz-Expires=3600&...",
        "constraints": {
          "timeWindows": [
            { "startHour": 6, "endHour": 10 }
          ]
        }
      },
      {
        "mediaId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        "hash": "a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8",
        "priority": 8,
        "downloadUrl": "https://s3.amazonaws.com/openad-media/b2c3d4e5.mp4?X-Amz-Expires=3600&...",
        "constraints": {
          "speedRange": { "minKmh": 0, "maxKmh": 50 }
        }
      }
    ]
  }
}
```

**Response** (200 OK) - Delta Manifest:
```json
{
  "success": true,
  "data": {
    "deviceId": "device-uuid",
    "version": "2026-04-05T14:30:00Z",
    "previousVersion": "2026-04-04T10:15:00Z",
    "isDelta": true,
    "operations": [
      {
        "op": "add",
        "path": "/media/-",
        "value": {
          "mediaId": "c3d4e5f6-a7b8-9012-cdef-123456789012",
          "hash": "b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9",
          "priority": 9,
          "downloadUrl": "https://s3.amazonaws.com/openad-media/c3d4e5f6.mp4?X-Amz-Expires=3600&...",
          "constraints": {}
        }
      },
      {
        "op": "remove",
        "path": "/media/1"
      }
    ]
  }
}
```

**Error Response** (404 Not Found):
```json
{
  "success": false,
  "error": {
    "code": "DEVICE_NOT_FOUND",
    "message": "Device not registered"
  }
}
```

### 6. Report Sync Status

Device reports successful manifest synchronization.

**Endpoint**: `POST /manifest/sync-status`  
**Auth**: Required (role: `device`)

**Request**:
```http
POST /v1/manifest/sync-status HTTP/1.1
Host: api.openad.example.com
Authorization: Bearer <device_jwt>
Content-Type: application/json

{
  "deviceId": "device-uuid",
  "manifestVersion": "2026-04-05T14:30:00Z",
  "syncedAt": "2026-04-05T14:35:00Z",
  "downloadedMedia": [
    {
      "mediaId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "verified": true
    }
  ],
  "storageUsed": 1234567890
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Sync status updated"
}
```

## Device Management Endpoints

### 7. Register Device

Register a new tablet device.

**Endpoint**: `POST /devices`  
**Auth**: Required (role: `admin`)

**Request**:
```http
POST /v1/devices HTTP/1.1
Host: api.openad.example.com
Authorization: Bearer <admin_jwt>
Content-Type: application/json

{
  "deviceId": "device-uuid",
  "name": "Vehicle 001",
  "storageCapacity": 5368709120,
  "vehicleId": "vehicle-uuid"
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "deviceId": "device-uuid",
    "name": "Vehicle 001",
    "status": "active",
    "storageCapacity": 5368709120,
    "createdAt": "2026-04-05T14:30:00Z"
  }
}
```

### 8. Get Device Status

Retrieve current status of a device.

**Endpoint**: `GET /devices/:deviceId`  
**Auth**: Required (role: `admin` or matching `device`)

**Request**:
```http
GET /v1/devices/device-uuid HTTP/1.1
Host: api.openad.example.com
Authorization: Bearer <admin_jwt>
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "deviceId": "device-uuid",
    "name": "Vehicle 001",
    "status": "active",
    "lastManifestVersion": "2026-04-05T14:30:00Z",
    "lastSyncAt": "2026-04-05T14:35:00Z",
    "lastKnownState": {
      "latitude": 40.7128,
      "longitude": -74.0060,
      "speed": 45,
      "timestamp": "2026-04-05T14:35:00Z"
    },
    "storageCapacity": 5368709120,
    "storageUsed": 1234567890,
    "createdAt": "2026-04-05T10:00:00Z"
  }
}
```

## Rate Limiting

All endpoints are rate-limited to prevent abuse:

- **Admin endpoints** (media upload, device management): 100 requests/minute per user
- **Device endpoints** (manifest fetch): 10 requests/minute per device
- **Sync status**: 1 request/minute per device

**Rate Limit Headers**:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1712332800
```

**Rate Limit Exceeded** (429 Too Many Requests):
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later.",
    "retryAfter": 60
  }
}
```

## Error Codes Summary

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_FAILED` | 400 | Request validation failed |
| `FILE_TOO_LARGE` | 413 | File exceeds size limit |
| `DUPLICATE_MEDIA` | 409 | Media with hash already exists |
| `MEDIA_NOT_FOUND` | 404 | Media asset not found |
| `DEVICE_NOT_FOUND` | 404 | Device not registered |
| `UNAUTHORIZED` | 401 | Invalid or missing JWT token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

## Next Steps

- Implement endpoints in NestJS controllers
- Add OpenAPI/Swagger documentation
- Set up rate limiting middleware
- Configure S3 pre-signed URL generation
