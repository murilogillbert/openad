import { Route } from '@angular/router';
import { authGuard } from './auth/auth.guard';
import { loginGuard } from './auth/login.guard';

export const appRoutes: Route[] = [
  {
    path: 'login',
    canActivate: [loginGuard],
    loadComponent: () =>
      import('./auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    loadComponent: () =>
      import('./shared/layout/main-layout.component').then(
        (m) => m.MainLayoutComponent
      ),
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./pages/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'inventory',
        loadComponent: () =>
          import('./pages/fleet-map.page').then((m) => m.FleetMapPage),
      },
      {
        path: 'devices',
        loadComponent: () =>
          import('./devices/devices-hub.page').then((m) => m.DevicesHubPage),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'vehicles' },
          {
            path: 'vehicles',
            children: [
              {
                path: '',
                loadComponent: () =>
                  import('./pages/inventory.page').then((m) => m.InventoryPage),
              },
              {
                path: ':vehicleId',
                loadComponent: () =>
                  import('./devices/device-workspace.page').then(
                    (m) => m.DeviceWorkspacePage
                  ),
                children: [
                  { path: '', pathMatch: 'full', redirectTo: 'overview' },
                  {
                    path: 'overview',
                    loadComponent: () =>
                      import('./devices/device-overview.page').then(
                        (m) => m.DeviceOverviewPage
                      ),
                  },
                  {
                    path: 'config',
                    loadComponent: () =>
                      import('./devices/device-config.page').then(
                        (m) => m.DeviceConfigPage
                      ),
                  },
                  {
                    path: 'diagnostic',
                    loadComponent: () =>
                      import('./devices/device-diagnostic.page').then(
                        (m) => m.DeviceDiagnosticPage
                      ),
                  },
                ],
              },
            ],
          },
          {
            path: 'hardware',
            loadComponent: () =>
              import('./devices/device-inventory.page').then(
                (m) => m.DeviceInventoryPage
              ),
          },
          {
            path: 'pairing',
            loadComponent: () =>
              import('./pairing/pending-pairing.component').then(
                (m) => m.PendingPairingComponent
              ),
          },
          {
            path: ':vehicleId',
            pathMatch: 'full',
            redirectTo: 'vehicles/:vehicleId',
          },
        ],
      },
      {
        path: 'vehicles',
        pathMatch: 'full',
        redirectTo: 'devices',
      },
      {
        path: 'pairing',
        pathMatch: 'full',
        redirectTo: 'devices/pairing',
      },
      {
        path: 'fleet/groups',
        loadComponent: () =>
          import('./device-groups/device-groups.component').then(
            (m) => m.DeviceGroupsComponent
          ),
      },
      {
        path: 'releases',
        pathMatch: 'full',
        redirectTo: 'settings/releases',
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./settings/settings-shell.page').then((m) => m.SettingsShellPage),
        children: [
          {
            path: 'profile',
            loadComponent: () =>
              import('./profile-security/profile-security.page').then(
                (m) => m.ProfileSecurityPage
              ),
          },
          {
            path: 'platform',
            loadComponent: () =>
              import('./platform-config/platform-config.page').then(
                (m) => m.PlatformConfigPage
              ),
          },
          {
            path: 'releases',
            loadComponent: () =>
              import('./releases/releases-hub.page').then(
                (m) => m.ReleasesHubPage
              ),
          },
          {
            path: 'release-notes',
            loadComponent: () =>
              import('./releases/release-notes.page').then(
                (m) => m.ReleaseNotesPage
              ),
          },
        ],
      },
      {
        path: 'campaigns',
        loadComponent: () =>
          import('./pages/campaigns.page').then((m) => m.CampaignsPage),
      },
      {
        path: 'campaigns/:campaignId/analytics',
        loadComponent: () =>
          import(
            './features/campaign-analytics/pages/campaign-analytics.page'
          ).then((m) => m.CampaignAnalyticsPage),
      },
      {
        path: 'media',
        loadComponent: () =>
          import('./pages/media-management.page').then(
            (m) => m.MediaManagementPage
          ),
      },
      {
        path: 'geo-zones',
        loadComponent: () =>
          import('./pages/geo-zones.page').then((m) => m.GeoZonesPage),
      },
      {
        path: 'reports/impression/:eventId',
        loadComponent: () =>
          import('./reports/impression-detail/impression-detail.component').then(
            (m) => m.ImpressionDetailComponent
          ),
      },
      {
        path: 'reports',
        loadComponent: () =>
          import('./pages/reports.page').then((m) => m.ReportsPage),
      },
    ],
  },
  { path: '**', redirectTo: '/dashboard' },
];
