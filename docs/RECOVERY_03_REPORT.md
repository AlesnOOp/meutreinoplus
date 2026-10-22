# MeuTreino+ — Recovery 03

Data: 21/10/2026. Implementação autorizada após aprovação do contrato. **Código e testes concluídos para revisão local; homologação nativa pendente. Não é uma declaração de prontidão para produção.**

## Proteção inicial e ambiente

Repositório `~/Dropbox/Projetos/MeuTreino+`, branch `main`, HEAD `2930e391f56a9916bf34a9ec0bb7e6ee7c9c9436` (`MeuTreino - 0.1.2`, Recovery 02). A árvore estava limpa antes das alterações. Recovery 01 permanece no commit `6007d3359f935cdf0df7d878bb8aac2c06fd2b93`. Foram examinados código, contratos, modelos, testes e relatórios anteriores; os testes foram executados novamente.

Escritas PostgreSQL ocorreram exclusivamente no banco descartável local `mt_recovery01_test_verified`, container `mt-recovery01-postgres`, PostgreSQL 18, porta de loopback `55439`, volume de dados em tmpfs e etiqueta de finalidade descartável. As duas suítes de segurança recusam execução fora do banco/host/porta esperados. Não houve acesso à VPS, alteração no banco de desenvolvimento, instalação de dependências, commit, push ou deploy.

O destino futuro continua `arbitro.hti.com.br`, database `meutreinodb`, schema `meutreino`. Não foi presumida compatibilidade automática com Supabase Auth, Storage ou PostgREST.

## Causas-raiz e correções

| Achado | Causa comprovada no código anterior                                                                                                                                                          | Correção                                                                                                                                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 04     | A resolução usava o payload antigo do conflito; edições posteriores podiam ficar sem próxima operação reconhecível. O Recovery 02 as preservava pendentes, mas não concluía a reconciliação. | Decisão durável vinculada à revisão local atual; ACK transacional; delta posterior reenfileirado quando seguro, ou payload integral enviado para novo conflito explícito. Resposta antiga não limpa a revisão nova. |
| 05     | O merge de sessão existente não percorria `payload.feedback`.                                                                                                                                | Persistência idempotente com identidade e versão, divergências explícitas e histórico imutável das avaliações/comentários. Reidratação do histórico pela API existente após o logout limpar o SQLite.               |
| 06     | `keep_local` e `keep_both` percorriam o mesmo caminho, limitado a correções de séries; outros campos e incompatibilidades temporais não tinham política completa.                            | Semânticas distintas, prévia, confirmação e duas variantes da mesma execução; merge de campos mutáveis, séries/correções, feedback e eventos válidos; bloqueio de alterações impossíveis/travadas.                  |
| 07     | Aplicação dos dados e fechamento do conflito eram transações diferentes; não havia recibo de resolução.                                                                                      | Bloqueios de sessão/conflito e todos os efeitos numa transação PostgreSQL, recibo com hash da solicitação e resultado integral; uma única decisão vencedora.                                                        |

## Contrato implementado

A sessão original continua canônica; fotografia e revisão da ficha permanecem congeladas. `keep_remote` preserva o remoto como principal e exige confirmação das diferenças locais. A cópia local fica recuperável. `keep_local` reconcilia o payload revisado do aparelho, preservando registros confirmados e criando correções adicionais quando necessário. `keep_both` mantém o remoto como principal e duas variantes históricas identificadas, sem criar outro treino ou duplicar séries operacionais. `keep_server` é alias seguro de `keep_remote`.

As duas fotografias são preservadas em toda decisão bem-sucedida, com origem e revisão, e podem ser consultadas na sessão/resumo. Eventos incompatíveis, alterações em dados imutáveis e diferenças em sessão encerrada não recebem desempate silencioso: o conflito permanece aberto e a interface oferece preservar ambas. A ordem cronológica dos eventos é usada na projeção de tempo.

O contrato completo, endpoints, regras de feedback e limites estão em `docs/RECOVERY_03_CONFLICT_POLICY.md`.

## Banco de dados

Migração aditiva `20261021010000_session_resolution_receipts`:

