# Quickstart: Tablet Ops Pipeline (development)

**Feature**: 003-tablet-ops-pipeline  
**Monorepo root**: `/home/bode/Documents/repos/openad/openad-monorepo`

---

## Prerequisites

- Node 20+, `pnpm`
- Docker (optional) for MongoDB/Redis per repo `docker compose`
- Android Studio / device or emulator for Capacitor native behaviour

---

## Run the API

From the repo root (use Nx per `AGENTS.md`):

```bash
pnpm exec nx run openad-api:serve
```

Ensure `.env` matches `.env.example` (MQTT broker URL, MongoDB URI, JWT secrets).

---

## Run the Management app

```bash
pnpm exec nx run openad-management:serve
```

Use the admin UI to exercise **pending pairings** and **command dispatch** once endpoints exist.

---

## Run the tablet (ad client)

```bash
pnpm exec nx run openad-ad-client:serve
```

For native MQTT and hardware APIs:

```bash
pnpm exec nx run openad-ad-client:capacitor:run -- -l
```

Configure `MQTT_URL` and API base URL in the tablet environment.

---

## Test pairing flow (manual)

1. Start API + broker + MongoDB.
2. Open tablet app — triggers `POST .../pairing/register` (once implemented).
3. In Management app — open device, **Generate pairing secret**.
4. Enter **display code** on tablet — `POST .../pairing/bind`.
5. Verify device JWT stored, MQTT connects (`MqttClientService.attachDevice`), config topics subscribed.

---

## Test TEMP_DISABLE_KIOSK (manual)

1. Ensure the tablet is provisioned as Device Owner / launcher and is currently in kiosk mode.
2. In Management → Fleet dashboard → **Remote commands**, select **Temporarily disable kiosk (5 min)** and send.
3. On the tablet:
   - Kiosk/lock-task mode should exit shortly after receipt.
   - The device should remain controllable for ~5 minutes.
4. Before 5 minutes expires, send the command again.
   - The disable window should extend (deadline refresh).
5. After 5 minutes (from the most recent command), confirm the tablet **re-enters kiosk mode automatically**.
6. Optional restart test: disable kiosk, then force-close/restart the app within the 5-minute window.
   - App should stay out of kiosk until the stored deadline, then re-enter.

---

## Run tests

```bash
pnpm exec nx run openad-api:test
pnpm exec nx run mqtt-contracts:test
```

Add targeted tests for new Zod schemas and pairing services as they land.

---

## Related specs

- [data-model.md](../data-model.md) — collections and fields
- [contracts/rest-api.md](./rest-api.md) — REST DTOs
- [contracts/mqtt.md](./mqtt.md) — MQTT schema extensions
