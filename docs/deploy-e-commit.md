# Registro do redesign, commit e deploy

Atualizado em 24/10/2026. Este documento registra as decisões do War Selector, o estado dos arquivos locais e os caminhos disponíveis para versionar e publicar. Nenhum commit, push ou deploy foi executado ao preparar este registro.

## Redesign do War Selector

- A experiência abre como página completa, sem modal.
- O overview fica acima da escala e reúne contexto do clã e das guerras, quantidade de membros, escudos, aptos, selecionados e vagas.
- A tabela da última guerra mostra **Ataques**, **Estrelas**, **Novas*** e **3★**. **Novas*** são as estrelas que o jogador acrescentou ao superar o melhor ataque anterior naquela base.
- Em telas estreitas, cada participante vira um cartão de uma coluna, com os quatro indicadores alinhados e sem rolagem horizontal.
- Permanecem disponíveis critérios, titulares e reservas, listas WL/BL, inclusão e remoção, cópia e download da seleção.

Arquivos e pacotes produzidos fora do repositório Git:

- `/private/tmp/clash/war_selector.user.js`: userscript para Tampermonkey ou console do navegador.
- `/private/tmp/clash/war_selector_standalone.html`: versão autônoma, com demo e importação de HAR.
- `/private/tmp/clash/clash-war-selector.zip`: pacote de compartilhamento. Inclui também relatórios CSV/JSON em `out/`; não é o pacote de deploy do site.
- `/private/tmp/clash/clashking-pages.zip`: pacote estático com `index.html`, `war_selector_standalone.html` e `portal/clashking.js`.
- `/private/tmp/clash/DESIGN.md` e `/private/tmp/clash/.impeccable/review/FINAL_VERDICT.md`: sistema visual e revisão do redesign.

A revisão visual aceitou a direção atual e registrou capturas em `/private/tmp/clash/.impeccable/review/`. O gate antigo de hero continua `FAIL` em `/private/tmp/clash/.impeccable/build/state.json`: ele compara um mock anterior de seis linhas com a demo atual e não foi marcado como aprovado ou substituído.

## Repositório que contém as alterações de código

A pasta `/private/tmp/clash` não é um repositório Git. O app com alterações locais está em `/private/tmp/clash/coc-clan-manager-scores`, na branch `feat/war-player-scores`, baseada em `origin/main`. Os outros dois diretórios de app estavam limpos na última conferência. Essa branch contém trabalho do app de scores; ela não contém o redesign standalone do War Selector descrito acima.

No repositório `coc-clan-manager-scores`, o estado observado inclui alterações em `README.md`, `package.json`, `public/index.html`, `public/portal/app.css`, `public/portal/app.js`, `public/portal/clan-api.js`, `public/portal/clashking.js` e `src/worker.js`, além de novos arquivos em `docs/`, `public/portal/` e `scripts/`. Este documento também ficará em `docs/` desse repositório.

Os arquivos do War Selector e os dois ZIPs estão fora desse repositório. Portanto, um commit feito nele não os inclui. Para versionar o código-fonte do seletor junto com o app sem publicá-lo, copie os arquivos escolhidos para uma pasta do repositório, por exemplo `docs/war-selector/`, e inclua-os no commit. Não copie o `clash-war-selector.zip` às cegas: ele também contém relatórios CSV/JSON de jogadores.

O pacote `clashking-pages.zip` também não é consumido diretamente pelos workflows atuais: o Pages atual publica `public/index.html` e `public/portal/`; o Worker usa os arquivos de `public/`. Para integrar a página ao app, um caminho possível é extrair o pacote em `public/war-selector/` e acrescentar essa pasta ao artefato de Pages em `.github/workflows/pages.yml`. O HTML carrega `portal/clashking.js` por caminho relativo, então preserve esse subcaminho dentro de `public/war-selector/`. O deploy do Worker já inclui arquivos sob `public/` pela configuração `assets.directory`. Até essa integração, trate o userscript e a página standalone como entregáveis separados.

Se a decisão for versionar o redesign no mesmo repositório, faça a integração antes do `git add -A`:

```sh
cd /private/tmp/clash/coc-clan-manager-scores
mkdir -p docs/war-selector public/war-selector
cp ../war_selector.user.js ../DESIGN.md docs/war-selector/
unzip -oq ../clashking-pages.zip -d public/war-selector/
```

