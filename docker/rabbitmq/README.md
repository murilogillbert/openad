# RabbitMQ (MQTT plugin) — optional broker

The API uses `mqtt.js` with `MQTT_URL` (example: `mqtt://openad:openad-dev-mqtt@127.0.0.1:1884`).

- **AMQP** `5672`: RabbitMQ protocol (optional for tooling).
- **Management** `15672`: HTTP UI; health checks use `/api/health/checks/alarms` when `MQTT_HEALTH` is `rabbitmq` (default) or unset, using `MQTT_MANAGEMENT_URL` and credentials.
- **MQTT** host port `1884` → container `1883` (plugin default).

`enabled_plugins` enables `rabbitmq_mqtt` and `rabbitmq_web_mqtt`. Configure users and topic permissions in RabbitMQ for production (unlike EMQX’s `acl.conf`).
