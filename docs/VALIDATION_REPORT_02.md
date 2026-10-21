# Validação do Prompt 02

Data da execução local: 20 de outubro de 2026. Nenhuma migração foi enviada para `arbitro.hti.com.br`. Nenhum aplicativo foi publicado.

## Ambiente efetivo

| Item                 | Valor verificado                                                 |
| -------------------- | ---------------------------------------------------------------- |
| Database             | `meutreino`                                                      |
| Schema de negócio    | `meutreino`                                                      |
| `public.users`       | ausente                                                          |
| Histórico Prisma     | `public._prisma_migrations`                                      |
| Usuário da API local | `meutreino` (superusuário do container; recusado só em produção) |
| Migração nova        | `20261020220000_meutreino_schema`, aplicada no PostgreSQL local  |
| Storage              | `MEDIA_STORAGE=local`, diretório `var/media`                     |

A migração moveu os objetos existentes com `ALTER ... SET SCHEMA`. Os doze exercícios de sistema foram inseridos nessa migração. O teste de integração confirma o schema, a ausência de `public.users` e o exercício `Agachamento livre`.

## Testes executados

- Prettier: `npm run format:check` passou.
- ESLint dos três workspaces: passou.
- Typecheck do pacote compartilhado, da API e do aplicativo: passou.
- Vitest compartilhado: 7 arquivos, 39 testes.
- Jest unitário da API: 8 suítes, 16 testes.
- Testes do aplicativo (`node:test`): política de logout e merge do snapshot, 5 testes.
- E2E contra o PostgreSQL local: 3 suítes, 13 testes. Inclui saúde, identidade e catálogo.
- `nest build`: passou.
- `expo export --platform web`: gerou `apps/mobile/dist`, incluindo as rotas de academias, equipamentos e exercícios.

O e2e de catálogo cobriu, com persistência real:

- CRUD de academia e uma preferencial por usuário.
- Isolamento entre usuários, inclusive na sincronização.
- Equipamento com número, sem número e com o mesmo número em academias diferentes.
- Vínculo com o exercício de sistema Leg press.
- Arquivamento da academia sem apagar o equipamento nem o vínculo.
- Upload, download, rejeição de arquivo inválido e remoção de foto. Outro usuário recebe 404.
- Pesquisa por nome, grupo muscular e tipo de equipamento.
- Exercício personalizado, edição, arquivamento e bloqueio do exercício de sistema.
- Sincronização idempotente, chave reutilizada com outro hash, conflito de versão e nova tentativa do mesmo conflito.

## O que não foi operado em aparelho

Não houve simulador iOS, emulador Android nem clique nas telas no navegador. A exportação web prova que o bundle compila. Não prova o toque, a câmera, a biblioteca de fotos nem a fila SQLite rodando contra a API.

Apple e Google continuam sem homologação em aparelho, como no Prompt 01.

## Sincronização

O worker mínimo existe para academia, equipamento e exercício personalizado. O servidor foi exercitado pelo e2e. A fila do aplicativo está implementada e a decisão de não sobrescrever linha pendente tem teste unitário. O ciclo completo aparelho sem rede, volta da rede e reconciliação não foi executado num dispositivo.

Conflito pede descarte da cópia local. Não há tela lado a lado. Não há cursor incremental. Fichas e séries não entram na fila.

Foto não vai no JSON. Sem rede, o base64 fica no SQLite e o envio espera o equipamento já existir no servidor.

## Logout

O banco `meutreino-{userId}.db` não é mais apagado em todo logout. A decisão está em `decideLocalLogout` e `localCleanupPlan`, com testes. Perda de rede preserva arquivo e refresh token. Logout voluntário com pendências pede confirmação. Revogação e troca de usuário preservam o arquivo se houver pendências. Exclusão de conta apaga mesmo assim. Esse fluxo de interface não foi clicado num aparelho.

## Prontidão do Prompt 03

A API aceita o fluxo de aceite: academia, máquina, exercício associado e leitura autorizada. Fichas, execução, gráficos e cobrança continuam fora. A implantação no Supabase self-hosted continua pendente e depende de confirmar se `meutreinodb` pode existir ao lado dos serviços já instalados. O detalhe está em `docs/DATABASE_DEPLOYMENT.md`.
