# Apple e Google — configuração

Os botões só aparecem quando o aplicativo tem a variável pública correspondente. Sem isso, o fluxo de e-mail e senha continua completo. A API devolve `503 provider_not_configured` se o provedor chegar sem audiência ou cliente configurado.

Nada disto foi homologado em aparelho. Os testes automatizados substituem a validação do provedor. A classe de produção verifica JWT de verdade, mas não houve login com credencial da Apple ou do Google.

Não coloque `GOOGLE_CLIENT_SECRET` nem `AUTH_ACCESS_TOKEN_SECRET` no aplicativo.

## Sign in with Apple

Identificador do app: `plus.meutreino.app`. O `app.json` já marca `ios.usesAppleSignIn` e inclui o plugin `expo-apple-authentication`.

No Apple Developer:

1. No App ID `plus.meutreino.app`, ative a capability Sign in with Apple.
2. Crie um Services ID apenas se for usar o fluxo web. O aplicativo nativo usa o bundle ID como audiência.
3. Em `apps/api/.env`, defina `APPLE_AUDIENCES` com o bundle ID. Vários valores separam-se por vírgula. Inclua o Services ID se o fluxo web existir.
4. Em `apps/mobile/.env`, defina `EXPO_PUBLIC_APPLE_SIGN_IN=true`.
5. Gere um development build iOS. O Expo Go não é o alvo desta capability.

O aplicativo gera um nonce, envia o SHA-256 para a Apple e o nonce original para a API. A API baixa as chaves de `https://appleid.apple.com/auth/keys` e confere assinatura, emissor `https://appleid.apple.com`, audiência, expiração e nonce. O nonce do token pode ser o valor original ou o SHA-256 hexadecimal dele.

A identidade é o `sub` da Apple, não o e-mail. Hide My Email é aceito. Nome e e-mail podem faltar nos logins seguintes. E-mail só é gravado quando `email_verified` vem verdadeiro. Se o e-mail já pertence a outra conta, a API responde `409 link_required` e não cria outra conta nem vincula sozinha.

## Google

O aplicativo usa Authorization Code com PKCE no navegador do sistema (`expo-auth-session` e `expo-web-browser`), não uma WebView.

No Google Cloud, crie clientes OAuth da marca MeuTreino+:

| Cliente | Uso                                                                                                |
| ------- | -------------------------------------------------------------------------------------------------- |
| iOS     | Bundle ID `plus.meutreino.app`                                                                     |
| Android | Package `plus.meutreino.app`, com SHA-1 e SHA-256 do keystore de debug e do keystore de publicação |
| Web     | Só se o cliente iOS ou Android exigir um client secret na troca do código                          |

Redirect URI nativo: `meutreino://oauth`. No navegador de desenvolvimento, o Expo pode gerar `http://localhost:8081/oauth` ou a porta que estiver aberta. Rode o app e copie o valor exato que `makeRedirectUri({ scheme: 'meutreino', path: 'oauth' })` produzir. Cada valor usado precisa estar no cliente Google e em `GOOGLE_REDIRECT_URIS`.

Variáveis do aplicativo, uma por plataforma:

- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`

Variáveis da API:

- `GOOGLE_CLIENT_IDS`: todos os client IDs aceitos, separados por vírgula.
- `GOOGLE_REDIRECT_URIS`: as URIs aceitas, separadas por vírgula.
- `GOOGLE_WEB_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`: a API só envia o segredo quando o `clientId` recebido é o cliente web. O segredo não entra no binário.

A API troca o código em `https://oauth2.googleapis.com/token` e valida o ID token nas chaves do Google. Emissor aceito: `https://accounts.google.com` ou `accounts.google.com`. A audiência tem de ser o client ID enviado. A identidade é o `sub`.

## Vínculo

Entrar com um `sub` novo cujo e-mail já está em outra conta não vincula e não duplica. A pessoa entra com a senha e, em Contas vinculadas, confirma a senha e autoriza o provedor. Uma identidade externa não pode pertencer a dois usuários. Desvincular só é permitido quando resta outro método. Desvincular o e-mail também apaga o hash da senha.

Esses conflitos estão cobertos por teste com provedor simulado. O botão nativo depende das credenciais acima e de um development build.
