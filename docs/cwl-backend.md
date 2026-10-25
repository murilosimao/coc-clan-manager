# Backend CWL — contratos e execução local

## Escopo desta entrega

API de planejamento síncrono, PostgreSQL e otimização determinística. O frontend ainda não chama estas rotas. Não há chamada a modelos de decisão, cron ou fila de planejamento.

O primeiro `GET .../plan` consulta as fontes públicas, calcula e persiste a proposta antes de responder. A chave `(clan_tag, start_time)` identifica a guerra, inclusive se vários dias forem consultados simultaneamente. Transação e advisory lock garantem uma única geração mesmo com vários visitantes. Uma revisão da líder nunca recalcula a proposta inicial. Uma atualização de resultados nunca redistribui missões.

## Ambiente local

```sh
npm install
npm run db:setup
npm run db:up
npm run db:migrate
npm run dev -- --port 8791 --ip 127.0.0.1
```

`db:setup` cria credenciais aleatórias em `.env` e `.dev.vars`, ambos ignorados pelo Git e fora de `public/`. Não sobrescreve arquivos existentes. O Compose usa `postgres:17-alpine`, volume persistente próprio e porta **127.0.0.1:55432**. Não altera outros bancos/containers. `docker compose stop postgres` para somente este serviço, preservando o volume.

O schema da aplicação é `cwl`; as migrations são versionadas e transacionais. O teste de integração usa **outro banco**, `coc_cwl_test`, e recusa resetar um banco sem sufixo `_test`.

```sh
npm run test:cwl
npm run check:scores
npm run check
```

## Contrato HTTP

Todas as rotas estão sob `/api/cwl`. Tags aceitam `#` codificado ou somente o identificador. `warStart` é o início exato retornado pela fonte, por exemplo `20261009T082016.000Z`. Datas de início identificam a guerra sem inventar números de rodada quando há lacunas no histórico.

| Método | Caminho | Comportamento |
|---|---|---|
| GET | `/health` | Confere conexão e migrations |
| GET | `/clans/:tag/seasons/:YYYY-MM` | Lista guerras CWL registradas no mês; não promete histórico completo |
| GET | `/clans/:tag/wars/:warStart/plan` | Gera uma vez ou recupera; retorna 201 na criação, 200 na leitura |
| POST | `.../plan/revisions` | Acrescenta edição/aprovação da líder |
| POST | `.../plan/sync` | Consulta resultados confiáveis e grava observação, sem novo plano |
| POST | `.../plan/reviews` | Resolve atribuição ambígua de ataque a missão, com justificativa |
| GET | `.../plan/metrics` | Adoção e execução das missões |
| GET | `.../plan/audit` | Revisões completas, matriz, parâmetros e dados de origem |
| GET | `/clans/:tag/seasons/:YYYY-MM/analytics` | Consolida participantes, missões, estrelas, destruição e duração |
| GET | `/clans/:tag/seasons/:YYYY-MM/ranking` | Ranking de mérito, política versionada e memória de cálculo por oportunidade |
| GET | `/clans/:tag/seasons/:YYYY-MM/dataset` | Exporta JSON de confrontos realmente observados para análise futura |

As rotas de escrita, auditoria e dataset exigem `Authorization: Bearer <LEADER_API_KEY>`. A credencial só pode operar no `LEADER_CLAN_TAG` configurado. Configuração ausente bloqueia a escrita. Nenhuma chave é enviada aos serviços de Clash, impressa em logs ou devolvida pela API. A futura UI precisará de autenticação da líder; a credencial de servidor não deve ser incluída no JavaScript público.

Leituras públicas permitem a geração inicial. A requisição termina somente depois do COMMIT, sem 202/job pendente. O GET de um plano já salvo consulta resultados se a última observação tiver mais de 60 segundos; falha da fonte preserva o plano e retorna `trackingWarning`. Observações idênticas são deduplicadas. A origem é sempre um host fixo; não há importação de dados arbitrários por visitantes.

### Aprovar

Corpo de `POST .../plan/revisions`:

