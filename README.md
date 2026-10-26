# CoC Clan Manager

**Site principal:** https://coc-purosangue.duckdns.org/

**Worker e API:** https://coc-clan-manager.murilo-m-simao.workers.dev

**GitHub Pages:** https://murilosimao.github.io/coc-clan-manager/

O workflow `pages.yml` publica somente o HTML e JavaScript estáticos após validação, quando `CWL_DEPLOY_READY=true`. Nesse endereço, a consulta pública usa a API do Worker por HTTPS. Para editar a CWL, o login leva à mesma aplicação no domínio do Worker, com cookies de sessão protegidos. O Worker permite CORS especificamente para `https://murilosimao.github.io` e `https://coc-purosangue.duckdns.org`, além de seu próprio domínio.

O domínio `coc-purosangue.duckdns.org` está vinculado ao Pages, com IPv4 `185.199.108.153` e certificado HTTPS. O Worker aceita esse host em HTTP e HTTPS; as consultas à API usam sempre HTTPS. A opção de exigir HTTPS está habilitada no Pages.

Seleciona participantes para a próxima guerra a partir dos escudos atuais, membros do clã e desempenho na última guerra concluída. A escalação oficial é feita no jogo.

O tamanho padrão da escalação é calculado pela quantidade de jogadores com escudo verde: 36 ou 37 disponíveis resultam em 35; 38 ou 39 resultam em 40. Os reforços seguem a atividade do clã: mais troféus primeiro, depois melhor posição no ranking. O Centro da Vila não define a ordem. Escudos vermelhos só entram como última opção no arredondamento para cima; bloqueios manuais continuam valendo.

## Interface e uso

O Quartel do Clã tem três áreas: **Time**, **Critérios** e **Última guerra**. No PC, a lista facilita comparar jogadores e apresenta contexto na lateral. No celular, a navegação fica na parte inferior, com detalhes expansíveis e ação de copiar. A busca e os filtros Convocados/Reserva/Todos funcionam nas duas telas.

- Estrelas do **1º e 2º ataque** aparecem separadamente. Zero estrela é um resultado válido; `—` significa ataque ausente ou desempenho indisponível.
- **Copiar para Excel** usa TSV com cabeçalhos. **Baixar TSV** gera o mesmo conteúdo em UTF-8 com BOM, incluindo a fonte do desempenho. Nomes são tratados como texto para evitar fórmulas ao colar na planilha. Não há importação de arquivos.
- **Histórico e estatísticas** nos detalhes de cada jogador (ou **Estatísticas e CWL** no relatório) consulta até 100 guerras pessoais no ClashKing. O filtro separa guerras normais de Liga. Os cálculos usam apenas guerras concluídas e a quantidade de ataques informada por cada guerra, incluindo rodadas de CWL com um ataque. O histórico pode incluir outros clãs e é consultado somente ao abrir o painel.
- Com a consulta opcional ligada, o histórico pessoal da última guerra normal concluída substitui a falta de registro na última guerra do clã para aplicar os mesmos critérios. Desempenho pessoal fica identificado separadamente na escalação.
- Brasões vêm do campo público `badgeUrls`. Os ícones de CV 1–18 estão incluídos no próprio site. Créditos e origem em `public/portal/images/SOURCES.md`. Ícones ausentes têm representação textual de reserva.

O redesenho foi iniciado em um worktree de `origin/main` (`43610a2`), na branch `redesign/mobile-war-room`. O sistema visual e as decisões de UX estão em `design-system/MASTER.md`.

## Arquitetura

O GitHub Pages publica a página estática, que consulta as rotas `/api/*` no Cloudflare Worker. O Worker também serve a mesma página em seu próprio endereço. Não é necessário manter um servidor.

