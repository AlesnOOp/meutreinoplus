# MeuTreino+

Seu treino. Seu ritmo. Sua evolução.

Monorepo da fundação 0.1: aplicativo Expo, API NestJS e contratos compartilhados. A interface e a documentação de produto estão em português brasileiro. Código, tabelas e APIs estão em inglês.

O aplicativo organiza, executa, registra e acompanha treinos. Ele não prescreve exercícios, não recomenda cargas e não substitui um profissional de educação física.

## Requisitos

- Node.js 22.13 ou superior, abaixo da versão 25. O desenvolvimento foi validado em Node 24.13.
- npm 11, incluso com essa linha do Node.
- Docker com Docker Compose, para o PostgreSQL 18 e o Mailpit locais.

## Primeira execução

Na raiz do repositório:

```bash
cp .env.example apps/api/.env
printf '%s\n' 'EXPO_PUBLIC_API_URL=http://localhost:3000' > apps/mobile/.env
npm install
npm run db:up
npm run db:migrate
```

O arquivo de exemplo contém usuário, senha e banco `meutreino`, além do segredo de desenvolvimento do access token. São valores locais, não credenciais de produção. Produção precisa de outro `AUTH_ACCESS_TOKEN_SECRET`.

O Compose sobe o PostgreSQL e o Mailpit. A caixa de teste fica em `http://localhost:8025`. O SMTP local é `127.0.0.1:1025`.

### API

```bash
npm run dev:api
```

- Saúde: `GET http://localhost:3000/api/v1/health`
- Documentação: `http://localhost:3000/api/docs`
- Conta: `/api/v1/auth` e `/api/v1/me`
- Academias, equipamentos, exercícios e sincronização: `/api/v1/gyms`, `/api/v1/exercises` e `/api/v1/sync`

A API lê `apps/api/.env`. Os scripts do workspace já executam com esse diretório como pasta atual.

### Aplicativo

```bash
npm run dev:mobile
```

O Expo abre o projeto em `apps/mobile`. No simulador iOS, a API local é `http://localhost:3000`. No emulador Android, use `http://10.0.2.2:3000`. Em um aparelho físico, use o IP da máquina na rede local.

A recepção cria conta, entra e recupera senha. A home autenticada leva às academias, aos equipamentos, à biblioteca de exercícios, ao perfil, às sessões, à exportação e à exclusão. Também permite criar fichas e executar treinos com registro local. Apple e Google só aparecem com as variáveis públicas descritas em [docs/OAUTH_SETUP.md](docs/OAUTH_SETUP.md). Os links de e-mail usam o esquema `meutreino://`.

## Scripts

| Comando                             | Efeito                                                        |
| ----------------------------------- | ------------------------------------------------------------- |
| `npm run dev:api`                   | API em modo watch                                             |
| `npm run dev:mobile`                | Expo                                                          |
| `npm run lint`                      | ESLint do pacote compartilhado, da API e do aplicativo        |
| `npm run format`                    | Prettier                                                      |
| `npm run format:check`              | Conferência de formatação                                     |
| `npm run typecheck`                 | Compila o pacote compartilhado e verifica os tipos            |
| `npm test`                          | Vitest compartilhado, Jest da API e testes de sessão do app   |
| `npm run test:e2e`                  | Saúde, identidade, catálogo, fichas e treinos no PostgreSQL   |
| `npm run build`                     | Pacote compartilhado, API e exportação web do Expo            |
| `npm run db:up` / `npm run db:down` | Sobe ou derruba o PostgreSQL e o Mailpit                      |
| `npm run db:migrate`                | Aplica as migrações                                           |
| `npm run validate`                  | Lint, formatação, tipos, testes, migração, integração e build |

O cliente Prisma é gerado em `apps/api/src/generated` e não vai para o Git. Os scripts de build, tipos e teste da API geram o cliente antes de rodar. `DATABASE_URL` precisa existir nessa hora.

## Layout

```text
apps/mobile          Aplicativo Expo
apps/api             API NestJS e Prisma
packages/shared      Contratos e política de sincronização
docs                 Arquitetura, dados, privacidade e roteiro
infrastructure       Docker Compose
scripts              Validação local
```

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md)
- [Escopo do produto](docs/PRODUCT_SCOPE.md)
- [Modelo de dados](docs/DATA_MODEL.md)
- [Sincronização offline](docs/OFFLINE_SYNC.md)
- [Segurança e privacidade](docs/SECURITY_PRIVACY.md)
- [Autenticação](docs/AUTHENTICATION.md)
- [Apple e Google](docs/OAUTH_SETUP.md)
- [Ciclo da conta](docs/ACCOUNT_LIFECYCLE.md)
- [Roteiro](docs/IMPLEMENTATION_ROADMAP.md)
- [Banco e implantação](docs/DATABASE_DEPLOYMENT.md)
- [Academias e equipamentos](docs/GYMS_AND_EQUIPMENT.md)
- [Biblioteca de exercícios](docs/EXERCISE_CATALOG.md)
- [Validação do Prompt 01](docs/VALIDATION_REPORT_01.md)
- [Validação do Prompt 02](docs/VALIDATION_REPORT_02.md)
- [Fichas de treino](docs/WORKOUT_PLANS.md)
- [Versionamento das fichas](docs/WORKOUT_VERSIONING.md)
- [Validação do Prompt 03](docs/VALIDATION_REPORT_03.md)
- [Sessões de treino](docs/WORKOUT_SESSIONS.md)
- [Cronômetros](docs/WORKOUT_TIMERS.md)
- [Sincronização da sessão](docs/SESSION_SYNC.md)
- [Validação do Prompt 04](docs/VALIDATION_REPORT_04.md)

## Estado para a próxima etapa

Conta, academias, equipamentos, fotos, exercícios, fichas e a execução do treino funcionam contra a API local. A sessão guarda a revisão da ficha no início e registra as séries feitas sem apagar o histórico. Gráficos, agenda e cobrança continuam fora. Apple, Google e as telas não foram homologados em aparelho. A implantação no Supabase da HTI não foi executada.
# meutreinoplus
