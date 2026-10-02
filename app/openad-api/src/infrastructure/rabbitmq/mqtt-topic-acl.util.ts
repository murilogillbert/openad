/**
 * RabbitMQ MQTT maps "/" in MQTT topics to "." in AMQP routing keys on `amq.topic`.
 * Topic permissions use regex on those routing keys.
 *
 * @see https://www.rabbitmq.com/docs/mqtt#topic-level-separator-and-wildcards
 */
export function escapeRoutingKeyRegexSegment(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Stable broker login name for a tablet (no colons — RabbitMQ rule). */
export function tabletMqttUsername(deviceId: string): string {
  return `openad-tablet-${deviceId}`;
}

/**
 * Routing keys this tablet may publish (device → server).
 * Keep in sync with `OpenAdMqttTopics` publish paths on the client.
 */
export function tabletMqttWriteRoutingKeyRegex(deviceId: string): string {
  const id = escapeRoutingKeyRegexSegment(deviceId);
  return `^((devices\\.${id}\\.(heartbeat|power-state|priority\\.ack))|(openad\\.${id}\\.(telemetry|commands\\.ack|impressions|spatial)))$`;
}

/**
 * Routing keys this tablet may subscribe to (server → device + shared broadcast).
 * Keep in sync with `OpenAdMqttTopics` subscribe list on the client.
 */
export function tabletMqttReadRoutingKeyRegex(deviceId: string): string {
  const id = escapeRoutingKeyRegexSegment(deviceId);
  return `^((devices\\.${id}\\.(config|priority))|(openad\\.${id}\\.(schedule|commands))|openad\\.priority\\.broadcast)$`;
}

/** Classic vhost permissions so MQTT can use `amq.topic` and subscription queues. */
export const TABLET_MQTT_CLASSIC_CONFIGURE = '^mqtt-subscription-.*$';
export const TABLET_MQTT_CLASSIC_WRITE =
  '^(amq\\.topic|mqtt-subscription-.*)$';
export const TABLET_MQTT_CLASSIC_READ =
  '^(amq\\.topic|mqtt-subscription-.*)$';
