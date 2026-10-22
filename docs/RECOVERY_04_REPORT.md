# MeuTreino+ — Recovery 04

## Resultado

Implementados os achados 08–11 no código, após aprovação da proposta. Base: branch `main`, commit `1cfa3fb7b2d548cdef2b49ed836ed70776c1ee0c`. Alterações ainda não commitadas. Não houve push, deploy, acesso à VPS ou alteração de banco compartilhado. Não foram instaladas dependências.

A conclusão é sustentada por testes automatizados com PostgreSQL descartável, SQLite em arquivo e HTTP real da API. Não representa homologação nativa nem autorização de implantação.

## Correções

| Achado | Problema confirmado                                                                       | Implementação                                                                                                                                      | Evidência de validação                                                                                                           |
| ------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 08     | Sync de fichas podia perder controle da versão esperada                                   | CAS por ficha, proprietário e versão; árvore, revisão, recibo e vínculo de origem na mesma transação; bloqueio transacional e retentativa limitada | Concorrência REST/sync, um vencedor, conflito do concorrente; erro injetado no banco reverte árvore, revisão e recibo            |
| 09     | Escritas operacionais e retentativas de sessões encerradas não tinham tratamento uniforme | Bloqueio de linha; novos registros após término recusados; repetição idêntica comprovada permanece leitura idempotente                             | Estados completed/aborted; séries, correções, feedback e sync; corrida entre término e escrita, sem HTTP 500                     |
| 10     | IDs válidos não comprovavam a prescrição congelada                                        | Projeção canônica confrontada com revisão oficial do proprietário; conferência dos valores planejados copiados; armazenamento do snapshot oficial  | 21 adulterações de snapshot; prescrição copiada adulterada; revisão antiga legítima e metadados equivalentes aceitos             |
| 11     | Editar B depois de iniciar T sobre A podia vincular T à ficha errada                      | Ledger imutável de origens no SQLite, cadeia de dependências, confirmação oficial persistida e fila sem descarte da revisão intermediária          | A → T → B, perda do ACK após commit, reinício do runtime e retomada: T vincula A e B permanece revisão posterior, sem duplicação |

O contrato novo de ficha admite `revisionOrigin` e retorna `revision` com origem, versão e snapshot oficial. Contratos antigos continuam aceitos. O cliente não presume que a última ficha seja a usada pelo treino, nem inventa versão oficial. A sessão mantém sua origem e só é enviada quando há vínculo oficial comprovado.

Conflito `keep_local` de ficha confirma a origem efetivamente bloqueada, preservando edições posteriores. Quando um treino depende dessa origem ainda não publicada, o app bloqueia descarte/troca de identidade por `keep_server` e `keep_both` da ficha com mensagem explícita. As três escolhas de conflitos de sessão do Recovery 03 foram preservadas.

## Persistência e infraestrutura

- Migração aditiva: `apps/api/prisma/migrations/20261022010000_plan_revision_origins/migration.sql`.
- Tabela de negócio `meutreino.plan_revision_origins`, com nomes SQL minúsculos em snake_case, referências à ficha, usuário, operação e revisão, unicidade e proteção de imutabilidade.
- SQLite esquema 7: `local_plan_revisions`, referência da sessão à origem e erro de dependência. Atualizações de conteúdo, fila e revisão são transacionais.
- Exclusão de conta inclui a nova relação na ordem de expurgo.
- Migração aplicada exclusivamente no PostgreSQL local descartável `mt_recovery01_test_verified`, porta 55439, container `mt-recovery01-postgres`. Conferidos namespace e ausência de gatilhos temporários de teste após execução.
- Nenhum objeto de negócio criado em `public`. `_prisma_migrations` é controle de infraestrutura já existente.
- Destino futuro permanece `arbitro.hti.com.br`, database `meutreinodb`, schema `meutreino`. Não foi acessado nem se presumiu integração automática com serviços Supabase.

## Validação executada

| Grupo                                                    |                 Resultado |
| -------------------------------------------------------- | ------------------------: |
| Segurança API — Recovery 01, 03 e 04, PostgreSQL real    |              76 aprovados |
| Mobile — testes diretos e produção com SQLite em arquivo |              83 aprovados |
| Shared — contratos e comparação canônica                 |              70 aprovados |
| Unitários API                                            |              16 aprovados |
| E2E auth, fichas e sessões                               | 15 aprovados, 2 excluídos |
| **Total aprovado**                                       |                   **260** |

Os dois E2E excluídos verificam contagens de população histórica de uma base de desenvolvimento (`keeps existing rows` e `keeps previous rows`). Não são evidência de preservação de dados reais numa base descartável com fixtures. Não foram alterados nem contabilizados como aprovados.

A integração nova combina os stores mobile de produção, SQLite real em arquivo, transporte Supertest e serviços reais sobre PostgreSQL. Os testes mobile isolados controlam transporte e simulam o runtime Expo; não validam a ponte SQLite nativa. Reinício de runtime/arquivo não substitui encerramento e recuperação do processo iOS/Android.

Também aprovados: typecheck completo (incluindo testes API), lint, build API, export web mobile e Prisma generate. `git diff --check` e verificação de whitespace dos arquivos novos aprovados. Verificação dos arquivos alterados/novos não encontrou credenciais privadas ou artefatos de execução adicionados.

A formatação dos arquivos alterados foi validada. O check global acusa cinco arquivos fora deste diff: `apps/mobile/expo-env.d.ts` gerado, `docs/OFFLINE_SYNC.md`, `docs/UX_UI_REVIEW.md`, `docs/VALIDATION_REPORT_04.md` e `README.md`. Permaneceram sem alteração para evitar ampliação do escopo.

## Limites e pendências explícitos

1. Se a ficha legada ainda não foi publicada, o cliente reconstrói a origem congelada do treino antes da edição posterior e preserva as operações antigas como `superseded`.
2. Se a publicação já ocorreu e a prescrição original não existe no histórico comprovável, o treino permanece pendente com erro visível. Não há importação histórica automática; essa estratégia requer definição própria antes de uso com dados reais.
3. Legado com `planVersion` positivo e versão interna do snapshot divergente só é reparado consultando aquela revisão exata e comprovando equivalência. A operação antiga não tem seu corpo reescrito. Revisão inexistente ou diferente mantém pendência.
4. Cada chamada processa até 20 rodadas de dependências de fichas; filas maiores continuam na chamada seguinte.
5. Homologação nativa pendente: modo avião, encerramento do processo, retomada, duas instalações concorrentes e feedback de dependências/conflitos. CoreSimulatorService recusou conexão neste ambiente; não foi possível validar aparelho/simulador.
6. Implantação futura exige migração e publicação coordenadas de API/shared/app. Esta entrega não executa esse procedimento.

A política detalhada consta de `docs/RECOVERY_04_POLICY.md`. Nenhuma correção adicional fora do Recovery 04 foi deliberadamente incluída.
