# Research: End-to-End Media Orchestration Platform for Transit Advertising

**Branch**: `001-transit-ad-platform-foundation`  
**Phase**: 0 — Technology & Architecture Research  
**Date**: 2026-04-04

---

## 1. MQTT for Tablet ↔ API Communication

### Decision
Use **MQTT 5.0** (via a broker such as Eclipse Mosquitto or EMQX) as the bidirectional real-time communication channel between Android tablets and the backend API.

### Rationale
- MQTT is purpose-designed for constrained, unreliable networks (mobile data, urban dead zones) — exactly the operating environment of in-vehicle tablets.
- Its publish/subscribe model decouples tablets from the server; a vehicle that loses connectivity simply queues outgoing messages and re-delivers them on reconnect with QoS 1/2 guarantees.
- MQTT 5.0 adds session expiry, user properties, and message expiry — essential for queued remote commands (FR-019) and fleet telemetry.
- The persistent session feature allows a reconnecting device to receive all commands and schedule updates missed while offline — directly fulfilling SC-003 (72-hour offline resilience).

### Topic Design
```
openad/{deviceId}/telemetry          # Device → Server: GPS, health, playback status
openad/{deviceId}/commands           # Server → Device: restart, sync, clear-cache
openad/{deviceId}/commands/ack       # Device → Server: command acknowledgement
openad/{deviceId}/schedule           # Server → Device: schedule updates
openad/{deviceId}/impressions        # Device → Server: impression events (QoS 2)
openad/fleet/broadcast               # Server → All: global announcements
```

### QoS Strategy
- **QoS 0** — Fleet telemetry (GPS position, health heartbeat). Fire-and-forget is acceptable; the next heartbeat replaces the value.
- **QoS 1** — Schedule pushes, asset update notifications. At-least-once; idempotency guaranteed by version/checksum on the device.
- **QoS 2** — Impression events, command acknowledgements. Exactly-once delivery is mandatory for commercial accountability (FR-021, FR-022).

### Alternatives Considered
- **WebSockets + HTTP long-poll**: Higher overhead per connection; does not scale to 10,000 concurrent devices without significant infrastructure (SC-010).
- **gRPC streaming**: Better for server-to-server; Android client libraries are heavier and require TLS setup on every device.
- **Firebase Cloud Messaging (FCM)**: Unreliable delivery guarantees, no QoS 2, not suitable for commercial impression recording.

---

## 2. MongoDB as Primary Database

### Decision
Use **MongoDB** (v7.x) as the primary persistent store for all domain entities: Devices, Vehicles, Campaigns, Creative Assets, Geo-Zones, Schedule Rules, Fleet Status Records, and Impression Events.

### Rationale
- The domain model has heterogeneous, nested structures (geo-zones as GeoJSON polygons, schedule rules as embedded arrays, device characteristics as variable-key maps) that fit MongoDB's document model naturally.
- MongoDB's native **GeoJSON / 2dsphere index** support enables efficient geo-zone membership queries without an external spatial database (FR-009).
- Impression Events are append-only, write-heavy, and immutable — MongoDB's time-series collection type (v5+) or a standard capped-collection approach suits this pattern.
- The `$geoIntersects` and `$geoWithin` operators allow the scheduling engine to evaluate a vehicle's coordinates against all active geo-zone polygons in a single indexed query.
- Aggregation pipelines natively support the business-metric roll-ups required for Proof-of-Play reports (FR-025) without an additional analytics store.

### Collection Strategy
| Collection | Notes |
|---|---|
| `devices` | Device registry, binding status, managed identity |
| `vehicles` | Vehicle catalog, characteristics, current assignment |
| `campaigns` | Campaign lifecycle, priority, budget |
| `creative_assets` | Asset metadata, checksum, version |
| `geo_zones` | GeoJSON polygons, 2dsphere indexed |
| `schedule_rules` | Embedded campaign + zone + window bindings |
| `impression_events` | Time-series or append-only; immutable after insert |
| `fleet_status` | Latest snapshot per device (upsert on `deviceId`) |
| `remote_commands` | Command queue with status tracking |

