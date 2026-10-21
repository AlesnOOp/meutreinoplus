# Validação — Prompt 01

Data: 20 de outubro de 2026. Máquina local, Node 24.13. Sem publicação e sem deploy.

## Resultado

Os fluxos de e-mail, sessão, perfil, exportação e exclusão estão implementados na API e no aplicativo e passaram nos testes automatizados abaixo. Apple e Google estão implementados no servidor e no aplicativo, com validação real de JWT na classe de produção, e **não foram homologados em aparelho**. O Prompt 01 não está fechado para publicação nas lojas enquanto essas credenciais e os testes nativos não existirem.

## Testes executados

| Suíte                                                     | Resultado                                        |
| --------------------------------------------------------- | ------------------------------------------------ |
| Vitest do pacote compartilhado                            | 6 arquivos, 35 testes, passou                    |
| Jest unitário da API                                      | 8 suítes, 16 testes, passou                      |
| Jest de ponta a ponta da API, com PostgreSQL              | 2 suítes, 8 testes, passou                       |
| `node --test` da política de sessão do aplicativo         | 3 testes, passou                                 |
| ESLint dos três workspaces                                | passou                                           |
| `tsc` da API, dos testes de ponta a ponta e do aplicativo | passou                                           |
| Prettier                                                  | passou                                           |
| `expo export --platform web`                              | passou, 1058 módulos, incluindo `wa-sqlite.wasm` |

A suíte de ponta a ponta cobriu cadastro, cadastro repetido, senha errada com a mesma resposta de e-mail inexistente, confirmação, token expirado, token reutilizado, login sem assinatura, isolamento de exportação, rotação e reuso de refresh token, logout, logout global, vínculo com reautenticação, tentativa de tomar a identidade de outro usuário, Google sem consentimento, desvínculo do último método, exclusão e limite de login.

Os testes de Apple e Google na API substituem `OidcIdentityService`. A classe de produção tem teste unitário com JWT assinado localmente para nonce, audiência e e-mail. Isso não homologa o provedor.

## O que não foi executado

- Development build no iPhone ou no Android.
- Login real com Apple ou Google.
- Clique manual nas telas, no navegador ou no simulador.
- Envio SMTP para uma caixa fora do Mailpit. Os testes usam o remetente em memória porque `NODE_ENV=test`.

## Builds

Exportação web do Expo concluída em `apps/mobile/dist`, ignorada pelo Git. Não houve build nativo de iOS nem de Android.

## Migrações

Aplicadas no PostgreSQL local:

- `20261020200000_identity`
- `20261020201000_profile_photo_guard`

## Pronto para o Prompt 02

A base de conta pode receber academias, equipamentos e exercícios. Cobrança continua fora. Antes de publicar, faltam credenciais Apple e Google, teste em aparelho e armazenamento privado fora do disco da API.
