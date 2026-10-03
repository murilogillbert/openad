import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ModerationDecisionDto {
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  /**
   * Motivo. Opcional na aprovacao, **obrigatorio na recusa** — a obrigatoriedade e verificada
   * no servico, nao aqui, porque depende do valor de `decision` e um decorador de campo nao
   * ve o irmao.
   *
   * O minimo de 3 caracteres barra o motivo de uma letra: a recusa vai para o anunciante, e
   * um motivo que nao explica nada gera suporte em vez de correcao.
   */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason?: string;
}
