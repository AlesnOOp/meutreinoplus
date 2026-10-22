# MeuTreino+ — Inventário funcional do MVP

Data: 22/10/2026. Diagnóstico de produto e arquitetura, sem implementação. Escopo: monorepo no estado de trabalho, incluindo a correção do ACK de Q ainda não commitada.

## Base, critérios e limites

Branch `main`, HEAD `cd95a0dbc4d1c887a9265161fe3a2b90c621e023`. Havia três arquivos de código/testes modificados e `docs/RECOVERY_04_2_CORRECAO_ACK_Q.md` novo. Foram preservados. A análise não aprova a auditoria independente pendente do Recovery 04.2 nem inicia outro recovery.

Evidências utilizadas:

- **S — análise estática:** rastreio entre rota, componente, callback, cliente HTTP, store, persistência e serviço. Arquivo ou endpoint isolado não foi considerado fluxo pronto.
- **T1 — testes HTTP executados:** 19 E2E aprovados em conta, catálogo, fichas e sessões, usando Nest/Supertest e PostgreSQL local descartável. Três verificações de ambiente histórico foram excluídas explicitamente.
- **T2 — testes SQLite executados:** 115 testes CJS aprovados, stores de produção sobre SQLite em arquivo, transporte/ponte Expo controlados pelo harness. Não são testes visuais.
- **N — execução visual/nativa:** não realizada nesta tarefa. Câmera, permissões reais, deep links, teclado, contraste percebido, VoiceOver/TalkBack e encerramento do processo não foram homologados.

**FUNCIONAL** abaixo significa fluxo completo rastreado no código com evidência integrada compatível em ambiente controlado, não aplicativo homologado em aparelho. Não significa “pronto para produção”. Se uma etapa essencial depende de integração externa não exercitada ou de hardware, o conjunto aparece PARCIAL ou NÃO VERIFICADO. Os 115 testes SQLite não provam câmera; testes unitários de cronômetro não provam seu comportamento nativo em segundo plano.

Estados: FUNCIONAL; PARCIAL; IMPLEMENTADO SEM INTERFACE; PLACEHOLDER; AUSENTE; NÃO VERIFICADO. Prioridades e complexidade são detalhadas em `MVP_GAP_ANALYSIS.md`.

## Matriz consolidada das 21 capacidades essenciais

A decomposição fixa abaixo evita contar arquivos, endpoints ou variações de botão como funcionalidades independentes.