```json
{
  "expectedRevision": 1,
  "approve": true,
  "reason": "Plano conferido para esta rodada"
}
```

### Editar e aprovar

Enviar `assignments` com todas as missões pendentes do plano, cada uma contendo `attackerTag`, `defenderTag` e `goalStars` (inteiro de 1 a 3), além de `expectedRevision`, `approve` e `reason`.

Versão desatualizada retorna **409**. A edição é atômica. Com `approve:false`, a edição fica em rascunho e `effective` mantém a última aprovação. A líder pode deliberadamente repetir um alvo; `duplicateTargets` sinaliza isso sem alterar automaticamente outras missões. Ataques já observados têm sua missão preservada. Edições após o fim da guerra são recusadas.

### Resolver uma ambiguidade

```json
{
  "order": 12,
  "missionRevision": 3,
  "reason": "Confirmado com a líder qual missão foi comunicada"
}
```

Uma revisão só pode apontar uma versão aprovada antes do ataque conhecido/detectado. Ataques que já existiam quando o plano foi criado não recebem missão retroativa. A resolução é um novo registro, mantendo as evidências anteriores.

## Cálculo e metas

O normalizador preserva `sourcePosition` do ClashKing. Em CWLs com elenco ativo completo e posições válidas/únicas de 1 a 50, ele ordena os participantes e calcula a posição ativa de 1 a N. Isso permite consumir registros que usam posições esparsas do elenco da Liga e mantém o espelho entre as duas escalações. Posições inválidas, duplicidades e elencos incompletos continuam recusados.

O backend reutiliza `public/portal/war-scores.js` (`war-ordinal-v2`): mesmas janelas de 14 dias de guerras normais e duas CWLs, corte anterior à guerra analisada, modificador exato, efeitos separados por jogador/CV e regularização. O provedor ainda recupera guerras completas referenciadas pelo histórico individual de jogadores com pouca evidência, inclusive de clãs anteriores. Ele valida cada guerra completa, aplica os mesmos filtros temporais e de modificador e preserva avisos quando há falha ou limite de consulta. O snapshot preserva os dados usados, versão da política de histórico, parâmetros, coeficientes, limiares, escalas e avisos das fontes.

Para cada confronto, os três cortes do modelo ordinal geram uma distribuição de estrelas de 0 a 3. O valor de uma atribuição é:

`expectedGain = soma(max(0, estrelas - melhorResultadoAtualDaBase) * distribuição[estrelas])`

O algoritmo húngaro maximiza a soma desses valores, atribuindo um alvo distinto a cada ataque restante. Não se otimiza a soma de `ATQ-DEF`, que não distinguiria distribuições completas. A matriz fica preservada para auditoria e para comparar alterações manuais.

A meta é o maior número de estrelas acima do resultado atual com sustentação maior ou igual a `goalSupport`. Nesta versão experimental o valor é **0,70**, gravado no plano. Se não houver nível sustentado, sugere-se a próxima estrela com aviso explícito. Esse parâmetro é uma hipótese inicial, **ainda não uma probabilidade individual calibrada**. Histórico insuficiente e diferenças de CV além de três níveis ficam sinalizados para revisão manual; todos os jogadores permanecem no plano. O algoritmo de atribuição e o limiar permanecem iguais ao snapshot funcional.

No primeiro acesso com guerra já em andamento, só ataques ainda disponíveis são distribuídos; bases triplicadas são retiradas e o ganho adicional considera o placar existente. Resultados já existentes ficam `before_plan`. Uma guerra já encerrada pode gerar reconstrução `retrospective:true`, útil para auditoria estatística, sem possibilidade de aprovação e sem atribuir missões oficiais a ataques passados.

## Persistência e métricas

- `rounds`: identificação, temporada e estado observado.
- `plans`: proposta inicial, matriz, versão do cálculo, fontes e snapshot estatístico imutáveis.
- `revisions`: alterações e aprovações, append-only.
- `observations`: snapshots recebidos, deduplicados e append-only.
- `attacks`: projeção dos ataques observados e sua atribuição à missão.
- `reviews`: resolução manual de ambiguidades, append-only.
- `ranking_policies`: política de mérito imutável por clã/edição, fixada na primeira criação de plano (ou primeira consulta analítica de uma edição legada).

