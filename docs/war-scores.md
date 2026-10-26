# Scores de guerra: versão experimental auditável

`war-ordinal-v2` produz notas relativas de ataque e defesa de 0 a 100. A nota não é uma porcentagem de triple nem um percentil. Os dois lados e todos os participantes aparecem, inclusive quem não tem histórico: esses recebem referência 50 e amostra ausente explícita. As notas não alteram a convocação nem atribuem alvos automaticamente.

## Histórico e corte temporal

Ao abrir Guerras, o frontend consulta até 30 guerras normais e 30 de CWL de cada clã por `/api/clans/:tag/score-history?type=random|cwl`. Cada requisição do Worker faz uma única consulta pública ao ClashKing. As quatro consultas são independentes, têm cache de 60 segundos e o ajuste acontece em Web Worker para preservar a interação. Falhas ficam explícitas e uma consulta parcial é identificada. O histórico da última guerra é calculado quando seu painel abre, com corte próprio.

O corte é `min(início do Battle Day analisado, instante da consulta)`. Entram somente guerras concluídas antes ou no corte, iniciadas antes dele, com o mesmo modificador explicitamente registrado. A guerra avaliada nunca treina o modelo. O score não usa o próprio ataque para decidir se seu resultado foi abaixo da referência. Ausência de modificador não é interpretada como `none`.

O mesmo recorte vale para **ataques e defesas**, inclusive para os adversários que participam do ajuste: guerras normais com fim entre `corte - 14 dias` (inclusivo) e o corte, mais as duas últimas edições de CWL disponíveis de cada clã com rodadas concluídas antes do corte. Uma edição corresponde à temporada mensal, não a uma rodada diária. Usa-se `season` quando disponível; caso contrário, a edição é inferida pelo mês UTC de `preparationStartTime`, exibida no cálculo e exportada. Sem ambos, a CWL fica fora. A escolha das duas edições ocorre antes do filtro de modificador; não se repõem temporadas incompatíveis com edições mais antigas. Rodadas já encerradas de uma edição em andamento podem entrar. A janela é ancorada na guerra analisada para permitir conferir relatórios passados sem usar dados futuros.

Na CWL, o backend também consulta referências públicas de guerras recentes de participantes com pouca evidência, inclusive de clãs anteriores. A referência identifica uma guerra completa, que é obtida e validada antes de entrar no ajuste; ataques parciais da API individual nunca são tratados como uma guerra completa. Só são usados registros concluídos antes do corte, do mesmo CV do participante e com o mesmo modificador. A coleta tem limites por jogador e por guerra; falhas, truncamentos e limites aparecem nos avisos e reduzem a cobertura. A versão da política da consulta é gravada junto à fonte do plano.

Guerras repetidas entre fontes são deduplicadas por clãs e início. É exigido histórico completo dos dois elencos, contagem de ataques consistente, ordem inteira única e sequência 1..N. Um ataque inválido invalida a cronologia daquela guerra. Fresh é o primeiro ataque naquela base, mesmo que tenha zero estrelas; os posteriores são limpezas até o primeiro triple. Tentativas depois de um triple ficam fora. A limpeza representa informação prévia, não dano acumulado.

## Modelo e pesos

O desfecho Y é a quantidade de estrelas, de 0 a 3. O modelo ordinal ajusta conjuntamente a habilidade do atacante `a` e a dificuldade do defensor `d`:

```
eta = a(atacante,CV) - d(defensor,CV) + soma(beta_f * x_f)
P(Y=s) = sigmoid(tau[s+1]-eta) - sigmoid(tau[s]-eta)
sigmoid(x) = 1/(1+exp(-x)); tau0=-infinito, tau4=+infinito
loss = -soma(w*ln(P(Y=estrelas)))
       + lambdaJogador/2 * soma(a^2+d^2)
       + lambdaFeature/2 * soma(beta^2)
w = 2^(-diasDesdeFim/meiaVida) * pesoModo * pesoFase
```

Features: diferença de CV limitada a [-3,3]; posição relativa do defensor entre os jogadores do mesmo CV; limpeza (0/1); modalidade CWL (0/1); CV do defensor em categorias, com o maior CV observado como referência. Posição relativa é `(n+1-2r)/(n-1)`, ou 0 quando existe somente uma base daquele CV. Habilidades são separadas por tag e CV: subir de CV não transforma resultados antigos em evidência no novo nível.

