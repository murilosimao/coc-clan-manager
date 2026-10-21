# CoC Clan Manager

**Site principal:** https://coc-purosangue.duckdns.org/

**Worker e API:** https://coc-clan-manager.murilo-m-simao.workers.dev

**GitHub Pages:** https://murilosimao.github.io/coc-clan-manager/

O workflow `pages.yml` publica somente o HTML e JavaScript estáticos a cada alteração em `public/`. Nesse endereço, o frontend consulta a API do Worker por HTTPS, sem cookies ou chave. O Worker permite CORS especificamente para `https://murilosimao.github.io` e `https://coc-purosangue.duckdns.org`, além de seu próprio domínio. Os demais domínios continuam bloqueados.

O domínio `coc-purosangue.duckdns.org` está vinculado ao Pages, com IPv4 `185.199.108.153` e certificado HTTPS. O Worker aceita esse host em HTTP e HTTPS; as consultas à API usam sempre HTTPS. A opção de exigir HTTPS está habilitada no Pages.

Seleciona participantes para a próxima guerra a partir dos escudos atuais, membros do clã e desempenho na última guerra concluída. A escalação oficial é feita no jogo.

O tamanho padrão da escalação é calculado pela quantidade de jogadores com escudo verde: 36 ou 37 disponíveis resultam em 35; 38 ou 39 resultam em 40. Para completar um tamanho arredondado para cima, a escalação usa as reservas de menor prioridade e pode recorrer a escudos vermelhos somente como última opção. Bloqueios manuais continuam valendo.

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

- **Membros, cargos, posições, escudos e guerra atual:** `clashapi.colinschmale.dev`, usando consultas públicas sem chave.
- **Histórico com ataques completos:** ClashKing (`api.clashk.ing`).
- O Worker usa URLs fixas, sem aceitar um endereço de destino arbitrário, e não encaminha cookies ou credenciais do navegador.
- Cache de 60 segundos nas respostas bem-sucedidas; são exibidos o momento da consulta e os avisos de dados ausentes.
- Os jogadores são consultados em lotes de cinco. Cada invocação usa no máximo cinco consultas externas e três conexões simultâneas.
- Perfis indisponíveis ou que já não pertençam ao clã ficam com escudo desconhecido e permanecem elegíveis; escudo vermelho bloqueia a seleção normal, mas pode ser usado como última opção se o tamanho padrão arredondar para cima. Confirmações manuais antigas não substituem os dados da API.
- Histórico ausente ou incompleto é identificado. A demonstração de desenvolvimento (`?demo=1`) é explícita e nunca substitui uma falha da API automaticamente.
- Workers Logs registra chamadas da API por categoria e ações básicas da página. Usa um UUID temporário por aba para agrupar a sessão; os logs personalizados não incluem IP completo, nomes ou tags de jogadores, conteúdo de HAR, cabeçalhos ou credenciais. Os logs automáticos de invocação ficam desligados para não persistir URLs com parâmetros. No plano gratuito, a Cloudflare informa retenção de 3 dias e limite de 200 mil eventos por dia.

Os provedores são serviços externos e podem mudar a disponibilidade ou atrasar dados. O cache não garante que um escudo alterado no jogo apareça imediatamente.

## Desenvolvimento

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

O workflow `.github/workflows/deploy.yml` publica pushes em `main` ou pode ser acionado manualmente. Configure em **Settings → Secrets and variables → Actions → Repository secrets**:

- `CLOUDFLARE_API_TOKEN`: token de deploy com permissão **Account / Workers Scripts / Edit**, limitado à conta de destino. O Wrangler pode precisar também de **Account Settings / Read** para descoberta da conta.
- `CLOUDFLARE_ACCOUNT_ID`: identificador da conta de destino.

Até os dois valores serem configurados, o workflow informa que o deploy foi pulado. Os secrets só são passados ao processo de deploy; não são inseridos no HTML nem no código do Worker.

O repositório, o frontend e os dados públicos retornados por `/api/*` são públicos. Credenciais de publicação ficam fora do código e dos arquivos estáticos.

## Credenciais

As fontes atuais não precisam de chave de aplicação. A credencial da Cloudflare só é usada para publicar. Não coloque tokens no JavaScript, no HTML, em arquivos `.env` versionados, em URLs do Git remoto ou em commits. A pasta publicada é exclusivamente `public/`; `src/`, `node_modules/`, `.wrangler/` e os workflows não são publicados como arquivos estáticos.

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
