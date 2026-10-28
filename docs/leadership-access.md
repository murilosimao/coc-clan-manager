# Gestão de usuários

Na aplicação, abra **Liderança → Gerenciar usuários**. A líder escolhe um dos clãs que administra e cadastra colíderes com email e senha inicial de pelo menos 12 caracteres. O destinatário pode trocar a senha em Liderança. A senha não é devolvida pela API nem armazenada na aplicação; Supabase Auth cuida das credenciais.

Para dar acesso ao segundo clã a uma conta que a líder já administra, cadastre o mesmo email nesse clã. A senha existente é preservada. A gestão não permite promover contas a líder, alterar líderes ou remover a própria liderança.

**Remover** pede confirmação e revoga apenas a associação ao clã selecionado. A identidade no Supabase Auth, o acesso aos demais clãs e os registros históricos são preservados. As permissões são consultadas no banco em cada requisição, inclusive com sessões já abertas. Se a conta ficar sem associações, não consegue mais entrar na liderança.

## Banco e owners

- `cwl.accounts`: diretório de email e UUID do Supabase Auth; sem senhas.
- `cwl.memberships`: papel por usuário e clã (`leader` ou `coLeader`). Esta é a fonte de autorização em produção.
- `cwl.access_events`: concessões e revogações com ator, usuário e clã; sem senha ou token.

Os owners administram a liderança diretamente no banco com a conexão administrativa. Antes de associar uma conta, confirme sua existência em `auth.users` e insira o UUID/email correspondente em `cwl.accounts`. Depois associe a conta e o clã em `cwl.memberships`. Não altere registros de planos ou revisões para gerenciar acesso.

A conta runtime só pode inserir e apagar associações de colíder. RLS protege linhas de líder e não existe permissão de UPDATE nessa tabela. As tabelas do esquema `cwl` continuam inacessíveis por `anon`, `authenticated` e `service_role` via Data API.

## Publicação

1. Execute `scripts/prepare-access.mjs` com `DB_URL` administrativo e a configuração local ignorada `.env.supabase`. O bootstrap preserva contas existentes, ignora identidades já excluídas e exige uma liderança ativa em cada clã configurado. O marcador `access_seed_v1` impede ressuscitar associações revogadas em execuções posteriores.
2. Publique a função compilada com `npm run build:supabase`.
3. Configure `CWL_ACCESS_DB=true` e retire a lista legada (`CWL_EDITORS={}`). Após a migração, mudanças de acesso são feitas no banco ou pela interface.
4. Publique Worker e GitHub Pages separadamente.

Somente a Edge Function usa a credencial administrativa de Auth fornecida pelo ambiente Supabase. Ela não é enviada ao Worker público nem ao navegador. Cadastro público continua desabilitado. Mutações exigem a origem exata da aplicação autenticada e passam pelo limitador de requisições do Worker.

O fluxo de cadastro compensa falhas de persistência removendo somente a identidade nova gerada para aquela operação. Uma falha de compensação é sinalizada com `user_cleanup_required`; o owner deve conferir a identidade órfã antes de repetir o cadastro.

## Verificação

`tests/cwl-access.test.mjs` usa PostgreSQL descartável para verificar isolamento de clãs, RLS, proteção das líderes, reutilização de contas, auditoria e revogação de sessões. `tests/users-mobile-browser.mjs` cobre cadastro, senha inicial, remoção/cancelamento, troca de clã, falhas e acesso de colíder em 320, 390, 768 e 1440 px.
