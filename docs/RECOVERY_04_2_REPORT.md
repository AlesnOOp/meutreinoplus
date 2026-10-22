# Recovery 04.2 — Reconciliação definitiva limitada a origens sem treino não publicado

Data: 22/10/2026. Base confirmada antes das alterações: `main`, HEAD `8261edb779d7eb535ea4d9599ece81f1ef414314`, árvore limpa. O Recovery 04.1 está preservado nesse commit preventivo. Nenhum commit foi criado ou reescrito nesta execução.

## Escopo implementado

A decisão explícita pode manter C e arquivar A/B/D, manter C como base para uma edição nova E, criar Q independente com A e arquivar os descendentes, ou criar Q e reaplicar B como E nessa cópia. As origens A/B/D, seus parentId, payloads, hashes e chaves permanecem intactos. A tela pede confirmação com nome/versão do servidor e a edição local exibida. Mudança local durante a prévia ou avanço remoto exige nova decisão explícita.

E possui UUID de origem, UUID de operação, hash, chave idempotente e recibo próprios. Sua base oficial é C ou Q; a proveniência aponta para B separadamente. No PostgreSQL, pedido e resultado imutáveis da decisão registram essa proveniência. No SQLite, `local_plan_derivations` registra E←B; o novo ledger de E recebe apenas o vínculo oficial efetivamente devolvido pelo servidor. Não atribui versão oficial nova a B.

`keep_both` cria Q com novos IDs e revisão própria; não publica A em P como se fosse keep_local. Ao reaplicar B sobre Q, a nova árvore E recebe IDs remapeados. A validação mobile confere origem, hash e prescrição, permitindo somente esse remapeamento de identidade. A ficha original permanece C. Ao reaplicar sobre C, a versão posterior contém E, como ação explícita adicional do usuário.

## Protocolo e integridade

Novo endpoint autenticado: `POST /api/v1/workout-plan-conflicts/:conflictId/reconcile`. Pedido contém UUID da decisão, versão C esperada, escolha, destino dos descendentes, origem escolhida para E e manifesto das operações a fechar. Limite de 200 operações por decisão; cadeias maiores permanecem bloqueadas para recuperação assistida.

A API valida propriedade do conflito/ficha, hashes, IDs, base e identidade dos recibos existentes, encadeamento transitivo e unicidade das operações. A é confrontada com o payload congelado no conflito. O conteúdo local B só é aceito como autoria de uma edição NOVA; não é aceito como evidência de publicação histórica.

O sync e a reconciliação compartilham o advisory lock por ficha; a reconciliação também bloqueia a linha da ficha/conflito e confere a versão esperada. Isso ordena operação em trânsito versus fechamento. Consulta recibos dentro da mesma transação e registra tombstones imutáveis para impedir aplicação tardia das identidades fechadas. Recibos antigos não são editados: uma operação já aplicada conserva seu resultado; uma fechada ainda não aplicada recebe `operation_closed`. Requisições com outra identidade não podem reutilizar chave/ID conhecidos com outro conteúdo.

Q, E, revisão oficial, operação nova, vínculo oficial de E, recibo da decisão, fechamentos e status do conflito são transacionais. Falha antes do commit não deixa Q/E/fechamentos parciais. Repetir UUID e hash retorna exatamente o recibo registrado, mesmo após edição posterior da ficha. Outro conteúdo com a mesma decisão é recusado. Duas decisões concorrentes sobre o conflito têm um vencedor; a perdedora recebe conflito sem criar segunda Q/E.

No mobile, a intenção inteira é persistida antes de HTTP, em transação SQLite exclusiva, após revalidar o grafo e a prévia local. Uma intenção pendente impede novas dependências incompatíveis e novas reclamações da fila da ficha. Não mantém transação SQLite aberta durante HTTP. ACK aplica fila, ficha, eventual cópia, proveniência e recibo local atomicamente. Falha local preserva a intenção para repetir a mesma decisão; ACK antigo de sync não ressuscita conflito/operação substituída. Retomar uma decisão inexistente não cria outra decisão silenciosamente.

Versão C obsoleta comprovadamente recusada fica registrada como decisão rejeitada local, sem alterar a fila; exige reabrir e confirmar nova prévia. Timeout/resultado desconhecido mantém a intenção. A interface distingue essa retomada das escolhas novas. Não há troca de decisão enquanto seu resultado for desconhecido.

## Migrações e privacidade

- PostgreSQL: `20261022020000_plan_reconciliation`, aditiva, cria `meutreino.plan_reconciliations` e `meutreino.plan_operation_closures`.
- UUID da decisão é PK; conflito é único; fechamento tem chave idempotente PK e operation_id único; FKs Restrict/NoAction, índices por usuário e check de base positiva. Gatilhos impedem update/delete de pedidos, resultados e fechamentos.
- Nenhum objeto de negócio criado em public. Não há alteração destrutiva de dados existentes nem materialização histórica.
- SQLite esquema 9: intenções/recibos de reconciliação e proveniência. Pedidos e resultados já confirmados são protegidos contra reescrita, e snapshots antigos permanecem sob suas proteções existentes.
- Exportação autenticada inclui decisões e fechamentos do próprio usuário. Expurgo inclui novas tabelas antes dos conflitos/fichas; testado com registros persistidos, sem afetar outro usuário.
- Migração aplicada apenas ao PostgreSQL descartável local `mt_recovery01_test_verified`, container `mt-recovery01-postgres`, tmpfs, porta 127.0.0.1:55439. Última migração conferida; nenhum gatilho temporário de teste residual. Nenhuma VPS ou base compartilhada acessada.

