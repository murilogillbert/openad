# Gera as chaves de upload dos três apps Android.
#
# Por que isto é necessário: o `android/` que o `expo prebuild` gera tem
# `release { signingConfig signingConfigs.debug }` — a versão de release sai assinada com a
# chave de **debug**, e o Play Console recusa o upload ("assinado em modo debug"). Os APKs que
# já geramos servem para instalar no celular por cabo; não servem para a loja.
#
# O que é "chave de upload", e por que não é a chave de assinatura do app:
# com o Play App Signing (padrão desde 2021), quem guarda a chave que assina o app entregue aos
# usuários é o **Google**. Você assina o AAB com a chave de **upload**, o Play verifica e
# re-assina com a chave de assinatura. A diferença importa muito na hora de perder uma:
#   - chave de upload perdida: recuperável, o suporte do Google registra uma nova;
#   - chave de assinatura perdida: o app **nunca mais** pode ser atualizado.
# É por isso que vale deixar o Google guardar a segunda.
#
# Mesmo assim: **guarde cópia destes arquivos e das senhas fora desta máquina.** Perder a
# chave de upload não é fatal, mas custa uma abertura de ticket e alguns dias.
#
# Idempotente: nunca sobrescreve keystore existente. Gerar de novo produziria uma chave
# diferente para um app já publicado, e o Play recusaria o upload seguinte.

param(
  [string] $Destino = 'd:\Projetos\.credenciais-loja',
  [string] $Jdk = 'D:\dev\jdk\jdk-21.0.12.1+1'
)

# `Continue` e não `Stop`: o `keytool` escreve a mensagem "Gerando o par de chaves..." no
# **stderr**, e com `Stop` o PowerShell trata saída de stderr de executável nativo como exceção
# — abortando um comando que deu certo. A verificação de sucesso aqui é a existência do arquivo
# e o `-list` no fim, não a ausência de stderr.
$ErrorActionPreference = 'Continue'

$keytool = Join-Path $Jdk 'bin\keytool.exe'
if (-not (Test-Path $keytool)) { throw "keytool nao encontrado em $keytool" }

# Identificação do titular da chave. Vai dentro do certificado e não é editável depois.
$dname = 'CN=Heavenbound Systems LTDA, OU=Mobile, O=Heavenbound Systems LTDA, L=Brasilia, ST=DF, C=BR'

$apps = @(
  @{ Id = 'opendriver';    Pacote = 'br.com.opendriver.app' },
  @{ Id = 'opendriverhub'; Pacote = 'br.com.opendriverhub.app' },
  @{ Id = 'opendriverads'; Pacote = 'br.com.opendriver.ads' }
)

New-Item -ItemType Directory -Force -Path $Destino | Out-Null

# A pasta guarda chave privada: só o dono lê. `icacls` em vez de `Set-Acl` porque `Set-Acl`
# exige SeSecurityPrivilege e falha em sessão comum.
& icacls $Destino /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null

$arquivoSenhas = Join-Path $Destino 'senhas-keystore.json'
$senhas = if (Test-Path $arquivoSenhas) {
  Get-Content $arquivoSenhas -Raw | ConvertFrom-Json -AsHashtable
} else {
  @{}
}

function Nova-Senha {
  # Sem caractere que precise de escape: a senha atravessa PowerShell, gradle e keytool, e um
  # `$` ou `"` no meio do caminho vira erro de aspas em vez de erro de senha legível.
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', '').Substring(0, 32)
}

foreach ($app in $apps) {
  $ks = Join-Path $Destino "$($app.Id)-upload.keystore"

  if (Test-Path $ks) {
    Write-Output "ja existe, mantido: $ks"
    if (-not $senhas[$app.Id]) {
      Write-Output "  ATENCAO: keystore existe mas a senha nao esta em $arquivoSenhas"
    }
    continue
  }

  $senha = Nova-Senha
  $senhas[$app.Id] = @{
    storePassword = $senha
    keyPassword   = $senha
    keyAlias      = 'upload'
    pacote        = $app.Pacote
  }

  # `-validity 10000` (~27 anos): o Google exige validade que vá além de 2033-10-22, e chave
  # que expira é chave que impede atualização do app no dia em que expirar.
  # RSA 2048 é o mínimo aceito; 4096 também serve e não traz vantagem prática aqui.
  $saidaGen = & $keytool -genkeypair `
    -keystore $ks `
    -storetype PKCS12 `
    -storepass $senha `
    -keypass $senha `
    -alias 'upload' `
    -keyalg RSA `
    -keysize 2048 `
    -validity 10000 `
    -dname $dname 2>&1 | Out-String

  if (-not (Test-Path $ks)) {
    Write-Output $saidaGen
    throw "keytool nao criou $ks"
  }
  Write-Output "criado: $ks"
}

$senhas | ConvertTo-Json -Depth 4 | Set-Content -Path $arquivoSenhas -Encoding UTF8
Write-Output ''
Write-Output "senhas em: $arquivoSenhas"

Write-Output ''
Write-Output '=== impressao digital das chaves (SHA-256) ==='
# O Play Console mostra esta impressão digital depois do primeiro upload. Conferir que bate é
# como se detecta que a chave foi trocada por engano.
foreach ($app in $apps) {
  $ks = Join-Path $Destino "$($app.Id)-upload.keystore"
  if (-not (Test-Path $ks)) { continue }
  $s = $senhas[$app.Id].storePassword
  $saida = & $keytool -list -v -keystore $ks -storepass $s -alias 'upload' 2>&1 | Out-String
  $sha = ([regex]::Match($saida, 'SHA256:\s*([0-9A-F:]+)')).Groups[1].Value
  '{0,-16} {1}' -f $app.Id, $sha
}

Write-Output ''
Write-Output 'GUARDE COPIA desta pasta fora desta maquina. Chave de upload perdida e'
Write-Output 'recuperavel pelo suporte do Google, mas custa dias.'
