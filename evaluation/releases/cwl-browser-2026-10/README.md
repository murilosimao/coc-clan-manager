# CWL: cálculo no navegador e preparação do Supabase

## Resultado

A fórmula melhorada do commit `b3f1f14` foi preservada. O replay usa 28 guerras com o histórico reconstruído pelo provider, uma guerra adicional de 30 jogadores e um caso sem histórico. Nos 304 ataques úteis da coorte, navegador e backend reproduziram os mesmos parâmetros, scores, evidências, metas e objetivo da fórmula melhorada, com tolerância numérica de `1e-9`.

| Execução | Ataques úteis | RPS (menor é melhor) |
|---|---:|---:|
| Snapshot original `108430d` | 304 | 0,07766903 |
| Fórmula melhorada `b3f1f14` | 304 | 0,07455368 |
| Mesma fórmula no navegador | 304 | 0,07455368 |

Isso confirma a portabilidade do resultado anterior; não constitui uma nova avaliação externa do modelo. O replay não usa o resultado da guerra analisada como histórico. As limitações de amostra e validação permanecem as da [avaliação anterior](../../candidates/cwl-v2/README.md).

## Empates no otimizador

Diferenças de ponto flutuante entre Chromium e Node podiam trocar duas atribuições empatadas. `cwl-assignment-v2.1` quantiza somente os pesos usados pelo algoritmo de atribuição, em unidades de `1e-9` estrela. Scores, probabilidades e valores exibidos mantêm a precisão original.

Em uma das 30 guerras, duas atribuições diferem das do antigo otimizador; a diferença no total esperado é zero. Todas as novas atribuições e metas coincidem entre frontend e backend. O maior desvio numérico observado foi `4,27 × 10^-14`. Planos já gravados não são recalculados ou substituídos.

## Verificações

- **69 testes de backend** aprovados, incluindo PostgreSQL real local, permissões, autoria, imutabilidade, concorrência, adulteração, sessão e CSRF.
- **21 verificações de interface** aprovadas, incluindo edição autenticada, cancelamento, leitura pública, carregamento parcial e respostas fora de ordem.
- Web Worker real aprovado com e sem histórico; dois replays históricos adicionais com tela de **390 px** e CPU desacelerada **4×**, para times de 15 e 30 jogadores. Essa simulação não substitui testes em aparelhos reais.
- Regressão dos scores, bundle da função, verificação Deno e dry-run do Worker aprovados. `npm audit`: **0 vulnerabilidades** no lockfile usado.
- Os **283 arquivos** do snapshot original permanecem com os mesmos hashes.
- No Supabase real, **9 de 9 tabelas com RLS**, nenhum acesso ao schema pelas roles públicas verificadas, conta de runtime sem privilégios administrativos e conexão pelo pooler com certificado e hostname verificados. Probes sem alteração de linhas confirmaram a recusa de operações protegidas.
- Duas contas confirmadas na allowlist privada. Token de publicação aceito em consulta de leitura; permissões de escrita não foram exercitadas.

O benchmark local em Deno, com 5.294 eventos e arquivo comprimido de 1,34 MB, mediu cerca de **190 ms** para descompressão e uma validação, sem ajustar o modelo. Não inclui a segunda validação, rede, autenticação, banco ou resposta do endpoint. Os limites hospedados ainda precisam ser medidos após publicação.

## Segurança e pendências

Somente líder e colíder autenticados podem submeter e aprovar planos. Visitantes consultam dados salvos. A função verifica fórmulas e evidências, mas confia nos editores quanto ao ajuste estatístico enviado pelo navegador; o snapshot completo fica arquivado para reprodução. Credenciais e identificadores das contas não constam destes relatórios.

Nesta revisão, **não houve publicação da função, do Worker ou do frontend**. A configuração de cadastro público e Data API ainda depende da confirmação no painel. O login com as duas contas, a recusa de acesso direto à função e os recursos usados no ambiente hospedado devem ser conferidos na publicação, seguindo o [roteiro de deploy](../../../docs/cwl-deployment.md).

## Arquivos

- `browser-parity.json`: replay completo, hashes das fontes, diferenças e tempos locais.
- `browser-mobile-15.json` e `browser-mobile-30.json`: replays com simulação de CPU móvel.
- `supabase-security.json`: verificação sanitizada do banco real.
- `save-benchmark.json`: benchmark local de descompressão e validação.
- `readiness.json`: verificações realizadas e pendências explícitas.
- `manifest.json`: hashes dos relatórios e dos arquivos de implementação usados nesta revisão.

Reprodução: `npm run test:cwl`, `npm run test:ui` com preview na porta 8791 e `npm run test:parity` com os snapshots congelados locais disponíveis. Fontes brutas e segredos ficam fora do Git.
