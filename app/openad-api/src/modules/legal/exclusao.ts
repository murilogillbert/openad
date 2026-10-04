import type { Response } from 'express';

/**
 * Página pública de exclusão de conta e dados.
 *
 * Exigência do Google Play (política de Exclusão de Dados): além do caminho **dentro** do app,
 * é obrigatório um **link na web**, alcançável sem login, onde o usuário peça a exclusão. Os
 * três apps já tinham a tela interna; o link web não existia, e é campo obrigatório da ficha.
 *
 * Alcançável sem login de propósito: quem desinstalou o app e quer apagar a conta não
 * consegue entrar. Página de exclusão atrás de login é o mesmo que não ter página.
 */
export interface DadosDaExclusao {
  produto: string;
  caminhoNoApp: string;
  apagados: string[];
  retidos: { oque: string; prazo: string; motivo: string }[];
  bloqueios: string[];
  controlador: {
    razaoSocial: string;
    cnpj: string;
    endereco: string;
    contato: string;
  };
  atualizadoEm: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Link de e-mail protegido da obfuscacao do Cloudflare.
 *
 * O Cloudflare (Scrape Shield → Email Address Obfuscation) reescreve todo `mailto:` para
 * `/cdn-cgi/l/email-protection` e troca o texto por `[email protected]`, contando com um
 * decodificador em JavaScript para restaurar no navegador. Nestas paginas a CSP e
 * `default-src 'none'`, entao **o decodificador nao roda**: o endereco fica ilegivel para
 * sempre.
 *
 * O efeito pratico era grave: o canal de exclusao de conta que o Google revisa aparecia
 * quebrado, e o contato do encarregado de dados exigido pelo art. 41 da LGPD nao era legivel.
 *
 * `<!--email_off-->` e o mecanismo documentado do Cloudflare para excluir um trecho da
 * obfuscacao. Os marcadores tem de casar exatamente: dois hifens, sem espacos.
 */
export function linkEmail(endereco: string): string {
  const e = esc(endereco);
  return `<!--email_off--><a href="mailto:${e}">${e}</a><!--/email_off-->`;
}

export function paginaExclusao(res: Response, o: DadosDaExclusao): void {
  const c = o.controlador;
  res.type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Excluir conta e dados — ${esc(o.produto)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:760px;margin:0 auto;padding:24px 16px 64px;color:#1F2937;line-height:1.6}
h1{color:#0A1726;font-size:28px}h2{color:#0A1726;font-size:19px;margin-top:28px}li{margin:4px 0}small{color:#6B7280}
a{color:#1F7BFF}code{background:#F2F5F9;padding:2px 6px;border-radius:4px;font-size:14px}
table{border-collapse:collapse;width:100%;margin-top:8px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #E5EAF0;vertical-align:top;font-size:15px}
th{color:#6B7280;font-size:13px;text-transform:uppercase;letter-spacing:.5px}
.caixa{background:#F2F5F9;border-radius:12px;padding:16px;margin-top:16px}</style></head>
<body>
<h1>Excluir conta e dados</h1>
<small>${esc(o.produto)} &middot; atualizado em ${esc(o.atualizadoEm)}</small>

<h2>Pelo app, a qualquer momento</h2>
<p>O caminho mais rápido: <code>${esc(o.caminhoNoApp)}</code>. A exclusão é imediata e não depende de atendimento.</p>

<div class="caixa">
<h2 style="margin-top:0">Não tem mais o app instalado?</h2>
<p>Envie um e-mail para ${linkEmail(c.contato)}
com o assunto <b>&ldquo;Exclusão de conta&rdquo;</b>, informando o <b>e-mail cadastrado</b> e o <b>CPF ou CNPJ</b> da conta.</p>
<p>Confirmamos a identidade e concluímos a exclusão em <b>até 15 dias</b>, e respondemos avisando. Não cobramos nada por isso e não pedimos justificativa.</p>
</div>

<h2>O que é apagado</h2>
<ul>${o.apagados.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>

<h2>O que é retido, e por quê</h2>
<p>A lei nos obriga a guardar parte dos registros mesmo depois da exclusão. O que fica <b>deixa de identificar você</b>: é mantido de forma anonimizada.</p>
<table>
<tr><th>Dado</th><th>Prazo</th><th>Motivo</th></tr>
${o.retidos
  .map((r) => `<tr><td>${esc(r.oque)}</td><td>${esc(r.prazo)}</td><td>${esc(r.motivo)}</td></tr>`)
  .join('')}
</table>

<h2>Quando a exclusão é recusada</h2>
<p>Em algumas situações precisamos resolver uma pendência antes. Nesses casos o app informa o motivo e o que fazer:</p>
<ul>${o.bloqueios.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>

<h2>Uma conta, três serviços</h2>
<p>A conta é a mesma no <b>OpenDriver</b> (corridas), no <b>OpenDriverHub</b> (marketplace com cashback) e no <b>OpenDriver Ads</b> (anunciante). Excluir em qualquer um deles <b>exclui nos três</b>: o pedido é propagado automaticamente, e cada serviço apaga ou anonimiza o lado dele. Você não precisa repetir o pedido em cada app.</p>

<h2>Quem trata os seus dados</h2>
<p>
  <b>${esc(c.razaoSocial)}</b><br>
  CNPJ ${esc(c.cnpj)}<br>
  ${esc(c.endereco)}<br>
  Encarregado pelo tratamento de dados pessoais (DPO): ${linkEmail(c.contato)}
</p>
<p>Veja também a <a href="/legal/privacidade">Política de Privacidade</a> e os <a href="/legal/termos">Termos de Uso</a>.</p>
<p><small>Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).</small></p>
</body></html>`);
}
