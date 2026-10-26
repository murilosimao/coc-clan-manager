# Publicação da CWL com Supabase e cálculo no navegador

## Arquitetura

O navegador consulta fontes públicas pelo proxy e executa `war-ordinal-v2` e `cwl-assignment-v2.1` em um Web Worker. O Worker da Cloudflare faz apenas o proxy de fontes e encaminha a API da CWL a uma Edge Function privada do Supabase. A função valida sessão, escopo do clã, dados e fórmulas, reconstrói a otimização e persiste o plano; ela não repete o ajuste ordinal. Nenhum servidor precisa ficar rodando permanentemente.

`CWL_BACKEND_REGION` seleciona a região da função pelo header `x-region`, definido somente pelo Worker. O banco atual está em `us-east-2`; as funções são invocadas em `us-east-1` para reduzir as viagens de rede ao banco. Remover essa variável retorna à seleção automática da plataforma. A configuração deve acompanhar a região do banco e ser conferida pelo header de resposta `x-sb-edge-region`.

O Supabase Data API fica desabilitado. A conexão com Postgres usa a role `cwl_runtime`, sem privilégios administrativos, DDL, DELETE, TRUNCATE ou bypass de RLS. Tabelas e funções do schema `cwl` não têm grants para `PUBLIC`, `anon`, `authenticated` ou `service_role`. A role recebe apenas as operações necessárias; snapshots e histórico têm triggers de imutabilidade. O proprietário/migrador do projeto continua sendo administrativo e precisa ser protegido separadamente.

## Preparação do projeto

1. Criar o projeto com Postgres padrão, Data API desabilitado e automatic RLS habilitado. O RLS de `cwl` é aplicado explicitamente pelo script de segurança.
2. Em Database → Settings → SSL Configuration, habilitar **Enforce SSL on incoming connections**. O cliente também verifica certificado e hostname; `sslmode=require` sozinho não fornece essa validação.
3. Guardar a conexão direta em `DB_URL` no `.env` administrativo local e a conexão do Transaction pooler em `DB_POOLER_URL`. Não usar essa credencial administrativa na aplicação.
4. Criar manualmente as contas de líder e colíder em Authentication → Users, confirmar os emails e desativar **Allow new users to sign up**. O UID e o clã de cada conta precisam estar na allowlist privada `CWL_EDITORS`. Metadados editáveis pelo usuário não concedem permissão.

Do diretório do repositório, quando o `.env` administrativo estiver no diretório pai:

```sh
node --env-file=../.env scripts/prepare-supabase.mjs --apply
node --env-file=.env.supabase scripts/check-supabase-security.mjs
```

O primeiro comando aplica somente as migrations de `cwl` e as permissões da role dedicada. A senha aleatória é gerada localmente; uma senha de runtime existente não é rotacionada automaticamente. Se houver `DB_POOLER_URL`, usuário e senha são substituídos pela conta restrita e a conexão é testada antes de salvar. O pooler transacional usa `prepare:false` e `max_pipeline:1`.

## Arquivos privados

| Arquivo | Conteúdo | Destino |
|---|---|---|
| `.env` administrativo | `DB_URL`, `DB_POOLER_URL` | Somente migrations locais |
| `.env.supabase` | `DATABASE_URL` restrita, `CWL_EDITORS`, `CWL_BACKEND_KEY`, `CWL_APP_ORIGIN` | Secrets da Edge Function |
| `.env.cloudflare` | `CWL_BACKEND_URL`, `CWL_BACKEND_KEY` | Secrets do Worker |

Todos ficam fora do Git, fora de `public/` e com permissão local `600`. A conexão administrativa não deve ser copiada para o Worker, a função ou GitHub Actions. A Edge Function usa a URL e a chave pública de Auth fornecidas automaticamente pelo Supabase; nenhuma chave de Auth ou de banco chega ao frontend.

`CWL_EDITORS` é um objeto JSON no formato `{"UUID":{"role":"leader","clanTag":"TAG"}}`; `coLeader` também é aceito. Não há promoção automática por email, cadastro ou metadados. Remover um UID da configuração revoga seu acesso na próxima verificação de sessão.

Cookies usam `HttpOnly`, `Secure` e `SameSite=Strict`. Seus valores também são cifrados com AES-GCM, usando chaves derivadas por finalidade do secret de transporte. A função aceita somente esse formato: cookies antigos com tokens Supabase em texto puro não autenticam nem renovam sessões na aplicação. Rotacionar `CWL_BACKEND_KEY` exige novo login.

O Worker não encaminha o header `Cookie` ao Supabase. Ele filtra somente os cookies da CWL, cifra o transporte e os envia no header privado `X-CWL-Session`, com validade de 60 segundos e vínculo à origem. A função reconstrói o header de sessão apenas no Request interno. Headers forjados pelo visitante não são encaminhados. Isso evita registrar cookies nos logs automáticos de invocação da plataforma; logs de aplicação também não devem conter tokens, senhas ou conteúdo de requisições.

