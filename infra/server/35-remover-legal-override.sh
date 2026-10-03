#!/usr/bin/env bash
#
# Remove as variáveis `LEGAL_*` que o Coolify injeta no `opendriver-backend`.
#
# O que elas estavam fazendo: `LEGAL_COMPANY=OpenDriver Tecnologia Ltda.` e
# `LEGAL_CONTACT_EMAIL=privacidade@opendriver.com.br`, **sobrescrevendo** o padrão do código.
# Resultado em produção: a política de privacidade do app de corridas declarava como
# controladora uma empresa que **não existe** (a razão social real é Heavenbound Systems LTDA,
# CNPJ 51.574.461/0001-09), e dava como contato do encarregado uma caixa que não recebe e-mail
# — `opendriver.com.br` publica `MX .` (null MX), `SPF -all` e `DMARC p=reject`.
#
# Isso é pior que o defeito original. Antes a página dizia "OpenDriver", que é nome fantasia e
# não identifica ninguém; agora dizia o nome de uma pessoa jurídica inexistente, o que numa
# fiscalização da ANPD ou numa revisão de loja é afirmação falsa sobre o controlador dos dados.
#
# Por que **remover** em vez de corrigir o valor: para existir uma fonte da verdade só. O
# padrão no código já é a razão social real, e foi assim justamente porque variável de ambiente
# que precisa estar definida para a página ficar correta é variável que um dia não vai estar
# definida — ou vai estar com o valor de outra época, que é exatamente o que aconteceu aqui.
# Com a variável removida, editar a razão social passa a ser alterar código, que tem revisão e
# teste.
#
# Remove as duas (produção e preview): a tabela tem uma linha por ambiente.
set -uo pipefail

UUID='cag0pegfzuz1zfhkxgjsfzf2'

echo '--- antes'
docker exec coolify-db psql -U coolify -d coolify -At -c "
  select count(*) from environment_variables e
  join applications a on a.id = e.resourceable_id and e.resourceable_type like '%Application%'
  where a.uuid = '$UUID' and e.key like 'LEGAL%';"

echo '--- removendo pelo modelo do Coolify'
docker exec coolify php artisan tinker --execute="
\$app = \App\Models\Application::where('uuid', '$UUID')->first();
if (! \$app) { echo 'APP_NAO_ENCONTRADA'; exit; }
\$n = 0;
foreach (\$app->environment_variables as \$e) {
  if (str_starts_with(\$e->key, 'LEGAL')) { echo 'removendo ' . \$e->key . ' = ' . \$e->value . PHP_EOL; \$e->delete(); \$n++; }
}
foreach (\$app->environment_variables_preview as \$e) {
  if (str_starts_with(\$e->key, 'LEGAL')) { echo 'removendo (preview) ' . \$e->key . PHP_EOL; \$e->delete(); \$n++; }
}
echo 'removidas: ' . \$n . PHP_EOL;
" 2>/dev/null

echo '--- depois'
docker exec coolify-db psql -U coolify -d coolify -At -c "
  select count(*) from environment_variables e
  join applications a on a.id = e.resourceable_id and e.resourceable_type like '%Application%'
  where a.uuid = '$UUID' and e.key like 'LEGAL%';"

echo ''
echo 'Agora rode o deploy para o conteiner perder as variaveis:'
echo "  bash /root/openad-infra/24-coolify-deploy.sh $UUID nao"