Parâmetros atuais: meia-vida de 30 dias entre os registros elegíveis (isso não amplia as janelas de 14 dias e duas CWLs); peso de modalidade igual ao destino 1 e outra modalidade 0,75; fresh 1 e limpeza 0,65; penalidade de jogador 1 e penalidade de features 2. A redução da penalidade de jogador foi selecionada em uma janela temporal e melhorou o erro em comparações posteriores; continua experimental. Os coeficientes e cortes são aprendidos com o histórico retornado.

O ajuste é determinístico: histórico ordenado por identidade da guerra e ataque; Adam por 220 passos, taxa 0,035, momentos 0,9/0,999 e epsilon 1e-8, efeitos e coeficientes inicialmente zero. Os cortes iniciais usam a distribuição ponderada de estrelas com suavização de uma observação por categoria. A cada passo, beta da diferença de CV é limitado a zero ou maior; cortes ficam separados por pelo menos 0,15. A verossimilhança é limitada a 1e-12 para estabilidade numérica.

## Nota exibida

```
ATQ = limitar(50 + 15*a/escalaAtaque, 0, 100)
DEF = limitar(50 + 15*d/escalaDefesa, 0, 100)
escala = max(0,35, raiz(media(efeito^2 dos jogadores com pelo menos 5 registros)))
```

A referência é 50 após ajuste por CV e contexto. Não há bônus fixo de CV ou liga na nota. Um CV17 e um CV18 com a mesma ATQ não têm o mesmo potencial contra qualquer alvo: a diferença de CV entra na avaliação específica do confronto. O diálogo mostra efeitos e escalas com seis casas decimais; o TSV exporta precisão numérica completa, com vírgula decimal para Excel em português.

Faixas de quantidade de evidência: nenhum registro = referência; menos de 5 registros ou peso total menor que 2 = baixa amostra; tamanho efetivo menor que 15 ou peso menor que 6 = amostra média; caso contrário, boa amostra. O tamanho efetivo `nK = soma(w)^2/soma(w^2)` também é exibido. Essas faixas e esse indicador não são intervalos de confiança estatísticos.

## Avaliação de cada ataque

Usa-se o alvo realmente atacado, a diferença de CV e a posição daquele defensor, os efeitos congelados antes da guerra e a fase no instante do ataque. A margem é `eta-tau3`: maior ou igual a 1 significa favorável; menor ou igual a -1, desafiador; entre ambos, equilibrado. A classificação só aparece com 50 ataques globais e pelo menos 5 ataques do atacante e 5 defesas do alvo, com peso total de pelo menos 2 em cada papel. Diferenças de CV maiores que 3 ficam fora da faixa validada e exigem revisão manual; o sistema não as rotula como favoráveis.

Um resultado inferior a 3 estrelas em confronto favorável aparece como “Abaixo da referência”. Essa comparação não comprova que o jogador errou: o modelo não conhece layout, execução, composição ou níveis utilizados naquele ataque. Em amostras insuficientes, o resultado continua no relatório sem julgamento do modelo. Ataques contra bases já triplicadas recebem identificação própria.

## Auditoria e limitações

Cada botão ATQ/DEF abre o cálculo numérico, histórico específico do jogador, pesos multiplicados, parâmetros globais aprendidos, critérios de exclusão e links das fontes com horários de consulta. A exportação TSV contém fórmulas, hiperparâmetros, parâmetros aprendidos, efeitos de todos os jogadores, todos os ataques elegíveis, registros descartados e as avaliações da guerra analisada. Os campos textuais são protegidos contra fórmulas de planilha; números negativos continuam numéricos.

Esta versão usa apenas guerras e CWL. Ranked fica fora enquanto não houver modificador histórico comprovado por ataque. Heróis, tropas e equipamentos atuais não são aplicados retrospectivamente: não há snapshots suficientes da época. Destruição aparece para auditoria, mas não altera o desfecho ordinal de estrelas. Não se inferem construções/layout nem se aplicam fatores de patch. A recuperação do histórico pessoal é limitada pela disponibilidade e pelos limites da API, então ainda pode faltar evidência. A avaliação comparativa de `war-ordinal-v2` está em [evaluation/candidates/cwl-v2/README.md](../evaluation/candidates/cwl-v2/README.md); ela mede estimativas em confrontos que ocorreram e não demonstra aumento causal das estrelas que o otimizador obteria com alvos alternativos.

Verificação determinística: `npm run check:scores`. Empacotamento sem publicação: `npm run check`.
