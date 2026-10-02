import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GeoZone, GeoZoneSchema } from './geo-zone.schema';
import { GeoZonesRepository } from './geo-zones.repository';
import { GeoZoneService } from './geo-zone.service';
import { GeoZonesController } from './geo-zones.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: GeoZone.name, schema: GeoZoneSchema }]),
  ],
  controllers: [GeoZonesController],
  providers: [GeoZonesRepository, GeoZoneService],
  exports: [GeoZonesRepository, MongooseModule],
})
export class GeoZonesModule {}
