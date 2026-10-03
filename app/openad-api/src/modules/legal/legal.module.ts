import { Module } from '@nestjs/common';
import { LegalController } from './legal.controller';

/**
 * Páginas legais públicas. Sem provider e sem dependência: o conteúdo é estático e a
 * identificação do controlador vem de constante com padrão no código.
 */
@Module({
  controllers: [LegalController],
})
export class LegalModule {}
