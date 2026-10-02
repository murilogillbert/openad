# Validation results — foundation spec (SC-001–SC-010)

**Branch**: `001-transit-ad-platform-foundation`  
**Date**: 2026-04-05  
**Method**: Automated tests (`pnpm exec nx run openad-api:test`), contract/integration coverage, and code review against `spec.md` success criteria. Full manual walkthrough of every flow is recommended before production.

| ID | Criterion (summary) | Result | Evidence / notes |
|----|---------------------|--------|------------------|
| **SC-001** | Device bind → vehicle active in catalog under 3 minutes | **Partial** | Contract + integration tests for bind, duplicate rejection, decommission (`device-onboarding.integration.spec.ts`, devices/vehicles contract specs). Portal inventory UI implements the flow; wall-clock UX not benchmarked in CI. |
| **SC-002** | All active vehicles on live dashboard; refresh ≤ 30s | **Partial** | Fleet status API + map polling; WebSocket updates via `/fleet`. Heartbeat monitor runs on a schedule; 30s refresh is implemented in the dashboard layer—verify under load outside CI. |
| **SC-003** | Offline playback 72h from cached schedule | **Not verified** | Architecture assumes cached schedule on device; no long-running soak test in this repo. |
| **SC-004** | Offline/alert within 2 min + admin notification | **Partial** | `HeartbeatMonitorService` uses 120s threshold; `NotificationService.alertAdmins` + Redis pub/sub + portal toasts. End-to-end latency not measured in CI. |
| **SC-005** | Remote command ACK within 5 min | **Partial** | Command issue + MQTT ack path covered (`remote-command-lifecycle.integration.spec.ts`). SLA not load-tested. |
| **SC-006** | 100% of plays recorded; none discarded silently | **Partial** | Impression ingestion + dedup by `eventId`; integration tests for pipeline. GPS-loss path uses `locationVerified` / flags per spec. |
| **SC-007** | Proof-of-Play report ready within 5 min | **Partial** | `ReportGenerationWorker` + `proof-of-play-report.integration.spec.ts`; async job model matches the requirement—validate duration on representative data volumes. |
| **SC-008** | No playback until asset integrity verified | **Partial** | `AssetIntegrityWorker` + verified asset gate on scheduling; contract tests around assets. |
| **SC-009** | Geo/priority resolution &lt; 1s | **Not verified** | Evaluator unit tests exist; no automated performance gate at 1s. |
| **SC-010** | 10k concurrent vehicles without degradation | **Not verified** | Requires dedicated load/scale testing; not part of default CI. |

## Quickstart flows (recommended manual checks)

1. **Inventory (US1)**: Login → bind device to vehicle → see active row → duplicate bind 409 → decommission.  
2. **Campaigns (US2)**: Create campaign → upload asset → verify → geo-zone + rule → activate → confirm schedule/MQTT path in logs or contract tests.  
3. **Fleet (US3)**: Dashboard map + commands; simulate telemetry/ack paths per integration tests.  
4. **Reports (US4)**: Request Proof-of-Play → poll job → download when `ready`.

Re-run this document after major releases or before go-live.
