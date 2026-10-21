# Sincronização offline — contrato da versão 0.1

O aluno precisa consultar e alterar academias, equipamentos, exercícios personalizados e fichas sem rede, e também executar um treino inteiro offline. O envio da sessão espera a rede, sem apagar o que já foi registrado.

## O que já existe

No dispositivo, `apps/mobile/src/db/local-database.ts` abre `meutreino-{userId}.db` com WAL. O esquema local 4 cria:

- `local_meta`, com `schema_version = 4` e uma cópia da conta para reabrir o aplicativo sem rede.
- `sync_queue`, com identificador, entidade, operação, `idempotency_key` única, `payload_hash`, `payload`, `base_version`, status, tentativas e último erro.
- `gyms`, `equipment`, `exercises`, `plans` e `sessions`, com uma marca `pending` e outra `synced`. A ficha e a sessão guardam a árvore inteira em `payload`.

Um banco criado no esquema 1 ganha a coluna `payload` e as tabelas de catálogo sem apagar a fila.

Status da fila local: `pending`, `in_flight`, `error`, `done`. Se o processo morre no meio de um envio, `queueStatusAfterRestart` devolve `in_flight` para `pending` na próxima abertura.

No servidor, `sync_operations` é o recibo. Status de servidor: `pending`, `applied`, `rejected`, `conflict`. Os dois vocabulários são diferentes de propósito.

O envelope compartilhado `syncOperationEnvelopeSchema` exige UUID, tipo de entidade, operação, chave de idempotência, hash SHA-256 em hexadecimal, versão base positiva ou nula, e `createdAt` ISO-8601.

## Identidade e hash

Identificadores de sessão, exercício da sessão, série executada, feedback e operação nascem no dispositivo. O mesmo UUID é enviado ao servidor. Reenviar não cria outra linha.

`canonicalJsonString` ordena as chaves, recusa `undefined`, aceita somente inteiros seguros e exige decimais como string. O hash é SHA-256 do UTF-8 canônico. O vetor de referência está em `apps/api/src/sync/canonical-hash.ts`: o objeto `{"a":"x","b":1}` produz `cdab067e9f3beb32d1252cfd63e492592fecbf591b0d08cadb24bb17f3864246`.

## Decisão

`evaluateSyncDecision` é uma função pura. A mesma chave de idempotência com o mesmo hash responde `acknowledge_duplicate`. A mesma chave com outro hash responde `reject` / `idempotency_key_reused`.

| Domínio                   | Upsert                                                                                                   | Delete                                                                                                                       | Correct                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `reference_catalog`       | Recusa. O catálogo de sistema é autoridade do servidor                                                   | Recusa                                                                                                                       | Recusa                                               |
| `editable_aggregate`      | Aplica se a versão base coincide. Sem linha no servidor, cria. Versão divergente pede decisão do usuário | Delete de linha ausente é reconhecido como já feito                                                                          | Sem alvo, recusa                                     |
| `feedback`                | Mesma regra do agregado editável                                                                         | Mesma regra                                                                                                                  | Sem alvo, recusa                                     |
| `workout_session`         | O agregado entra inteiro. Séries novas são inseridas. Série já existente com outro resultado não é sobrescrita | Delete de sessão não é aceito nesta etapa. Delete de sessão ausente continua reconhecido na política pura                    | Correção vai dentro do agregado, não como operação `correct` |
| `performed_set`           | Sem linha, aplica. Mesmo hash, reconhece. Hash diferente mantém o servidor e preserva a cópia do cliente | Recusa. Série executada é imutável                                                                                           | Sem alvo, recusa. Com alvo, aplica uma nova correção |
| `professional_permission` | Recusa. Concessão nasce no servidor                                                                      | Revogação aplica. Já revogada ou ausente de forma idempotente é reconhecida quando o estado já é revogado. Sem linha, recusa | Recusa                                               |

`editable_aggregate` cobre perfil, academia, equipamento, exercício do usuário, ficha e agenda. Conflito de versão usa `user_required`: a interface futura mostra as duas versões. Não há “última gravação vence” para resultado de treino.