## Validação antes de publicar

```sh
npm ci
npm audit
npm run test:cwl
npm run check:scores
npm run check
npm run build:supabase
npx --yes deno@2.9.6 check --config supabase/functions/cwl/deno.json supabase/functions/cwl/index.ts
```

Com o preview local em execução, `npm run test:ui` confere consulta pública, login, edição autenticada, cancelamento, concorrência de respostas e o Web Worker real. `npm run test:parity` requer os snapshots congelados locais, fora do Git; o relatório compara parâmetros, scores, evidência, alvos, metas e erro histórico contra `b3f1f14`. Os resumos versionados estão em `evaluation/releases/cwl-browser-2026-10/`.

## Ordem da publicação

Os comandos abaixo publicam configurações/serviços. Eles pertencem à etapa de publicação, após revisão do código e dos resultados.

1. Usar um access token limitado ao projeto, com `edge_functions_read`, `edge_functions_write` e `edge_functions_secrets_write`, fornecido pelo ambiente; nunca incluir o token no comando ou no Git. A conexão PostgreSQL não autoriza deploy de funções.
2. Preparar e publicar primeiro a função privada:

```sh
npm run build:supabase
npx --yes supabase@2.122.0 secrets set --env-file .env.supabase --project-ref "$SUPABASE_PROJECT_REF"
npx --yes supabase@2.122.0 functions deploy cwl --use-api --project-ref "$SUPABASE_PROJECT_REF"
```

3. Registrar os dois secrets de transporte no Worker: `npx wrangler secret bulk .env.cloudflare`.
4. Publicar o Worker e depois os arquivos do frontend. A interface do Worker e GitHub Pages compartilham o código; o login no Pages leva ao domínio do Worker para não depender de cookies de terceiros.

No GitHub, o Pages publica o frontend após validação, sem liberar o deploy dos serviços. As rotinas do Worker e da função exigem também a variável **`CWL_DEPLOY_READY=true`**. Ela só deve ser ativada depois que a função e os secrets estiverem configurados. A função do Supabase tem workflow manual próprio. Os secrets de CI são `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`; o projeto é indicado pela variável `SUPABASE_PROJECT_REF`. Credenciais do banco ficam somente no Supabase.

`verify_jwt=false` na configuração da função desativa somente a autenticação automática do gateway: a própria função exige a chave privada do Worker em todas as chamadas e valida a sessão Supabase separadamente nas operações protegidas. Sem a chave de transporte, inclusive `/health` deve retornar 401 quando chamado diretamente na função.

## Conferência após publicação

- `/api/cwl/health` pelo Worker deve confirmar banco e migrations.
- A URL direta da função, sem a chave privada, deve recusar com 401.
- Visitante não deve ter botões de editar/preparar nem conseguir gravar pela API. Consultar um dia sem plano não cria registros.
- A conta da líder deve entrar, preparar uma única proposta, revisar e salvar uma aprovação. Reabrir o dia deve manter a proposta inicial e a revisão aprovada. Repetir para o colíder quando seu UID estiver configurado.
- Testar o login no celular e a saída da sessão; após sair, a tela volta à consulta.
- Conferir tempos, CPU e memória no ambiente hospedado. O benchmark local não demonstra os limites da plataforma publicada.

## Limite de confiança

Só editores autorizados podem submeter modelos; a função valida fontes, cronologia, evidência e consistência das fórmulas, mas não refaz a otimização estatística de 220 iterações. A identidade do editor e o snapshot completo ficam preservados para reprodução. Essa arquitetura confia nos editores autorizados e não transforma um cálculo enviado pelo navegador em prova independente de treinamento correto. A avaliação de mérito continua dependendo de missão aprovada antes do ataque e de evidência suficiente.

O processamento de um snapshot aceita no máximo 4 MiB comprimidos e 32 MiB descomprimidos. Cada instância processa apenas uma inicialização ou auditoria de snapshot por vez; outra chamada recebe 429 para tentar novamente. O bloqueio transacional do banco preserva um único plano inicial mesmo entre instâncias diferentes. Leituras comuns não descomprimem o histórico completo. Memória e tempo ainda precisam ser medidos na função publicada.

Referências oficiais: [limites de Workers](https://developers.cloudflare.com/workers/platform/limits/), [Edge Functions](https://supabase.com/docs/guides/functions/limits), [segurança da Data API](https://supabase.com/docs/guides/api/securing-your-api), [SSL](https://supabase.com/docs/guides/platform/ssl-enforcement) e [poolers](https://supabase.com/docs/guides/database/connecting-to-postgres).
