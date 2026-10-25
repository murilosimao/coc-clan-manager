# Avaliação local da CWL — war-ordinal-v2

Esta pasta registra a comparação da candidata `war-ordinal-v2` e `cwl-assignment-v2` contra o snapshot local `108430d` (`snapshot/cwl-baseline-2026-10-25`). O snapshot e seus 283 arquivos congelados permanecem inalterados. O manifesto do snapshot fica em `evaluation/baselines/cwl-2026-10/manifest.json`.

## Resultado

| Recorte | Ataques | RPS snapshot | RPS candidata | Cobertura snapshot | Cobertura candidata |
|---|---:|---:|---:|---:|---:|
| Validação temporal: últimas 3 rodadas de setembro | 398 | 0,08178 | **0,07763** | 36,2% | 37,2% |
| Outubro offline: 12 clãs, 84 guerras | 1.356 | 0,08966 | **0,08670** | 38,9% | 40,0% |
| Replay pelo provedor usado pelo backend: 4 clãs, 28 guerras | 304 | 0,07767 | **0,07455** | 44,1% | 51,6% |
| Grupo externo: 3 clãs, 21 guerras | 201 | 0,09723 | **0,09224** | — | — |
| PuroSangue dentro do replay do provedor | 103 | 0,03949 | **0,03847** | 68,9% | 85,4% |

RPS é o erro de Ranked Probability Score, calculado sobre a distribuição de zero a três estrelas; menor é melhor. A cobertura é a proporção de ataques dentro da faixa de CV que receberam classificação contextual com a evidência mínima exigida. Não é cobertura de previsão nem probabilidade de acerto.

No replay do provedor, o intervalo de 95% por guerra para a diferença de RPS candidata menos snapshot foi `[-0,00535; -0,00109]`; por clã, `[-0,00521; -0,00148]`, com apenas quatro clãs. No grupo externo de três clãs, o intervalo por guerra foi `[-0,00790; -0,00251]`. No PuroSangue, com sete guerras, o intervalo foi `[-0,00340; 0,00169]` e cruza zero: não há evidência suficiente para afirmar que a precisão melhorou naquele clã isoladamente.

No PuroSangue, a taxa real de PT foi 92,2%, enquanto a estimada pela candidata foi 78,5%. A candidata aumentou a cobertura de 71 para 88 ataques, mas continua conservadora nesse recorte. Não se ajustou uma calibração agressiva: o multiplicador 1,15 teve RPS ligeiramente pior que a candidata sem calibração no holdout externo (`0,09247` contra `0,09224`).

## Protocolo e limites

- Os parâmetros foram escolhidos usando as primeiras quatro rodadas disponíveis de setembro; as três últimas rodadas de setembro serviram como validação temporal. Outubro e o grupo externo não escolheram parâmetros.
- A mudança avaliada reduz a penalidade dos efeitos individuais de 2 para 1, recupera guerras completas referenciadas pelo histórico pessoal e escolhe a cópia estruturalmente íntegra quando fontes repetem uma guerra. O filtro temporal, a regra de modificador, a separação fresh/limpeza e as janelas de 14 dias e duas edições de CWL continuam em vigor.
- O replay pelo provedor reproduz as consultas que o backend faz. Algumas respostas atingiram o limite de 200 itens por jogador e houve avisos de limite de guerras; o histórico ainda pode estar truncado. Os avisos completos estão em `production-comparison.json`.
- O grupo externo do replay pelo provedor é o mesmo conjunto de três clãs resumido em `holdout-summary.json`; não deve ser contado como uma segunda amostra independente.
- A comparação avalia resultados em alvos que realmente foram atacados. Ela não conhece resultados contrafactuais dos outros alvos e, portanto, não prova que a otimização produzirá mais estrelas do que a estratégia da líder.
- No replay de 304 ataques, as categorias favorável, equilibrado e difícil tiveram respectivamente 84/89, 36/55 e 1/13 PTs; os 147 restantes ficaram sem classificação contextual suficiente. São resultados descritivos deste conjunto, não garantias para uma CWL futura.
- O otimizador continua usando `goalSupport = 0,70`; essa sustentação não é uma probabilidade individual calibrada. Diferenças de CV acima de três níveis exigem revisão manual.

Os JSONs nesta pasta são resumos compactos. Predições e respostas públicas brutas ficam fora do Git em `/private/tmp/clash/output/cwl-improvement-2026-10-25/`. `manifest.json` registra hashes dos resumos e do código para reprodução local.