### Alternatives Considered
- **PostgreSQL + PostGIS**: Excellent geo support, stronger ACID for financial records; however the schema rigidity conflicts with flexible device characteristic fields and heterogeneous campaign rule structures. Can be introduced as a dedicated financial ledger in a future phase.
- **InfluxDB for telemetry**: Good time-series fit for fleet heartbeats; rejected to avoid operating two databases when MongoDB's time-series collection handles the volume for v1.

---

## 3. Redis for Queuing & Caching

### Decision
Use **Redis 7.x** with **Redis Streams** as the primary message queue and hot-data cache layer.

### Rationale
- **Redis Streams** provide a persistent, consumer-group-aware queue that bridges MQTT broker events to backend processing workers without message loss — the MQTT broker publishes to Redis Streams; workers consume at their own pace.
- The `XADD` / `XREADGROUP` / `XACK` pattern gives at-least-once delivery with consumer group acknowledgement, exactly what is needed for processing impression events before writing to MongoDB.
- **Redis pub/sub** powers real-time WebSocket push to the dashboard (FR-015) without polling MongoDB on every refresh cycle.
- **Redis key-value caching** stores the active schedule for each device (pre-computed after campaign changes), so the scheduling evaluation path (FR-009) reads from cache first, with MongoDB as the source of truth.
- **Remote command queue**: Commands issued from the dashboard are written as Redis Stream entries with a TTL. The MQTT delivery worker consumes and forwards them; on ACK the stream entry is acknowledged and the status in MongoDB is updated.

### Key Redis Structures
| Structure | Purpose |
|---|---|
| `stream:impressions` | Impression event pipeline (MQTT → worker → MongoDB) |
| `stream:telemetry` | Device telemetry pipeline (heartbeats → MongoDB upsert) |
| `stream:commands` | Remote command dispatch from dashboard to MQTT |
| `cache:schedule:{deviceId}` | Pre-computed active schedule per device, TTL 5m |
| `cache:fleet:{deviceId}` | Latest fleet status snapshot per device, TTL 35s |
| `pubsub:dashboard` | Real-time broadcast channel to connected dashboard WebSocket clients |
| `set:offline_devices` | Set of deviceIds with missed heartbeat threshold — feeds alert detection |

### Alternatives Considered
- **RabbitMQ**: Full AMQP broker; heavier to operate. Redis Streams cover the needed functionality with lower operational overhead for v1.
- **Apache Kafka**: Best-in-class at massive event throughput; operationally complex for a team starting v1. Recommended as a future migration path if impression volumes exceed Redis Streams throughput limits.
- **BullMQ (Redis-backed)**: Simplifies queue management in Node.js environments; valid for task queues (report generation, asset propagation) and recommended for those specific use cases.

---

## 4. PrimeNG as Frontend Component Library

### Decision
Use **PrimeNG** (v17+ / Angular 17+) as the UI component library for the web management portal.

### Rationale
- PrimeNG provides enterprise-grade, production-ready components that directly cover the platform's UI requirements: DataTable (inventory catalog, FR-003), Map (dashboard live fleet view, FR-014), Charts (analytics, FR-025), and complex Form controls (campaign wizard, FR-007).
- PrimeNG's `p-table` with virtual scrolling handles 10,000-row vehicle catalogs without pagination hacks.
- Built-in dark-mode theming (PrimeNG Nova/Lara themes) supports a "Mission Control" visual style appropriate for a fleet operations dashboard.
- Strong TypeScript-first API aligns with Angular's strict-mode development discipline.
- PrimeNG's Google Maps integration (`GMapModule`) or Leaflet wrapper (`p-gmap`) can render the live vehicle map with minimal custom code.

### Alternatives Considered
- **Angular Material**: Excellent for consumer-facing UIs; component depth insufficient for complex admin dashboards (no data grid with virtual scroll, no map component).
- **AG Grid + custom components**: Best-in-class grid performance; requires composing multiple libraries for the full admin feature set.
- **React + MUI**: Valid stack; rejected because the user specified Angular/PrimeNG.

---

## 5. Tailwind CSS as Styling Framework

