# Relatório de validação — Prompt 00

Data: 20 de outubro de 2026. Ambiente: macOS, Node 24.13.1, npm 11, Docker 29.2.1. Comando principal: `npm run validate` na raiz.

## Resultado

| Verificação                                                           | Resultado                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| ESLint de `@meutreino/shared`, `@meutreino/api` e `@meutreino/mobile` | Passou                                                                                |
| `prettier --check .`                                                  | Passou, inclusive depois do ajuste do Metro                                           |
| Typecheck do pacote compartilhado, da API e do aplicativo             | Passou                                                                                |
| Vitest do pacote compartilhado                                        | 5 arquivos, 28 testes, passou                                                         |
| Jest unitário da API                                                  | 7 suítes, 14 testes, passou                                                           |
| PostgreSQL 18 (`meutreino-postgres-1`)                                | Healthy                                                                               |
| `prisma migrate deploy`                                               | 1 migração encontrada, nenhuma pendente                                               |
| Jest e2e `GET /api/v1/health`                                         | 1 teste, passou                                                                       |
| `nest build`                                                          | Passou                                                                                |
| `expo export --platform web`                                          | Passou depois de registrar `wasm` no Metro                                            |
| `GET http://localhost:3000/api/v1/health` ao vivo                     | 200, `database: up`, cabeçalhos `nosniff`, `no-referrer`, `DENY`, `no-store`          |
| HTML exportado em `apps/mobile/dist/index.html`                       | 200, título `MeuTreino+`, scripts do bundle presentes                                 |
| Simulador iOS, emulador Android e aparelho físico                     | Não executado neste ambiente                                                          |
| Navegação interativa no navegador                                     | Não executada. Não há ferramenta de navegador nesta sessão                            |
| Maestro em `apps/mobile/e2e`                                          | Estrutura vazia de propósito. Nenhum fluxo e2e mobile foi escrito                     |
| Pipeline do GitHub Actions                                            | Arquivo presente. Não foi disparado porque o diretório ainda não é um repositório Git |

A primeira execução de `npm run validate` falhou só na exportação web. O Metro não resolvia `wa-sqlite.wasm`. `apps/mobile/metro.config.js` inclui `wasm` em `assetExts`. A exportação seguinte concluiu com 994 módulos e o asset `wa-sqlite.wasm` de 641 KB. Lint, tipos, testes, banco, migração, e2e e build da API já tinham passado nessa mesma execução.

O Jest da API emite `ExperimentalWarning: VM Modules`. A flag é necessária para carregar o NestJS 12, que é ESM. Os testes não foram ignorados.

O `prisma generate` avisa que existe a 8.0.0-rc.23. O projeto permanece na 7.10.1 estável.

Há um processo de desenvolvimento da API escutando a porta 3000, iniciado antes deste relatório. O health check ao vivo foi feito contra ele.

## O que não foi mascarado

O ESLint 9.39.5 permanece porque o `eslint-config-expo` 58 falha no ESLint 10. O aviso de depreciação do npm continua visível. `strict`, lint e a checagem de formatação seguem ligados.
