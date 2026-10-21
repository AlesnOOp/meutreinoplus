# Sincronização da sessão

O treino inteiro funciona sem rede. Iniciar, registrar série, pausar, descansar e finalizar gravam primeiro no SQLite `meutreino-{userId}.db`, esquema local 4, tabela `sessions`. A fila `sync_queue` recebe uma operação `workout_session` com o agregado inteiro: fotografia, exercícios, séries, correções, feedback e eventos de tempo. A interface só mostra a série como concluída depois dessa gravação.

## Envio

`syncSessions` sincroniza as fichas e depois envia só `workout_session`. A operação `correct` global continua recusada para academia, equipamento, exercício e ficha. A correção de série viaja dentro do upsert da sessão.

O servidor aplica o agregado numa transação com `SELECT … FOR UPDATE` e o recibo em `sync_operations`.

- A fotografia, a versão da ficha, a academia e o início não são atualizados depois da inserção.
- Série nova é inserida, mesmo que a sessão já esteja travada. Nesse caso o recibo fica em conflito `session_locked`. A série não é apagada.
- O mesmo identificador de série com outro conteúdo não altera a linha. O recibo fica em conflito `performed_set_diverged` e o payload do cliente fica em `workout_session_conflicts`.
- Correção e evento de tempo novos entram pelo identificador. Repetir o mesmo identificador não duplica.
- Notas, status e status dos exercícios só mudam quando `baseVersion` é a versão do servidor e a sessão ainda está aberta.
- A mesma chave de idempotência com o mesmo hash reconhece a operação. A mesma chave com outro hash responde `idempotency_key_reused`.

`keep_local` e `keep_both` inserem uma correção “Valor preservado na reconciliação.” A linha original permanece. `keep_server` adota a leitura do servidor no aparelho. Essa escolha é explícita.

## Sessão nascida offline

O aparelho só enfileira a sessão quando a ficha local já tem versão de servidor maior ou igual a 1 e os exercícios, as séries, as cargas e as repetições ainda coincidem com a fotografia. Se a ficha foi editada depois do início offline, a sessão fica no aparelho. Não sobe com a revisão errada e não é apagada.

Se o servidor não encontra a revisão da `planVersion` declarada, responde `plan_not_synced` e não grava recibo. A fila local volta para `pending`, junto com `session_open`, para tentar de novo. Uma sessão concluída offline, quando a revisão existe, sincroniza sem alterar essa revisão.

Iniciar com rede chama a sincronização da ficha antes. Se essa sincronização reportar conflito de ficha, o início permanece na fotografia local e não chama o início remoto.

## O que a fila protege

`countPendingOperations` conta toda a fila, inclusive sessão. Logout com operação pendente continua pedindo confirmação ou preservando o arquivo. Depois de uma resposta do servidor, o aparelho não substitui a sessão local se ainda houver linha aberta na fila para ela.

Dois aparelhos não fundem resultados por última gravação. A série que divergiu fica preservada dos dois lados até a pessoa escolher.