- **Membros, cargos, posições, troféus, escudos e guerra atual:** `clashapi.colinschmale.dev`, usando consultas públicas sem chave.
- **Histórico com ataques completos:** ClashKing (`api.clashk.ing`).
- O proxy de fontes públicas aceita somente provedores e rotas permitidos e não encaminha credenciais do navegador. A API privada da CWL encaminha a sessão somente à função configurada do Supabase.
- Cache de 60 segundos nas respostas bem-sucedidas; são exibidos o momento da consulta e os avisos de dados ausentes.
- Os jogadores são consultados em lotes de cinco. Cada invocação usa no máximo cinco consultas externas e três conexões simultâneas.
- Perfis indisponíveis ou que já não pertençam ao clã ficam com escudo desconhecido e permanecem elegíveis; escudo vermelho bloqueia a seleção normal, mas pode ser usado como última opção se o tamanho padrão arredondar para cima. Confirmações manuais antigas não substituem os dados da API.
- Histórico ausente ou incompleto é identificado. A demonstração de desenvolvimento (`?demo=1`) é explícita e nunca substitui uma falha da API automaticamente.
- Workers Logs registra chamadas da API por categoria e ações básicas da página. Usa um UUID temporário por aba para agrupar a sessão; os logs personalizados não incluem IP completo, nomes ou tags de jogadores, conteúdo de HAR, cabeçalhos ou credenciais. Os logs automáticos de invocação ficam desligados para não persistir URLs com parâmetros. No plano gratuito, a Cloudflare informa retenção de 3 dias e limite de 200 mil eventos por dia.

Os provedores são serviços externos e podem mudar a disponibilidade ou atrasar dados. O cache não garante que um escudo alterado no jogo apareça imediatamente.

## Desenvolvimento

### Scores de ataque e defesa nas guerras

Em **Guerras**, cada participante dos dois lados recebe ATQ e DEF. O histórico carrega em segundo plano e usa apenas guerras concluídas anteriores ao início da guerra analisada, com o mesmo modificador. As notas não alteram a convocação nem escolhem alvos pelos jogadores. Cada ataque mostra a dificuldade relativa do alvo realmente escolhido e, quando há amostra suficiente, se o resultado ficou abaixo da referência.

Na CWL, o cálculo amplia a evidência de jogadores com pouca amostra consultando guerras completas referenciadas pelo histórico individual, inclusive de clãs anteriores. A janela continua limitada a 14 dias de guerras normais e às duas últimas edições válidas de CWL por jogador, antes do início do confronto e com o modificador correspondente. Limites e lacunas da API aparecem como avisos. A fórmula melhorada `war-ordinal-v2` foi preservada na execução pelo navegador; resultados, protocolo e limitações estão em [evaluation/candidates/cwl-v2](evaluation/candidates/cwl-v2/README.md) e na [verificação de paridade](evaluation/releases/cwl-browser-2026-10/README.md). O otimizador continua experimental e exige revisão da líder.

Clique em **ATQ** ou **DEF** para ver a fórmula substituída pelos valores do jogador, ataques/defesas usados, pesos, parâmetros aprendidos e registros excluídos. Ambos usam guerras normais dos últimos 14 dias e as duas últimas edições de CWL de cada clã, anteriores à guerra analisada. **Exportar cálculo TSV** inclui toda a base e parâmetros para auditoria. Notas de jogadores sem histórico ficam em 50, identificadas como referência. A versão é experimental e usa guerras/CWL; Ranked e níveis históricos de heróis/tropas/equipamentos ficam fora quando não confirmados. A fórmula e as limitações estão em [docs/war-scores.md](docs/war-scores.md).

### Backend CWL com PostgreSQL

O cálculo inicial executa em um Web Worker no navegador, sem bloquear a interface. Uma Edge Function privada valida e grava o plano no PostgreSQL do Supabase; somente líder e colíder autenticados podem preparar ou editar o plano. Visitantes consultam os planos salvos. A [preparação para publicação](docs/cwl-deployment.md) detalha secrets, autenticação, permissões do banco e a ordem de deploy.

A persistência do plano inicial, revisões e métricas de calibração estão documentadas em [docs/cwl-backend.md](docs/cwl-backend.md). O ranking usa a política versionada [cwl-merit-v1](docs/cwl-ranking.md), com memória de cálculo por missão e desempates por destruição e duração. Ambiente local: `npm run db:setup`, `npm run db:up`, `npm run db:migrate`, `npm run dev -- --port 8791`. Integração com PostgreSQL real: `npm run test:cwl`.

A aba **Liga CWL** apresenta plano do dia, edição inline e ranking, com exportação TSV da visão atual. A [documentação do frontend](docs/cwl-frontend.md) explica os estados, a atualização de dias acompanhados e a revisão autenticada. Para explorar o exemplo ilustrativo: `http://127.0.0.1:8791/?demo=1&view=cwl`. Para verificar os fluxos no navegador: `npm run test:ui`, com o preview local em execução.

