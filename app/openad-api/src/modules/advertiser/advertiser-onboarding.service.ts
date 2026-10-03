import { ConflictException, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infrastructure/postgres/prisma.service';
import type { PrincipalDoEcossistema } from '../auth/strategies/ecosystem-jwt.strategy';

export interface SituacaoDeAnunciante {
  advertiserId: string;
  legalName: string;
  status: string;
  createdAt: string;
}

/**
 * Adesao de uma conta do ecossistema ao openad como anunciante.
 *
 * Isto estava **faltando**: nenhum ponto do codigo criava linha em `openad.ad_advertisers`,
 * e `FederatedJwtStrategy` devolve `null` quando nao encontra uma. O efeito pratico era que
 * nenhum anunciante conseguia autenticar — todas as rotas de `/advertiser/*` respondiam 401
 * para todo mundo, para sempre. O app do anunciante nao teria como sair da tela de login.
 *
 * O comentario do modelo no `schema.prisma` ja declarava a regra de produto: "nasce `active`
 * [...] nao existe fila de aprovacao de cadastro. A moderacao e do **criativo**, nao do
 * cadastro." Esta classe e a implementacao dela.
 *
 * Por que a adesao e uma rota explicita e nao um efeito colateral da autenticacao: escrever
 * no banco durante a validacao de token transformaria um `GET` de sondagem em criacao de
 * parceiro. Qualquer pessoa do hub que tocasse `/advertiser/campaigns` por curiosidade
 * passaria a constar como parceira comercial, com linha em tabela que alimenta relatorio de
 * faturamento. Adesao e ato, e ato tem rota.
 */
@Injectable()
export class AdvertiserOnboardingService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly prisma: PrismaService
  ) {
    this.logger.setContext(AdvertiserOnboardingService.name);
  }

  async situacao(userId: string): Promise<SituacaoDeAnunciante | null> {
    const linha = await this.prisma.adAdvertiser.findUnique({
      where: { userId },
      select: {
        id: true,
        legalName: true,
        status: true,
        createdAt: true,
      },
    });
    if (!linha) {
      return null;
    }
    return {
      advertiserId: linha.id,
      legalName: linha.legalName,
      status: String(linha.status),
      createdAt: linha.createdAt.toISOString(),
    };
  }

  /**
   * Cria o vinculo, ou devolve o que ja existe.
   *
   * Idempotente de proposito: o app chama isto no primeiro uso e nao tem como saber se uma
   * tentativa anterior chegou a gravar (rede caindo depois do `INSERT` e antes da resposta).
   * Com idempotencia, repetir e seguro; sem ela, a segunda tentativa daria erro de chave
   * unica e o usuario ficaria preso numa tela de erro com a conta **ja criada**.
   *
   * Anunciante `suspended` e o unico caso que recusa. Reativar por adesao seria dar a quem
   * foi suspenso a forma de desfazer a suspensao — uma decisao de operador contornada por
   * uma chamada de API.
   */
  async aderir(
    principal: PrincipalDoEcossistema,
    legalNameInformado?: string
  ): Promise<{ criado: boolean; anunciante: SituacaoDeAnunciante }> {
    const existente = await this.prisma.adAdvertiser.findUnique({
      where: { userId: principal.userId },
      select: { id: true, legalName: true, status: true, createdAt: true },
    });

    if (existente) {
      if (String(existente.status) !== 'active') {
        throw new ConflictException({
          error: {
            code: 'ADVERTISER_SUSPENDED',
            message:
              'Esta conta de anunciante esta suspensa. Fale com o suporte para reativar.',
          },
        });
      }
      return {
        criado: false,
        anunciante: {
          advertiserId: existente.id,
          legalName: existente.legalName,
          status: String(existente.status),
          createdAt: existente.createdAt.toISOString(),
        },
      };
    }

    /**
     * `legal_name` e `VarChar(180)`. O corte e aqui, antes do banco: deixar o Postgres
     * recusar devolveria 500 para um nome comprido, que e entrada de usuario comum.
     *
     * Sem nome informado, usa o nome da conta do hub. Nao e o nome juridico ideal para nota
     * fiscal, mas e melhor que string vazia: o parceiro aparece identificavel na fila de
     * moderacao desde a primeira campanha, e o campo e editavel depois.
     */
    const legalName = (legalNameInformado?.trim() || principal.name.trim())
      .slice(0, 180);

    const criada = await this.prisma.adAdvertiser.create({
      data: {
        userId: principal.userId,
        legalName,
        // `documentEnc`/`documentHash` ficam nulos: o documento da pessoa esta no hub,
        // cifrado com a chave **do hub**. Copiar o texto claro para ca duplicaria dado
        // pessoal em dois lugares, e copiar o cifrado seria inutil sem a chave. Quando a
        // emissao de nota fiscal entrar, o caminho e o anunciante informar o documento aqui.
        status: 'active',
      },
      select: { id: true, legalName: true, status: true, createdAt: true },
    });

    // `info`, nao `log`: `PinoLogger` (nestjs-pino) expoe os niveis do pino
    // (`trace`/`debug`/`info`/`warn`/`error`/`fatal`), nao a interface `LoggerService` do
    // Nest.
    this.logger.info(
      {
        event: 'advertiser.aderiu',
        advertiserId: criada.id,
        userId: principal.userId,
        hubRole: principal.hubRole,
      },
      'conta do ecossistema aderiu como anunciante'
    );

    return {
      criado: true,
      anunciante: {
        advertiserId: criada.id,
        legalName: criada.legalName,
        status: String(criada.status),
        createdAt: criada.createdAt.toISOString(),
      },
    };
  }
}
