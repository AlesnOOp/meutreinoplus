# Recovery 04.2 — Análise de segurança da materialização histórica

**Análise para nova aprovação. Nenhuma importação histórica foi implementada.** O app continua recusando publicar um treino dependente de revisão local não confirmada. A reconciliação de fichas não altera a semântica dos conflitos de sessão.

## Evidências e limite de confiança

Uma revisão persistida no PostgreSQL, vinculada à ficha e ao proprietário, constitui a evidência usada pelo guard do Recovery 04. Um recibo de operação aceita, associado ao UUID de origem e à revisão oficial, permite recuperar esse vínculo. O conteúdo deve ser conferido com a revisão registrada, não com a ficha viva ou com um número informado pelo cliente.

SQLite, UUID, hash SHA-256, chave idempotente, timestamps, autenticação e uma sessão declarada pelo aparelho não provam que uma prescrição já foi oficial. Um cliente comprometido pode fabricar todos esses campos. O hash prova igualdade entre conteúdos comparados; não prova autoria, anterioridade ou aprovação. Equipamentos e exercícios existentes tampouco comprovam a combinação prescrita. Uma revisão local imutável no fluxo normal ainda é controlada fisicamente pelo aparelho.

Na entrega atual, B arquivada aparece no pedido imutável de reconciliação como conteúdo local, e E é uma edição NOVA autorizada e validada no servidor. A proveniência E←B não transforma B em revisão oficial anterior nem autoriza associar a E um treino que usou B.

## Requisitos de integridade para uma eventual evolução

| Questão                                               | Proteção necessária                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cliente inventa prescrição e a apresenta como oficial | Não aceitar `official=true`, `planVersion` ou assinatura gerada só no cliente como prova. Oficialidade deve vir de revisão/recibo já registrados, ou de autorização autenticada nova, claramente datada como nova.                                                                                 |
| Validação canônica do Recovery 04                     | Manter o caminho atual: ficha, usuário, revisão oficial e projeção canônica, incluindo séries, carga, unidades, descanso e relações. Um histórico importado não pode entrar por uma exceção que dispense esse guard para sessões oficiais.                                                         |
| Classes de dado                                       | Separar `official_revision`, `local_archive` e eventual `imported_unverified`. Somente o primeiro fornece versão oficial comprovada. Conteúdo importado não deve receber retroativamente o mesmo identificador ou classificação.                                                                   |
| Treinos duplicados                                    | Manter identidade estável da sessão, recibos idempotentes e vínculo único da origem importada por usuário/aparelho. Uma nova UUID não prova novo treino. Duplicatas com UUIDs diferentes exigem revisão explícita; não somar automaticamente históricos importados às métricas oficiais.           |
| Exportação                                            | Incluir classe de origem, prova disponível, motivo da classificação, hashes, decisão, conteúdo e vínculos, sem expor credenciais/tokens. Exportar um dado não o torna confiável. Garantir isolamento no download.                                                                                  |
| Exclusão                                              | Incluir tabelas, referências, índices e arquivos na ordem transacional de expurgo; respeitar proteções append-only com procedimento de exclusão controlado. Testar ausência de registros órfãos e de dados de outro usuário afetados. Isso é requisito técnico, não certificação jurídica de LGPD. |
| Legado sem prova                                      | Preservar localmente com bloqueio explícito e caminho de recuperação/backup. Não escolher a versão mais recente por semelhança, nem fabricar publicação antiga.                                                                                                                                    |
| Futura mudança de schema/API                          | Usar referência discriminada e namespace/tabelas separados, classe de confiança, usuário, identidade de origem, hash, evidência, instante de importação, decisão e eventual sessão correspondente. Não reutilizar `plan_version` oficial para um documento importado não verificado.               |

## Alternativas

1. **Somente revisões oficiais comprovadas — recomendação atual.** Recuperar recibo/revisão exata quando existirem; caso contrário manter o bloqueio. Preserva a garantia canônica, embora limite a recuperação automática de legados.
2. **Área separada de histórico não verificado.** Permitir visualizar/importar conteúdo pessoal com classificação explícita e sem inseri-lo nas sessões oficiais ou métricas agregadas. Exige novo contrato, deduplicação e decisões de produto/privacidade; não está implementada nem aprovada.
3. **Autorização prévia assinada pelo servidor.** Disponibilizar para uso offline um documento de prescrição já validado, vinculado ao usuário, ficha, revisão e hash, com algoritmo/chave e rotação definidos. Isso ajuda a comprovar revisões obtidas antes da desconexão; não prova uma ficha inteiramente inventada offline. As chaves de assinatura não podem estar no app.
4. **Revisão humana e adoção como nova prescrição.** Um responsável confirma o conteúdo e sua data de adoção, sem alegar publicação passada. Não resolve automaticamente o vínculo do treino antigo; exige fluxo próprio de histórico e responsabilidade.

Uma materialização histórica separada por UUID só seria aceitável após decidir qual classe de confiança ela representa. Dar-lhe um registro no servidor não cria prova de que o treino respeitou uma prescrição oficial anterior.

## Recomendação

Manter a alternativa 1 nesta fase. Antes de eventual aprovação da alternativa 2 ou de materialização histórica, definir: efeito nas métricas, duplicatas, rótulo na interface, identidade da sessão original, evidências aceitas, critérios de revisão, exportação/exclusão e testes de tentativa de fraude. Acrescentar schemas e endpoints versionados separados, sem enfraquecer o guard atual nem reinterpretar recibos/variantes do Recovery 03. Nenhuma dessas mudanças foi feita no Recovery 04.2.