Séries divergentes usam `retain_server_and_preserve_client`. O servidor não é sobrescrito. A fila local fica em erro até a pessoa escolher registrar uma correção ou descartar a cópia local.

## Retentativa

`exponentialBackoffMs` usa jitter de metade a 100% do atraso exponencial, base de 1 segundo e teto de 60 segundos. A tentativa precisa ser um inteiro maior ou igual a 1. O relógio e o contador ficam na fila; o worker que vai consumi-los ainda não existe.

## Recuperação

Depois de um encerramento inesperado:

1. A abertura do SQLite relê `in_flight` e marca `pending`.
2. O reenvio usa a mesma chave de idempotência e o mesmo hash.
3. O servidor reconhece a duplicata se a primeira tentativa tinha chegado.

`POST /api/v1/sync` aplica academia, equipamento e exercício personalizado. O recibo e a escrita da entidade acontecem na mesma transação. `GET /api/v1/sync/snapshot` devolve a cópia atual. O aplicativo envia a fila ao abrir as listas e quando a pessoa salva com rede. Sem rede, a alteração fica na fila e a linha local marcada como pendente não é substituída pelo snapshot.

Conflito de versão responde `version_mismatch` e permanece `user_required`. A tela oferece descartar a cópia local e reler o servidor. Não há última gravação vence. Repetir a mesma chave e o mesmo hash reconhece a operação já aplicada ou o mesmo conflito, sem criar outra linha.

A foto não entra no JSON. Ela sobe em `POST /api/v1/gyms/:gymId/equipment/:equipmentId/photo` depois que a linha do equipamento existe. Se a captura acontecer offline, o arquivo fica no SQLite e o envio espera a volta da rede.

## Logout e banco local

`decideLocalLogout` decide o arquivo `meutreino-{userId}.db`:

- Perda de rede: o arquivo e o refresh token permanecem.
- Logout voluntário com fila pendente: o aplicativo pede confirmação antes de apagar.
- Sessão revogada ou troca de usuário com fila pendente: o arquivo permanece para o mesmo usuário entrar de novo. O refresh token da sessão encerrada sai do cofre.
- Logout sem pendências: o arquivo é apagado.
- Exclusão da conta: o arquivo é apagado mesmo com pendências, porque essas operações não têm mais destino.

## Fichas

`syncPlans` envia só operações `workout_plan`. Academias, equipamentos e exercícios continuam no lote do catálogo. A ficha vai inteira: exercícios, séries e equipamento por academia. Se a versão divergir, o servidor guarda o payload e o aparelho oferece manter a versão sincronizada, manter a deste aparelho ou guardar as duas. Sem rede, a ficha local permanece.

Uma operação de ficha na fila entra na mesma contagem de `countPendingOperations`. Logout com pendência continua pedindo confirmação ou preservando o arquivo, como no Prompt 02.

## Sessões de treino

`syncSessions` sincroniza as fichas antes e envia só operações `workout_session`. O payload leva a fotografia da ficha, os exercícios da sessão, as séries, as correções, o feedback e os eventos de tempo. Uma série nova é inserida. Uma série com o mesmo identificador e outro resultado permanece como estava no servidor e vira conflito `performed_set_diverged`. A resolução `keep_local` ou `keep_both` grava uma correção. Não apaga a linha original.

Se a ficha ainda não tem revisão no servidor, a operação responde `plan_not_synced` e a sessão continua no aparelho. O detalhe está em [Sincronização da sessão](SESSION_SYNC.md).

## O que ainda não sincroniza

- Cursor incremental por dispositivo. O snapshot é a cópia inteira visível.
- Agendas.
- Conflito de academia, equipamento ou exercício lado a lado. Nessa fila, a resolução continua sendo descartar a alteração local.
- Catálogo de sistema continua somente leitura. Permissões profissionais continuam concedidas só no servidor.
- Notificação do sistema quando o descanso termina. O cronômetro do aplicativo não depende dela.
