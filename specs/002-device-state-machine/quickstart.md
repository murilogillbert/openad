# Quickstart: Device State Machine and Configuration Profiles

**Feature**: 002-device-state-machine  
**Date**: 2026-04-05  
**Target audience**: Engineers picking up any task in this feature

---

## Prerequisites

```bash
# Start all backing services (MongoDB, Redis, MQTT broker)
pnpm docker:up

# Verify services are healthy
pnpm docker:ps
```

---

## Running the API

```bash
# Start the NestJS API in development watch mode
pnpm api:serve
```

API available at: `http://localhost:3000/api/v1`  
Swagger UI: `http://localhost:3000/api/docs`

---

## Running the Management App

```bash
pnpm management:serve
```

App available at: `http://localhost:4200`

---

## Running Tests

```bash
# All unit + integration tests for the API
pnpm api:test

# Watch mode during development
pnpm exec nx run openad-api:test --watch

# Run tests for a specific module only
pnpm exec nx run openad-api:test --testPathPattern="device-state"

# Run domain library tests
pnpm exec nx run domain:test

# Run API contract library tests
pnpm exec nx run api-contracts:test
```

---

## Key Files for This Feature

### New Services (to be created)

| File | Responsibility |
|------|----------------|
| `app/openad-api/src/modules/devices/device-state-machine.service.ts` | Core FSM: validates and executes state transitions |
| `app/openad-api/src/modules/devices/device-state-machine.service.spec.ts` | Unit tests for every transition guard |
| `app/openad-api/src/modules/devices/retired-device-guard.ts` | NestJS guard: rejects all requests from retired UUIDs |
| `app/openad-api/src/modules/fleet-monitor/health-threshold-evaluator.service.ts` | Evaluates health metrics against configured thresholds |
| `app/openad-api/src/modules/configuration-profiles/configuration-profiles.module.ts` | NestJS module for profile CRUD |
| `app/openad-api/src/modules/configuration-profiles/configuration-profiles.service.ts` | Profile business logic + cascade delete |
| `app/openad-api/src/modules/device-groups/device-groups.module.ts` | NestJS module for group management |
| `app/openad-api/src/modules/device-groups/device-groups.service.ts` | Group assignment + MQTT config push |

### Modified Files

| File | Change |
|------|--------|
| `libs/domain/src/lib/entities.ts` | Add `DeviceLifecycleState`, `CapabilityManifest`, `HealthMetrics`, `ConfigurationProfile`, `DeviceGroup`, `DeviceLifecycleEvent`, `RetiredDeviceRegistryEntry`. Migrate `DeviceStatus` → `DeviceLifecycleState`. |
| `libs/api-contracts/src/lib/types.ts` | Add all new request/response interfaces from `contracts/api.md` |
| `libs/mqtt-contracts/src/lib/` | Add `HeartbeatPayload` (extended), `DeviceConfigPayload`, `PowerStatePayload` |
| `app/openad-api/src/modules/devices/devices.schema.ts` | Add `lifecycleState`, `groupId`, `capabilityManifest`, `lastHealthMetrics` fields |
| `app/openad-api/src/modules/fleet-monitor/heartbeat-monitor.service.ts` | Update threshold (120s → 180s), call `DeviceStateMachineService.transitionTo()` instead of `markOffline()` |
| `app/openad-management/src/app/` | Add `device-groups/` feature with drag-and-drop UI |

### New Schemas (MongoDB)

| Collection | Schema file |
|------------|-------------|
| `device_lifecycle_events` | `app/openad-api/src/modules/devices/device-lifecycle-event.schema.ts` |
| `retired_device_registry` | `app/openad-api/src/modules/devices/retired-device-registry.schema.ts` |
| `configuration_profiles` | `app/openad-api/src/modules/configuration-profiles/configuration-profile.schema.ts` |
| `device_groups` | `app/openad-api/src/modules/device-groups/device-group.schema.ts` |

---

## TDD Workflow

This project enforces **Red-Green-Refactor**. Always write the test first.

```bash
# Example: Adding the Active → Flagged transition
# 1. Write the failing test
#    app/openad-api/src/modules/devices/device-state-machine.service.spec.ts

# 2. Run — it should FAIL (Red)
pnpm exec nx run openad-api:test --testPathPattern="device-state-machine"

# 3. Implement the minimum code to pass
# 4. Run again — it should PASS (Green)
# 5. Refactor if needed, tests still green
```

---

## Health Check

```bash
curl http://localhost:3000/api/health
# → { "status": "ok", ... }
```

---

## Useful MQTT Debug

```bash
# Subscribe to all device topics (requires mosquitto_sub or MQTT Explorer)
mosquitto_sub -h localhost -p 1883 -t "devices/#" -v

# Simulate a heartbeat with health metrics
mosquitto_pub -h localhost -p 1883 -t "devices/{deviceId}/heartbeat" \
  -m '{"deviceId":"abc-123","timestamp":"2026-04-05T05:00:00Z","location":{"lat":-23.5,"lng":-46.6,"hdop":1.2,"locked":true},"health":{"batteryPercentage":45,"storageUtilizationPercent":72,"gpsHdop":1.2}}'

# Simulate engine-off
mosquitto_pub -h localhost -p 1883 -t "devices/{deviceId}/power-state" \
  -m '{"deviceId":"abc-123","engineOn":false,"detectionMethod":"power_disconnect","timestamp":"2026-04-05T05:01:00Z"}'
```

---

## State Machine Quick Reference

```
Pending ──(first heartbeat)──► Active ──(3-min timeout)──► Flagged
                                 │ ◄──(metrics recover)──── │
                                 │                           │
                           (admin suspend)             (admin suspend)
                                 ↓                           ↓
                             Suspended ──(admin reinstate)──► Active
                                 │
                           (admin retire)
                                 ↓
                              Retired (permanent)
```

All transitions are gated by `DeviceStateMachineService.transitionTo(deviceId, toState, trigger)`.  
An `INVALID_TRANSITION` error is thrown for any pair not in the allowed matrix.

---

## Feature Flags

All thresholds are environment-configurable (`.env` / `ConfigService`):

| Variable | Default | Description |
|----------|---------|-------------|
| `HEARTBEAT_FLAGGED_THRESHOLD_MS` | `180000` | Ms without heartbeat before device is flagged |
| `HEARTBEAT_INTERVAL_MS` | `60000` | Expected heartbeat frequency |
| `HEALTH_BATTERY_MIN_PERCENT` | `10` | Battery threshold below which device is flagged |
| `HEALTH_STORAGE_MAX_PERCENT` | `95` | Storage threshold above which device is flagged |
| `HEALTH_GPS_HDOP_MAX` | `5.0` | GPS HDOP above which precision is considered poor |
| `POWER_ENGINE_OFF_VOLTAGE_V` | `12.4` | Voltage below which engine-off is inferred (OBD-II path) |
| `POWER_ENGINE_OFF_GRACE_MS` | `30000` | Grace period before dimming/pausing on engine-off |
