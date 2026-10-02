import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'reports/impression/:eventId',
    renderMode: RenderMode.Server,
  },
  {
    path: 'campaigns/:campaignId/analytics',
    renderMode: RenderMode.Server,
  },
  /** Dynamic vehicle workspace — no static params for prerender. */
  {
    path: 'devices/vehicles/:vehicleId',
    renderMode: RenderMode.Server,
  },
  {
    path: 'devices/vehicles/:vehicleId/overview',
    renderMode: RenderMode.Server,
  },
  {
    path: 'devices/vehicles/:vehicleId/config',
    renderMode: RenderMode.Server,
  },
  {
    path: 'devices/vehicles/:vehicleId/diagnostic',
    renderMode: RenderMode.Server,
  },
  /** Matches redirect-only route in app.routes (`devices/:vehicleId` → `vehicles/...`). */
  {
    path: 'devices/:vehicleId',
    renderMode: RenderMode.Server,
  },
  {
    path: '**',
    renderMode: RenderMode.Prerender,
  },
];
