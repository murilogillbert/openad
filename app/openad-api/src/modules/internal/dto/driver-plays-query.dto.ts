import { IsISO8601, IsUUID } from 'class-validator';

/**
 * Janela de tempo de um trajeto, mais o motorista.
 *
 * A janela e o unico recorte possivel: o openad **nao conhece corrida**. Quem sabe quando um
 * trajeto comecou e terminou e o opendriver; ele passa o intervalo e recebe os anuncios que
 * tocaram dentro dele.
 */
export class DriverPlaysQueryDto {
  @IsUUID()
  driverUserId!: string;

  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;
}
