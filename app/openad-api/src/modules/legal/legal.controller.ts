import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';

/**
 * Política de privacidade e termos de uso do OpenDriver Ads, servidos pela própria API.
 *
 * Por que o openad tem páginas **próprias**, e não reusa as do hub ou do opendriver: os três
 * produtos tratam dados diferentes. O opendriver coleta localização e áudio de viagem; o hub
 * coleta compra e cashback; o openad coleta dado de faturamento de anunciante e conteúdo de
 * criativo. Uma política só não descreveria os três com honestidade, e política imprecisa é
 * pior que política ausente — ela afirma coisa errada sobre tratamento de dado pessoal.
 *
 * O ponto que mais importa aqui, e que precisa estar escrito: **o OpenDriver Ads não perfila
 * passageiro.** A escolha do anúncio é por região e horário do veículo, não por quem está
 * dentro dele. A declaração "sem rastreamento para publicidade" do app de corridas depende
 * disso continuar verdade.
 *
 * Fora do prefixo `api/v1` (ver `main.ts`), porque é endereço colável em ficha de loja.
 */
@ApiExcludeController()
@SkipThrottle()
@Controller('legal')
export class LegalController {
  @Get('privacidade')
  @Header('Cache-Control', 'public, max-age=3600')
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"
  )
  privacidade(@Res() res: Response): void {
    res.type('html').send(
      pagina(
        'Política de Privacidade',
        `
<p>Esta política explica como ${esc(CONTROLADOR.razaoSocial)} ("nós") trata os dados pessoais de quem usa o <b>OpenDriver Ads</b> — a plataforma pela qual um anunciante contrata exibição de anúncio nas telas instaladas em veículos —, em conformidade com a Lei Geral de Proteção de Dados (Lei 13.709/2018). A conta do OpenDriver Ads é a mesma do OpenDriver e do OpenDriverHub.</p>
${identificacao()}

<h2>1. A quem esta política se aplica</h2>
<p>Ao <b>anunciante</b>: a pessoa ou empresa que cria campanha, envia criativo e acompanha relatório. Para o passageiro que vê a tela, veja a seção 6.</p>

<h2>2. Dados que coletamos do anunciante</h2>
<ul>
<li><b>Conta do ecossistema:</b> nome, e-mail, celular e CPF ou CNPJ, já existentes na sua conta OpenDriver. Senha é guardada apenas como hash, e pelo serviço de conta — não por esta plataforma.</li>
<li><b>Cadastro de anunciante:</b> o nome ou razão social com que o anúncio é identificado na moderação e no relatório.</li>
<li><b>Campanhas:</b> nome, período, orçamento, valor por exibição, região e faixa horária escolhidas.</li>
<li><b>Criativos:</b> os arquivos de imagem e vídeo que você envia, mais os metadados técnicos extraídos deles (duração, resolução, codec, tamanho).</li>
<li><b>Compras de crédito:</b> recibo da loja de aplicativos (Apple ou Google), identificador da transação, valor e situação. <b>Não recebemos nem armazenamos dado de cartão</b> — a cobrança é feita integralmente pela loja.</li>
<li><b>Registro de uso:</b> data e hora das ações feitas na plataforma, para trilha de auditoria.</li>
</ul>

<h2>3. Para que usamos, e com que base legal</h2>
<ul>
<li>Executar o contrato: veicular a campanha, apurar as exibições e cobrar o que foi contratado (<b>execução de contrato</b>).</li>
<li>Moderar criativo antes de ir ao ar, para cumprir a legislação publicitária e as nossas regras de conteúdo (<b>legítimo interesse</b> e <b>obrigação legal</b>).</li>
<li>Prevenir fraude de exibição e de recibo de compra (<b>legítimo interesse</b>).</li>
<li>Cumprir obrigações fiscais e contábeis (<b>obrigação legal</b>).</li>
</ul>

<h2>4. Com quem compartilhamos</h2>
<ul>
<li><b>Apple e Google</b>, para processar a compra de crédito dentro do aplicativo e validar o recibo.</li>
<li><b>Motorista do veículo</b>, de forma indireta: o criativo é exibido no equipamento dele, e o valor de repasse referente à exibição aparece no extrato dele — sem a sua identificação.</li>
<li><b>Autoridades</b>, quando exigido por lei ou ordem judicial.</li>
</ul>
<p>Não vendemos dados pessoais.</p>

<h2>5. Por quanto tempo guardamos</h2>
<ul>
<li>Criativos: enquanto a campanha estiver ativa, e por 12 meses após o encerramento, como prova do que foi veiculado.</li>
<li>Registro de exibição e de faturamento: pelo prazo exigido pela legislação fiscal.</li>
<li>Demais dados: enquanto a conta de anunciante estiver ativa.</li>
</ul>

<h2>6. O que NÃO fazemos — passageiro não é perfilado</h2>
<p>Esta é a parte mais importante desta política, e vale tanto para anunciante quanto para quem vê a tela:</p>
<ul>
<li>A escolha do anúncio usa <b>a região e o horário em que o veículo está</b>, e características do próprio veículo. Nunca quem está dentro dele.</li>
<li><b>Não há identificação de passageiro.</b> A tela não tem câmera, não tem microfone, não lê identificador de celular e não se conecta a aparelho de passageiro.</li>
<li><b>Não há perfil de audiência</b> e não há atribuição de anúncio a pessoa. Não cruzamos exibição com conta, compra ou corrida.</li>
<li>O relatório que o anunciante recebe é <b>agregado</b>: quantidade de exibições confirmadas e quantidade de veículos distintos. Nunca lista de pessoas.</li>
<li>Não usamos identificador de publicidade (IDFA, GAID) e não integramos rede de publicidade de terceiro.</li>
</ul>

<h2>7. Seus direitos</h2>
<p>Você pode pedir confirmação do tratamento, acesso, correção, anonimização, portabilidade, informação sobre compartilhamento, e revogar consentimentos.</p>
<p>Você pode <b>excluir sua conta pelo app do ecossistema</b>. Ao excluir, os dados do seu cadastro de anunciante são apagados ou anonimizados; registros de faturamento são mantidos sem identificar você, pelo prazo legal. Crédito não utilizado <b>não é reembolsável em dinheiro</b> (ver os termos, seção 4) e é perdido na exclusão.</p>

<h2>8. Segurança</h2>
<p>Conexão criptografada (HTTPS), tokens de sessão no armazenamento seguro do aparelho, criativos em armazenamento privado com credencial de acesso restrita a este serviço, e trilha de auditoria das ações administrativas.</p>

<h2>9. Contato</h2>
<p>Dúvidas, pedidos de titular e suporte: <a href="mailto:${esc(CONTROLADOR.contato)}">${esc(CONTROLADOR.contato)}</a>.</p>
<p>Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).</p>`
      )
    );
  }

  @Get('termos')
  @Header('Cache-Control', 'public, max-age=3600')
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"
  )
  termos(@Res() res: Response): void {
    res.type('html').send(
      pagina(
        'Termos de Uso',
        `
<p>Estes termos regem o uso do <b>OpenDriver Ads</b>, oferecido por ${esc(CONTROLADOR.razaoSocial)}. Ao criar uma conta de anunciante ou usar a plataforma, você concorda com eles e com a <a href="/legal/privacidade">Política de Privacidade</a>.</p>
${identificacao()}

<h2>1. O serviço</h2>
<p>O OpenDriver Ads permite contratar a exibição de anúncio em telas instaladas em veículos da frota parceira. Você define orçamento, período e onde quer aparecer; nós veiculamos e prestamos contas das exibições efetivamente realizadas.</p>

<h2>2. Conta de anunciante</h2>
<ul>
<li>É preciso ter 18 anos ou mais e informar dados verdadeiros.</li>
<li>A conta é a mesma do ecossistema OpenDriver. Tornar-se anunciante é um ato explícito dentro do app e não altera os outros serviços.</li>
<li>Você responde pelo conteúdo enviado e pela titularidade dos direitos sobre ele.</li>
</ul>

<h2>3. Criativo e moderação</h2>
<ul>
<li>Todo criativo passa por <b>verificação técnica automática</b> (formato, duração, resolução) e por <b>revisão humana</b> antes de ir ao ar.</li>
<li>Podemos recusar criativo que viole a legislação publicitária, o Código de Defesa do Consumidor, direito de terceiro, ou as nossas regras de conteúdo. A recusa é informada com o motivo.</li>
<li>É proibido anunciar: conteúdo ilícito, enganoso, discriminatório, de teor sexual, político-eleitoral, bebida alcoólica para menores, tabaco, arma, jogo de azar não autorizado, medicamento sem registro e serviço financeiro sem autorização do Banco Central.</li>
<li>Você garante ter licença para usar imagem, música e marca presentes no criativo. Reclamação de terceiro sobre o conteúdo é de sua responsabilidade.</li>
<li>Podemos suspender campanha já aprovada se surgir indício de violação, informando o motivo.</li>
</ul>

<h2>4. Crédito, cobrança e reembolso</h2>
<ul>
<li>A plataforma funciona com <b>crédito pré-pago</b>, comprado como item digital dentro do aplicativo, pela Apple ou pelo Google.</li>
<li><b>O crédito não é conversível em dinheiro</b>, não é transferível e não é sacável. Ele serve exclusivamente para contratar exibição nesta plataforma.</li>
<li>O crédito é consumido conforme as exibições são confirmadas, ao valor por exibição que você definiu na campanha.</li>
<li>Pedido de reembolso de compra de crédito segue a política da loja onde a compra foi feita (Apple ou Google) — não processamos reembolso diretamente.</li>
<li>Crédito não utilizado é perdido na exclusão da conta.</li>
</ul>

<h2>5. Como a exibição é contada</h2>
<ul>
<li>Só é cobrada a <b>exibição confirmada pelo equipamento</b>, depois de reconciliação de duração e de verificação antifraude. Exibição interrompida, com tela desligada ou com sinal inconsistente não é cobrada.</li>
<li>O relatório do app mostra a contagem apurada e é a base da cobrança.</li>
<li>Não garantimos quantidade mínima de exibições: ela depende da frota em operação, da região escolhida e da concorrência com outras campanhas no mesmo período.</li>
</ul>

<h2>6. Repasse ao motorista</h2>
<p>Parte do valor de cada exibição faturável é repassada ao motorista do veículo que exibiu. O percentual mínimo é definido pela plataforma e informado na criação da campanha. Isso é parte do custo do serviço e não cria vínculo entre você e o motorista.</p>

<h2>7. Responsabilidades</h2>
<p>Trabalhamos para manter a plataforma disponível e a apuração correta, mas não garantimos disponibilidade ininterrupta, nem a presença de veículo em determinada região e horário. Nossa responsabilidade limita-se ao crédito correspondente à exibição não realizada.</p>

<h2>8. Encerramento</h2>
<p>Você pode excluir sua conta a qualquer momento pelo app. Podemos suspender conta de anunciante que viole estes termos, informando o motivo; nesse caso, campanhas em veiculação são interrompidas.</p>

<h2>9. Alterações</h2>
<p>Podemos alterar estes termos; mudanças relevantes são avisadas no app com antecedência razoável. O uso continuado após o aviso significa concordância.</p>

<h2>10. Contato e foro</h2>
<p>Dúvidas e suporte: <a href="mailto:${esc(CONTROLADOR.contato)}">${esc(CONTROLADOR.contato)}</a>. Aplica-se a legislação brasileira, e fica eleito o foro da comarca de Brasília/DF, sem prejuízo do direito do consumidor de demandar no foro do seu domicílio.</p>`
      )
    );
  }
}