| ID / Funcionalidade                                        | Estado         | Evidência                                                                                        | Lacuna                                                                                                  | Prioridade da lacuna  | Complexidade |
| ---------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------- | ------------ |
| A1 Cadastro e confirmação por e-mail recebida pelo usuário | PARCIAL        | S: sign-up/verify-email → auth API; T1 confirma token via outbox de teste                        | SMTP real, chegada do e-mail e abertura/colagem no aparelho não exercitados                             | P0                    | Média        |
| A2 Login por senha e restauração online                    | FUNCIONAL      | S: sign-in → api/client → session-store/SecureStore; T1 autenticação, refresh, revogação         | Falta ensaio nativo de sessão persistida; restauração offline avaliada em E4                            | P0 validação          | Baixa        |
| A3 Editar nome, preferências e tema do perfil              | FUNCIONAL      | S: profile → PATCH /me; T1 grava/lê perfil; tema usa store/paleta                                | Preferência de unidade não é respeitada em toda execução; ver complementar                              | P1                    | Baixa/Média  |
| B1 Biblioteca geral e exercícios personalizados            | FUNCIONAL      | S: lista/cache/endpoint; T1 catálogo e criação personalizada                                     | Base inicial de 12 movimentos; expansão é conteúdo, não módulo ausente                                  | P1                    | Média        |
| B2 Pesquisar e filtrar músculo/equipamento                 | FUNCIONAL      | S: ExerciseListScreen filtros locais; T1 GET /exercises com q/muscle/equipmentType               | Picker da ficha não oferece os mesmos filtros/detalhes                                                  | P1                    | Baixa        |
| B3 Detalhes instrutivos e referência visual                | PARCIAL        | S: ExerciseDetailScreen renderiza descrição/instructions; migração tem textos                    | Instruções de seed incluem avisos genéricos; sem imagem/vídeo integrado                                 | P1                    | Média        |
| B4 Selecionar exercício para a ficha                       | FUNCIONAL      | S: ExercisePickerScreen → updateLocalPlan; T1/T2 árvore de ficha persistida                      | Seleção acontece pelo contexto da ficha; detalhe da biblioteca não adiciona diretamente                 | P1                    | Baixa        |
| C1 Cadastrar/editar academia e preferida                   | FUNCIONAL      | S: GymForm/List/Detail → SQLite → sync; T1 isolamento/preferida/arquivo, T2 edições offline      | Validar experiência nativa e erros de rede                                                              | P0 validação          | Baixa        |
| C2 Cadastrar equipamento e associar exercícios             | FUNCIONAL      | S: EquipmentForm + exerciseIds; T1 vínculos e persistência; T2 fila                              | Associação inversa na ficha é ação separada, pouco explicada                                            | P1                    | Baixa        |
| C3 Fotografar equipamento com o celular                    | NÃO VERIFICADO | S: permissões → launchCameraAsync → base64 → saveEquipmentPhoto                                  | Nenhuma captura física executada; mensagens de permissão do app.json dizem “perfil”                     | P0                    | Média        |
| C4 Foto: persistir, enviar, baixar e visualizar            | PARCIAL        | S: SQLite base64/photo_pending → API → arquivo privado → data URI; T1 upload/download/isolamento | Teste usa bytes de assinatura PNG, não imagem renderizada; falta foto real, reinício e offline          | P0                    | Média        |
| D1 Criar, salvar, editar, duplicar e arquivar ficha        | FUNCIONAL      | S: rotas plans + plan-store; T1 CRUD/revisões; T2 filas reais                                    | Auditoria final da reconciliação avançada permanece pendente; não usar como foco da demo                | P1 validação restrita | Média        |
| D2 Séries, repetições, carga kg e descanso do exercício    | FUNCIONAL      | S: ExerciseConfig → updateLocalPlan → API; T1 cargas/séries; T2 publicação                       | Não há editor completo de duração/descanso por série; vírgula decimal é inconsistente                   | P1                    | Baixa/Média  |
| D3 Preferência de equipamento por exercício/academia       | FUNCIONAL      | S: EquipmentPicker → exercise.equipment → sessão; T1 preserva vínculo com máquina arquivada      | Usuário precisa entender exercício × máquina da academia                                                | P1                    | Baixa        |
| E1 Selecionar ficha e iniciar sessão                       | FUNCIONAL      | S: StartWorkout → startLocalSession; T1 snapshot oficial; T2 origem offline                      | Primeira utilização precisa de dados/cache e conta; entrada fria offline é E4                           | P0 validação          | Baixa        |
| E2 Registrar séries e resultados efetivos                  | FUNCIONAL      | S: ExerciseSessionScreen → recordLocalSet; T1/T2 séries, correções e idempotência                | UI registra carga em kg; duração/distância não são execução completa                                    | P1                    | Média        |
| E3 Cronômetro lógico, pausa, retomada e finalização        | FUNCIONAL      | S: eventos persistidos + projeções; T1 execução real; T2 reinício do runtime                     | Som, vibração, tela bloqueada e segundo plano não verificados/implementados como experiência completa   | P1                    | Média        |
| E4 Sincronizar e acessar novamente sem rede                | PARCIAL        | S: syncSessions/fila/revisões; T2 offline e retomada                                             | index.tsx envia status offline a uma tela sem acesso direto ao cache, mesmo com conta recuperada        | P0                    | Baixa/Média  |
| F1 Listar sessões e recuperar histórico remoto             | FUNCIONAL      | S: WorkoutHome + restoreSessionHistory paginado; T1 listagem, T2 recuperação                     | Rótulo “neste aparelho” não explica restauração; falta busca/filtros                                    | P1                    | Baixa        |
| F2 Consultar todos os resultados do treino encerrado       | PARCIAL        | S: SessionSummary → sessionSummary; T1 resultados existem no agregado                            | Resumo não lista repetições e filtra a seção de cargas por set.load; séries sem carga ficam sem detalhe | P0                    | Baixa/Média  |
| F3 Acompanhar evolução entre sessões                       | AUSENTE        | Busca em rotas, serviços e componentes; Home apenas conta sessões/fichas                         | Sem histórico por exercício, comparação longitudinal ou gráfico                                         | P1                    | Média        |

