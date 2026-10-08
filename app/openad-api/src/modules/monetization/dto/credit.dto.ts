import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ComprarCreditoPixDto {
  /**
   * Valor em **centavos inteiros**, como todo dinheiro nesta API.
   *
   * O piso e o teto também são validados no serviço, com mensagem que explica o motivo. Aqui
   * eles são limite sintático: `@Min(1)` existe para recusar zero e negativo antes de qualquer
   * consulta ao banco.
   */
  @ApiProperty({ example: 90_000, description: 'Valor em centavos (R$ 900,00)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountCents!: number;
}

export class ExtratoQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/** Corpo que o hub envia quando o Asaas confirma o pagamento. */
export class ConfirmarCreditoDto {
  /**
   * Identificador da cobrança no provedor.
   *
   * Opcional porque a chave que liga os dois lados é o `purchaseId` do caminho — este campo é
   * registro, para o caso de a compra ter sido criada sem ele (falha ao gravar a cobrança).
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalId?: string;
}

export class EstornarCreditoDto {
  @ApiProperty({ example: 'estorno solicitado pelo pagador no banco' })
  @IsString()
  @MinLength(3)
  @MaxLength(400)
  motivo!: string;
}

/** Lançamento manual de crédito pelo operador. */
export class AjustarCreditoDto {
  @ApiProperty()
  @IsUUID()
  advertiserId!: string;

  @ApiProperty({ example: 50_000, description: 'Valor em centavos' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountCents!: number;

  /**
   * `@IsIn` e não `@IsString`: com apenas `@IsString`, um `direction: 'creditar'` passaria a
   * validação e chegaria ao Prisma, onde o enum do banco recusaria com erro de banco — `500`
   * no lugar de `400`, e quem investiga procurando defeito de programa.
   */
  @ApiProperty({ enum: ['credit', 'debit'] })
  @IsIn(['credit', 'debit'])
  direction!: 'credit' | 'debit';

  /**
   * Chave de idempotência **escolhida por quem chama**.
   *
   * Obrigatória de propósito: um ajuste manual repetido por duplo clique ou por nova tentativa
   * creditaria duas vezes, e crédito lançado à mão é exatamente onde esse erro passaria
   * despercebido — não há recibo de provedor para conferir depois.
   */
  @ApiProperty({ example: 'pix-extrato-2026-10-08-001' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  referenceId!: string;

  @ApiProperty({ example: 'deposito por Pix conferido no extrato do dia 08/10' })
  @IsString()
  @MinLength(3)
  @MaxLength(400)
  motivo!: string;
}
