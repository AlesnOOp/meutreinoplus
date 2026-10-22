# Recovery 04.2 — Correção do bloqueador de ACK sobre Q

Data: 22/10/2026. Base conferida antes de editar: branch `main`, HEAD `cd95a0dbc4d1c887a9265161fe3a2b90c621e023`, árvore limpa. Commit preventivo preservado. Nenhum commit criado.

## Problema e correção

Após perda de ACK de keep_both, a listagem podia importar Q antes de a decisão ser reconhecida no aparelho. Uma edição posterior F em Q era aceita, mas repetir a decisão gravava o snapshot antigo de Q/E sobre a ficha viva e limpava a pendência de F. Sua fila continuava contendo F, contradizendo a ficha exibida.

A aplicação do recibo agora separa reconhecimento e atualização da ficha viva. Dentro da mesma transação SQLite exclusiva, após reconhecer somente as operações fechadas pelo manifesto, verifica a ficha atual e todas as operações ativas. Não promove o snapshot quando existe fila pendente/em voo/em erro, conflito não pertencente à decisão, edição suja não encerrada pelo manifesto, versão oficial superior ou conteúdo diferente na mesma versão conhecida. Preserva payload, origem, contadores, versão, pendência e conflito de F; apenas registra a versão remota observada no campo de acompanhamento.

E continua sendo registrada uma única vez no ledger, na proveniência e na fila já confirmada. Porém, sua origem só é instalada como origem viva se seu snapshot tiver sido promovido à ficha. Quando F já existe, E é o registro local de uma publicação oficial anterior já comprovada pelo recibo, sem substituir F.

Como um ACK atrasado pode acrescentar E ao ledger sem avançar a revisão viva de F, as novas edições alocam o próximo número após o máximo entre o contador vivo e o ledger. Isso evita colisão de `(plan_id, local_revision)` e mantém o parentId da próxima edição apontando para F, não para E.

Não houve importação histórica, vínculo fictício, reescrita de A/B/F, mudança de recibos remotos ou alteração dos conflitos de sessão. Não foram bloqueadas as edições legítimas de Q: elas são preservadas quando o recibo anterior chega.

## Evidência da reprodução após a correção

A sonda da auditoria foi repetida com a expectativa corrigida, usando store de produção e SQLite temporário:

```json
{
  "before": { "name": "F - NEW USER EDIT", "pending": true, "synced": false, "version": 2 },
  "after": { "name": "F - NEW USER EDIT", "pending": true, "synced": false, "version": 2 },
  "activeQueueBefore": 1,
  "activeQueueAfter": 1,
  "pendingContent": "F - NEW USER EDIT",
  "originalIntent": [{ "acknowledged": 1 }]
}
```

O recibo é reconhecido, mas F permanece exibida e corretamente pendente.

## Testes

| Grupo                                           |                                   Resultado |
| ----------------------------------------------- | ------------------------------------------: |
| Mobile, stores de produção e SQLite em arquivo  | 124 aprovados (9 diretos + 115 com harness) |
| Segurança API com PostgreSQL descartável e HTTP |                                89 aprovados |
| Shared                                          |                                70 aprovados |
| Unitários API                                   |                                16 aprovados |
| E2E auth/fichas/sessões                         |                   15 aprovados, 2 excluídos |
| **Total**                                       |                           **314 aprovados** |

São nove novos testes mobile e dois casos HTTP adicionais, além da cobertura anterior:

- keep_both/archive e keep_both/reapply com ACK perdido, refresh importando Q e F pendente, publicada ou em conflito;
- reinício antes de retomar a intenção, preservação dos campos vivos e dos registros completos da fila/ledger de F;
- próxima edição G com identidade livre e parentId de F; convergência de F/G nos casos sem conflito independente;
- treino nascido sobre F, snapshot e origem preservados e posterior sincronização;
- falha na transação de ACK, rollback completo, retentativa única e edição concorrente à resposta;
- integração real SQLite→HTTP→PostgreSQL com F pendente e F já publicada, incluindo comparação direta dos contadores, origem e versão locais antes/depois, unicidade de Q/E e publicação de edição posterior.

Os testes HTTP desse grupo usam instância Nest própria, com o limitador real ativo. A primeira execução ampliada compartilhou o orçamento de requisições com os demais cenários e recebeu dois HTTP 429; a separação por grupo resolveu a interferência sem desabilitar ou alterar regras de produção. A suíte completa passou na repetição.

Os dois E2E excluídos são verificações de população histórica de uma base de desenvolvimento (`keeps existing rows`, `keeps previous rows`), como nas entregas anteriores. Não foram contados como aprovados.

Também aprovados: typecheck completo, lint completo, build shared/API, export web mobile, formatação dos arquivos alterados/novos e `git diff --check`. Nenhuma dependência instalada, nenhum manifest/lockfile alterado.

PostgreSQL restrito ao container local descartável `mt-recovery01-postgres`, tmpfs, porta 127.0.0.1:55439, database `mt_recovery01_test_verified`. A última migração continua `20261022020000_plan_reconciliation`; não houve migração adicional nem gatilho temporário residual após os testes. Nenhuma VPS/base compartilhada acessada.

## Arquivos

- `apps/mobile/src/plans/plan-store.ts`: promoção condicionada do snapshot, reconhecimento histórico de E e alocação de revisão sem colisão.
- `apps/mobile/test/plan-reconciliation.test.cjs`: nove regressões SQLite.
- `apps/api/test/recovery04.security-spec.ts`: integração ampliada para F pendente/publicada e isolamento do orçamento HTTP do grupo.
- `docs/RECOVERY_04_2_CORRECAO_ACK_Q.md`: este relatório.

## Limites

A correção trata o bloqueador demonstrado e preserva as limitações já documentadas do Recovery 04.2. Não é uma conclusão da auditoria independente integral, que foi interrompida: os demais itens ainda precisam de revisão antes da aprovação final.

Não há reparo automático de fichas que eventualmente já tenham sido sobrescritas por uma versão anterior; reconstruir esse estado exigiria prova e diagnóstico próprios. A reprodução e os testes desta entrega usaram apenas fixtures temporárias. Testes com runtime adaptado não substituem homologação nativa, encerramento real do processo nem teste visual no iOS/Android. Sem declaração de prontidão para produção.

Sem commit automático, push ou deploy. A árvore contém somente os quatro arquivos desta correção.
