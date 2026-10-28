# Dados atuais da API oficial

Os perfis, membros, escudos, guerra atual e resumo das guerras usam a API oficial
quando `COC_API_MODE` está configurado. As consultas são feitas no servidor com
`Authorization: Bearer`; o navegador recebe somente dados do jogo e horários de
consulta. Não há leitura do cache antigo dessas respostas no Worker. Falhas de
IP, chave, limite ou indisponibilidade são reportadas, sem fallback silencioso.

- Local: `COC_API_MODE=direct`, `COC_API_KEY` restrita ao IP de desenvolvimento.
- Worker e função privada Supabase: `COC_API_MODE=royaleapi`,
  `COC_WORKER_API_KEY` exclusiva, restrita ao IP do proxy `45.79.218.79`.
- O proxy é `https://cocproxy.royaleapi.dev`, autorizado pelo proprietário. Ele
  recebe a chave no transporte HTTPS. Não são aceitos destinos configuráveis,
  redirecionamentos, operações de escrita nem cookies do visitante.
- A chave permanece em secrets do Worker e do Supabase. Nunca colocar em vars,
  arquivos públicos, parâmetros de URL, logs, retorno JSON ou GitHub Pages.

Rotas públicas adicionais, sujeitas ao limitador existente:

- `/api/players/:tag/profile`: níveis atuais de tropas, heróis e equipamentos.
- `/api/players/:tag/league-history`: períodos, tiers, colocação e totais oficiais.
- `/api/players/:tag/league-group?period=current|previous`: ataques/defesas do
  jogador no grupo atual ou anterior. Os outros membros do grupo são omitidos.
- `/api/players/:tag/battle-log`: batalhas recentes, incluindo estrelas,
  destruição, duração, data e código do exército quando disponível.
- `/api/league-tiers`: catálogo oficial de ligas e ícones.
- `/api/clans/:tag/warlog`: resumo atualizado das últimas guerras normais.

Essas rotas ainda não alteram o score ATQ/DEF. A fórmula continua usando o
histórico de guerra validado; o sinal de consistência ranqueada precisa de
comparação e calibração antes de entrar na nota. `attackWins` não significa
triple; `attackStars=0` não deve ser convertido em ausência de ataque quando o
log detalhado mostra ataques.

## Convocação e dados atrasados

A convocação consulta os dois clãs automaticamente. Usa a participação mais
recente conhecida em guerra normal, inclusive quando não houve ataques. Clãs
externos continuam sujeitos à opção de histórico pessoal. As regras e listas
manuais continuam separadas por clã.

Antes de usar um arquivo de guerras, sua última guerra completa é comparada com
o resumo atual: adversário e fim, com tolerância de cinco minutos para pequenos
ajustes de relógio. Se a fonte histórica perdeu guerras mais recentes, os
registros anteriores a essa lacuna não podem excluir jogadores automaticamente.
A tela informa `Histórico recente indisponível`; o relatório antigo continua
identificado como a última guerra **disponível**, com sua data.

A API oficial fornece o elenco/ataques da guerra atual e resumos das guerras
passadas. Depois de começar outra guerra, o warlog não recupera sozinho os
ataques individuais da anterior. O arquivo completo ainda depende do ClashKing;
para ter histórico próprio será necessária captura persistente enquanto cada
guerra ainda estiver disponível na API oficial. A verificação de atualidade
impede apresentar esse arquivo incompleto como se fosse a última guerra.

Referências: https://developer.clashofclans.com/#/documentation e
https://docs.royaleapi.com/proxy.html.
