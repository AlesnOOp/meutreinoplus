# Autenticação — MeuTreino+

A conta não depende de assinatura. `resolveAppAccess` decide o uso comercial do aplicativo. `resolveAccountManagement` decide perfil, sessões, exportação, exclusão, restauração de compras e consulta da assinatura. Usuário `active` ou `pending_deletion` entra nessas rotas mesmo com entitlement inativo. Usuário `deleted` não entra.

## Senha

Argon2id via `@node-rs/argon2`, com `memoryCost` 19456, `timeCost` 2 e `parallelism` 1. O hash fica em `users.password_hash`. A senha tem de 12 a 128 caracteres, sem regra de composição, e não pode ser igual ao e-mail. A confirmação de senha existe só na interface.

Fora de teste, a API consulta a faixa k-anonymity do Have I Been Pwned, com `Add-Padding` e tempo limite de 2 segundos. Senha comprometida responde `400 password_compromised`. Se o serviço não responder, o cadastro continua e a API registra um aviso. Em `NODE_ENV=test` a consulta não sai da máquina.

## Sessão

O access token é JWT HS256 de 15 minutos. Claims: `sub`, `sid`, `purpose: access`, emissor `meutreino-api`, audiência `meutreino-mobile`. O segredo é `AUTH_ACCESS_TOKEN_SECRET`, com no mínimo 32 caracteres. Produção recusa o valor de desenvolvimento `development-only-access-token-secret-32` e recusa a ausência do segredo.

O refresh token tem 32 bytes em base64url. O banco guarda só o SHA-256. A sessão dura no máximo 30 dias a partir da criação. A rotação não estende esse prazo. A inatividade de 14 dias, medida por `last_used_at`, é conferida na renovação. Reapresentar um token já substituído ou revogado revoga a família. Token desconhecido responde 401 sem revogar outras sessões. Token expirado revoga só aquela sessão.

No aplicativo, o access token fica só na memória. O refresh token vai para o Expo SecureStore (`meutreino.refresh_token`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`). Se o cofre não existir, como em parte da web, o refresh fica na memória do processo e não vai para AsyncStorage nem para o SQLite. O identificador de instalação (`meutreino.installation_id`) permanece depois do logout. O SQLite do usuário é `meutreino-{userId}.db` e é apagado no logout.

A renovação é única por vez. Um 401 tenta uma renovação e repete a chamada uma vez.

## E-mail e enumeração

Cadastro, reenvio e recuperação respondem `202 { status: "accepted" }` mesmo quando o e-mail já existe ou não existe. Login com e-mail desconhecido ou senha errada responde a mesma mensagem: "E-mail ou senha inválidos." O caminho sem usuário ainda verifica um hash Argon2 fixo.

Tokens de verificação, recuperação e troca de e-mail têm 32 bytes, são guardados como SHA-256 e são de uso único. Verificação e troca duram 24 horas. Recuperação dura 30 minutos. Emitir outro token marca os anteriores como usados. Token desconhecido, usado e expirado têm códigos diferentes; isso não revela se o e-mail existe. Logs de SMTP registram o template e o hash do destinatário, nunca o token.

A conta nasce sem e-mail verificado. Login, perfil, sessões, exportação e exclusão funcionam antes da confirmação. Vincular provedor, trocar e-mail e alterar senha autenticado exigem e-mail confirmado. A redefinição de senha prova o controle da caixa de entrada, marca o e-mail como verificado se ainda não estava e revoga todas as sessões.

## Limites

Em memória, por instância. O endereço usado é `request.ip`; `X-Forwarded-For` não é aceito como cliente.

| Ação               | Limite                                   |
| ------------------ | ---------------------------------------- |
| Login por IP       | 40 a cada 15 minutos                     |
| Login por e-mail   | 8 a cada 15 minutos, zerado após sucesso |
| Cadastro por IP    | 30 por hora                              |
| Recuperação por IP | 8 por hora                               |
| Reenvio por e-mail | 5 por hora                               |
| Verificação por IP | 20 por hora                              |

Há também o throttle geral de 100 requisições por minuto.

## Reautenticação

Vínculo, desvínculo, troca de e-mail e exclusão pedem uma prova na própria requisição: senha atual, identity token novo da Apple ou código novo do Google. Não há token de passo separado. A exclusão ainda exige o texto `EXCLUIR MINHA CONTA`.

Alterar a senha de quem já tem hash confere a senha atual e revoga as outras sessões, mantendo a atual. Redefinir pela recuperação revoga todas.
