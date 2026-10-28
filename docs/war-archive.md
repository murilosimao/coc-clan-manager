# Arquivo próprio de guerras

A API oficial só mostra elenco e ataques enquanto a guerra é a atual. Depois
que a próxima preparação começa (na Black Emirates, 8 minutos depois do fim),
o warlog guarda apenas totais. O ClashKing, nossa fonte de guerras completas,
parou de arquivar guerras de qualquer clã depois de 20/10/2026. A convocação
passou a julgar jogadores por uma guerra de 8 dias e quatro guerras antes: o
CARLOSSTS ficou na reserva por um 0/2 de 20/10, embora tenha feito 2/2 com
três estrelas em 24, 26 e 28/10 (conferido no Clash Spot).

## Captura

- Cron do Worker a cada minuto (`src/war-capture.js`). Consulta
  `/v1/clans/{tag}/currentwar` dos clãs de `WAR_ARCHIVE_CLANS` pelo proxy
  RoyaleAPI (`COC_API_MODE=royaleapi`, secret `COC_WORKER_API_KEY`, restrita ao
  IP do proxy). São cerca de 1.440 execuções por dia, 1,4% da cota diária do
  plano gratuito.
- Só grava quando estado, ataques ou placar mudam. A memória do isolate é
  apenas otimização; a gravação é idempotente.
- `warEnded` vira captura final. Se o fim passou sem captura final, a resposta
  devolve a guerra como pendente e o poller tenta o `currentwar` do adversário,
  como o `war-archiver` do ClashKing. Sem isso, fica o último snapshot,
  marcado como incompleto.
- Warlog privado também bloqueia o `currentwar` (403 `accessDenied`). O
  SanguePuro só é capturado depois de tornar o registro de guerra público no jogo.

## Armazenamento

`cwl.war_archive` (migration 005): uma linha por clã e início de preparação,
JSON reduzido e validado (`reduceWar`), sempre orientado com o nosso clã em
`clan`. Snapshots só avançam; a captura final e a identidade da guerra são
imutáveis; o runtime não apaga linhas. A função privada recebe as rotas
`/api/cwl/war-archive/*` somente com `X-War-Capture-Key`, derivada do
`CWL_BACKEND_KEY`; o Worker devolve 404 para visitantes nesses caminhos.

## Leitura

`/api/clans/{tag}/wars` junta o arquivo e o ClashKing pela chave
preparação+adversário. A captura final vence; um snapshot incompleto só entra
quando o ClashKing não tem a guerra. A resposta inclui `freshness` com o fim
mais recente no arquivo, no ClashKing e no warlog oficial.

- Captura incompleta: quem cumpre os critérios passa; quem não cumpre fica
  `Captura parcial · mantido`, porque o ataque pode ter vindo depois.
- Warlog oficial mais novo que a última guerra detalhada: aviso explícito com
  as duas datas. Os critérios continuam aplicados à guerra detalhada.

## Quem não jogou a última guerra do clã

`Consultar histórico recente` vem ligado por padrão (`selectionRulesVersion: 3`).
Só conta uma guerra normal encerrada depois do início da última guerra do clã
(no máximo 14 dias). Uma guerra antiga não pune duas vezes: quem ficou fora por
um 0/2 volta como sem registro na rodada seguinte.

1. Arquivo da família: guerras dos dois clãs gerenciados (captura própria ou
   ClashKing), para quem entra e sai entre PuroSangue e SanguePuro.
2. ClashKing pessoal, inclusive de outros clãs, só se o ClashKing não estiver
   atrás do nosso arquivo ou do warlog oficial (tolerância de 30 min). Se
   estiver atrasado, ninguém é excluído por ele e a tela avisa.
3. Sem registro: o jogador permanece elegível.

A origem aparece no detalhe do jogador e na coluna de fonte do TSV.
