import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { PortalAuthService } from '../auth/portal-auth.service';
import { ReleasesAdminPage } from './releases-admin.page';
import { ReleasesOperatorToolsComponent } from './releases-operator-tools.component';

/**
 * Shell: superadmins see full release admin; other authenticated users see operator tools only.
 */
@Component({
  selector: 'app-releases-hub-page',
  standalone: true,
  imports: [CommonModule, ReleasesAdminPage, ReleasesOperatorToolsComponent],
  templateUrl: './releases-hub.page.html',
})
export class ReleasesHubPage {
  private readonly auth = inject(PortalAuthService);

  protected isSuperAdmin(): boolean {
    return this.auth.getPortalUser()?.role === 'super_admin';
  }
}