const ATUALIZADO_EM = '03/10/2026';

/**
 * Identificação do controlador.
 *
 * Valores reais como **padrão no código**, não só variável de ambiente. O opendriver tinha
 * `process.env.LEGAL_COMPANY || 'OpenDriver'` e nenhum `.env` de produção definia a variável,
 * então a página servia o fallback — que não identifica pessoa jurídica nenhuma e não cumpre
 * o art. 9º da LGPD. Variável que precisa estar definida para a página ficar correta é
 * variável que um dia não vai estar definida.
 */
const CONTROLADOR = {
  razaoSocial: process.env.LEGAL_COMPANY || 'Heavenbound Systems LTDA',
  nomeFantasia: process.env.LEGAL_TRADE_NAME || 'Open Driver',
  cnpj: process.env.LEGAL_CNPJ || '51.574.461/0001-09',
  endereco:
    process.env.LEGAL_ADDRESS ||
    'Rua 9, Lote 05, Rua das Pitangueiras, Lote 6, Loja 11 e 12 — Norte (Águas Claras), Brasília/DF, CEP 71.908-540',
  contato: process.env.LEGAL_CONTACT_EMAIL || 'murilogillbert@gmail.com',
} as const;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function identificacao(): string {
  return `
<h2>Quem trata os seus dados</h2>
<p>
  <b>${esc(CONTROLADOR.razaoSocial)}</b> (nome fantasia ${esc(CONTROLADOR.nomeFantasia)})<br>
  CNPJ ${esc(CONTROLADOR.cnpj)}<br>
  ${esc(CONTROLADOR.endereco)}<br>
  Encarregado pelo tratamento de dados pessoais (DPO):
  <a href="mailto:${esc(CONTROLADOR.contato)}">${esc(CONTROLADOR.contato)}</a>
</p>`;
}

function pagina(titulo: string, corpo: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)} — OpenDriver Ads</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:760px;margin:0 auto;padding:24px 16px 64px;color:#1F2937;line-height:1.6}
h1{color:#0A1726;font-size:28px}h2{color:#0A1726;font-size:19px;margin-top:28px}li{margin:4px 0}small{color:#6B7280}
a{color:#1F7BFF}</style></head>
<body><h1>${esc(titulo)}</h1><small>Última atualização: ${ATUALIZADO_EM}</small>${corpo}</body></html>`;
}
