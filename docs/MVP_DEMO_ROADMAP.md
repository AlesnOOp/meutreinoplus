# MeuTreino+ — Roadmap e demonstração do MVP

Data: 22/10/2026. Plano proposto, sem implementação ou homologação nativa nesta execução. Ler com MVP_FUNCTIONAL_INVENTORY.md e MVP_GAP_ANALYSIS.md.

## Sequência mínima de entregas

| Entrega                          | Resultado pequeno e verificável                                                    | Reutilização e limites                                                                                        | Aceite                                                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Preparar demonstração        | App executável, API acessível e dados de exemplo identificados                     | Configuração existente, ambiente local isolado; nenhum acesso à VPS ou banco compartilhado                    | Registrar versão, aparelho/OS e URL; abrir app e consultar catálogo; não depender de acesso manual a banco                      |
| 1 — Fechar entrada e retomada    | Primeiro acesso pelo canal real de e-mail e continuação offline com conta cacheada | auth/session-store/layout atuais; correção de navegação, sem contornar autenticação                           | Cadastro → e-mail → confirmação → login → perfil; reiniciar sem rede e abrir cache; conta inexistente/logout não recebem acesso |
| 2 — Provar fotografia            | Captura, preview, persistência e envio de imagem real                              | ImagePicker, SQLite, upload privado e cache já existentes; corrigir texto de permissão/feedback se necessário | Negar/permitir, fotografar, reiniciar, abrir offline, sincronizar e baixar; imagem real visível; outro usuário sem acesso       |
| 3 — Completar consulta histórica | Séries, reps, carga/unidade e resultados sem carga visíveis                        | Projetar registros efetivos e snapshot existentes, sem novo modelo de sessão ou mudança de conflitos          | Treino encerrado com correção e série sem carga aparece integralmente; tela corresponde aos dados persistidos                   |
| 4 — Acabamento pontual           | Clareza de seleção, mensagens e conteúdo dos movimentos usados                     | Componentes/paleta existentes; curadoria de 2–3 movimentos, sem reescrever módulos                            | Iniciante encontra exercício, máquina e resultado; teclado não impede salvar; dados de exemplo são identificados                |
| 5 — Ensaio completo              | Roteiro de 10–15 minutos repetível, sem intervenção técnica                        | Uma conta e um aparelho, kg e treino de força; sync normal sem conflitos deliberados                          | Executar todas as jornadas, reinício offline e retorno de rede; registrar resultado real e limites                              |

As entregas 1–3 fecham lacunas essenciais; 4 pode ser reduzida a textos/estados indispensáveis e conteúdo dos exercícios escolhidos. Imagem de catálogo, gráfico de evolução e comparações avançadas podem vir depois: não são requisitos para provar criação e execução do treino. Nenhuma entrega autoriza alterar contratos de sincronização, revisões imutáveis ou segurança dos Recoveries.

## Roteiro proposto: 12 minutos

Pré-condições: app instalado e API de demonstração alcançável; correio controlado pelo demonstrador; objeto/equipamento disponível para fotografia; permissão testável; dois movimentos de força identificados; sem treinos de usuários reais. Se houver conta ou ficha previamente preparada, declarar isso. Os 12 movimentos de seed são catálogo inicial, não histórico de treino executado.