- `meutreino.workout_session_resolutions`: recibo único por conflito, chave idempotente, proprietário, revisão local, versão esperada, escolha, hash e resultado integral.
- `meutreino.workout_session_variants`: fotografias local/remota com UUIDs próprios e vínculos à sessão e ao recibo.
- `meutreino.exercise_feedback_revisions`: versões preservadas da avaliação. A migração arquiva as avaliações existentes.
- Proteção SQL de UPDATE/DELETE nas três tabelas novas; identificadores SQL em minúsculas e snake_case. Nenhum objeto de negócio foi criado em `public`.
- Expurgo de conta atualizado para respeitar as novas referências e proteções, dentro do procedimento já existente.

A migração foi aplicada SOMENTE no PostgreSQL descartável. Nenhuma migração histórica foi alterada. O SQLite sobe de esquema 5 para 6 com intenções de resolução e cache de variantes; o upgrade não repete a normalização de catálogo do esquema 4→5.

## Evidências de atomicidade e idempotência

O teste PostgreSQL injeta falha em um trigger BEFORE INSERT do recibo, depois de a decisão ter aplicado suas mudanças e fechado o conflito na transação. Compara diretamente sessão, exercícios, séries, correções, avaliações e suas revisões, eventos, conflitos, recibos e variantes antes/depois: tudo permanece igual. Removida a falha, a mesma decisão conclui. O trigger de teste é removido em `finally`; a consulta final confirmou zero triggers residuais com esse nome.

Testes HTTP concorrentes verificam um único recibo e duas variantes, com um vencedor HTTP 200 e o concorrente HTTP 409. Retentativas com a mesma chave devolvem exatamente o resultado original, inclusive depois de outra alteração legítima na sessão. Reutilização com outra decisão é recusada. Contagens e conteúdo persistido são verificados, além do status HTTP.

No SQLite real em arquivo, os testes interrompem a resposta depois do commit remoto simulado, reiniciam o runtime e reenviam a mesma solicitação/chave. Também injetam falha na gravação SQLite após ACK e comprovam rollback de intenção/fila/sessão. Edições entre prévia e confirmação são recusadas antes do envio; edições durante/depois do ACK permanecem pendentes com nova operação. ACK de fila `superseded` não reconhece a revisão posterior.

## Testes e verificações executados

| Verificação                                          | Resultado                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| Shared/Vitest, 11 arquivos                           | 63 aprovados                                                  |
| API unitários, 8 suítes                              | 16 aprovados                                                  |
| Segurança PostgreSQL real: Recovery 01 + Recovery 03 | 43 aprovados: 28 anteriores + 15 novos                        |
| API HTTP: autenticação, fichas e sessões             | 15 aprovados; 2 verificações de população histórica excluídas |
| Mobile                                               | 67 aprovados: 9 testes diretos + 58 no executor CJS           |
| Typecheck shared/API/mobile                          | Aprovado                                                      |
| ESLint shared/API/mobile                             | Aprovado                                                      |
| Prettier do diff                                     | Aprovado; checagem global tem 5 avisos fora do diff           |
| Build shared e API/Nest                              | Aprovado                                                      |
| Export Expo web                                      | Aprovado                                                      |
| `git diff --check`, incluindo novos arquivos         | Aprovado                                                      |

**Total: 204 testes aprovados**, sem contar as duas exclusões. As duas verificações legadas de fichas/sessões exigem população histórica do banco de desenvolvimento, incluindo pelo menos 57 usuários. Foram excluídas por nome, sem fabricar essa população nem acessar o banco compartilhado. Os demais testes dessas suítes foram executados.

Os testes novos cobrem decisões remota/local/ambas, feedback divergente e versão obsoleta, comentários, exercício pulado/concluído, série extra, correção efetiva após correção remota, cancelamento/finalização, pausas incompatíveis, fim anterior a série remota, simultaneidade, rollback, repetição, chave alterada, referências externas e propriedade. O PostgreSQL é real, com chamadas HTTP ao Nest e consultas diretas ao estado.

No mobile, 53 dos testes CJS usam SQLite real em arquivo (37 corridas do Recovery 02, 3 casos de resolução antes simulados e 13 novos). Os outros 5 CJS verificam fronteiras de autenticação/retorno ao primeiro plano com substitutos. A ponte Expo e o transporte de rede são controlados pelo harness: SQLite real não significa execução nativa. O relogin foi verificado por login HTTP novo com leitura do feedback no PostgreSQL e, separadamente, reidratação de sessão encerrada/feedback em SQLite vazio. O teste de GET de histórico atrasado confirma preservação de edição local concorrente.