**Resultado aproximado: 14/21 = 66,7%, arredondado para 67% das capacidades essenciais comprovadas no recorte controlado.** Não é percentual de código concluído, de segurança aprovada nem de jornadas nativas homologadas. Nenhuma jornada completa foi homologada visualmente nesta execução; isso não significa que o produto tenha 0% de funcionalidade.

## Jornada A — Primeiro acesso

**Fluxo encontrado:** `/welcome` → `/sign-up` → `/verify-email` → `/sign-in` → `/home`; `/more` → `/profile` para configurar preferências. Não existe wizard obrigatório de perfil.

**Responsáveis:** `apps/mobile/src/app/(public)/sign-up.tsx:22–66`, `verify-email.tsx:30–79`, `(public)/sign-in.tsx`, `api/client.ts:58–100,146–204`, `session/session-store.ts:43–71`; API `identity/auth.service.ts:43–155`, `me.controller.ts:48–64`, `profile.service.ts`. O perfil e a conta são remotos; conta/preferências são cacheadas em SQLite, refresh token usa SecureStore, access token fica em memória.

**Endpoints:** `/api/v1/auth/register`, `/verify-email`, `/resend-verification`, `/login`, `/refresh`, `/logout` sob auth; GET/PATCH `/api/v1/me`. Não há exigência de assinatura para acessar o núcleo na navegação atual; não há compra integrada.

**Comprovado:** T1 cria conta, consome confirmação obtida do outbox, autentica, atualiza preferências, testa sessões/revogação. S mostra os callbacks conectados às telas. **Não comprovado:** envio SMTP externo e deep link em aplicativo instalado. `email/email.module.ts:12–31` usa capture em teste e SMTP nos demais casos; SMTP é implementado, não uma ausência de backend. O app aceita código/link colado, alternativa ao deep link. Login de conta ainda não verificada é permitido (`auth.service.ts:102–126`); usar “Ir para entrar” pode acessar o núcleo, mas não demonstra confirmação funcionando.

**Lacunas:** jornada de instalação/API acessível não foi exercitada; servidor precisa de URL acessível ao aparelho e correio configurado. Aceite de termos é checkbox sem documento aberto pelo componente de consentimento; não tratar isso como jornada jurídica completa. O onboarding não guia a criação da primeira academia/ficha, mas Home oferece CTA contextual.

## Jornada B — Biblioteca

**Fluxo encontrado:** aba `/exercises` → pesquisa/filtros → `/exercises/[exerciseId]`; para escolher: `/plans/[planId]/exercises/add` → callback `choose` cria um item próprio da ficha, preservando a referência ao catálogo. `/exercises/new` permite conteúdo do usuário.

**Responsáveis:** `catalog/exercise-screens.tsx:38–178,181–343,345–445`; `plans/plan-screens.tsx:487–584`; `catalog/catalog-store.ts` lista e cacheia exercícios; `api/catalog.ts`; API `catalog/catalog.controller.ts:227–280`, `catalog.service.ts` e tabelas exercises/músculos/requisitos.

**Endpoints/persistência:** GET/POST `/api/v1/exercises`, PATCH `/exercises/:id`, POST `/:id/archive`; GET `/sync/snapshot` e POST `/sync` abastecem/cacheiam o SQLite por usuário. Catálogo de sistema é remoto e somente leitura; personalizado é local-first.

**Conteúdo real encontrado:** a migração `20261020220000_meutreino_schema/migration.sql:144–194` semeia 12 movimentos nomeados em português, músculos e tipos de equipamento. São dados iniciais do produto, não treinos realizados. Vários campos instructions são avisos como “Sem recomendação clínica”, não orientação instrutiva de execução. A descrição é curta e útil como identificação; não foi avaliada tecnicamente por profissional nesta tarefa.

**Mídia:** schema prevê `visualAssetId` e referência licenciada, mas `ExerciseView`, store/cache e tela de detalhe não oferecem uma cadeia de imagem/vídeo. `ExerciseDetailScreen` renderiza textos e ações; não há player ou imagem. Portanto biblioteca textual integrada existe; biblioteca audiovisual pronta não existe. Não foi encontrado download de mídia licenciada nem pacote local de imagens de exercícios nos assets. Assets Expo/ícones não são referência visual de movimento.

