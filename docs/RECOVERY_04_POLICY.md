# Recovery 04 — Revisões, snapshots e sessões encerradas

Esta política complementa o contrato de conflitos de execução do Recovery 03. Não altera suas três escolhas nem transforma variantes históricas em novos registros operacionais.

## Concorrência de fichas

Uma operação de ficha decide, altera a árvore, cria a revisão e grava o recibo na mesma transação PostgreSQL. A atualização condicional contém ID da ficha, proprietário e versão esperada. A versão aumenta exatamente uma vez; nenhuma linha correspondente significa conflito, sem revisão órfã ou sucesso silencioso.

O sync serializa criação/retentativas por chave e ficha com advisory locks transacionais e usa isolamento serializável com retentativa limitada. A versão esperada é a enviada ou a versão comprovada da dependência anterior; nunca é substituída pela versão viva encontrada durante a escrita. A ficha divergente e seu recibo de conflito são persistidos juntos. REST conserva seu CAS, agora incluindo proprietário no predicado.

## Revisões offline

O SQLite esquema 7 mantém `local_plan_revisions`: UUID da origem, identidade da ficha, revisão local monotônica, conteúdo imutável, predecessora/base conhecida e vínculo oficial, inicialmente ausente. A fila conserva cada operação, inclusive revisões intermediárias usadas por sessões; não apaga o snapshot anterior quando a ficha é editada. Revisão, ficha e operação são gravadas na mesma transação SQLite exclusiva.

O payload de ficha admite `revisionOrigin: { id, parentId }`. `parentId` aponta para uma origem anterior da mesma ficha/usuário, não para um número oficial inventado pelo cliente. Hash e chave de cada tentativa permanecem estáveis. A API cria a revisão oficial, o recibo e `meutreino.plan_revision_origins` atomicamente. O resultado `revision: { originId, version, snapshot }` identifica exatamente o que foi confirmado. Retentativas devolvem esse vínculo persistido, mesmo se a ficha viva avançou.

A sessão captura `source_plan_revision_id` no início. Uma ficha pendente não é tratada como se sua edição já correspondesse à versão oficial anterior: a sessão espera o vínculo da origem usada. Depois da confirmação, o cliente verifica equivalência integral da prescrição e usa a fotografia oficial daquela revisão, acertando conjuntamente `planVersion` e `planSnapshot.version`. O snapshot local de origem permanece na tabela imutável. Não se usa a revisão mais recente como substituta.

Exemplo: criação vazia → versão oficial 1; ficha A com 8 repetições usada por T → versão 2; edição B com 12 repetições → versão 3. T referencia 2. O número concreto é atribuído pelo servidor; o UUID local apenas identifica a dependência.

O ACK só reconhece a revisão enviada. Edições posteriores continuam pendentes. GET/listagem antigos não substituem linhas sujas, e o refresh verifica a revisão local novamente dentro da transação. O envio é FIFO por ficha e compartilha o mecanismo de exclusão de sync do Recovery 02. Há limite de 20 rodadas por chamada; filas maiores continuam pendentes para a próxima chamada.

## Conflito de ficha com treino dependente

Uma origem bloqueada não pode ser confirmada como outra prescrição. `keep_local` resolve primeiro a origem efetivamente em conflito; o vínculo é persistido na mesma transação da resolução. As edições locais seguintes permanecem na fila e são publicadas depois, sem sobrescrever o estado mais recente do aparelho.

Quando existe treino pendente que depende de origem não publicada, o mobile bloqueia `keep_server`/`keep_both` da **ficha** com explicação. Descartar essa origem ou criar outra ficha com novos IDs não resolve a dependência histórica do treino original. As escolhas de conflitos de **sessão** do Recovery 03 continuam disponíveis e com sua semântica preservada.

## Snapshots oficiais

