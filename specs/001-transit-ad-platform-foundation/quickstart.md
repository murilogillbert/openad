# Quickstart: End-to-End Media Orchestration Platform for Transit Advertising

**Branch**: `001-transit-ad-platform-foundation`  
**Date**: 2026-04-04

---

## Overview

This document guides a developer to set up and understand the system end-to-end in the shortest path possible. It covers the four foundational pillars: Inventory Activation, Contextual Delivery, Fleet Intelligence, and Commercial Accountability.

---

## Architecture at a Glance

```
Android Tablets (10,000+)
      ↕ MQTT 5.0 / TLS
EMQX Broker ──► Redis Streams (event bridge)
                      │
              NestJS Backend Services
              ├── Device Service        # Onboarding & registry
              ├── Campaign Service      # Scheduling & geo-evaluation
              ├── Fleet Monitor         # Heartbeat & alert detection
              ├── Impression Service    # Event ingestion & deduplication
              └── Reporting Service     # Aggregation & export
                      │
              MongoDB (primary store)  Redis (cache & queues)
                      │
      Angular 17 Frontend (PrimeNG + Tailwind)
      ├── Inventory Portal
      ├── Campaign Builder
      ├── Mission Control Dashboard
      └── Proof-of-Play Reporting
```

---

## Infrastructure Dependencies

| Service | Purpose | Version |
|---|---|---|
| EMQX | MQTT broker (10k+ concurrent device connections) | 5.x |
| MongoDB | Primary domain data store | 7.x |
| Redis | Message queues, hot cache, pub/sub | 7.x |
| Node.js | Backend runtime (NestJS framework) | 20 LTS |
| Angular | Frontend framework | 17+ |
| PrimeNG | Angular UI component library | 17+ |
| Tailwind CSS | Utility-first CSS | 3.x |

---

## Repository Structure

```
openad/
├── apps/
│   ├── api/                    # NestJS backend (REST API + MQTT bridge)
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── devices/
│   │   │   │   ├── vehicles/
│   │   │   │   ├── campaigns/
│   │   │   │   ├── geo-zones/
│   │   │   │   ├── fleet-monitor/
│   │   │   │   ├── impressions/
│   │   │   │   └── reporting/
│   │   │   ├── infrastructure/
│   │   │   │   ├── mqtt/       # EMQX client & topic handlers
│   │   │   │   ├── redis/      # Streams & pub/sub adapters
│   │   │   │   └── mongodb/    # Repository implementations
│   │   │   └── main.ts
│   │   └── test/
│   │       ├── unit/
│   │       ├── integration/
│   │       └── contract/
│   │
│   └── portal/                 # Angular 17 frontend
│       ├── src/
│       │   ├── app/
│       │   │   ├── inventory/  # Device & vehicle management
│       │   │   ├── campaigns/  # Campaign builder & asset upload
│       │   │   ├── dashboard/  # Mission Control live map
│       │   │   └── reports/    # Proof-of-Play & billing
│       │   └── environments/
│       └── e2e/                # Playwright e2e tests
│
├── libs/
│   ├── domain/                 # Shared domain types & interfaces
│   ├── mqtt-contracts/         # MQTT topic schemas (shared with device SDK)
│   └── api-contracts/          # REST API types (generated from OpenAPI)
│
├── device-sdk/                 # Android client library documentation
│   └── mqtt-protocol.md        # Links to contracts/mqtt-topics.md
│
└── specs/
    └── 001-transit-ad-platform-foundation/
        ├── spec.md
        ├── plan.md
        ├── research.md
        ├── data-model.md
        ├── quickstart.md       # This file
        └── contracts/
            ├── rest-api.md
            └── mqtt-topics.md
```

---

## Core Flows (Developer Reference)

### Flow 1: Device Onboarding (Inventory Activation)

```
Fleet Operator (Portal)
  1. POST /api/v1/devices/bind  { serialNumber, vehicleId, hardwareProfile }
  2. System creates Device record (status: unbound → active)
  3. System creates/updates Vehicle record (boundDeviceId = deviceId)
  4. System generates managed deviceId (UUID) + issues TLS cert
  5. MQTT broker ACL provisioned for openad/{deviceId}/*
  6. Portal confirms vehicle appears in inventory catalog
```

### Flow 2: Campaign & Schedule Setup (Contextual Delivery)

