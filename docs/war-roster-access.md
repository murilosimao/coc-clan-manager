# Acesso à sugestão de guerra

A escalação sugerida é calculada no navegador. Ela não é uma escalação oficial
compartilhada no banco e não altera a guerra no jogo.

- Visitantes consultam membros, detalhes, critérios e exportam o time; não têm
  controles de inclusão, remoção, prioridade, bloqueio ou edição de critérios.
- Líder e colíder logados podem ajustar somente os clãs autorizados na sessão.
  Cada alteração reconsulta a sessão no servidor antes de alterar o estado local.
  Sessão expirada, revogada ou indisponível impede a alteração.
- Remover ou bloquear um jogador pede confirmação com seu nome. Cancelar mantém
  a seleção. O botão de restauração também exige login e confirmação.
- `manualRosterVersion: 1` marca a correção: listas manuais de versões anteriores
  são esvaziadas uma vez por clã ao carregar suas preferências. Isso restaura a
  sugestão calculada sem descartar a ordenação e o critério de histórico pessoal.
  Ajustes autenticados posteriores continuam salvos em recargas.

Preferências e listas continuam locais, separadas por clã e origem do site.
GitHub Pages encaminha o login ao Worker, que usa cookies HttpOnly na própria
origem; uma sessão do Worker não é tratada como sessão do Pages. Não há um novo
endpoint de gravação compartilhada. A proteção de interface evita alterações
acidentais e exige a sessão existente; localStorage é controlado pelo próprio
navegador, não representa autorização no servidor.

`tests/roster-auth-browser.mjs` cobre visitante, líder, colíder, recarga,
restauração de listas antigas, confirmação/cancelamento, perda da sessão e
isolamento de permissões por clã, em 320, 390, 768 e 1440 pixels.
