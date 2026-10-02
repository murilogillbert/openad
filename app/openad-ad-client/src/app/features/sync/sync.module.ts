import { NgModule } from '@angular/core';
import { DownloadProgressIdbService } from './services/download-progress-idb.service';
import { DownloadManagerService } from './services/download-manager.service';
import { ManifestClientService } from './services/manifest-client.service';
import { SyncStorageManagerService } from './services/storage-manager.service';
import { SyncOrchestratorService } from './services/sync-orchestrator.service';

@NgModule({
  providers: [
    DownloadProgressIdbService,
    DownloadManagerService,
    ManifestClientService,
    SyncStorageManagerService,
    SyncOrchestratorService,
  ],
})
export class SyncModule {}
