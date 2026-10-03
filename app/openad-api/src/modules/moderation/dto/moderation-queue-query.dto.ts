import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ModerationQueueQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /**
   * Teto baixo de proposito: cada item da fila faz duas consultas extras (criativos e
   * prontidao), entao uma pagina grande multiplica o custo por item. Vinte e cinco e mais do
   * que um moderador revisa de uma vez.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit?: number;
}