**Comprovado:** T1 pesquisa por nome/músculo/equipamento, protege exercício de sistema e cria/edita/arquiva personalizado. T1/T2 demonstram o exercício na árvore de uma ficha. **Falta:** mídia e conteúdo instrutivo, filtros/preview no picker e atalho contextual para adicionar um exercício visto no detalhe a uma ficha.

## Jornada C — Academia, equipamento e foto

**Fluxo encontrado:** `/gyms/new` → `/gyms/[gymId]` → `/gyms/[gymId]/equipment/new` → detalhe do equipamento → escolher foto/tirar foto → preview; formulário associa exerciseIds. A preferência do equipamento na ficha é feita por `/plans/[planId]/exercises/[planExerciseId]/equipment`.

**Responsáveis:** `catalog/gym-screens.tsx:97–218`, `equipment-screens.tsx:111–238,239–475`, `catalog-store.ts:195–286,560–584`, `api/catalog.ts:81–123`. Equipamento/academia ficam em SQLite e PostgreSQL; foto local fica como base64/content type e photo_pending, não como URI temporária do picker. Preview usa `data:` URI; sem cache mas hasPhoto=true há botão de download.

**Endpoints:** GET/POST `/api/v1/gyms`; GET/PATCH academia; GET/POST/PATCH equipamento sob `/gyms/:gymId/equipment`; POST/GET/DELETE `/:equipmentId/photo`. API `catalog.service.ts:221–296` verifica propriedade, grava MediaAsset e arquivo privado; `catalog.module.ts` injeta `LocalObjectStorage` (`object-storage.ts:11–29`). Não existe adapter Supabase/S3 implementado; arquivo local da API exige volume persistente no ambiente de demonstração.

**Captura:** `equipment-screens.tsx:277–347` solicita câmera/galeria, chama ImagePicker com base64/quality 0.7, aceita JPEG/PNG/WebP e limita 5 MB. Não há conversão explícita HEIC→JPEG ou redimensionamento por dimensões. `app.json` declara mensagens de câmera/fotos como uso “apenas” no perfil, embora a tela fotografe equipamentos. Negação mostra mensagem, sem CTA para ajustes do sistema. Nada disso foi testado em hardware.

**Comprovado:** T1 cria academia/equipamento/vínculo e faz upload/download privado, nega outro usuário e remove foto. O PNG desse teste é apenas uma assinatura de oito bytes (`catalog.e2e-spec.ts:20`); `images.ts` confere prefixo, não decodifica a imagem. Esse teste não prova renderização nem captura. Nenhum teste mobile executado nesta tarefa prova a ponte de câmera.

**Riscos de demo:** foto real grande/formato não suportado, permissão negada, cache em segundo aparelho e backend sem volume. O status online é inferido da sessão, não uma confirmação de upload: quando o store cai para fila por falha de rede, a tela ainda pode dizer “Foto salva” com base no boolean original. O envio de fotos pendentes é acionado pelo sync de catálogo, não por um serviço de background dedicado.

## Jornada D — Montagem da ficha

**Fluxo encontrado:** `/plans/new` → detalhe → adicionar exercício → configurar séries → salvar → reabrir/editar. Academias/equipamentos podem ser associados por exercício. Há duplicação, substituição com escolha sobre séries, ordenação e arquivamento/restauração.

**Responsáveis:** `plans/plan-screens.tsx:51–230,234–481,487–584,588–858,861+`; `plans/plan-store.ts`; API `plans/plans.controller.ts`, `plans.service.ts`; shared `plans/contracts.ts`, `plans/load.ts`. Local ledger/fila e árvore SQLite; árvore viva e revisões oficiais em `meutreino`.

**Endpoints:** CRUD de `/api/v1/workout-plans`, subrotas de exercícios/séries/order/duplicate/archive/restore/revisions; POST `/sync` publica a árvore. `PlanDetailScreen` chama syncPlans e esse fluxo primeiro sincroniza o catálogo, de modo que o picker não depende necessariamente de visitar a aba biblioteca antes.

**Comprovado:** T1 árvore, cargas, substituição, duplicação e versões; T2 edições/filas/revisões e ACK. UI edita reps/carga/unidade, rótulo de carga progressiva, peso corporal, notas e descanso do exercício. **Lacunas:** input de carga na montagem não normaliza vírgula como a execução; não há editor de durationSeconds/loadType=time nem descanso individual de cada série na tela, apesar de contrato/API suportarem parte disso. A seleção da ficha é funcional, porém mais pobre que a biblioteca geral.

