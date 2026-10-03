# Scripts de operação do servidor de produção

Scripts versionados para operar `179.236.228.94` (`ssh opendriver`). Todos foram **executados
contra o servidor real** em 2026-10-03; o que está escrito aqui é observação, não suposição.

A numeração é a ordem de execução. Os de 01 a 06 são **somente leitura** — podem rodar com o
serviço no ar, a qualquer momento.

| Script | O que faz | Escreve? |
|---|---|---|
| `01-inventario.sh` | Host, containers, migrations aplicadas, contagens, config das aplicações | não |
| `02-backup.sh` | `pg_dumpall --globals-only`, `pg_dump -Fc`, SQL legível, schema-only de `public` e `opendriver`, tar do MinIO, SHA256 | só cria arquivos |
| `04-topologia.sh` | Mapeia qual container serve qual domínio e para qual armazenamento aponta | não |
| `05-referencias.sql` | Para onde apontam as referências de arquivo guardadas no banco | não |
| `06-avatares-antigos.sql` | As 4 linhas que citam `hubstorage` | não |
| `07-sandbox.sh` | Postgres separado com cópia restaurada, para ensaiar migration | cria container |

Uso:

```powershell
scp -q infra/server/01-inventario.sh opendriver:/root/openad-infra/
ssh opendriver "cd /root/openad-infra && sed -i 's/\r$//' 01-inventario.sh && bash 01-inventario.sh"
```

O `sed -i 's/\r$//'` não é enfeite: editado no Windows, o arquivo chega com CRLF e o `bash`
falha com `$'\r': command not found` numa linha que parece correta no editor.

---

## Topologia decidida em 2026-10-03

Quatro serviços **permanecem** na VM antiga (`187.77.46.26`), consumidos de lá:

| Domínio | HTTP observado |
|---|---|
| `hubstorage.opendriver.com.br` | 403 (MinIO respondendo; 403 na raiz é o normal dele) |
| `n8n.opendriver.com.br` | 200 |
| `evolution.opendriver.com.br` | 200 |
| `solarapi.opendriver.com.br` | 404 |

Todo o resto fica na VPS nova. O `coolify.opendriver.com.br` não resolve hoje e será
reapontado para o IP novo — o Coolify 4.3.23 **já está rodando aqui**.

### O que a VPS nova já serve

| Container | É | Domínio | Observação |
|---|---|---|---|
| `cag0peg…` | opendriver-backend | `api-app.opendriver.com.br` | `PAYMENT_PROVIDER=mock`, **`NODE_ENV=development`** |
| `v6q66q2…` | hub-backend | `hubapi.opendriver.com.br` | `PAYMENT_PROVIDER=mock`, `NODE_ENV=production` |
| `krqsjub…` | hub-web | `hub.`, `opendriver.com.br`, `www.` | — |
| `jrey2ip…` | tiles | `tiles.opendriver.com.br` | — |
| `l5bcr9s…` | Postgres 16.15 | — | banco `hub`, 11 MB, schemas `public` e `opendriver` |
| `hub-minio` | MinIO | — | buckets `hub-uploads` e `opendriver-private` |

Mais `opendriver-nominatim`, `opendriver-osrm`, `opendriver-tiles` e a pilha do Coolify.

---

## A contradição do `hubstorage`, e por que ela não custa nada

`hubstorage` fica na VM antiga, mas **os dois backends gravam no MinIO desta VPS**
(`MINIO_ENDPOINT=http://hub-minio:9000`). Isso parecia ser um caso de arquivo gravado num
lugar e servido de outro, que é o tipo de defeito que só aparece semanas depois como
"arquivo sumido".

Não é. Levantado por consulta ao banco:

- **4 linhas** em `public.users.avatar_url` citam `hubstorage`.
- Os quatro objetos (`4b26ee1a`, `f11a4aed`, `7befc543`, `1450f54e`) **já existem** no
  `hub-uploads` desta VPS. Nenhum arquivo a migrar — apenas o *hostname* gravado no banco
  está desatualizado.
- Todo o resto das referências é externo e não depende de armazenamento próprio:
  `survey_video_deliveries.video_url` (100 linhas) aponta para o Instagram, e
  `users.avatar_url` (38) e `partners.logo_url` (4) para a API do Dicebear, que gera avatar.
- Os 3 documentos de motorista em `opendriver` são **chave relativa**
  (`drivers/<id>/cnh-….jpg.enc`), resolvida contra `MINIO_ENDPOINT`. Apontam para cá, e os 3
  arquivos estão em `opendriver-private`. Consistente.

### Mas há um defeito real ao lado 🔴

```
MINIO_PUBLIC_URL=https://v6q66q2lv00ly550hffog7f5.179.236.228.94.sslip.io
```

Esse é o domínio **do próprio hub-backend**, não de armazenamento. Nenhuma rota ali serve
objeto de MinIO. Então a URL pública gerada para o próximo arquivo enviado aponta para um
lugar que responde 404.

Que isso ainda não apareceu é confirmável: a busca por `sslip.io` nas colunas de arquivo
devolve **zero linhas** em todas. Ou seja, nenhum upload aconteceu desde que essa variável
foi definida — o primeiro vai quebrar.

Precisa de um domínio de armazenamento apontando para esta VPS. É decisão de nomenclatura, e
está na lista de pendências do plano.

---

## O backup de 2026-10-03

| Arquivo | Tamanho | Para que |
|---|---|---|
| `globals.sql` | 671 B | roles do cluster — `pg_dump` **não** inclui, e sem eles o restore gera banco inacessível |
| `hub.dump` | 179 KB | banco inteiro, formato custom; 346 objetos, verificado por `pg_restore --list` |
| `hub-plain.sql.gz` | 45 KB | mesmo conteúdo em SQL legível, redundância contra divergência de versão do `pg_restore` |
| `public-antes.sql` | 45 KB | **linha de base** do diff do protocolo de 5 passos |
| `opendriver-antes.sql` | 47 KB | idem |
| `minio-data.tar.gz` | 5,2 MB | 86 arquivos dos dois buckets |

No servidor em `/root/backups/20261003-062520Z`, e **copiado para fora** em
`D:\Backups\opendriver-prod\20261003-062520Z`, com os seis SHA-256 conferidos na máquina
local. Backup que só existe no servidor que ele protege não é backup.

Um defeito foi corrigido no caminho: o `tar` do Alpine é o do BusyBox e **não** conhece
`--ignore-failed-read`. Com a flag, o comando falhava inteiro e não gerava arquivo — e a
mensagem dizia "erro parcial", que parece ressalva e era perda total do backup de mídia.

### Sandbox

`openad-pg-sandbox` (postgres:16-alpine, mesma minor da produção), na rede `coolify`, **sem
porta publicada**. Confere com a produção em sete contagens: `users` 45, `cashback_entries`
24, `integration_settings` 9, `rides` 12, `driver_earnings` 2, e as 11 + 12 migrations.

```bash
docker exec -it openad-pg-sandbox psql -U postgres -d hub
```

É o alvo seguro para `prisma migrate diff --shadow-database-url`, que **reseta** o banco que
recebe — apontado para um banco real, apaga. Já aconteceu no desenvolvimento deste projeto.
