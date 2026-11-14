# Grafo de tarefas

Grafo de dependências na horizontal (esquerda → direita), montado automaticamente
a partir das tarefas e das siglas de que cada uma depende. 100% local e offline:
os dados ficam no navegador (localStorage), sem servidor e sem internet.

## Abrir

- **Mais simples:** dê dois cliques em `public/index.html`.
  Mantenha o arquivo sempre no mesmo lugar e use sempre o mesmo navegador.
- **Ou** sirva a pasta `public/` (ex.: `python3 -m http.server -d public 8000` e abra
  http://localhost:8000). Hospedada assim (ou no GitHub Pages), o app também abre offline
  depois da primeira visita.

## Como usar

1. **Criar grafo** na tela inicial.
2. No painel **Tarefas** (à esquerda), adicione tarefas com sigla, nome, responsável,
   descrição (opcional, aparece ao passar o mouse sobre o nó) e dependências (`T01, T02`). Sem dependências = tarefa independente. O grafo se redesenha
   enquanto você digita. Em "Colar várias tarefas" dá para importar linhas como:
   `T07 - Construir árvore AVL | Ana | T01, T02, T03`
3. **Clique nos nós** para concluir: uma tarefa liberada (branca) fica verde, e as setas que saem
   dela também. Quando todas as setas de entrada de uma tarefa bloqueada ficam verdes, ela passa a
   liberada. Clique de novo para desfazer (só se nenhuma tarefa que dependa dela estiver concluída).
4. O botão **Ocultar** no topo do painel (ou **Tarefas** na doca) esconde o painel para dar mais
   espaço ao grafo; o botão **Tarefas** da doca o mostra de novo.

## Seus dados

Tudo é salvo automaticamente enquanto você edita ou marca tarefas. Se houver um erro no painel
(sigla repetida, dependência inexistente, ciclo), o aviso aparece e o que está inválido só é salvo
depois de corrigido.
Os grafos continuam lá quando você fecha e abre o navegador. Eles somem se você limpar os dados
do site, usar janela anônima ou trocar de navegador/computador. Por isso, use
**Exportar backup** na tela inicial de vez em quando e **Importar backup** para restaurar.