Os 37 testes de corridas do Recovery 02 continuam aprovados. O teste de edição durante resolução agora exige a etapa adicional do Recovery 03: fila antiga preservada como `superseded` e uma nova operação pendente, em vez de apenas manter o conflito antigo. Os testes de isolamento do Recovery 01 receberam somente o campo de versão no feedback e permanecem aprovados.

Comandos: scripts npm `typecheck`, `lint`, `format:check`, builds de cada workspace, `test:security` da API, testes unitários API/mobile e seleção HTTP de `auth.e2e-spec.ts`, `plans.e2e-spec.ts`, `sessions.e2e-spec.ts`. Vitest usou configuração temporária externa ao repositório com root/tsconfig explícitos do shared, devido à resolução preexistente do tsconfig raiz Expo. Não houve alteração de dependências ou lockfile.

## Limitações e homologação

- Não foi executado build nativo iOS/Android nem homologação física. `xcrun simctl list devices booted` retornou conexão recusada pelo CoreSimulatorService nesta execução. Nenhum banco instalado no simulador foi alterado.
- Validar em duas instalações iOS: encerrar o processo antes/depois do commit, modo avião, timeout, retomada em primeiro plano, concorrência, leitura de variantes, VoiceOver e confirmação de descarte.
- O export web comprova empacotamento; não comprova a ponte SQLite nativa ou os fluxos de rede no aparelho.
- O teste de falha de rede mobile é transporte controlado; o recibo e o rollback do servidor são comprovados separadamente em PostgreSQL real.
- `format:check` global apontou `apps/mobile/expo-env.d.ts`, `docs/OFFLINE_SYNC.md`, `docs/UX_UI_REVIEW.md`, `docs/VALIDATION_REPORT_04.md` e `README.md`, todos fora do diff. Os arquivos rastreados foram comparados ao HEAD; não foram reformados para ampliar o escopo. A checagem Prettier específica de todos os arquivos alterados/novos passou.
- Não foram executados testes de carga ou prova formal do protocolo, nem uma nova auditoria integral de segurança/LGPD.
- O endpoint antigo que enviava só `choice` deixa de satisfazer o contrato. App, shared, API e migração precisam de implantação coordenada e homologação antes da liberação.

## Estado final

Código e documentação permanecem sem commit, para revisão. HEAD preservado. Nenhum push, deploy, acesso à VPS ou alteração em banco compartilhado.

## Arquivos modificados ou novos

- `apps/api/jest.security.config.cjs`
- `apps/api/prisma/migrations/20261021010000_session_resolution_receipts/migration.sql`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/identity/deletion.service.ts`
- `apps/api/src/sessions/session-reference-guard.ts`
- `apps/api/src/sessions/sessions.controller.ts`
- `apps/api/src/sessions/sessions.service.ts`
- `apps/api/test/session-conflicts.security-spec.ts`
- `apps/api/test/session-isolation.security-spec.ts`
- `apps/api/test/sessions.e2e-spec.ts`
- `apps/mobile/src/api/sessions.ts`
- `apps/mobile/src/db/local-database.ts`
- `apps/mobile/src/db/sync-state.ts`
- `apps/mobile/src/sessions/session-screens.tsx`
- `apps/mobile/src/sessions/session-store.ts`
- `apps/mobile/test/regressions.test.cjs`
- `apps/mobile/test/session-resolution.test.cjs`
- `apps/mobile/test/support/sqlite-harness.cjs`
- `apps/mobile/test/sync-races.test.cjs`
- `docs/DATA_MODEL.md`
- `docs/RECOVERY_03_CONFLICT_POLICY.md`
- `docs/RECOVERY_03_REPORT.md`
- `docs/SESSION_SYNC.md`
- `docs/WORKOUT_SESSIONS.md`
- `packages/shared/src/index.ts`
- `packages/shared/src/sessions/contracts.ts`
- `packages/shared/src/sessions/project.test.ts`
- `packages/shared/src/sessions/project.ts`
- `packages/shared/src/sessions/resolution.test.ts`
- `packages/shared/src/sessions/resolution.ts`
- `packages/shared/src/sync/decision.ts`