Adoção mede alvos mantidos, metas mantidas, missões integralmente preservadas, metas elevadas/reduzidas e revisão aprovada. Execução mede cumprimento/superação da missão efetiva, aderência ao alvo original, contribuição real ao placar, pendências e ataques não usados após o encerramento.

Sem timestamp de ataque, a associação automática usa a janela entre observações. Se houve mudança aprovada nesse intervalo, fica `ambiguous`, sem crédito ou penalidade automáticos. `attributionBasis` explicita se a associação veio de timestamp da fonte ou janela de observação; atrasos da fonte continuam sendo uma limitação. Destruição e duração não alteram ATQ/DEF. Duração ausente permanece `null`; médias de duração só são comparáveis com todos os ataques disponíveis.

O dataset exporta **somente os confrontos realmente atacados**, com proposta inicial, confronto observado, resultado e missão aprovada quando identificável. Nenhum resultado é inventado para alvos não escolhidos. Alterações da líder são preferências observadas, não prova de que a alternativa não executada daria menos estrelas.

As métricas estão prontas para calibrar o próximo dia/edição, mas não há retreinamento ou troca silenciosa de coeficientes. O ranking usa a política [cwl-merit-v1](cwl-ranking.md), documentada com fórmulas, pesos, exemplos e casos excluídos. Tanto `analytics.ranking` quanto a rota `ranking` retornam as notas e a memória de cálculo. A política é uma decisão de produto explícita; seus pesos não são apresentados como parâmetros estatisticamente calibrados. O cálculo é síncrono sobre os dados persistidos, sem novo ajuste de ATQ/DEF, sem consultar APIs externas e sem alterar as missões.

## Simulação retrospectiva

`npm run simulate:cwl` executa o próprio `planWar()` sobre a última edição encerrada disponível para os clãs selecionados, sem gravar planos no banco. O script coleta snapshots públicos, preserva data/hash/fontes e gera relatório HTML/Markdown, métricas, ataques observados e matrizes por rodada em `../output/cwl-validation-AAAA-MM-DD/`.

É possível fixar `--season 2026-10` e `--out /caminho/da/execucao`. Os snapshots existentes em `out/sources` são reutilizados; use outro diretório para uma coleta nova. O replay confere corte anterior à batalha, janelas e modificador, placar, elenco completo, alvos únicos, otimização e invariância ao apagar os resultados da própria rodada.

A comparação estatística usa somente confrontos realmente atacados. Resultados para alvos alternativos não são inventados e não há ranking retroativo de mérito. Metas históricas são diagnósticas sobre os alvos reais. O relatório separa guerras já avaliadas e grupos externos novos; o arquivo `prior-evaluation-keys.json` preserva a lista usada para essa separação. Bootstrap por guerra e por clã, amostra disponível e limitações acompanham os números.

## Implantação posterior

O Worker suporta `HYPERDRIVE.connectionString` ou `DATABASE_URL` do ambiente. Use TLS conforme o provedor e configure credenciais como secrets. Hyperdrive deve ter cache de consultas desativado para esta carga transacional, que exige leitura imediatamente consistente das versões. A role de aplicação deve operar apenas no schema `cwl`; migrations devem usar uma role própria.

O PostgreSQL de produção ainda será disponibilizado pelo usuário. Não houve deploy, push ou aplicação de migrations fora do ambiente local.

O ajuste estatístico usa mais CPU que os **10 ms por requisição do Workers Free**. A execução síncrona foi validada localmente; antes de publicar, é necessário usar um runtime serverless com orçamento de CPU suficiente (por exemplo Workers Paid) ou adaptar a hospedagem do núcleo. Não se deve tratar o sucesso local como validação do limite gratuito. Referências: [limites de Workers](https://developers.cloudflare.com/workers/platform/limits/) e [Postgres.js com Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/postgres-js/).