**Limite:** a correção de ACK de Q faz parte do estado analisado e passou nos testes SQLite desta tarefa. Isso não conclui a auditoria independente pendente nem justifica demonstrar conflitos concorrentes complexos ao contratante neste MVP.

## Jornada E — Execução e sincronização

**Fluxo encontrado:** `/plans/[planId]` → `/treino/iniciar?planId=...` → `/treino/[sessionId]` → exercício → registrar → pausar/retomar/descansar → finalizar → resumo. A seleção de academia é opcional. Há pular série/exercício, correção, série extra e feedback.

**Responsáveis:** `sessions/session-screens.tsx:140–205,205–370,372–725`; `sessions/session-store.ts:95–235,237–481`; shared `sessions/project.ts`, `sessions/clock.ts`, contratos; API `sessions/sessions.controller.ts`, `sessions.service.ts`, `session-reference-guard.ts`.

**Endpoints:** POST `/api/v1/workout-sessions`; GET lista/open/:id/summary; subrotas sets/correct/undo/pause/resume/finish/cancel/exercises/rest; POST `/sync`. SQLite guarda agregado, fila, eventos, origens e pendências. PostgreSQL guarda snapshot da revisão e registros de execução. Tempos são projetados a partir de eventos; intervalo visual roda a cada segundo. Não há prova de alarme/segundo plano nativo.

**Comprovado:** T1 execução, snapshot, pausa/correção/fim e sync idempotente; T2 store real com SQLite, reinício do runtime e dependências. Carga efetiva da tela é explicitamente kg (`session-screens.tsx:438–462,568–580,645–652`), mesmo se perfil/ficha usarem lb. Isso não permite apresentar suporte imperial integral.

**Interrupção concreta de jornada:** `session/session-store.ts:43–63` recupera conta cacheada em falha de rede e põe status offline. Porém `app/index.tsx:29–47` oferece apenas tentar a rede ou ir a welcome; não encaminha o usuário autenticado em cache a `/home`. O layout privado aceitaria offline, mas não há CTA público de continuação. Logo, treinamento offline já aberto é diferente de reabrir o app sem rede. Não ensaiar fechamento total em modo avião como se estivesse comprovado.

A recuperação de conexão no RootLayout tenta bootstrap a cada 15 s/foreground; ela não equivale a um agendador completo de sync de catálogo, fotos e sessões. Várias telas sincronizam ao ganhar foco, e algumas falhas são suprimidas para manter dados locais. A demo deve mostrar o estado verdadeiro e a ação que dispara sincronização, não prometer background instantâneo.

## Jornada F — Histórico e evolução

**Fluxo encontrado:** aba `/treino` lista concluídos/interrompidos → `/treino/[sessionId]/resumo`. `restoreSessionHistory` (`sessions/session-store.ts:488–523`) pagina o servidor e preserva linhas locais sujas; não é histórico exclusivamente local, apesar do rótulo da tela.

**Persistência/endpoints:** sessões e snapshots no SQLite/PostgreSQL; GET `/api/v1/workout-sessions?page=...`, GET `/:id`, `/:id/summary`, `/:id/variants`. Os registros completos de reps/carga/correções existem.

**Lacuna de exposição:** `SessionSummaryScreen:727–790` apresenta tempos, contagens, cargas e feedback. `shared/sessions/project.ts:187–225` filtra loads por carga não vazia e não devolve reps nessa lista. Assim, resultados sem carga e reps completas não são apresentados pelo caminho normal do histórico. O resumo não oferece navegação explícita para todos os exercícios encerrados. Não confundir a disponibilidade do agregado com uma jornada de consulta completa.

**Evolução:** Home calcula contagens dos últimos sete dias, concluídos e fichas; não é comparação longitudinal. Não há rota/gráfico/série temporal por exercício implementados. Reutilizar registros efetivos existentes antes de propor nova persistência de métricas.

## Complementares e capacidades apenas preparadas

