import { NgModule } from '@angular/core';
import { PlaybackControllerComponent } from './components/playback-controller/playback-controller.component';
import { ConstraintFilterService } from './services/constraint-filter.service';
import { LoopManagerService } from './services/loop-manager.service';
import { PlaybackEngineService } from './services/playback-engine.service';
import { PriorityQueueService } from './services/priority-queue.service';
@NgModule({
  imports: [PlaybackControllerComponent],
  providers: [
    PlaybackEngineService,
    ConstraintFilterService,
    LoopManagerService,
    PriorityQueueService,
  ],
  exports: [PlaybackControllerComponent],
})
export class PlaybackModule {}
