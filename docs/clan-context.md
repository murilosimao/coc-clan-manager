# Escolha do clã

O site oferece dois contextos: PuroSangue (`2G8QCR92V`) e SanguePuro (`2CQ9CR2YP`). Nomes, rótulos e brasões locais ficam no catálogo `public/portal/clan-context.js`. O catálogo não concede permissões de liderança.

No primeiro acesso, sem uma escolha salva ou um link explícito válido, a pessoa escolhe um dos dois cartões. Consultas de membros, guerras e CWL só começam depois da escolha. Não é necessário login para escolher ou consultar um clã.

A preferência usa `localStorage`, chave `coc-clan-context-v1`, com versão e tag. Persiste no mesmo navegador e origem até limpar os dados do site. Não contém senha, token ou papel de usuário. Se o armazenamento estiver bloqueado, a seleção ainda funciona durante a visita e o site informa que não conseguiu salvar.

O parâmetro `?clan=TAG` válido tem prioridade sobre a escolha salva e atualiza a preferência. Isso mantém o contexto ao abrir o acesso autenticado no Worker a partir do GitHub Pages. Um parâmetro de outro clã abre novamente o seletor. O modo `?demo=1` continua determinístico para revisão visual e não sobrescreve essa preferência.

O botão no cabeçalho mostra o nome e o brasão do clã atual. A troca mantém a seção em uso, limpa filtros e dados anteriores e carrega o novo contexto. Critérios e listas locais continuam separados por tag. Uma edição aberta da CWL exige confirmação para ser descartada; uma gravação em andamento não pode ser interrompida pela troca.

Os acessos da líder e dos colíderes continuam sendo conferidos no servidor por clã. A seleção do contexto no navegador não muda essas permissões. Os arquivos do frontend devem ser publicados no GitHub Pages e no Worker que hospeda o acesso autenticado.

`tests/clan-context-browser.mjs` verifica primeira escolha, persistência, brasões, teclado, seis larguras de tela, links explícitos, clãs não permitidos, critérios separados, rascunhos, resposta atrasada do clã anterior e armazenamento bloqueado ou inválido.
