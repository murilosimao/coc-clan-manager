# Mérito da CWL — política cwl-merit-v1

O mérito avalia a entrega da missão aprovada antes do ataque. ATQ e DEF estimam capacidade; o mérito mede a contribuição na edição. A política é determinística, sem IA, e fica gravada de forma imutável por clã/temporada. Mudanças futuras exigem uma versão explícita; não se substituem os pesos de uma edição já iniciada.

## 1. Nota de cada oportunidade

Para um ataque no alvo aprovado:

\[
  m_i = 80r_i + 15c_i d_i + 5\frac{a_i}{3}
\]

- \(a_i=\max(0,s_i-b_i)\): estrelas realmente acrescentadas ao placar; \(s_i\) é o resultado do ataque e \(b_i\), o melhor resultado anterior daquela base.
- \(g_i\): meta de estrelas da missão aprovada aplicável ao ataque.
- \(r_i=\min(1,a_i/(g_i-b_i))\): proporção entregue da missão, quando \(g_i>b_i\).
- \(c_i\): 1 quando atingiu a meta no alvo aprovado; 0 caso contrário.
- \(d_i\): dificuldade contextual de cumprir **aquela meta**, de 0 a 1, conforme a seção seguinte.

São até **80 pontos pela missão**, **15 pela dificuldade** e **5 pela contribuição real em estrelas**, no intervalo de 0 a 100. Cumprir duas estrelas pode valer mais que um PT fácil. Superar a missão não conta como duas missões: aumenta a parcela de estrelas acrescentadas.

Atacar outro alvo rende **zero** no mérito, sem crédito para os desempates, mesmo com PT. O resultado continua visível nas estatísticas factuais. Ataque aprovado e não usado rende zero **somente quando a guerra estiver encerrada na fonte**. Reservas não geram oportunidades; ataques pendentes não entram na média.

Se a meta já tinha sido alcançada por outro ataque (\(b_i\ge g_i\)), a missão ficou obsoleta. A oportunidade fica explicitamente excluída, sem nota, sem crédito duplicado e sem atribuir culpa ao jogador. Não ocupa o denominador. A líder deve atualizar missões ainda não executadas quando necessário.

## 2. Dificuldade sem duplicar CV ou score

\[
 q_i=\sum_{k=g_i}^{3}p_{ik},\qquad d_i=1-q_i
\]

\(p_{ik}\) é a distribuição de estrelas do confronto **congelada no plano inicial**. Recalcula-se a soma para a meta efetivamente aprovada pela líder: uma missão de duas estrelas usa a dificuldade de conseguir duas ou mais, não a de triplicar.

A distribuição já considera capacidade ofensiva/defensiva, diferença de CV, posição dentro do mesmo CV, contexto de CWL e fresh/limpeza no modelo compartilhado. Não se soma outro bônus arbitrário por subir CV ou espelhos. Isso contaria a mesma dificuldade duas vezes. Percentual e duração não entram nesta estimativa.

O bônus exige pelo menos cinco registros e peso efetivo dois de cada lado, ausência do aviso de amostra global pequena e diferença de CV dentro do suporte do modelo. O contexto precisa permanecer igual ao snapshot: estrelas anteriores **e existência de ataque anterior**, inclusive se esse ataque deu zero estrelas. Se mudou, não se usa uma previsão fresh para premiar limpeza.

Sem essa evidência ou com contexto alterado, \(d_i=0\) **para o bônus**, com justificativa explícita. Isso não significa que o alvo seja fácil: significa que a dificuldade não foi demonstrada. O jogador continua recebendo toda a parcela de missão e estrelas, com histórico insuficiente identificado. A distribuição é uma estimativa experimental, não uma probabilidade individual comprovadamente calibrada; por isso não decide sozinha o mérito.

## 3. Nota da edição e participação

\[
 R_j=\frac{\sum_{i=1}^{n_j}m_i+2\cdot50}{n_j+2}
\]

