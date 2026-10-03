import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class AdvertiserListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /**
   * Teto de 100 por pagina.
   *
   * Nao e numero arbitrario escolhido por gosto: sem teto, `limit=100000` num cliente movel
   * transforma uma listagem paginada em varredura de collection, e o custo recai no servidor
   * que atende a frota inteira.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