A validação consulta a revisão persistida da mesma ficha e usuário. Compara uma projeção determinística: identidade, nome, descrição, destaque, status, exercícios e sua ordem semântica, observações, descanso, relações com equipamentos e todas as séries prescritas com seus IDs, índices, tipos, repetições, carga normalizada, unidade, duração e descanso. Omissões, adições e conteúdo adulterado não equivalem à revisão original.

Ordenação física de chaves JSON, representação equivalente de carga e campos de apresentação não definem outra prescrição. Os campos de apresentação excluídos são nomes de exercícios/academias/equipamentos, número exibido da máquina, status exibido do equipamento e timestamps da ficha. Não são usados para reescrever o snapshot oficial: a importação persiste a fotografia da revisão canônica. O vínculo `duplicatedFromId` também é validado pelo guard existente.

O estado e o descanso dos exercícios executados devem respeitar a estrutura congelada. Os valores planejados copiados para uma série executada com `plannedSetId` devem conferir com a série oficial, incluindo carga normalizada. Tentativas inválidas recebem erro estruturado antes de novas gravações ou recibo de sucesso. Revisão antiga legítima continua válida depois de a ficha viva mudar.

## Estados terminais

`completed`, `aborted` ou `lockedAt` impedem novos registros operacionais. REST usa bloqueio de linha e leitura protegida em `ReadCommitted`; a operação que chega depois da finalização observa a trava e é recusada, em vez de usar um snapshot serializável obsoleto e vazar HTTP 500. Sync mantém preflight e transação serializável do Recovery 03.

Retentativas comprovadas por recibo de sync ou por identidade/conteúdo persistido de série/correção são leituras idempotentes, não novas execuções. Feedback idêntico também é leitura sem novo histórico. Conteúdo diferente não pode usar o mesmo ID para alterar dados confirmados. Novas séries, correções, avaliações ou eventos depois do término são recusados.

Importar uma sessão inteira concluída offline continua sendo materialização inicial atômica: não se confunde com anexar registros a uma sessão previamente encerrada. Não foi criada exceção para correções posteriores ao término. Variantes do Recovery 03 continuam sendo fotografias históricas, não filhos operacionais da sessão.

## Dados legados

Operações antigas sem `revisionOrigin` permanecem compatíveis. O cliente só reconhece o conteúdo confirmado; estados locais diferentes ou sem fila são reenfileirados com controle de versão. Não altera o corpo de uma solicitação que pode já ter sido enviada.

Uma sessão antiga versão zero sem origem pode recuperar seu snapshot antes da ficha posterior quando a ficha ainda não tem publicação confirmada no aparelho. As filas anteriores são preservadas como `superseded`, não apagadas. Se já existir publicação concorrente no servidor, o CAS mantém o conflito em vez de sobrescrevê-la.

Se a ficha já foi publicada e a revisão original não consta do histórico conhecido, o cliente conserva a sessão pendente com `dependency_error` visível. Só usa uma revisão oficial equivalente após comprovar a prescrição; não fabrica número oficial, duplica ficha ou reescreve história. A importação histórica desse legado ausente exige estratégia específica antes de operar dados reais, conforme a proposta aprovada.

Sessões legadas com `planVersion` positivo e `planSnapshot.version` divergente consultam aquela revisão exata na API. Só uma prescrição equivalente permite corrigir ambos os campos e gerar outra operação; a fila anterior fica `superseded`. Revisão ausente ou diferente conserva a pendência explícita. A consulta ocorre fora da transação SQLite e sua aplicação revalida a revisão local.

## Implantação e homologação

A migração é aditiva, em `meutreino`; recibos de sessão anteriores não são recalculados. O expurgo de conta respeita a nova ordem de referências. Atualizar migração, API, shared e app de forma coordenada. Não há implantação automática nesta entrega.

Testes em SQLite de arquivo, PostgreSQL e HTTP não substituem homologação iOS/Android. Validar reinício do processo, retorno ao primeiro plano, modo avião, duas instalações concorrentes, acessibilidade e os avisos de dependência no aparelho.
