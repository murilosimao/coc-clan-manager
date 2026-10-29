# Simulações do ATQ com ranqueada — 28/10/2026

Experimento local. Nenhum score, DEF, plano, regra de convocação ou dado de produção foi alterado.

## Amostra

- 47 guerras completas: 28 confrontos de CWL e 19 guerras normais, dos dois clãs.
- 1.274 ataques úteis: 940 na seleção, 138 na validação e 196 no teste. Foram retirados ataques em alvos já triplicados e diferenças de CV fora da faixa do modelo.
- 97 jogadores na família atual; 456 registros semanais em oito semanas.
- 1991 ataques ranqueados únicos na base local; ClashSpot forneceu 16 resumos e 76 grupos detalhados, somente para a simulação.
- 456 registros semanais e 23 grupos foram comparados com a API oficial sem divergência. Todos os grupos extraídos tiveram contagem e soma de estrelas conferidas.

## Comparação temporal

Parâmetros escolhidos por RPS médio entre guerras anteriores a 12/10. 12–18/10 é validação e 19–28/10 é teste. Nenhum resultado do teste escolhe os coeficientes primários. RPS mede erro ordinal de estrelas; menor é melhor. As guerras podem ter sido vistas em estudos anteriores: este corte não é apresentado como validação externa inédita.

| Variante | Seleção | Validação | Teste | Redução de erro no teste |
|---|---:|---:|---:|---:|
| v2 | 0.055264 | 0.075265 | 0.046229 | 0.00% |
| Liga | 0.054762 | 0.074763 | 0.045917 | 0.67% |
| Qualidade | 0.055105 | 0.074914 | 0.046150 | 0.17% |
| Liga + qualidade | 0.054684 | 0.074544 | 0.045868 | 0.78% |
| Controle uniforme | 0.054136 | 0.075055 | 0.045838 | 0.84% |
| Bônus concentrado, τ=5 | 0.054965 | 0.074724 | 0.046066 | 0.35% |
| Bônus concentrado, τ=10 | 0.054875 | 0.074649 | 0.046009 | 0.48% |

A melhor combinação no período de seleção foi bS=0.6, bQ=1, κ=3 e promoção de 0.5 degrau. São os melhores valores entre os testados; ambos os coeficientes ficaram na borda superior da grade. Isso não identifica um ótimo global ou coeficientes prontos para produção.

A diferença de RPS entre a combinação e o v2 foi -0.000360, com intervalo descritivo de 95% por guerra [-0.001297, 0.000868]. O intervalo contém zero. O controle uniforme ficou próximo: parte do ganho pode vir de elevar a previsão geral, sem demonstrar melhor identificação individual de atacantes.

## Pequenas variações

Mesmos bS e bQ da combinação selecionada. Estes resultados mostram sensibilidade; não escolhem parâmetros pelo teste.

| κ | Crédito de promoção | Seleção | Validação | Teste |
|---:|---:|---:|---:|---:|
| 3 | 0 | 0.054743 | 0.074436 | 0.045880 |
| 3 | 0.5 | 0.054684 | 0.074544 | 0.045868 |
| 6 | 0 | 0.054785 | 0.074475 | 0.045890 |
| 6 | 0.5 | 0.054732 | 0.074568 | 0.045879 |
| 12 | 0 | 0.054851 | 0.074549 | 0.045916 |
| 12 | 0.5 | 0.054807 | 0.074622 | 0.045906 |

As diferenças entre κ=3, 6 e 12 e entre meio degrau e mínimo das ligas são pequenas nesta amostra. Não há sustentação para tratar um desses valores como definitivo.

## Pouco histórico

A qualidade ranqueada estava utilizável em 69 ataques de guerra na seleção, 26 na validação e 26 no teste. A exigência de outros jogadores no mesmo contexto reduz bastante a cobertura.

| Ataques prévios de guerra | Ataques no teste | RPS v2 por ataque | RPS combinado por ataque | Com Q disponível |
|---|---:|---:|---:|---:|
| 0 | 19 | 0.081831 | 0.081570 | 0 |
| 1-4 | 20 | 0.069167 | 0.069651 | 0 |
| 5+ | 157 | 0.040434 | 0.040082 | 26 |

No teste, nenhum dos ataques do grupo com menos de cinco registros prévios tinha Q utilizável. Portanto, esta rodada não demonstra que Q resolve o principal problema dos jogadores novos ou de retorno. Há apenas cinco guerras no teste, todas do clã principal; o secundário participa da seleção via CWL.

## Efeito nas notas da guerra em preparação

Exemplo calculado com fontes congeladas e a data da consulta preservada. Não é nota publicada, mérito ou garantia de PT.

| Jogador | Ataques de guerra na base | ATQ v2 | ATQ combinado | Com concentração τ=5 |
|---|---:|---:|---:|---:|
| Markola | 0 | 50.0 | 78.2 | 78.2 |
| Murilo_M_S | 21 | 78.0 | 87.3 | 79.9 |
| Luis_PT | 13 | 61.6 | 76.7 | 66.0 |
| CARLOSSTS | 22 | 77.2 | 81.0 | 78.1 |

A concentração usa τ/(τ+n_efetivo_guerra) sobre o incremento da habilidade. Ela conserva o bônus integral sem histórico e reduz seu efeito em quem já tem registros. É uma escolha de comportamento, não uma superioridade estatística demonstrada. Os coeficientes não foram reajustados para esses dois controles.

## Integridade e limites

- 47 modelos e 26857 comparações de DEF permaneceram exatamente iguais.
- Limiares, coeficientes, escala, contagens e pesos dos registros de guerra foram preservados.
- Sem sinal ranqueado, ATQ continua exatamente no v2. Ataques ranqueados não aumentam a contagem de evidência de guerra.
- O cálculo usa somente semanas encerradas antes do plano.
- A família atual é uma aproximação retrospectiva; a tabela histórica do ClashSpot cobre participantes rastreados e não equivale à lista completa de membros.
- Só 1 ataques ranqueados têm CV histórico delimitado dos dois lados pelos registros disponíveis. O restante usa CV atual ou exibido na linha histórica e fica identificado como exploratório.
- O controle que exige CV delimitado mantém a fórmula, mas elimina a amostra suficiente para Q. Isso confirma a necessidade de capturar CV e contexto junto dos registros futuros.
- O pareamento tier/semana não inventa um modificador por ataque. Não foi introduzida tabela de patches.
- Bootstrap condicionado aos coeficientes e referências congelados; repetição dos jogadores entre guerras continua sendo uma limitação.
- Estas métricas avaliam ataques realizados e não provam resultados de alvos alternativos.

## Leitura recomendada

A estrutura resolve o comportamento de referência e mantém DEF isolado. O ganho preditivo foi pequeno e não conclusivo; os dados ainda não justificam substituir o score oficial. Para uma futura exibição paralela, a variante concentrada em pouca evidência é mais alinhada ao objetivo, mas também precisa de avaliação prospectiva.

Arquivos para conferir: [scores atuais](/private/tmp/clash/output/atq-ranked-2026-10-28/current-scores.tsv), [todos os ataques](/private/tmp/clash/output/atq-ranked-2026-10-28/scores.tsv), [resultados completos](summary.json), [grade](/private/tmp/clash/output/atq-ranked-2026-10-28/grid.json), [checagem das fontes](source-checks.json), [invariantes](invariants.json) e [protocolo](protocol.json).