### Servidor de desenvolvimento

Requer Node.js 22 ou superior.

```sh
npm ci
npm run dev
```

Abra a URL informada pelo Wrangler. A página consulta `#2G8QCR92V` por padrão e permite trocar a tag em **Meu clã**. Para revisão visual com uma captura de 20/10/2026, acrescente `?demo=1` à URL. Os painéis pessoais de estatísticas consultam a API atual, mesmo ao revisar essa demonstração.

```sh
npm run check
```

Esse comando prepara o pacote de deploy localmente, sem publicar.

## Publicação manual

```sh
npx wrangler login --use-keyring --scopes account:read user:read workers:write workers_scripts:write
npm run deploy
```

A autorização acontece na Cloudflare. O parâmetro `--use-keyring` guarda a credencial no gerenciador de credenciais do sistema operacional, fora do projeto. A URL pública é informada ao terminar o deploy. O Worker se chama `coc-clan-manager`.

Para consultar os logs, abra **Workers & Pages → coc-clan-manager → Observability → Logs**. `npx wrangler tail` acompanha as mensagens `console.log()` em tempo real.

## Publicação pelo GitHub Actions

Os workflows de publicação dependem da validação e da variável `CWL_DEPLOY_READY=true`. Configure a função e os secrets primeiro, seguindo [docs/cwl-deployment.md](docs/cwl-deployment.md). O workflow `.github/workflows/deploy.yml` publica pushes em `main` ou pode ser acionado manualmente. Configure em **Settings → Secrets and variables → Actions → Repository secrets**:

- `CLOUDFLARE_API_TOKEN`: token de deploy com permissão **Account / Workers Scripts / Edit**, limitado à conta de destino. O Wrangler pode precisar também de **Account Settings / Read** para descoberta da conta.
- `CLOUDFLARE_ACCOUNT_ID`: identificador da conta de destino.

Até os dois valores serem configurados, o workflow informa que o deploy foi pulado. Os secrets só são passados ao processo de deploy; não são inseridos no HTML nem no código do Worker.

O repositório, o frontend e os dados públicos retornados por `/api/*` são públicos. Credenciais de publicação ficam fora do código e dos arquivos estáticos.

## Credenciais

As fontes de dados do jogo não precisam de chave de aplicação. O login e a persistência da CWL usam secrets separados no Supabase e no Worker, com conta de banco restrita e validação TLS. Não coloque tokens no JavaScript, no HTML, em arquivos `.env` versionados, em URLs do Git remoto ou em commits. A pasta publicada é exclusivamente `public/`; `src/`, `node_modules/`, `.wrangler/` e os workflows não são publicados como arquivos estáticos.

Se futuramente for usada a API oficial da Supercell, a chave deverá ficar em um **Worker Secret** definido com `wrangler secret put`, usado apenas no servidor. Nunca reutilize uma chave exposta em chat ou em um commit.

## Regras

- Somente o escudo vermelho exclui automaticamente; escudos sem confirmação permanecem elegíveis.
- Para quem tem registro na última guerra concluída do clã, a seleção exige os dois ataques e pelo menos uma estrela. A ausência de registro não exclui o jogador.
- A consulta ao histórico pessoal em guerras normais anteriores, inclusive de outros clãs, é opcional e vem desligada. Se ligada, ela só substitui a ausência de registro na última guerra do clã; falha ou falta de histórico continua sem excluir o jogador.
- A lista de prioridade pode superar os critérios de desempenho, mas nunca o escudo vermelho. Bloqueios manuais também são respeitados.
- O tamanho sugerido é o padrão mais próximo da quantidade elegível, entre 5, 10, 15, ..., 50. Uma diferença de até duas vagas é preenchida ou cortada pelo fim da ordem escolhida.
- Novas estrelas são calculadas por ordem de ataque, acompanhando o melhor resultado anterior em cada base.
- A seleção pode ser copiada ou baixada em TSV, incluindo o resultado separado de cada ataque e o motivo da convocação.

Tipografia Barlow e Barlow Condensed distribuída sob SIL Open Font License; licenças em `public/portal/fonts/`.

Créditos de dados: ClashKing e o proxy de perfis `clashapi.colinschmale.dev`. Projeto independente, sem afiliação com a Supercell.
