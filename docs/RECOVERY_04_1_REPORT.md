# Recovery 04.1 — Contenção de dependências órfãs

Data: 22/10/2026. Base confirmada antes de editar: branch `main`, HEAD `f452a8bca3723b77f480dc151d82d01449db59b6`, árvore limpa. Commit preventivo preservado. Implementada somente a contenção da Etapa 1 e seus testes. A reconciliação definitiva está proposta em `RECOVERY_04_1_PROPOSTA.md`, aguardando aprovação.

## Comportamento entregue

Antes de resolver conflito, o store examina a origem e todos os descendentes transitivos no ledger local. Consulta sessões vinculadas às revisões afetadas independentemente de `pending`, e examina a fila em todos os estados, incluindo contagem de tentativas, operações confirmadas e substituídas. Operações legadas sem origem são consideradas conservadoramente quando seu descarte não pode ser comprovado seguro.

`keep_server` e `keep_both` são recusados quando deixariam revisões posteriores ou treinos sem origem publicável. A recusa não envia HTTP, não marca a operação original como concluída, não limpa o conflito e não altera snapshot, dependência, chave, hash ou fila. A mensagem orienta escolher **Manter a versão deste aparelho**, publicar a origem e sincronizar os descendentes. Essa opção não é escolhida automaticamente.

A verificação e a preparação são uma transação SQLite exclusiva. Quando uma decisão é segura para envio, grava `plan_conflict_intents` antes de HTTP. Enquanto uma escolha de descarte/cópia está aguardando confirmação, o store impede novas edições na mesma ficha e novos treinos que poderiam depender da origem em descarte. O pedido persistido não muda durante a retentativa. A rede permanece fora da transação SQLite.

O ACK altera fila, vínculo se existente, ficha, eventual cópia e remoção da intenção na mesma transação exclusiva. Falha local mantém a intenção e o conflito para repetir a decisão. Perda de ACK/reinício não permite trocar a escolha enquanto o resultado remoto for desconhecido. A tela informa qual botão repetir; erros de contenção são capturados e apresentados na interface, em vez de virarem rejeições de Promise sem tratamento. Botões ficam desabilitados durante a chamada.

Há também revalidação no primeiro persist de um treino. Se ele leu a origem antes de uma escolha e tentou gravá-la depois da confirmação do descarte, o store recusa o início atomicamente e pede reabertura da ficha. Um treino já existente não é apagado ou reescrito por essa proteção.

A mudança usa o SQLite esquema **8**, aditivo: nova tabela de intenções; revisões e operações anteriores permanecem. Não há mudança de schema/contrato PostgreSQL nem migração nova no servidor. As pequenas alterações de testes anteriores ajustam a versão esperada 7→8 e a mensagem ampliada de contenção; não removem asserções de integridade.

## Caminhos do usuário e casos bloqueados

| Situação                                                | Comportamento e recuperação                                                                                                                                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A→B, com ou sem treino em A/B                           | Bloqueia keep_server/keep_both; keep_local publica A e permite sincronizar B. Edições posteriores são preservadas.                                                                                   |
| A→B→D                                                   | Mesma proteção para descendência indireta; keep_local permite publicar em ordem a cadeia válida.                                                                                                     |
| Origem sem descendente/treino afetado                   | keep_server/keep_both mantêm suas semânticas: servidor permanece na ficha original; keep_both recebe outra ficha.                                                                                    |
| Confirmação de decisão perdida                          | A escolha previamente persistida pode ser repetida; outra escolha fica bloqueada. Descarte/cópia também bloqueia edição e novo treino até confirmação. Após login/conexão, repetir o botão indicado. |
| keep_local aguardando confirmação                       | Repetir keep_local. Novas edições continuam permitidas porque essa decisão publica a origem; o ACK não limpa suas pendências.                                                                        |
| Origem referida pela operação ausente no ledger         | Todas as escolhas bloqueadas, com orientação para preservar backup/aparelho e solicitar recuperação assistida. Não inventar identidade ou publicação.                                                |
| Recusa persistente do servidor para intenção já enviada | Preservar a intenção; mensagem orienta retentativa da mesma escolha e recuperação assistida se persistir. Sem rotina automática de desfazer decisão remota desconhecida.                             |
| Dependência já órfã antes desta atualização             | Contenção não reconstitui publicação histórica. Exige diagnóstico/recuperação própria; não se promete convergência automática de dados previamente inconsistentes.                                   |