| Tempo       | Ação e valor demonstrado                                                             | Situação atual / risco e alternativa honesta                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–1:30   | Cadastrar, confirmar, entrar e ajustar nome/unidade kg                               | Canal real e instalação não ensaiados; pode parar no token. Conta preparada é contingência declarada, não prova de onboarding. Não obter token por SQL/outbox durante apresentação |
| 1:30–3:00   | Pesquisar catálogo, filtrar músculo e ler um detalhe                                 | Biblioteca integrada com 12 movimentos; instruções genéricas e nenhuma imagem/vídeo. Não simular player ou prometer tutorial visual                                                |
| 3:00–5:00   | Criar academia, equipamento, associar exercício e tirar foto                         | Código conectado, hardware não homologado. Foto pré-carregada só demonstra visualização e deve ser declarada; não comprova câmera                                                  |
| 5:00–7:00   | Criar ficha com dois exercícios e duas séries, reps, kg e descanso; escolher máquina | Reutiliza picker e configurações reais. Usar valores inteiros em kg; não apresentar lb/cardio como completos                                                                       |
| 7:00–9:30   | Iniciar, registrar séries, pausar/retomar, mostrar descanso e finalizar              | Fluxo de negócio testado; timer em tela bloqueada não verificado. Mostrar offline com app aberto; reabertura fria só após entrega 1                                                |
| 9:30–11:00  | Consultar histórico e resultados da sessão recém-executada                           | Hoje resumo não mostra todas as reps/resultados sem carga. Entrega 3 necessária; não apresentar contagem semanal como gráfico de evolução                                          |
| 11:00–12:00 | Retornar rede, disparar sync pelo fluxo previsto e conferir estado                   | Foco/ações disparam sync; não prometer envio instantâneo em background. Confirmar pelo estado visível, sem editar fila                                                             |

Reserva até 15 minutos: repetir abertura offline após encerramento e retorno online, ou comparar dois resumos se ambos forem reais. Se o P0 de retomada continuar aberto, demonstrar a limitação explicitamente e não anunciar jornada offline completa.

## Dados de demonstração e intervenções proibidas no ensaio

Criar academia, equipamento, ficha e sessão pela interface. Uma base preparada pode reduzir tempo, mas precisa estar marcada como exemplo. Não inventar evolução com sessões apresentadas como reais; se usar registros sintéticos para ilustrar uma tela, identificá-los antes. Não existe hoje fluxo de gráfico de evolução para demonstrar.

Não usar console, banco, edição de SQLite, token extraído do outbox, exclusão de fila ou troca de identidade como passo normal do usuário. Uma apresentação que exija essas ações não atende ao critério de jornada completa. Correções técnicas devem acontecer antes do ensaio, com nova autorização de implementação.

## Evidências de aceitação a coletar depois

- Cadastro e confirmação entregues por canal real; login e reabertura online/offline.
- Foto real com permissão negada e permitida, persistente após reinício e reenviada sem perda silenciosa.
- Ficha montada por UI, sessão encerrada e resultados coerentes com o agregado persistido.
- Retorno da rede com pendências distinguíveis e sincronização confirmada.
- Navegação e formulários com teclado, fonte ampliada e leitor de tela em aparelho identificado.

Os testes desta auditoria fornecem evidência complementar: 19 HTTP/PostgreSQL e 115 SQLite em arquivo aprovados, com limites descritos no inventário. Não substituem esses ensaios.

## Marco de retomada do Recovery 04.2

Pausa preservada. Branch main, HEAD observado `cd95a0dbc4d1c887a9265161fe3a2b90c621e023`. Antes desta tarefa já havia alterações em:

- apps/api/test/recovery04.security-spec.ts
- apps/mobile/src/plans/plan-store.ts
- apps/mobile/test/plan-reconciliation.test.cjs
- docs/RECOVERY_04_2_CORRECAO_ACK_Q.md (novo)

São parte do trabalho anterior de ACK de Q, não desta entrega de MVP. A revisão independente final continua pendente; não inferir aprovação a partir dos testes de inventário. Preservar o diff, o relatório e o commit preventivo, sem reset, commit automático ou mistura de implementação.

Na retomada: confirmar novo HEAD/estado, comparar esse marco, revisar a correção pendente e seguir as condições já aprovadas do Recovery 04.2. O roadmap de produto não autoriza materialização histórica, alteração de conflitos de sessão nem mudança dos mecanismos de segurança. Se um P0 exigir isso, separar e solicitar aprovação antes de implementar.

## Ordem posterior ao mínimo

P1: consistência kg/lb e decimal, estado de envio, picker/contexto, instruções, mídia licenciada e comparação simples entre sessões. Validar acessibilidade e atualizar escopo documental. P2: OAuth homologado, agenda, profissionais, IAP e cardio/alarme nativo, cada qual com escopo próprio. Não iniciar essas expansões para viabilizar a apresentação básica.
