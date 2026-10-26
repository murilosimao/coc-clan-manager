# CWL no frontend

A aba **Liga CWL** no computador e **CWL** na navegação do celular reúne duas visões:

- **Plano do dia:** edição, confronto por data/adversário, atacante, alvo, meta e resultado. Cada linha mostra ATQ do atacante e DEF do alvo; ao passar o mouse ou focar a nota, aparece sua explicação. Ataques concluídos exibem as estrelas com ícones, a destruição e a duração numa faixa única abaixo do confronto. Na demonstração, o botão **Editar** habilita a edição direta: tocar no alvo abre as opções com DEF, a meta é escolhida num menu e conflitos de alvo mostram com quem ele se repete. Não há expansão por jogador.
- **Ranking de mérito:** posição e nota, missões cumpridas, média de estrelas novas e desempates. Abrir um jogador mostra a regularização da nota, cada oportunidade, parcelas 80/15/5 e dados utilizados. Os valores completos de desempate ficam nos detalhes.

O visual mantém a identidade existente. A lista vira uma composição vertical no celular, com controles de toque, navegação por teclado nas abas e detalhes nativos no ranking. Avisos e fórmulas são apresentados em camadas para preservar a leitura da lista.

## Dados e estados

A consulta é iniciada somente ao abrir a aba CWL. As guerras da edição aparecem primeiro; o plano selecionado é mostrado assim que sua requisição termina, enquanto os resultados da edição ainda podem estar carregando. Visitantes consultam somente planos salvos. Quando falta um plano, líder ou colíder autenticado pode usar **Preparar plano neste aparelho**. O ajuste ocorre em Web Worker, com progresso das fontes, cálculo e gravação. Reabrir/atualizar consulta o registro existente, sem redistribuir os alvos.

O frontend lê `/analytics` depois do plano. Se um dia **já acompanhado** ainda estiver pendente no banco e a fonte informar seu encerramento ou seu prazo tiver passado, consulta o plano daquele dia para atualizar os resultados. O estado e eventuais faltas continuam dependendo da confirmação da fonte: passar do horário não fabrica um encerramento. Guerras históricas ainda não acompanhadas não são criadas em lote. Falhas individuais preservam os registros e aparecem em aviso.

Trocar clã, edição ou dia invalida respostas antigas. Falhas de atualização mantêm dados anteriores identificados; `trackingWarning` é exibido. A busca preserva foco e os cálculos expandidos. O botão **Atualizar CWL** atualiza a área da Liga.

O plano vigente vem de `effective`. Para um ataque já avaliado, a missão exibida vem de `hit.mission` e sua revisão — uma aprovação mais recente não reescreve o objetivo daquele ataque. Rascunhos, simulações históricas, ataques anteriores ao plano e atribuições pendentes têm rótulos diferentes. Ausência de mérito é exibida como **sem nota**, preservando a distinção de zero.

A cobertura informa dias registrados/encerrados, sem prometer uma edição completa. Duração ausente não vira zero. ATQ/DEF e mérito permanecem separados.

As explicações dos scores incluem contagem, peso e tamanho efetivo da amostra; “referência” indica ausência de histórico individual e não desempenho médio observado. Diferenças de CV acima de três níveis recebem aviso de faixa não validada e pedem revisão da líder.

## Exportação e acesso

**Copiar TSV** no computador e **Copiar plano/ranking** no celular exportam a visão e o filtro atuais, em colunas para Excel. Se a cópia não estiver disponível, o arquivo TSV pode ser baixado como alternativa automática. Campos textuais são tratados para não virarem fórmulas de planilha.

Nos dados reais, **Entrar como liderança** abre o login; em GitHub Pages, leva à aplicação no domínio do Worker para usar cookies de primeira parte. Apenas UIDs autorizados para o clã veem **Editar** e **Preparar plano**. **Salvar** grava e aprova uma nova revisão no backend; visitantes continuam em consulta. Um erro de versão ou sessão preserva o rascunho para o editor revisar, e respostas antigas de outros clãs/dias não substituem a tela atual. Senhas são enviadas somente no login e não ficam no estado persistido; tokens ficam em cookies HttpOnly.

Na demonstração, a edição permanece inteiramente local. Tanto nela quanto no acesso real, **Editar** habilita os controles inline dos ataques pendentes; alvo duplicado recebe um aviso com o nome de quem compartilha a atribuição, sem troca automática. A meta é escolhida num menu de uma a três estrelas. O botão **Editar** fica no painel superior em computadores/tablets e no dock inferior em celulares. Durante a edição, **Salvar** e **Cancelar** ficam fixos no canto inferior direito durante a rolagem. Cancelar pede confirmação e restaura o rascunho. Ataques concluídos ficam bloqueados. O navegador não recebe chaves da API nem credenciais do banco.

## Revisão local

Com o Worker e PostgreSQL locais preparados conforme [cwl-backend.md](cwl-backend.md):

- Dados reais: `http://127.0.0.1:8791/?view=cwl`
- Exemplo ilustrativo: `http://127.0.0.1:8791/?demo=1&view=cwl`
- Exemplo direto do ranking: `http://127.0.0.1:8791/?demo=1&view=cwl&tab=ranking`

A demonstração é explícita e nunca substitui uma falha de dados reais. Usa cenários fictícios e a mesma função de mérito do backend para gerar o exemplo. `npm run demo:cwl` regenera `public/portal/cwl-demo.json`; não altera o banco. Alterações feitas na página duram até recarregar ou restaurar o exemplo.

```sh
# Com npm run dev -- --port 8791 --ip 127.0.0.1 em outro terminal:
npx playwright install chromium
npm run test:ui
```

Os testes de navegador usam rotas controladas e verificam layout em 320, 390, 768, 800, 1024 e 1440 px, navegação, cópia, missões atribuídas, carregamento parcial, login, edição real autenticada e respostas fora de ordem. O Web Worker real também é comparado ao Node com CPU reduzida e sem histórico. Capturas e relatório ficam em `.wrangler/cwl-ui-review/`, fora do Git. `CWL_UI_BASE_URL` permite outra porta de preview, sempre em loopback. `npm run test:parity` usa os snapshots locais congelados para comparar 30 casos reais com a versão melhorada `b3f1f14`.
