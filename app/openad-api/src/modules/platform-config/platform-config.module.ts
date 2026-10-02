import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { PlatformConfigController } from './platform-config.controller';
import { PlatformConfigService } from './platform-config.service';
import { PlatformConfigDoc, PlatformConfigSchema } from './schemas/platform-config.schema';
import { PlatformConfigRuntimeService } from './platform-config-runtime.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlatformConfigDoc.name, schema: PlatformConfigSchema },
    ]),
    AuthModule,
  ],
  controllers: [PlatformConfigController],
  providers: [PlatformConfigService, PlatformConfigRuntimeService],
  exports: [PlatformConfigService, PlatformConfigRuntimeService],
})
export class PlatformConfigModule {}