O fluxo normal tem caminho por keep_local, mas ele **aceita publicar o conteúdo local conflitante**. Se o usuário exige manter C sem publicar A/B, deve aguardar a reconciliação definitiva; a contenção não finge oferecer essa opção. keep_both nunca é convertido implicitamente em keep_local.

## Testes executados

| Grupo                                                             |                      Aprovados |
| ----------------------------------------------------------------- | -----------------------------: |
| Mobile, stores de produção e SQLite em arquivo                    | 102 (83 anteriores + 19 novos) |
| Segurança API, Recoveries 01/03/04, PostgreSQL descartável e HTTP |                             76 |
| Shared, incluindo contratos e comparação canônica                 |                             70 |
| Unitários API                                                     |                             16 |
| E2E auth/fichas/sessões                                           |                             15 |
| **Total**                                                         |                        **279** |

Dois E2E de contagem de população histórica (`keeps existing rows` e `keeps previous rows`) foram excluídos explicitamente, como no Recovery 04. Não contam como aprovados; não foram alterados para passar em fixtures descartáveis.

Os 19 testes novos cobrem: keep_server/keep_both sem treino, com treino em A e em B; caminho posterior por keep_local até convergir; A→B→D com operação pending/in_flight/done/superseded e tentada; sessão dependente inclusive marcada sincronizada; perda de ACK de escolhas seguras e de keep_local; reinício; repetição da decisão; edição após confirmação; corrida de edição/início de treino com confirmação; treino que leu origem obsoleta; falha transacional na preparação e no ACK; preservação de snapshots, chaves, hashes e dependências; origem ausente com bloqueio assistido. Os testes de escolhas bloqueadas comparam o estado completo antes/depois e comprovam ausência de chamada remota.

O transporte da nova suíte mobile é controlado; SQLite é real em arquivo e os stores são os de produção. As suítes API reexecutadas usam HTTP real sobre PostgreSQL descartável, incluindo a integração prévia SQLite→HTTP→PostgreSQL do Recovery 04. Isso não constitui homologação da ponte Expo nem encerramento real do processo no iOS/Android.

Também executados: typecheck completo, lint completo, build shared/API e export web mobile, formatação dos arquivos alterados/novos e `git diff --check`, com revisão de arquivos novos e padrões de segredos. Uma primeira execução paralela de geração Prisma falhou com EEXIST antes dos testes; a suíte foi repetida em sequência e aprovada. Não foram instaladas dependências.

PostgreSQL restrito ao container descartável `mt-recovery01-postgres`, tmpfs e porta local 55439, database `mt_recovery01_test_verified`. Conferidos label de finalidade e database; a última migração permanece `20261022010000_plan_revision_origins`. Testes usam fixtures e injeção de falhas temporária; não houve migração adicional. Nenhum banco compartilhado ou VPS acessado.

## Limites e entrega

Sem commit automático, push ou deploy. HEAD preventivo permanece inalterado; árvore contém apenas as mudanças desta entrega. Não há homologação nativa nem declaração de prontidão para produção. Intenções são recuperadas repetindo explicitamente a escolha na tela de conflito; não há reconciliação automática em segundo plano. Recuperação de operações já órfãs, fechamento remoto de requisições em trânsito, arquivo de B e nova edição derivada de C pertencem à proposta, não a esta implementação.
