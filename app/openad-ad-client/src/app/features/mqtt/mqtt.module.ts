import { NgModule } from '@angular/core';
import { MqttClientService } from './services/mqtt-client.service';

@NgModule({
  providers: [MqttClientService],
})
export class MqttModule {}
