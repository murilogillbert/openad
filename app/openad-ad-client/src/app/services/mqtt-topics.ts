/**
 * Tablet MQTT topics — aligned with `app/openad-api` (`MqttService`, fleet ingestors, schedule push).
 * See `libs/mqtt-contracts` for payload shapes.
 */
export const OpenAdMqttTopics = {
  /** Server → device (QoS 1, retained) — `MqttService.publishDeviceConfig` */
  deviceConfig: (deviceId: string) => `devices/${deviceId}/config`,

  /** Device → server — extended health (spec 002) */
  deviceHeartbeat: (deviceId: string) => `devices/${deviceId}/heartbeat`,

  /** Device → server — power / engine proxy */
  devicePowerState: (deviceId: string) => `devices/${deviceId}/power-state`,

  /** Device → server — `TelemetryIngestorService` */
  telemetry: (deviceId: string) => `openad/${deviceId}/telemetry`,

  /** Server → device (QoS 1, retained) — `SchedulePushService` */
  schedule: (deviceId: string) => `openad/${deviceId}/schedule`,

  /** Server → device (QoS 1) — `CommandDispatchProcessor` */
  commands: (deviceId: string) => `openad/${deviceId}/commands`,

  /** Device → server (QoS 1) — `CommandAckHandler` */
  commandAck: (deviceId: string) => `openad/${deviceId}/commands/ack`,

  /** Device → server (QoS 2) — `ImpressionIngestionService` */
  impressions: (deviceId: string) => `openad/${deviceId}/impressions`,

  /** Device → server (QoS 1) — `SpatialLedgerMqttService` */
  spatialLedger: (deviceId: string) => `openad/${deviceId}/spatial`,

  /** Server → device (QoS 1) — priority / emergency ads (`PriorityCommandsGateway`) */
  priorityDevice: (deviceId: string) => `devices/${deviceId}/priority`,

  /** Server → all devices (QoS 1) */
  priorityBroadcast: () => 'openad/priority/broadcast',

  /** Device → server (QoS 1) — priority playback ack */
  priorityAck: (deviceId: string) => `devices/${deviceId}/priority/ack`,
} as const;
