# Roteiro de implementação — MeuTreino+ 1.0

A fundação 0.1 compila, sobe a API, aplica a migração e abre o aplicativo de desenvolvimento. Cada etapa abaixo entrega um fluxo utilizável sem antecipar a seguinte.

## Prompt 01 — Conta e perfil

Entregue na API e no aplicativo, com a ressalva de Apple e Google documentada em [VALIDATION_REPORT_01.md](./VALIDATION_REPORT_01.md).

- Cadastro, confirmação, login, recuperação e logout por e-mail e senha, com Argon2id.
- Access token curto, refresh token com hash, rotação e detecção de reuso.
- Sign in with Apple e Google no contrato de `auth_identities`, aguardando credencial externa para homologação em aparelho.
- Perfil, sessões, exportação e exclusão imediata.
- SecureStore guarda o refresh token. O SQLite é isolado por usuário.

Fora: fichas, treino, cobrança e sincronização de domínio.

## Prompt 02 — Academias, equipamentos e exercícios do usuário

- CRUD das academias do aluno e dos equipamentos, com número da máquina e apelido.
- Upload privado de foto, limitado a JPEG, PNG e WebP até 5 MB.
- Exercícios personalizados sobre a tabela `exercises`.
- Catálogo de sistema continua vazio até existir conteúdo licenciado.

## Prompt 03 — Fichas

- Ficha, exercícios ordenados e séries independentes.
- Duplicação e arquivamento.
- Carga progressiva permanece rótulo.
- Edição da ficha não tem caminho de escrita para sessões.

## Agenda semanal — pendente

- Uma agenda ativa.
- Slots de ficha, aeróbico e descanso.
- Reagendamento pela edição dos slots.
- Fuso informado pelo dispositivo, armazenado em `weekly_schedules.time_zone`.

## Prompt 04 — Execução offline (implementada; homologação em aparelho pendente)

- Iniciar, pausar, retomar, concluir e interromper sessão sem rede.
- Registrar séries, exercícios pulados e duração.
- Travar a sessão ao concluir ou interromper.
- A fila local passa a receber essas operações. O envio ainda pode esperar a etapa de sincronização, desde que o treino completo permaneça no SQLite.

## Motor de sincronização — implementação parcial

- Endpoint autenticado que aplica `evaluateSyncDecision`.
- Recibo em `sync_operations`.
- Retentativa com `exponentialBackoffMs`.
- Tela de conflito para versão divergente e para série divergente.
- Indicador de pendência e de erro além da tela técnica.

## Prompt 07 — Histórico e gráficos

- Listas de sessões, frequência, duração e volume registrado.
- Histórico por exercício.
- Gráficos com `react-native-gifted-charts` e `react-native-svg`, depois da verificação de compatibilidade com o SDK 58.
- Nenhuma leitura da escala subjetiva como melhora física.

## Prompt 08 — Feedback

- Escala de cinco níveis, comentário e desconforto informado.
- Texto de limite clínico visível na tela.
- Compartilhamento somente com `read_feedback`.

## Prompt 09 — Vínculo com profissional

- Convite, consentimento, permissões e revogação pelo aluno.
- Autoria de ficha sem transferência de propriedade.
- Sem portal web do profissional.

## Prompt 10 — Assinatura

- Produtos mensal e anual nas lojas, com oferta introdutória de 30 dias.
- Verificação de transação, renovação, cancelamento, expiração, carência e restauração.
- Notificações da Apple e do Google atualizam `subscriptions` e gravam `subscription_events` com hash.
- `resolveAppAccess` passa a ser o único portão de `app_access`.

## Prompt 11 — Privacidade operacional

- Exportação.
- Pedido de exclusão, janela de cancelamento e purge privilegiado descrito no modelo.
- Telas de consentimento.
- Revisão final das fichas App Privacy e Data Safety.

## Prompt 12 — Preparação de loja

- Ícone, privacidade, contas de teste e builds de produção.
- Maestro para os fluxos críticos, a partir de `apps/mobile/e2e`.
- Sem publicação automática a partir deste repositório.

## Critério para avançar

Uma etapa só fecha quando lint, tipos e os testes novos passam, e quando o fluxo principal foi exercitado no ambiente disponível. Falha de verificação não é desligada para obter build verde.
