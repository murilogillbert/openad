/**
 * Mongo index definitions are declared on schemas in this folder (003-tablet-ops-pipeline).
 * See `pairing-request.schema.ts`, `pairing-secret.schema.ts`, `pairing-attempt-log.schema.ts`.
 */
export const PAIRING_INDEX_NOTES =
  'pairing_requests: deviceId; status+createdAt; pairing_secrets: requestId+ttlExpiresAt; pairing_attempt_logs: deviceId+createdAt';
