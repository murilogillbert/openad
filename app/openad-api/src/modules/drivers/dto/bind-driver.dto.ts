import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class BindDriverDto {
  /**
   * `public.users.id` do motorista.
   *
   * `@IsUUID()` so garante a forma. A existencia e o papel sao conferidos em
   * `DriverDirectoryService.resolver` — foi exatamente a conferencia que faltava, e a falta
   * dela mandava repasse para identificador inexistente sem erro nenhum.
   */
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  driverUserId!: string;
}