## Testes e verificações

| Grupo                                                       |                                   Resultado |
| ----------------------------------------------------------- | ------------------------------------------: |
| Segurança API — Recoveries 01/03/04/04.2, PostgreSQL e HTTP |                                87 aprovados |
| Mobile — stores de produção, SQLite real em arquivo         | 115 aprovados (9 diretos + 106 com harness) |
| Shared — contratos/regras                                   |                                70 aprovados |
| Unitários API                                               |                                16 aprovados |
| E2E auth/fichas/sessões                                     |                   15 aprovados, 2 excluídos |
| **Total aprovado**                                          |                                     **303** |

Os dois E2E excluídos são as verificações históricas de população da base de desenvolvimento (`keeps existing rows`, `keeps previous rows`). Não representam prova válida em fixtures descartáveis e não foram contados como aprovados. A integração real SQLite→HTTP→PostgreSQL foi repetida após a validação final do recibo mobile, sem contá-la duas vezes.

Cobertura nova: quatro combinações de keep_server/keep_both e archive/reapply; B imutável; proveniência E; origem/base nova; operações já tentadas; HTTP concorrente de dois aparelhos; duas requisições idênticas concorrentes; fechamento contra operação em trânsito; injeção de falha após criar Q/E e antes do recibo; perda de ACK; reinício do runtime/arquivo; rollback do ACK SQLite; edição posterior; sessões em A/B bloqueadas; ausência de fila ativa órfã; nova prévia após mudança local/remota; ACK antigo após fechamento; exportação e expurgo. Asserções consultam diretamente registros PostgreSQL e SQLite, recibos, snapshots, filas e contagens de Q/E.

Os testes mobile isolados controlam transporte e adaptam a ponte Expo para SQLite de arquivo. A suíte HTTP testa os serviços reais da API/PostgreSQL e o store de produção. Isso não comprova execução nativa ou encerramento real do processo iOS/Android.

Typecheck completo, lint, build shared/API, export web mobile, formatação dos arquivos alterados/novos e `git diff --check` aprovados. Conferidos arquivos novos e padrões de segredos. Nenhuma dependência instalada; manifests e lockfile não alterados. Artefatos de build e geração Prisma ficaram fora do diff. A formatação do Prisma foi limitada aos blocos novos, sem reformatação global do schema.

## Limites e riscos residuais

1. A API não consegue comprovar ausência de treinos ainda privados no aparelho; a contenção local verifica essas dependências. Um cliente adulterado não ganha permissão para publicá-los como oficiais: o guard canônico de sessão permanece obrigatório. Treino dependente de origem sem vínculo oficial continua bloqueando keep_server/keep_both; keep_local permanece o caminho existente para publicar a origem. Não foi alterada a semântica dos conflitos de sessão, seus recibos ou variantes.
2. Resultado desconhecido exige conexão/login e repetição da intenção. Não há reconciliação automática em segundo plano.
3. Quando outro aparelho já resolveu o mesmo conflito com uma decisão diferente, o perdedor preserva dados e intenção e solicita recuperação assistida. Não adota silenciosamente uma decisão diferente nem reaplica B sem consentimento. Adoção guiada do recibo vencedor em todos os aparelhos é evolução futura; não se declara convergência automática desse caso.
4. Origens legadas sem provas, cadeias inconsistentes ou manifesto excessivo exigem recuperação assistida. O código não inventa vínculos nem reescreve operações tentadas.
5. O histórico local arquivado permanece no ledger e no pedido/recibo, mas ainda não possui uma tela dedicada de restauração. Arquivar não significa apagar; reaplicar a edição escolhida está disponível no ato da decisão.
6. Atualização coordenada de migração/API/shared/mobile será necessária no futuro. Clientes antigos não conhecem `operation_closed`, mas a API impede reativação das mesmas identidades.
7. Nenhuma homologação nativa ou prontidão para produção declarada. Pendentes validação da confirmação visual em aparelho, conectividade real, encerramento do processo e acessibilidade.

A análise específica sobre histórico está em `RECOVERY_04_2_HISTORICO_SEGURANCA.md`, sem implementação dessa parte.

## Arquivos desta entrega

- `apps/api/prisma/migrations/20261022020000_plan_reconciliation/migration.sql`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/catalog/sync.service.ts`
- `apps/api/src/identity/deletion.service.ts`
- `apps/api/src/identity/export.service.ts`
- `apps/api/src/plans/plans.controller.ts`
- `apps/api/src/plans/plans.service.ts`
- `apps/api/test/recovery04.security-spec.ts`
- `apps/mobile/src/api/plans.ts`
- `apps/mobile/src/db/local-database.ts`
- `apps/mobile/src/db/sync-state.ts`
- `apps/mobile/src/plans/conflict-containment.ts`
- `apps/mobile/src/plans/plan-screens.tsx`
- `apps/mobile/src/plans/plan-store.ts`
- `apps/mobile/test/plan-reconciliation.test.cjs`
- `apps/mobile/test/session-resolution.test.cjs`
- `apps/mobile/test/support/sqlite-harness.cjs`
- `apps/mobile/test/sync-races.test.cjs`
- `docs/RECOVERY_04_2_HISTORICO_SEGURANCA.md`
- `docs/RECOVERY_04_2_REPORT.md`
- `docs/SESSION_SYNC.md`
- `packages/shared/src/index.ts`
- `packages/shared/src/plans/reconciliation.ts`
