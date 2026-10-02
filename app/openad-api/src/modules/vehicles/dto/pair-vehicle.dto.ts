import { IsUUID } from 'class-validator';

export class PairVehicleDto {
  @IsUUID()
  deviceId!: string;
}
