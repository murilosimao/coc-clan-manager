# ATQ com evidência da ranqueada

Política publicada: `war-atq-ranked-v1`, sobre o ajuste `war-ordinal-v2`.
Escopo: ATQ. DEF, coeficientes, cortes, escalas, contagens de guerra, convocação e política de mérito continuam iguais.

## Fórmula

Use a última semana encerrada antes do corte da guerra (segunda 05:00 UTC). A semana aberta não fornece ataques.
Posição sustentada: liga anterior se manteve; anterior + 0,5 se subiu; atual se caiu.
Referência: membros únicos de PuroSangue e SanguePuro com o mesmo CV, incluindo os não participantes com liga conhecida. Menos de cinco referências deixa S neutro.

- `S = n/(n+3) × Φ⁻¹(percentil médio da posição sustentada)`; percentil limitado a [0,01; 0,99].
- `Q = Σ(estrelas − média de referência)/(nQ+3)`. Referência exclui o próprio jogador e exige a mesma semana, liga, CV atacante e CV defensor, com pelo menos 20 ataques de outros dois jogadores. Sem referência, Q = 0.
- `μ = max(0; 0,6S + Q)`.
- `g = 5/(5+nEfetivoGuerra)`.
- `aNovo = aBase + g × max(0; a*(μ) − a*(0))`.
- `ATQ = limitar(50 + 15aNovo/escalaBaseATQ; 0; 100)`.

`a*(μ)` minimiza a perda ordinal dos ataques de guerra do jogador mais `λ(a−μ)²/2`, condicionada no DEF e nos parâmetros-base já ajustados. Subtrair o mesmo ajuste com μ = 0 evita atribuir à ranqueada um efeito de convergência numérica. O bônus só aumenta ATQ e diminui com evidência de guerra. `n/N` é constância descritiva; não entra na convocação.

## Dados e limites

Produção usa somente a API oficial da Supercell, através do proxy RoyaleAPI autorizado. ClashSpot fica restrito ao experimento offline. Não há chave no navegador.

O Worker fornece lotes limitados de perfis, histórico de ligas e grupos anteriores. Cada lote possui assinatura HMAC, com domínio separado de sessões, verificada pela função privada antes de salvar um novo plano. URLs e parâmetros têm lista explícita de permissões. Cache de cinco minutos, consultas distribuídas em lotes; ajuste numérico no Web Worker do navegador.

CVs de grupos ranqueados não são informados pela fonte. Nesta versão são estimados pelos perfis atuais, como na simulação exploratória; não representam prova do CV na data. Evoluções comprovadas no histórico disponível excluem a semana. Falta de qualquer perfil da família impede formar um percentil artificial. Falta de níveis para completar a referência deixa Q neutro. Legend I fica fora por usar outro período de competição. Liga + semana identifica o contexto de comparação; não se afirma conhecer o modificador numérico de cada ataque.

Se a coleta falhar, o ATQ de guerra/CWL permanece disponível. Planos salvos anteriormente não são recalculados. Novos planos guardam os dados assinados no arquivo auditável já existente, sem nova tabela, migration ou acesso público ao banco.

## Validação

- 47 guerras: 26.857 comparações do código publicado com o candidato aprovado; ATQ idêntico, DEF preservado.
- Testes de corte temporal, ausência de dados, referência sem auto inclusão, Q incompleto, alteração de CV, assinaturas adulteradas/expiradas, parâmetros e aritmética de planos.
- Mesmo módulo compartilhado no Node e nos Web Workers, incluindo paridade com limitação de CPU de celular.
- Interface auditável em 320, 390 e 1440 px, além da suíte de CWL/autenticação/contexto/convocação existente.

A amostra de teste do experimento tem cinco guerras, todas do clã principal. A variante focada melhorou o RPS médio aproximadamente 0,35%; isso não comprova probabilidades individuais calibradas. Resultados detalhados e limitações estão em `evaluation/candidates/atq-ranked-2026-10-28`.