Isso guarda o userscript e o sistema visual em `docs/war-selector/` e deixa a página estática pronta em `public/war-selector/`. Para que GitHub Pages também a publique, adicione ao passo **Prepare static files** do workflow `pages.yml`:

```sh
cp -R public/war-selector _site/war-selector
```

A publicação manual pelo Wrangler inclui os arquivos novos de `public/` sem precisar de alteração no workflow do Worker.

## Conferir e criar um commit local

Os comandos abaixo atuam somente no repositório `coc-clan-manager-scores`. `git add -A` não inclui arquivos de `/private/tmp/clash` que estejam fora desse repositório. Confira a lista staged antes de confirmar o commit.

```sh
cd /private/tmp/clash/coc-clan-manager-scores
git status --short --branch
git diff --check
npm ci
npm run check
git add -A
git diff --cached --check
git diff --cached --stat
git status --short
git commit -m "feat: add war player performance scores"
git status --short --branch
```

`npm run check` executa `wrangler deploy --dry-run`; prepara o deploy localmente, sem publicar. O `.gitignore` exclui `node_modules/`, `.wrangler/`, `.env` e `.dev.vars`. Ainda assim, revise `git status` e o diff staged antes do commit. Não adicione credenciais ou arquivos `.env`.

O commit permanece apenas local. Não execute `git push` neste fluxo.

## Publicar o app na Cloudflare sem push

O `wrangler.jsonc` aponta para `src/worker.js` e para os assets em `public/`. Assim, o comando manual publica o Worker e esses assets a partir do checkout local, inclusive alterações ainda não enviadas ao GitHub.

```sh
cd /private/tmp/clash/coc-clan-manager-scores
npx wrangler whoami
npm run check
npm run deploy
```

Se o Wrangler ainda não estiver autenticado, faça login uma vez e repita os comandos:

```sh
npx wrangler login --use-keyring --scopes account:read user:read workers:write workers_scripts:write
```

`npm run deploy` publica o Worker `coc-clan-manager` na conta Cloudflare selecionada pelo Wrangler. Confira cuidadosamente a conta exibida por `npx wrangler whoami` antes de publicar. Ao terminar, abra a URL informada pelo Wrangler e valide o carregamento da página e das rotas da API.

## GitHub Pages e limite de não fazer push

O workflow `.github/workflows/pages.yml` publica `public/index.html` e `public/portal/` quando há push para `main`, e também permite execução manual no GitHub Actions. O workflow só consegue acessar commits que já estão no GitHub. Com as alterações apenas no checkout local e sem push, ele não pode publicar esta versão local.

O workflow `.github/workflows/deploy.yml` também publica o Worker em `main` ou por acionamento manual no GitHub Actions. Ele requer os secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`. Um acionamento manual do Actions também usa uma branch remota, não o estado ainda não enviado do computador.

Logo, sem push, o caminho de deploy disponível para o estado local é `npm run deploy` no Wrangler. Isso atualiza o Worker e seus assets na Cloudflare; não atualiza o site do GitHub Pages. Para o Pages refletir um commit local, será necessário enviá-lo ao GitHub, o que está fora deste fluxo.

## Publicar o War Selector standalone

O HTML standalone pode ser aberto localmente sem deploy. Para hospedar o conteúdo de `clashking-pages.zip` no app atual, integre-o sob `public/war-selector/`, mantendo juntos `index.html`, `war_selector_standalone.html` e `portal/clashking.js`, e ajuste `.github/workflows/pages.yml` para copiar essa pasta para `_site/war-selector/`. O workflow atual de `coc-clan-manager-scores` copia apenas `public/index.html` e `public/portal/`, portanto extrair o ZIP na raiz desse checkout não o adiciona à publicação atual. Depois da integração, `npm run deploy` também publicará essa pasta pela configuração de assets do Worker.

O userscript é distribuído pelo Tampermonkey: atualize o conteúdo do script usando `war_selector.user.js`. Isso não é feito pelo deploy do Worker nem pelo workflow do Pages.

## Após a publicação

- Confirme no Wrangler ou no GitHub Actions qual versão e destino foram publicados.
- Verifique overview, tabela e ações em desktop e em larguras de celular. As capturas existentes cobrem 1504 px, 390 px e 320 px.
- Para o War Selector, confira a definição de `Novas*`, ausência de modal e ausência de rolagem horizontal.
- Para o app, confira a página pública, chamadas da API e logs do Worker quando aplicável.
