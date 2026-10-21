# CoC Clan Manager

Seleciona participantes para a próxima guerra a partir dos escudos atuais, membros do clã e desempenho na última guerra concluída. A escalação oficial é feita no jogo.

## Arquitetura

Um Cloudflare Worker serve a página estática e as rotas `/api/*` no mesmo domínio. O navegador consulta apenas esse domínio. Não é necessário manter um servidor.

- **Membros, cargos, posições, escudos e guerra atual:** `clashapi.colinschmale.dev`, usando consultas públicas sem chave.
- **Histórico com ataques completos:** ClashKing (`api.clashk.ing`).
- O Worker usa URLs fixas, sem aceitar um endereço de destino arbitrário, e não encaminha cookies ou credenciais do navegador.
- Cache de 60 segundos nas respostas bem-sucedidas; são exibidos o momento da consulta e os avisos de dados ausentes.
- Os jogadores são consultados em lotes de cinco. Cada invocação usa no máximo cinco consultas externas e três conexões simultâneas.
- Perfis indisponíveis ou que já não pertençam ao clã ficam com escudo desconhecido, excluído enquanto o filtro estiver ligado. Confirmações manuais antigas não substituem os dados da API.
- Histórico ausente ou incompleto é identificado. A demo é sempre uma fonte separada.

Os provedores são serviços externos e podem mudar a disponibilidade ou atrasar dados. O cache não garante que um escudo alterado no jogo apareça imediatamente.

## Desenvolvimento

Requer Node.js 22 ou superior.

```sh
npm ci
npm run dev
```

Abra a URL informada pelo Wrangler. A página consulta `#2G8QCR92V` por padrão e permite trocar a tag. Use **Ver demo** para uma captura de 20/10/2026.

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

## Publicação pelo GitHub Actions

O workflow `.github/workflows/deploy.yml` publica pushes em `main` ou pode ser acionado manualmente. Configure em **Settings → Secrets and variables → Actions → Repository secrets**:

- `CLOUDFLARE_API_TOKEN`: token de deploy com permissão **Account / Workers Scripts / Edit**, limitado à conta de destino. O Wrangler pode precisar também de **Account Settings / Read** para descoberta da conta.
- `CLOUDFLARE_ACCOUNT_ID`: identificador da conta de destino.

Até os dois valores serem configurados, o workflow informa que o deploy foi pulado. Os secrets só são passados ao processo de deploy; não são inseridos no HTML nem no código do Worker.

O frontend público e `/api/*` são acessíveis a quem tiver o endereço. O repositório privado protege o código no GitHub, não restringe o acesso ao site publicado.

## Credenciais

As fontes atuais não precisam de chave de aplicação. A credencial da Cloudflare só é usada para publicar. Não coloque tokens no JavaScript, no HTML, em arquivos `.env` versionados, em URLs do Git remoto ou em commits. A pasta publicada é exclusivamente `public/`; `src/`, `node_modules/`, `.wrangler/` e os workflows não são publicados como arquivos estáticos.

Se futuramente for usada a API oficial da Supercell, a chave deverá ficar em um **Worker Secret** definido com `wrangler secret put`, usado apenas no servidor. Nunca reutilize uma chave exposta em chat ou em um commit.

## Regras

- Filtro de escudo exclui vermelhos e desconhecidos.
- Critérios de desempenho consideram ataques, estrelas e ataques de três estrelas da última guerra.
- Listas de inclusão e exclusão e ajustes manuais preservam os bloqueios de escudo ativos.
- Tamanhos válidos: 5, 10, 15, ..., 50.
- Novas estrelas são calculadas por ordem de ataque, acompanhando o melhor resultado anterior em cada base.
- A seleção pode ser copiada ou exportada como JSON, incluindo a origem dos escudos.

Créditos de dados: ClashKing e o proxy de perfis `clashapi.colinschmale.dev`. Projeto independente, sem afiliação com a Supercell.
