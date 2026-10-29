# ATQ com evidência da ranqueada — experimento local

Este diretório não é importado pelo frontend ou backend. `public/portal/war-scores.js`
continua em `war-ordinal-v2`. Não houve deploy, alteração de DEF, convocação, mérito,
otimização oficial, migrations ou escrita no banco de produção.

## Fórmula

Use somente a última semana encerrada antes do plano. Mantenha a liga anterior
quando houver permanência, some 0,5 quando houver promoção e use a liga atual
quando houver queda. Compare essa posição com a família no mesmo CV, usando
o percentil de empate médio transformado pela inversa normal (limite 1–99%).
Com menos de cinco referências de CV, o sinal de liga é neutro.

`S = n/(n+κS) × z(percentil)`, inicialmente κS=6, com variantes 3 e 12.

`Q = soma(estrelas − referência sem o jogador)/(ataques válidos + κQ)`.
A referência usa a mesma semana, liga exata/contexto e o mesmo par de CVs.
Exige pelo menos 20 ataques de pelo menos dois outros jogadores. Não existe
fallback entre ligas com modificadores diferentes. Falta de referência é
ausência de evidência; não recebe uma penalidade.

`μ = max(0, bS × S + bQ × Q)`, com coeficientes não negativos escolhidos apenas
no período de seleção. A grade inclui a opção de não usar nenhum sinal.
Sem participação ou com troca de CV confirmada, não há bônus da semana.
Constância `n/N` é descritiva e não entra no ATQ.

O v2 é ajustado normalmente. DEF, coeficientes, limiares e escala ficam fixos.
Para cada atacante, calcule dois ótimos condicionais da mesma perda ordinal:

`a*(μ) = argmin_a [perda de guerra/CWL com DEF fixo + λ(a−μ)²/2]`.

A habilidade experimental é `a_novo = a_v2 + max(0, a*(μ)−a*(0))`.
A diferença entre os dois ajustes evita dar crédito à ranqueada por uma melhora
numérica decorrente apenas de executar de novo o otimizador finito do v2.
Com convergência completa do v2, `a*(0) = a_v2` e isso coincide com a proposta.

`ATQ = clip(50 + 15 × a_novo / escala_v2, 0, 100)`.

Uma variação exploratória concentra o aumento em pouca evidência de guerra:
`a_focado = a_v2 + τ/(τ+n_efetivo_guerra) × (a_novo−a_v2)`, com τ=5 ou 10.
Ela não muda a fórmula principal ou o protocolo de seleção; os mesmos coeficientes
foram reaproveitados, sem novo ajuste aos resultados do teste.

## Dados e limites

- API oficial: perfis, catálogo de ligas, histórico semanal e grupo anterior.
- ClashSpot: DOM público de 16 tabelas de temporadas e 76 grupos. Somente para
  simulação. Dados extraídos pelo Chrome, com verificações humanas resolvidas
  pelo usuário; não foi criado scraper de produção.
- A data da temporada no ClashSpot é o fim; o identificador oficial é o início.
- `Unranked` não é um degrau competitivo. Uma liga atual continua conhecida
  mesmo quando o jogador ainda não se inscreveu no grupo da semana atual.
- O grupo anterior pode apontar para a última participação, não para a semana
  de calendário imediatamente anterior; o filtro usa sempre as datas reais.
- Arquivo próprio e fontes de guerras anteriores: somente leitura. Mesmas
  janelas de 14 dias de guerras normais e duas últimas CWLs do v2.
- A família atual e o CV sem confirmação histórica tornam parte da análise
  exploratória. O CV mostrado numa linha antiga do ClashSpot é registrado como
  exibido, sem afirmar uma captura do perfil naquele instante.
- O pareamento tier/semana é um proxy de contexto homogêneo; não inventa um
  modificador numérico por ataque. Legend I fica fora até normalizar seu período.
- Os testes usam ataques realizados. Não validam o resultado de alvos alternativos.

## Reprodução neste workspace

Os dados congelados estão fora do Git em
`/private/tmp/clash/output/atq-ranked-2026-10-28`, junto das fontes dos estudos
anteriores usadas para o histórico de guerra. Não envie `.env` ou credenciais.

```sh
node --test experiments/ranked-atq/model.test.mjs
node experiments/ranked-atq/source-audit.mjs ../output/atq-ranked-2026-10-28
node experiments/ranked-atq/prepare.mjs ../output/atq-ranked-2026-10-28
node experiments/ranked-atq/simulate.mjs ../output/atq-ranked-2026-10-28
node experiments/ranked-atq/audit.mjs ../output/atq-ranked-2026-10-28
node experiments/ranked-atq/report.mjs ../output/atq-ranked-2026-10-28
```

O `collect.mjs` é uma coleta separada e autenticada; não é necessário executá-lo
para reproduzir o experimento congelado. Ele só lê APIs e o arquivo próprio
(`BEGIN READ ONLY`), e salva JSON local sem headers ou chaves.

39 guerras anteriores a 12/10 selecionam parâmetros. Três guerras de 12–18/10
validam e cinco guerras de 19–28/10 testam. O arquivo `protocol.json` fixa a grade
de 64 configurações. A seleção adicional focada em menos de cinco ataques e os
controles de concentração do bônus são análises exploratórias identificadas.

Os coeficientes e referências são fixos nos intervalos bootstrap. Cinco guerras
de teste e a repetição dos mesmos jogadores não sustentam uma adoção definitiva.
O critério de liberação inclui ganho no grupo com pouco histórico e comparação
com o controle que aumenta igualmente a referência dos participantes.
