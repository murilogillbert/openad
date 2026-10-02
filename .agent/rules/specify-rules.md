# openad Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-05

## Active Technologies
- TypeScript 5.9 (Node 20 LTS for API; Angular 21 for Management App; Capacitor 8 / Android for Tablet App) + NestJS 11 (API), `@nestjs/schedule` (cron sweeps), `@nestjs/mongoose` + Mongoose 9 (persistence), BullMQ 5 + ioredis (async job queues), MQTT 5 (device messaging), Angular 21 + PrimeNG 21 + Angular CDK (Management App UI), Capacitor 8 (Tablet App shell) (002-device-state-machine)
- MongoDB (primary — all new collections); Redis (BullMQ job queues for async config propagation) (002-device-state-machine)

- TypeScript 5.x (Node.js 20 LTS — backend), TypeScript 5.x (Angular 17 — frontend) + NestJS (backend framework), Angular 17, PrimeNG 17, Tailwind CSS 3, EMQX 5.x (MQTT broker), BullMQ (background jobs), Socket.io (WebSocket — dashboard real-time) (001-transit-ad-platform-foundation)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript 5.x (Node.js 20 LTS — backend), TypeScript 5.x (Angular 17 — frontend): Follow standard conventions

## Recent Changes
- 002-device-state-machine: Added TypeScript 5.9 (Node 20 LTS for API; Angular 21 for Management App; Capacitor 8 / Android for Tablet App) + NestJS 11 (API), `@nestjs/schedule` (cron sweeps), `@nestjs/mongoose` + Mongoose 9 (persistence), BullMQ 5 + ioredis (async job queues), MQTT 5 (device messaging), Angular 21 + PrimeNG 21 + Angular CDK (Management App UI), Capacitor 8 (Tablet App shell)

- 001-transit-ad-platform-foundation: Added TypeScript 5.x (Node.js 20 LTS — backend), TypeScript 5.x (Angular 17 — frontend) + NestJS (backend framework), Angular 17, PrimeNG 17, Tailwind CSS 3, EMQX 5.x (MQTT broker), BullMQ (background jobs), Socket.io (WebSocket — dashboard real-time)

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
