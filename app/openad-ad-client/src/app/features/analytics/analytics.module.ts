import { NgModule } from '@angular/core';
import { PlayBatchUploaderService } from './services/play-batch-uploader.service';
import { PlayRecordBufferService } from './services/play-record-buffer.service';

/**
 * Local play-record buffer + batch upload to core analytics ingest (006 US1).
 */
@NgModule({
  providers: [PlayRecordBufferService, PlayBatchUploaderService],
})
export class AnalyticsModule {}
