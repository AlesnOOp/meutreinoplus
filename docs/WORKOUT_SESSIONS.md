# Sessões de treino

Uma sessão registra o que foi feito a partir de uma ficha. Ela não é a ficha. Editar a ficha depois do início não altera o treino aberto, e concluir o treino não grava uma revisão nova da ficha.

## Estados

O status persistido é `in_progress`, `paused`, `completed` ou `aborted`. Na interface, `aborted` aparece como Cancelado. Não existe um segundo valor `cancelled`.

| De            | Para          | Condição                                                                 |
| ------------- | ------------- | ------------------------------------------------------------------------ |
| —             | `in_progress` | A ficha é do usuário, está ativa e tem revisão. Não há outra sessão aberta. |
| `in_progress` | `paused`      | Grava `paused_at` e um evento `pause`.                                   |
| `paused`      | `in_progress` | Limpa `paused_at` e grava um evento `resume`.                            |
| aberta        | `completed`   | Confirma se ainda houver série planejada sem resultado. Trava a sessão.  |
| aberta        | `aborted`     | Exige `confirm: true`. Trava a sessão.                                   |

Uma sessão travada não volta a aberta. Finalizar de novo responde `409 session_locked`. O mesmo identificador de sessão, reenviado no início, devolve a sessão existente. Um segundo início, com outro identificador e com uma sessão ainda aberta, responde `409 session_open`.

O dono sai do token. O corpo não informa `userId`. Recurso de outra pessoa responde 404.

## Fotografia da ficha

`POST /api/v1/workout-sessions` lê a revisão imutável da versão atual e copia esse JSON para `workout_sessions.plan_snapshot`. Também congela o nome da ficha, a versão, o nome da academia e, em cada exercício da sessão, nome, ordem, descanso, academia e equipamento. As séries planejadas ficam dentro dessa fotografia.

A sessão aberta não é remontada lendo `workout_plan_sets`. Essa tabela é reescrita quando a ficha muda. `performed_sets.planned_set_id` aponta para o identificador que estava na revisão e não tem chave estrangeira.

A função `protect_locked_workout_session` recusa alterar `plan_snapshot`, `plan_version`, `plan_name_snapshot`, `started_at`, o usuário, a academia e a ficha em qualquer atualização. Concluir a sessão não escreve em `workout_plan_revisions`.

## Exercícios e séries

Os exercícios podem ser feitos fora da ordem. Concluir o treino não exige que todos estejam concluídos. O status do exercício da sessão distingue concluído, parcial e pulado. Pular exige um motivo; a interface envia “Pulado”.

Cada série realizada tem identificador próprio, sessão, exercício da sessão, série planejada opcional, posição, repetições e carga planejadas, repetições e carga realizadas, unidade e desfecho `completed` ou `skipped`. Carga nula é peso corporal, não zero. Repetição e carga negativas são recusadas. A carga planejada não é substituída pela carga feita.

`performed_sets` e `performed_set_corrections` recusam `UPDATE` e `DELETE`. Corrigir ou desfazer insere uma correção. A leitura usa a correção mais recente. Uma correção `voided` desfaz a marcação e conserva a linha original. Série extra não tem `planned_set_id`. Repetir o mesmo identificador com o mesmo conteúdo devolve a linha. O mesmo identificador com outro conteúdo responde `409 set_immutable`.

O feedback de 1 a 5 e o comentário ficam em `exercise_feedback`, ligados ao exercício daquela sessão. A nota pode faltar se houver comentário. Sem nota e sem comentário, não há linha. A escala descreve a percepção. Não diagnostica lesão, não define carga e não é prescrição.

## API

Tudo em `/api/v1`, com o mesmo acesso das etapas anteriores, tag Treinos no Swagger.

- `POST /workout-sessions` inicia. Resposta 201, inclusive na repetição do mesmo identificador.
- `GET /workout-sessions` lista. `GET /workout-sessions/open` devolve a sessão aberta.
- `GET /workout-sessions/:id` e `GET /workout-sessions/:id/summary`.
- `POST /workout-sessions/:id/pause`, `/resume`, `/cancel`, `/finish`. Resposta 200.
- `POST /workout-sessions/:id/sets`, `/sets/:setId/correct`, `/sets/:setId/undo`.
- `POST /workout-sessions/:id/exercises/:exerciseSessionId/complete`, `/skip`, `/feedback`.
- `POST /workout-sessions/:id/rest`.
- `POST /workout-session-conflicts/:id/resolve` com `keep_server`, `keep_local` ou `keep_both`.

Finalizar com série planejada ainda em aberto e sem `confirmIncomplete` responde `409 incomplete_session`. Cancelar sem `confirm` responde `400 confirmation_required`.

## Telas

As rotas de treino ficam em `/treino` para não colidir com “Sessões ativas”, que continua sendo a lista de aparelhos autenticados.

- `/treino` lista fichas ativas e oferece continuar a sessão local aberta.
- `/treino/iniciar` escolhe a academia e inicia.
- `/treino/:sessionId` é a sessão: pausa, retomada, exercícios e finalização.
- `/treino/:sessionId/exercicio/:exerciseSessionId` registra série, correção, série extra, pulo, comentário, avaliação e descanso.
- `/treino/:sessionId/resumo` mostra ficha, academia, horários, duração, exercícios, séries, cargas e avaliações.

A série só aparece como concluída depois que o SQLite confirma a gravação. Há um indicador de rede e de fila pendente. Light e dark mode vêm do tema já existente.