### Decision
Use **Tailwind CSS v3.x** alongside PrimeNG, applying Tailwind for layout, spacing, and custom utility composition (not for component styling that PrimeNG already handles).

### Rationale
- Tailwind's utility-first approach is ideal for the "glue" between PrimeNG components: grid layouts, screen-level spacing, responsive breakpoints, and custom Mission Control dashboard panel arrangements.
- PrimeNG Unstyled mode (v17+) allows full Tailwind control over PrimeNG component internals for visual consistency.
- Tailwind's `@layer` system lets the team extend the design system (custom colors for device health states: green/yellow/red/grey) without fighting PrimeNG's default theme variables.

### Integration Note
- Default PrimeNG themes (`lara-dark-*`) can coexist with Tailwind using CSS specificity boundaries. PrimeNG Unstyled + PrimeTailwind preset is the recommended approach for full Tailwind control over PrimeNG components.

### Alternatives Considered
- **PrimeNG themes only (no Tailwind)**: Sufficient for standard admin UIs; Tailwind adds layout flexibility for the map-heavy Mission Control dashboard with dynamic panel resizing.
- **Bootstrap**: Less composable; conflicts with PrimeNG's own grid system.

---

## 6. System Architecture Summary

```
[Android Tablet]
      ↕ MQTT (TLS, QoS 0/1/2)
[MQTT Broker: EMQX / Mosquitto]
      ↕ Redis Streams bridge
[Backend Services: Node.js / NestJS]
      ├── Device Service (onboarding, registry)
      ├── Campaign Service (scheduling, geo-evaluation)
      ├── Fleet Monitor Service (heartbeat, alert detection)
      ├── Impression Service (event ingestion, deduplication)
      └── Reporting Service (aggregation, PDF/CSV export)
      ↕
[MongoDB] ← primary persistent store
[Redis]   ← queues, cache, pub/sub
      ↕ WebSocket (Socket.io)
[Angular Frontend: PrimeNG + Tailwind]
      ├── Inventory Management Portal
      ├── Campaign Builder
      ├── Mission Control Dashboard (live map)
      └── Proof-of-Play Reporting Module
```

---

## 7. Cross-Cutting Concerns

### Security (per Constitution Principle VII)
- MQTT connections MUST use TLS 1.3; device certificates pinned at binding time (FR-006).
- Each device's managed identity is used as the MQTT client ID; broker ACLs enforce that a device can only publish/subscribe on its own `openad/{deviceId}/*` topics.
- JWT tokens (short-lived, refresh-token pattern) for web portal authentication; role-based access (Fleet Operator, Campaign Manager, Administrator, Finance Analyst).
- Creative asset uploads must validate MIME type, file size, and integrity checksum server-side before storage.

### Offline Resilience
- Android tablet maintains a local SQLite snapshot of the active schedule (last 72 hours worth); MQTT client reconnects with persistent session; queued impression events are re-delivered at QoS 2 on reconnect.

### Testing Strategy (per Constitution Principle VI — TDD, NON-NEGOTIABLE)
- **Unit tests**: Each service class tested in isolation with mocked repositories and MQTT client.
- **Integration tests**: MQTT message flow → Redis Streams → service processing → MongoDB write validated end-to-end per pillar.
- **Contract tests**: MQTT topic schemas and REST API contracts versioned and tested with consumer-driven contract tests.
- **E2E tests**: Playwright tests covering the 4 primary user journeys (onboarding flow, campaign creation, dashboard commands, report generation).
- Coverage minimum: 80% line coverage enforced in CI (Constitution Quality Gate 3).

### Performance Targets (from SC-010)
- 10,000 concurrent MQTT device connections: EMQX handles 1M+ connections; Mosquitto handles ~100k — EMQX is the recommended broker for production.
- Impression event ingestion: target ≥ 50,000 events/minute (≈833/second) via Redis Streams consumer group with horizontal worker scaling.
- Dashboard refresh: ≤ 30s fleet status staleness; achieved via Redis pub/sub push rather than polling.
- Proof-of-Play report generation: ≤ 5 minutes for any campaign (SC-007); achieved via MongoDB aggregation pipeline + BullMQ background job.
