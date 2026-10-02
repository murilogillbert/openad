# Spec 009 (MDM) + 010 (admin console) — implementation matrix

**Purpose:** Trace [specs/009-mdm-apk-distribution/spec.md](../009-mdm-apk-distribution/spec.md) and [specs/010-admin-profile-security/spec.md](../010-admin-profile-security/spec.md) functional requirements to code. Status: **Pass** / **Pass with notes** / **Covered in tests** (add file refs as tests land).

| ID | Requirement (summary) | API | Management UI | Device (ad-client) | Tests |
|----|------------------------|-----|---------------|---------------------|-------|
| 009-FR-001 | Superadmin upload APK | `POST /releases/upload` | Drawer upload | — | contract |
| 009-FR-002..005 | Metadata, one latest, QR, manifest | releases module + manifest controller | Provisioning UI | `AppUpdateService` | contract |
| 009-FR-006..009 | Version, daily check, MQTT command, silent | device manifest + report + command | — | scheduler + `runUpdateCheckFlow` | contract |
| 009-FR-010 | Role gate superadmin for admin routes | `Roles('super_admin')` on admin controllers | `ReleasesHubPage` | — | contract |
| 009-FR-011 | Audit | `ReleaseAuditService` | — | — | contract |
| 009-FR-012 | Multi-version hosting | releases collection + artifact by token | ledger | — | — |
| 009-FR-013 | Per-device version visible | `currentRelease` on device | vehicle/device detail (extended) | report endpoint | `vehicles-detail-app-release.contract.spec.ts` |
| 009-FR-014 | Staged rollout | rollouts + eligibility | admin + table | update manifest | contract |
| 010-FR-001..007 | Profile & security | auth portal controllers | `profile-security.page` | — | `admin-profile-security.contract.spec.ts` |
| 010-FR-008..013 | Platform config | platform-config API | `platform-config.page` | — | `platform-config.contract.spec.ts` |
| 010-FR-014..022 | MDM dashboard (QR, PDF, ledger, rollouts, force check) | releases admin + device + command | `releases-admin.page` | ad-client | contract |

**Gaps closed in this effort:** derived Staged state, revoke, metrics, device version on vehicle detail, read-only release notes (operators), PDF trim, single active rollout, contract tests, responsive pass.