| Funcionalidade                              | Estado                      | Evidência                                                            | Lacuna                                                                                | Prioridade   | Complexidade |
| ------------------------------------------- | --------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------ | ------------ |
| Foto de perfil pela galeria                 | PARCIAL                     | profile.tsx:90+, API /me/photo                                       | Sem captura pela câmera nessa tela; renderização nativa não verificada                | P1           | Baixa/Média  |
| Apple/Google                                | NÃO VERIFICADO              | auth/providers.ts + social-buttons.tsx, OIDC API                     | Exige IDs/audiences/redirect/config externa; testes OIDC usam respostas controladas   | P2           | Média        |
| Recuperação de senha/troca de e-mail        | PARCIAL                     | reset-password/confirm-email + endpoints auth/me; T1 token/outbox    | Canal real de e-mail/deep links não exercitado                                        | P1           | Média        |
| Dispositivos, logout/revogação              | FUNCIONAL                   | /sessions, api/client, T1 logout e revogação                         | Homologar mensagens e retorno visual                                                  | P1           | Baixa        |
| Exportação e exclusão de conta              | FUNCIONAL                   | privacy/delete-account + /me/export/delete-account; T1               | Não é certificação LGPD; revisão final integral de segurança segue pendente           | P1           | Média        |
| Preferência kg/lb aplicada em toda execução | PARCIAL                     | perfil armazena; configuração aceita lb; execução força kg           | Harmonizar input e apresentação sem reinterpretar dados existentes                    | P1           | Média        |
| Duração de série planejada                  | IMPLEMENTADO SEM INTERFACE  | contracts planSet.durationSeconds; PlansService.storedLoad(time)     | Não há editor mobile do tempo nem jornada completa de execução por duração            | P2           | Média        |
| Descanso por série                          | IMPLEMENTADO SEM INTERFACE  | contrato/store/execução leem set.restSeconds                         | Montagem só expõe descanso do exercício                                               | P1           | Baixa        |
| Instrução didática dos movimentos de seed   | PLACEHOLDER                 | alguns instructions são avisos genéricos na migração                 | Conteúdo editorial efetivo; não basta preencher a coluna                              | P1           | Média        |
| Imagem/vídeo da biblioteca                  | AUSENTE                     | modelo visualAssetId sem entrega no ExerciseView/tela                | Conteúdo licenciado + contrato de leitura + cache/render                              | P1           | Média        |
| Agenda semanal/cardio                       | AUSENTE como jornada        | WeeklySchedule/Slot no Prisma, sem serviço/controller/rota de agenda | Modelo não é agenda utilizável; cardio/distância não têm fluxo completo               | P2           | Alta         |
| Profissional/aluno/convites                 | AUSENTE como jornada        | modelos ProfessionalProfile/StudentProfessionalLink/LinkPermission   | Sem serviço e UI de convite/permissões operacionais                                   | P2           | Alta         |
| Compra, trial e restauração de assinatura   | AUSENTE                     | modelos Subscription e indicador entitlement em More                 | Sem IAP, recibos de loja ou tela de compra                                            | P2           | Alta         |
| Push/som/vibração de descanso               | AUSENTE no fluxo encontrado | dependências/rotas/eventos não fornecem esse mecanismo               | Alarmes e ciclo nativo próprios, sem alterar clock persistido                         | P2           | Média        |
| Acessibilidade nativa/contraste real        | NÃO VERIFICADO              | labels, roles, alerts e focus básicos existem em ui.tsx              | VoiceOver/TalkBack, fonte ampliada, toque e contraste no aparelho                     | P1           | Média        |
| Distribuição iOS/Android de demonstração    | NÃO VERIFICADO              | app.json configura IDs, Expo Router e plugins                        | Não instalado/executado nesta tarefa; não encontrado eas.json no inventário rastreado | P0 validação | Média        |

## Organização do monorepo e documentação

- `apps/mobile`: 42 páginas e três layouts Expo; telas consolidadas em catalog/plans/sessions, UI comum, Zustand para sessão/tema, HTTP autenticado e SQLite por usuário.
- `apps/api`: Nest módulos identity/email/catalog/plans/sessions/health, Prisma/PostgreSQL e arquivos privados locais. Controllers cobrem o núcleo; domínios do schema não equivalem a endpoints prontos.
- `packages/shared`: contratos Zod, tipos de catálogo/cargas, relógios/projeções, decisões de sync e reconciliação. Reutilização deve ser a base do MVP.
- Prisma: 10 migrações presentes. Migrações antigas criam objetos inicialmente em public e depois os movem; usar a cadeia completa. Negócio atual em meutreino; não inferir Supabase Auth/Storage/PostgREST por haver outro database.
- `docs`: há documentos de fases distintas e Recoveries. `PRODUCT_SCOPE.md` ainda afirma que telas/endpoints/catalog seed não existem, embora agora existam. São contexto/intenção, não prova. O inventário presente prevalece como leitura do estado observado, sem reescrever os relatórios anteriores.

