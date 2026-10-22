# Recovery 03 — Política de conflitos de execução

Esta política se aplica a sessões executadas. A resolução de conflitos de fichas continua tendo seu próprio contrato.

## Identidade e histórico

A sessão original é sempre a execução canônica. A ficha congelada, sua revisão, identidade dos exercícios, academia e início não são reescritos. Séries, correções e eventos confirmados não são atualizados ou excluídos pela resolução.

Cada decisão bem-sucedida preserva duas fotografias imutáveis em `meutreino.workout_session_variants`: o conteúdo apresentado pelo aparelho e o conteúdo remoto imediatamente anterior à decisão. As fotografias têm UUIDs próprios, origem, revisão de origem e vínculo ao recibo e à mesma sessão. Não são novas sessões e não acrescentam séries às tabelas operacionais nem aos totais de treinos. Ficam acessíveis na sessão/resumo, inclusive em cache SQLite depois do download.

## Escolhas

- `keep_remote`: mantém os resultados remotos como principais. A prévia lista os campos e registros locais diferentes. Havendo diferenças, a confirmação explícita é obrigatória. Quando existem séries ou correções locais divergentes, a interface oferece preservar ambas antes da confirmação. A fotografia local permanece como cópia de recuperação.
- `keep_local`: usa o payload local revisado na decisão, incluindo alterações posteriores à criação do conflito. Insere séries distintas, preserva correções e eventos, reconcilia avaliação/comentário, observações, estado e motivo dos exercícios e transições válidas. Uma alteração em valor já confirmado vira uma NOVA correção. O valor efetivo escolhido é registrado depois das correções anteriores. Séries distintas com índice ocupado recebem o próximo índice livre até 40, sem trocar seus IDs; a fotografia de origem conserva a posição original. Diferenças em metadados imutáveis, resultado/observação original de uma série, eventos incompatíveis ou resultados encerrados exigem preservar ambas. Não há reabertura de sessão concluída/cancelada.
- `keep_both`: mantém o remoto como principal e as duas fotografias como alternativas identificadas. Não aplica o merge de `keep_local`, não duplica o treino e não infla estatísticas.
- `keep_server`: alias de `keep_remote`; exige a mesma prévia, chave, revisão e confirmação.

## Tempo e encerramento

O merge considera a união dos eventos por ID e sua ordem de ocorrência. ID confirmado com conteúdo diferente é incompatível. Pausa/retomada devem formar sequência válida; o estado aberto deve corresponder à última pausa. Descansos não podem se sobrepor, ser pausados/retomados fora de estado ou terminar sem início. Expiração natural do descanso permite outro início. Eventos simultâneos na mesma linha temporal exigem revisão; eventos independentes de treino/descanso podem ocorrer juntos. Encerramento e séries devem respeitar o período da execução. A projeção de relógio/descanso ordena eventos cronologicamente, mesmo quando chegaram fora de ordem.

A política conserva o conflito aberto se não houver reconciliação segura. A interface explica a incompatibilidade e oferece `keep_both`. Uma sessão remota encerrada só admite `keep_local` sem alteração de conteúdo; diferenças ficam em variantes. A resolução não muda seus resultados travados.

## Protocolo da API

1. `POST /workout-session-conflicts/:id/preview`: `{choice, localRevision, payload}`. Autoriza todas as referências e retorna versão remota, hash da prévia, diferenças e possibilidade de merge.
2. O aparelho persiste a decisão no SQLite antes de transmiti-la.
3. `POST /workout-session-conflicts/:id/resolve`: os mesmos campos, `idempotencyKey` UUID, `expectedVersion`, `previewHash`, `confirmDiscard`.
4. `GET /workout-sessions/:id/variants`: leitura autorizada das fotografias e sua proveniência.

A transação PostgreSQL bloqueia primeiro a sessão, depois o conflito; valida proprietário, referências, versão e prévia; aplica a decisão; incrementa a versão exatamente uma vez; fecha o conflito; grava o resultado integral em `workout_session_resolutions` e as duas variantes. Falha em qualquer etapa reverte tudo. A chave está vinculada ao usuário, conflito e conteúdo integral da decisão. Repetição devolve o resultado original persistido, mesmo se a sessão tiver mudado depois; conteúdo diferente é recusado. Um concorrente com outra decisão recebe `conflict_already_resolved`.

Os recibos e variantes têm proteção SQL contra UPDATE/DELETE. Exclusão de conta utiliza o procedimento de expurgo já existente, atualizado para a ordem das novas referências; essa exceção não é usada pela sincronização.

## Feedback

O payload inclui a versão da avaliação: zero significa novo/legado sem versão conhecida. Mesmo conteúdo é idempotente; alteração normal exige identidade e versão atuais. Divergência vira conflito ANTES de gravar qualquer parte do agregado. `keep_local` autoriza substituir o conteúdo principal preservando a avaliação anterior em `exercise_feedback_revisions`. A versão nova também é arquivada. Não há concatenação silenciosa de comentários.

Depois do ACK, o mobile atualiza somente os metadados de versão de feedback das operações ainda não enviadas, recalculando seu hash; preserva os comentários posteriores e nunca muda a solicitação de uma tentativa já enviada.

## Recuperação no aparelho

SQLite esquema 6 acrescenta `session_resolution_intents` e `session_variants`. A intenção contém chave, revisão e payload exatos da decisão. Timeout/encerramento deixa a intenção pendente; nova sincronização transmite a mesma solicitação. O reconhecimento local atualiza intenção, fila, revisão e sessão numa única transação.

Se a revisão local ainda é a decidida, aplica o resultado canônico. Se avançou, calcula apenas o delta posterior: aplica-o sobre o resultado quando seguro e cria uma nova operação pendente; quando incompatível, conserva o payload mais recente integral e o enfileira com base antiga para produzir NOVO conflito explícito. Feedback posterior adota a identidade/revisão canônica do mesmo exercício, preservando seu texto novo. Filas substituídas permanecem como `superseded`, com suas revisões; não são apagadas nem tratadas como ACK de execução. ACK antigo não pode reconhecer essas filas novamente.

Se outro aparelho já resolveu, a decisão local fica registrada como `requires_review`, seus dados continuam pendentes e uma nova operação produz a reconciliação necessária. Isso vale também ao descobrir o fechamento durante a prévia.

## Implantação e homologação

API, contratos e app devem ser atualizados de forma coordenada. O endpoint antigo com apenas `choice` é recusado: não satisfaz revisão, idempotência ou confirmação. A migração PostgreSQL é aditiva, em `meutreino`, e preserva avaliações existentes. O upgrade SQLite 5→6 não repete a normalização de catálogo introduzida no esquema 5.

Os testes de SQLite usam SQLite real em arquivos, com adaptador da ponte Expo; transporte de rede é controlado. Os testes da API usam HTTP Nest e PostgreSQL real. Permanecem obrigatórios os testes em iOS de encerramento do processo, retorno ao primeiro plano, perda de rede, acessibilidade e duas instalações/dispositivos. Export web não comprova esses comportamentos nativos.
