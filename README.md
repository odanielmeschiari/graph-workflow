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
5. O botão **Resumo** na doca gera um texto com as próximas tarefas (só as liberadas e ainda não
   concluídas), separado por responsável, pronto para copiar.
6. O botão **Distribuir** na doca divide as tarefas pendentes entre a equipe: informe a dificuldade de
   cada tarefa (um número, ou ordenando da mais difícil à mais fácil, com empates) e os integrantes.
   O algoritmo equilibra a carga de cada pessoa e tenta deixar todos com tarefas em paralelo, sem
   ninguém ocioso esperando outra pessoa. Veja a prévia e clique em **Aplicar**; os responsáveis
   continuam editáveis à mão. Tarefas já concluídas não são alteradas. Na ordenação, arraste as
   tarefas (ou use as setas) para reordenar.
7. O botão **Trocar nome** na doca (e **Trocar nome de pessoa** na tela inicial) substitui o nome de
   uma pessoa nos responsáveis das tarefas e na lista de integrantes da distribuição, por exemplo
   todas as ocorrências de "Pessoa A" por "Pessoa B". Escolha a pessoa na lista, digite o novo nome e
   veja a prévia de quantas tarefas serão alteradas. Se o novo nome já existir, as duas pessoas são
   unificadas. Dentro de um grafo, a troca vale só para ele, a menos que você marque **Aplicar em
   todos os grafos**; há também a opção de trocar o nome nos títulos e descrições das tarefas
   (só a palavra exata: trocar "Ana" não mexe em "Mariana").
8. Quando uma tarefa depende de outra vários níveis atrás, a seta contorna as tarefas do meio por uma
   pista própria, em vez de passar por cima delas, e fica mais discreta que as setas do fluxo
   principal. Aponte (ou foque com o teclado) uma tarefa para realçar só as setas que entram e saem
   dela.

## Seus dados

Tudo é salvo automaticamente enquanto você edita ou marca tarefas. Se houver um erro no painel
(sigla repetida, dependência inexistente, ciclo), o aviso aparece e o que está inválido só é salvo
depois de corrigido.
Os grafos continuam lá quando você fecha e abre o navegador. Eles somem se você limpar os dados
do site, usar janela anônima ou trocar de navegador/computador. Por isso, use
**Exportar backup** na tela inicial de vez em quando (todos os grafos em um arquivo).

Também dá para exportar **um grafo só**: pelo botão ⤓ do cartão na tela inicial ou pelo botão
**Exportar** na doca, dentro do grafo. **Importar** na tela inicial aceita tanto o arquivo de um grafo
quanto um backup completo. Se o grafo já existir neste navegador, você escolhe entre **Substituir**,
**Importar como cópia** (mantém os dois) ou cancelar. Assim dá para enviar um grafo para outra pessoa
sem mexer nos demais.
