# Validação hospedada da CWL

Função privada do Supabase publicada na versão 2; Worker publicado na versão `207efb2d-fa58-4a0a-b373-74d825629b5b`. Esta etapa publicou a interface no domínio do Worker. GitHub Pages e o branch Git não foram publicados nesta revisão.

## Acesso e persistência

- Acesso direto à função sem a chave de transporte recusado com 401; saúde pelo Worker confirmada com PostgreSQL real.
- Nove probes públicos aprovaram leitura, recusa de inicialização/revisão anônimas, CSRF, sessão falsa e proxy não permitido. Essas consultas não criaram planos, revisões ou políticas no banco.
- O usuário confirmou o login de líder e colíder e voltou a confirmar o funcionamento após a correção de sessão.
- Os confrontos históricos de 3 e 4 de outubro ficaram com 15 missões cada, um arquivo de cálculo e uma revisão por plano. Recarregar reaproveitou o plano salvo. Por serem históricos, não houve aprovação retroativa de missões ou mérito.
- Cadastro público desabilitado, usuários anônimos desabilitados e exigência de SSL aplicada, conferidos pela API de configuração. O schema `cwl` não está entre os schemas expostos pela Data API; as nove tabelas continuam com RLS e sem acesso pelas roles públicas verificadas.

## Tempos e recursos observados

| Medição | Resultado |
|---|---:|
| Cálculo no navegador, 3/10 | 713 ms |
| Cálculo no navegador, 4/10 | 1.037 ms |
| Inicialização hospedada, 4/10, após ajuste de região | 2.865 ms |
| Maior CPU registrada antes do ajuste | 674 ms |
| Maior CPU registrada na janela da versão corrigida | 541 ms |
| Memória no encerramento da execução mais pesada da janela corrigida | 19,4 MB |

As métricas de CPU e memória vêm dos eventos de encerramento do runtime; os eventos analisados tiveram motivo `EarlyDrop`. Memória no encerramento não é medição de pico. O tempo de inicialização inclui espera por rede e banco; o cálculo pesado foi realizado no navegador.

O banco está em `us-east-2`. Invocar a função em `us-east-1`, em vez da seleção automática `sa-east-1`, reduziu as sondagens de saúde de 1.843–2.052 ms para 508–911 ms. São poucas medições sequenciais, não um benchmark de carga. A execução de 4/10 usa um arquivo menor que a de 3/10; a diferença entre as duas inicializações não mede isoladamente o ganho de região.

## Correção identificada nos logs

A inspeção inicial, feita somente por contagens, detectou cookies de sessão em texto legível em quatro invocações automáticas da plataforma. Nenhum valor foi extraído, exibido ou incluído nos relatórios.

A correção cifra os valores dos cookies com AES-GCM e transporta somente os cookies da CWL em um segundo envelope cifrado no header privado `X-CWL-Session`, vinculado à origem e válido por 60 segundos. O Worker deixa de encaminhar `Cookie`; a função o reconstrói apenas internamente. Headers do visitante não substituem o transporte privado.

Cookies antigos em texto puro não autenticam nem renovam sessões nesta aplicação. A janela hospedada após a correção registrou **zero headers Cookie vindos do Worker, zero cookies com JWT em texto puro e zero registros do header privado de sessão**, em 23 invocações disponíveis na consulta. Os registros anteriores não foram apagados; esta afirmação não equivale a revogação global dos JWTs no Supabase Auth.

## Verificação e limites

Os 71 testes de backend passaram, incluindo cookies cifrados, recusa de formatos antigos/adulterados, rotação de chave, transporte completo e expiração do envelope. As 21 verificações de interface e os dois casos do Web Worker real também passaram. Bundle da função, verificação Deno e dry-run do Worker passaram. A fórmula de scores não foi alterada.

A janela hospedada cobre times de 15 jogadores. Não mede todos os tamanhos máximos de entrada, o pico de memória ou a CPU individual do Worker da Cloudflare. A edição/aprovação de uma CWL em andamento segue coberta pelos testes locais; a amostra hospedada é histórica.

Os JSONs desta pasta contêm somente métricas e resultados sanitizados, sem senhas, tokens, identificadores das contas ou cabeçalhos de autenticação. O [roteiro de deploy](../../../docs/cwl-deployment.md) descreve a configuração permanente.
