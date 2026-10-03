import { IsOptional, IsString, Length } from 'class-validator';

export class AderirAnuncianteDto {
  /**
   * Razao social ou nome do anunciante. Opcional: sem ele, usa o nome da conta do hub.
   *
   * O limite de 180 e o da coluna (`legal_name VarChar(180)`). O minimo de 2 existe para
   * recusar nome de um caractere, que nao identifica parceiro nenhum na fila de moderacao.
   */
  @IsOptional()
  @IsString()
  @Length(2, 180)
  legalName?: string;
}
