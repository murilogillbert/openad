import { IsUUID } from 'class-validator';

export class UnpairVehicleDto {
  @IsUUID()
  deviceId!: string;
}
