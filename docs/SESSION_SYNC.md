# Sincronização da sessão

O treino inteiro funciona sem rede. Iniciar, registrar série, pausar, descansar e finalizar gravam primeiro no SQLite `meutreino-{userId}.db`, esquema local 8, tabela `sessions`. A fila `sync_queue` recebe uma operação `workout_session` com o agregado inteiro: fotografia, exercícios, séries, correções, feedback e eventos de tempo. A interface só mostra a série como concluída depois dessa gravação.

## Envio

`syncSessions` sincroniza as fichas e depois envia só `workout_session`. A operação `correct` global continua recusada para academia, equipamento, exercício e ficha. A correção de série viaja dentro do upsert da sessão.

O servidor aplica o agregado em transação serializável, com recibo em `sync_operations`. A resolução usa bloqueios explícitos de sessão/conflito e recibo próprio em `workout_session_resolutions`.

- A fotografia, a versão da ficha, a academia e o início não são atualizados depois da inserção.
- Alterações em sessão travada e agregados divergentes ficam em conflito antes de qualquer gravação parcial. O payload local permanece recuperável.
- O mesmo identificador de série com outro conteúdo não altera a linha. O recibo fica em conflito `performed_set_diverged` e o payload do cliente fica em `workout_session_conflicts`.
- Correção e evento de tempo novos entram pelo identificador. Repetir o mesmo identificador não duplica.
- Notas, status e status dos exercícios só mudam quando `baseVersion` é a versão do servidor e a sessão ainda está aberta.
- A mesma chave de idempotência com o mesmo hash reconhece a operação. A mesma chave com outro hash responde `idempotency_key_reused`.

A resolução exige prévia, revisão local, versão remota esperada, chave idempotente e confirmação de descarte. `keep_local` reconcilia o agregado; `keep_remote` (`keep_server`) escolhe o remoto; `keep_both` preserva duas variantes imutáveis da mesma execução, mantendo o remoto como principal. Veja o contrato completo em [RECOVERY_03_CONFLICT_POLICY.md](RECOVERY_03_CONFLICT_POLICY.md).

## Sessão nascida offline

A sessão captura a origem imutável da revisão local usada no início. A fila publica as revisões necessárias em ordem e recebe o vínculo oficial de cada UUID; só então envia a sessão com a fotografia daquela revisão. Editar a ficha depois do início não substitui a prescrição do treino. `planVersion` e `planSnapshot.version` são resolvidos juntos, sem números oficiais inventados no aparelho. Política e tratamento explícito de legados em [RECOVERY_04_POLICY.md](RECOVERY_04_POLICY.md).

Se o servidor não encontra a revisão da `planVersion` declarada, responde `plan_not_synced` e não grava recibo. A fila local volta para `pending`, junto com `session_open`, para tentar de novo. Uma sessão concluída offline, quando a revisão existe, sincroniza sem alterar essa revisão.

Iniciar com rede chama a sincronização da ficha antes. Se essa sincronização reportar conflito de ficha, o início permanece na fotografia local e não chama o início remoto.

## O que a fila protege

`countPendingOperations` conta toda a fila, inclusive sessão. Logout com operação pendente continua pedindo confirmação ou preservando o arquivo. Depois de uma resposta do servidor, o aparelho não substitui a sessão local se ainda houver linha aberta na fila para ela.

Dois aparelhos não fundem resultados por última gravação. A série que divergiu fica preservada dos dois lados até a pessoa escolher.