```
Campaign Manager (Portal)
  1. POST /api/v1/campaigns  → campaignId (status: draft)
  2. POST /api/v1/campaigns/{id}/assets  → assetId (status: pending → verified)
  3. POST /api/v1/geo-zones  → zoneId (GeoJSON polygon)
  4. POST /api/v1/campaigns/{id}/rules  → ruleId
  5. PATCH /api/v1/campaigns/{id}/status  { status: "active" }
  6. Campaign Service computes target devices (geo-zone intersection + active fleet)
  7. Schedule push: Server publishes to openad/{deviceId}/schedule (QoS 1, retained)
  8. Device downloads assetUrl, verifies SHA256, marks rule as ready
  9. Device plays ad when GPS enters geo-zone during time window
 10. Device publishes to openad/{deviceId}/impressions (QoS 2)
```

### Flow 3: Fleet Health Monitoring (Fleet Intelligence)

```
Fleet Monitor Service (background)
  Every 30s:  Sweep Redis cache:fleet:* for stale entries
  On stale:   Transition device connectivity.status → offline
  On offline: Write alert to MongoDB fleet_status
              Publish to Redis pubsub:dashboard
              Dashboard WebSocket clients receive update
              Notification service fires to fleet_admin (email/in-app)

Fleet Admin (Dashboard)
  1. GET /api/v1/fleet/status  → live map data
  2. Clicks vehicle with alert flag
  3. POST /api/v1/fleet/devices/{id}/commands  { type: "RESTART" }
  4. Server writes to remote_commands (status: queued)
  5. Server publishes to openad/{deviceId}/commands (QoS 1)
  6. Device restarts, publishes ACK to openad/{deviceId}/commands/ack
  7. Server updates remote_commands.status → acknowledged
  8. Dashboard receives update via WebSocket
```

### Flow 4: Proof-of-Play Report (Commercial Accountability)

```
Device (continuous, per ad play)
  → MQTT QoS 2: openad/{deviceId}/impressions
  → Redis Stream: stream:impressions (XADD)
  → Worker pool: XREADGROUP → validate → deduplicate by eventId → MongoDB insert

Finance Analyst (Portal)
  1. POST /api/v1/reports/proof-of-play  { campaignId, format: "pdf" }
  2. BullMQ job queued (reportJobId returned)
  3. Worker: MongoDB aggregation pipeline on impression_events
  4. Worker: generates report document + uploads to storage
  5. GET /api/v1/reports/{reportJobId}  → status: ready, downloadUrl
  6. Analyst downloads report (pre-signed URL, 1h expiry)
```

---

## Key Design Decisions (see research.md for full rationale)

| Decision | Choice | Reason |
|---|---|---|
| Device ↔ Server protocol | MQTT 5.0 | Designed for unreliable mobile networks, QoS 2 for impressions |
| Impression delivery guarantee | QoS 2 (exactly-once) | Commercial accountability — zero silent drops |
| Telemetry delivery | QoS 0 (fire-and-forget) | Next heartbeat replaces old value; volume would be excessive at QoS 1 |
| Geo-zone queries | MongoDB $geoIntersects (2dsphere) | Native spatial indexing, no external geo database needed |
| Event pipeline | Redis Streams + consumer groups | Durable, ordered, replay-able — bridges MQTT events to DB workers |
| Dashboard real-time | Redis pub/sub → WebSocket | Push model, avoids polling 10k fleet records |
| Report generation | BullMQ background job | Decouples request from processing; ≤5min SLA met asynchronously |
| Asset integrity | SHA-256 checksum (server + device) | Verified at upload AND after device download (FR-012) |

---

## Constitution Compliance Summary

| Principle | Compliance |
|---|---|
| KISS | Single broker, single database, Redis for targeted caching only — no unnecessary layers |
| DRY | Shared `libs/domain` for entity types; `libs/mqtt-contracts` for topic schemas reused by backend and device SDK |
| SOLID | Each NestJS module owns a single domain; Repository pattern for DB access; Dependency injection throughout |
| YAGNI | Multi-market, mobile app, biometric reach measurement deferred — not built until required |
| TDA | Domain entities own their state transition logic; impression recording logic lives in Impression Service, not in callers |
| TDD | All services use Red-Green-Refactor; unit tests before implementation per module; Playwright e2e for user journeys |
| Enterprise Quality | JWT auth with refresh, TLS/cert pinning, structured logging, OpenAPI-generated contracts, 80% coverage gate |
| Clean Code | Intention-revealing names throughout; each service module single-responsibility; `why` comments on non-obvious decisions (e.g., QoS level choices) |
