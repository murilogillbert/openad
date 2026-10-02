import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Postgres do ecossistema, no mesmo espirito do `MongodbModule`: global, para que qualquer
 * modulo injete o cliente sem reimportar.
 *
 * Divisao de responsabilidade entre os dois bancos, que vale lembrar ao mexer aqui: Mongo
 * guarda operacao e telemetria (frota, midia, entrega, eventos), Postgres guarda **so** o que
 * o ecossistema compartilha — identidade e dinheiro. Colocar operacao no Postgres significaria
 * reescrever reconciliacao, antifraude e ledger espacial, que e o diferencial do produto.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PostgresModule {}
