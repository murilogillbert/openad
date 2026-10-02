# Contract: Spatial manifest section (device payload)

**Feature**: `005-geospatial-triggering-engine`  
**Consumers**: `openad-ad-client` (playback + geofence engine), `openad-api` (generator)  
**Format**: JSON, validated with Zod in `libs/api-contracts` (to be added during implementation).

## Placement

Delivered alongside existing manifest media list (see `004-media-orchestration-pipeline`), as an **additive** top-level field, for example:

```json
{
  "spatial": {
    "version": "2026-04-05T12:00:00.000Z",
    "entries": [ /* SpatialEntry */ ]
  }
}
```

Legacy clients without spatial parsing ignore `spatial`.

## SpatialEntry (normative shape)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `zoneId` | string (UUID) | yes | Stable zone id |
| `tier` | `T1` \| `T2` \| `T3` \| `T4` | yes | Arbitration stack |
| `priorityScore` | number | yes | Tie-breaker / ordering |
| `geometry` | object | yes | Discriminated union — see below |
| `mediaId` | string (UUID) | yes | Creative to play |
| `trigger` | object | yes | `{ "mode": "entry" \| "dwell", "dwellSeconds"?: number }` |
| `rotation` | `sequential` \| `weighted_random` \| `priority_first` | yes | Peer delivery |
| `arbitration` | object | yes | `{ "pacingFactor": number, "weights": { "p": number, "d": number, "h": number } }` |
| `epicenter` | `{ "lng": number, "lat": number }` | no | For distance term |
| `velocity` | object | no | `{ "maxKmhSilence"?: number, "minKmhDwell"?: number }` |
| `hysteresisExitMeters` | number | no | Exit buffer |
| `cooldownSeconds` | number | no | Min time between triggers for this rule |

## geometry discriminant

**Circle**

```json
{
  "type": "Circle",
  "center": { "lng": -122.4, "lat": 37.78 },
  "radiusMeters": 500
}
```

**Polygon** (GeoJSON-compatible outer ring)

```json
{
  "type": "Polygon",
  "coordinates": [
    [ [-122.45, 37.75], [-122.45, 37.82], [-122.35, 37.82], [-122.35, 37.75], [-122.45, 37.75] ]
  ]
}
```

## Telemetry contracts (ledger)

Batch events published over existing MQTT telemetry channel (exact topic TBD in implementation; must align with `mqtt-contracts`):

- `spatial.receipt` — SpatialReceipt fields
- `spatial.lost_opportunity` — LostOpportunityEvent fields  
- `spatial.residency` — ZoneResidencyInterval summary records

Schemas to be added as Zod types in `libs/mqtt-contracts` with versioned payloads.