\(n_j\) conta somente oportunidades avaliáveis: ataques com missão atribuída e convocações aprovadas sem ataque após o fim. A regularização equivale a **duas oportunidades neutras de 50 pontos**. Uma atuação isolada não tem a mesma sustentação de várias boas atuações; jogar mais dias, por si só, não dá pontos de presença. Também são retornadas a média sem regularização e a força da evidência \(n_j/(n_j+2)\).

Exemplos com a mesma quantidade de oportunidades:

| Situação | Nota do ataque |
|---|---:|
| Missão 2★, resultado 2★ fresh, suporte estimado 0,70 | 87,8333 |
| Missão 3★, resultado 3★ fresh, suporte estimado 0,98 | 85,3000 |
| Missão 3★, resultado 2★ fresh | 56,6667 |
| Missão 3★ cumprida, dificuldade sem histórico suficiente | 85,0000 |
| PT em alvo diferente do aprovado | 0 |

Uma atuação de 100 pontos resulta em \(R=66,6667\). Sete atuações de 90 pontos resultam em \(R=81,1111\). Três atuações muito boas ainda podem superar sete ruins: o volume não é o critério principal. Os valores 80/15/5 e o prior 2×50 são escolhas explícitas desta política, não pesos aprendidos ou apresentados como ótimos.

## 4. Ordem e desempates

Comparam-se, nesta ordem:

1. Maior nota regularizada de mérito.
2. Maior proporção de missões cumpridas nas oportunidades avaliadas.
3. Maior média de estrelas acrescentadas com crédito de missão, por oportunidade avaliada.
4. Maior percentual médio de destruição nos ataques avaliados no alvo aprovado.
5. Menor duração média desses ataques, **somente se todos os jogadores daquele grupo empatado tiverem duração completa**.

Os valores são comparados em seis casas decimais. Totais não favorecem automaticamente quem recebeu mais convocações. Um ataque perdido entra como zero na nota e nas taxas; não se inventam percentual ou tempo para ele. Ataques em alvo não autorizado não melhoram desempates.

Se falta duração para alguém, o tempo fica fora de todo o grupo: compará-lo apenas entre alguns pares produziria uma ordenação inconsistente. Duração ausente é `null`. Persistindo igualdade, mantém-se o empate (posições 1, 1, 3, por exemplo). A tag apenas estabiliza a apresentação, sem criar vantagem esportiva.

## 5. Evidência, revisão e abrangência

Ataques ambíguos, anteriores ao plano, guerras retrospectivas e oportunidades sem aprovação não recebem mérito nem zero automático. Ficam identificados e deixam a avaliação provisória. A revisão já existente pode resolver atribuição ambígua usando uma missão aprovada antes do ataque; não cria uma meta retroativa.

A política é fixada na tabela `cwl.ranking_policies`. A leitura agrega toda a edição em um snapshot consistente do PostgreSQL. `analytics` e `ranking` não replanejam, não reajustam ATQ/DEF e não incorporam dados de guerras futuras ao bônus de dificuldade. Notas mudam somente com novos resultados ou revisão auditável da evidência.

`GET /api/cwl/clans/:tag/seasons/:YYYY-MM/ranking` retorna:

- `policy`, suas constantes, versão e data de persistência; `formulas` com as expressões usadas.
- `entries` com posição, nota, média simples, oportunidades, taxas, disponibilidade do contexto e desempates.
- `opportunities` de cada jogador com missão/revisão, resultado, progresso, parcelas dos pontos, suporte estimado e justificativas.
- `status`: `empty`, `provisional` ou `complete_recorded_rounds`. Uma entrada pode ser `ranked`, `provisional`, `pending` ou `excluded`.
- `coverage: recorded_rounds_only`, quantidade de rodadas registradas e encerradas. Não se afirma que o mês inteiro foi coletado.
- `automaticBonusAllocation: false`: a API oferece o ranking auditável; não distribui recompensas automaticamente.

Estatísticas factuais em `analytics.players` permanecem separadas: incluem os ataques reais e suas estrelas mesmo quando não podem receber crédito de missão. O frontend ainda não foi alterado para consumir o ranking.