## UX: conclusões permitidas pelo código

Existe design system: paletas clara/escura, violeta/lima/coral, Screen/Field/Button/Card/Notice/EmptyState, ícones e componentes acessíveis. Não há fundamento para afirmar que todas as telas são visualmente “toscas” sem executá-las, nem para declarar que o novo visual ficou bom em aparelho.

Pontos favoráveis rastreados: Home com CTA contextual e contagens reais; cinco entradas principais de navegação; formulários nomeados; loading, erros, confirmação e estados vazios; safe area/teclado tratados no componente comum; alertas de pendência e preservação de dados.

Atritos rastreados: entrada offline fria bloqueada na raiz; confirmação de e-mail depende de canal externo; picker menos rico que biblioteca; distinção exercício/máquina exige duas associações; números de unidade inconsistentes; resumo incompleto; sync por foco pouco visível; estados de conflitos avançados extensos e técnicos para iniciante. Listas usam mapas em ScrollView, suficiente para 12 itens mas sem ensaio de catálogo ampliado. Não foi observada lentidão, truncamento, falta de contraste ou desalinhamento: esses itens precisam de teste visual.

## Testes desta execução e ambiente

T1: `auth.e2e-spec.ts`, `catalog.e2e-spec.ts`, `plans.e2e-spec.ts`, `sessions.e2e-spec.ts`, executados com filtro que excluiu três verificações históricas: população anterior em plans/sessions e catálogo com nome de database fixado em `meutreino`. Elas não são prova válida num database descartável chamado `mt_recovery01_test_verified`. Não foram modificadas para passar.

T2: `node --test test/*.test.cjs`, executado em apps/mobile. Ponte Expo e transporte são adaptados/controlados; o SQLite é real em arquivo. Não inclui os nove testes TypeScript diretos, não os conta duas vezes e não reivindica os 314 testes da entrega anterior como executados aqui.

PostgreSQL exclusivamente local descartável, container `mt-recovery01-postgres`, finalidade etiquetada, tmpfs e porta 127.0.0.1:55439. MEDIA_ROOT/EXPORT_ROOT de teste em /tmp. Sem migrações, instalações, VPS, deploy ou criação de commit. Sem execução visual/nativa.

## Respostas executivas

1. **Aproximadamente 67% (14/21)** das capacidades essenciais têm o fluxo rastreado e evidência integrada no recorte controlado. Não equivale à prontidão de apresentação em aparelho.
2. Cinco obstáculos: ausência de ensaio nativo completo/canal real de primeiro acesso; entrada fria offline; foto real/permite câmera ainda sem prova; consulta histórica incompleta; biblioteca pouco instrutiva e sem mídia/evolução que sustentem a apresentação. Prioridades separadas no gap analysis.
3. **A biblioteca existe e está integrada** ao catálogo, cache, busca e seleção de ficha. Tem 12 movimentos de sistema semeados, além dos personalizados. Não é biblioteca audiovisual pronta.
4. **A captura de fotos está implementada e conectada, mas não foi comprovada em celular.** Upload/download privado está testado no recorte de bytes; foto real, renderização, permissões e persistência nativa continuam pendentes.
5. **Há caminho feliz completo no código e nos testes de negócio**, em kg, com conta/API/dados acessíveis. Não é possível afirmar uma jornada visual completa sem intervenção técnica nesta data; há interrupção estática na reabertura offline e confirmação depende do ambiente. Não confundir conta previamente preparada com onboarding demonstrado.
6. Menor sequência: preparar ambiente/dados declarados de demo → fechar primeiro acesso e entrada offline → homologar foto real → expor resultados completos → ensaiar as seis jornadas em aparelho; aplicar acabamento e conteúdo visual pontuais, sem reescrever o núcleo.
