# Segurança e privacidade — MeuTreino+

Autenticação, sessão, exportação e exclusão estão implementadas. Os parâmetros e os limites estão em [AUTHENTICATION.md](./AUTHENTICATION.md). O ciclo da conta está em [ACCOUNT_LIFECYCLE.md](./ACCOUNT_LIFECYCLE.md). Apple e Google estão em [OAUTH_SETUP.md](./OAUTH_SETUP.md).

## Autenticação

Três provedores existem no modelo: `email`, `apple` e `google`.

- E-mail e senha usam Argon2id. O hash fica em `users.password_hash`. A senha não é registrada em log.
- O acesso é um JWT de 15 minutos. Ele não é gravado no banco nem no SQLite.
- A renovação usa 32 bytes aleatórios. Só o SHA-256 é gravado em `auth_sessions.refresh_token_hash`. Cada uso rotaciona o token. Reapresentar um token já substituído revoga a família da sessão.
- No aparelho, o refresh token vai para o SecureStore com `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Sem cofre, fica só na memória. Não há SQLCipher nesta versão.
- A API valida o identity token da Apple e o código do Google no servidor. Grava `provider` e `provider_subject`. Não grava token do provedor. A homologação em aparelho ainda depende das credenciais externas.

Nenhum segredo de verificação, chave de loja ou senha de banco entra no aplicativo. As variáveis públicas são a URL da API e, quando existirem, os identificadores OAuth de cliente. O client secret do Google fica só na API.

## Autorização

Toda leitura e escrita de recurso carrega o usuário autenticado e filtra pelo dono. Identificador na URL não autoriza acesso. Um profissional só lê o que `link_permissions` concede enquanto o vínculo está `active` e não revogado.

Permissões previstas: `read_plans`, `write_plans`, `read_sessions`, `read_feedback`. Conceder permissão é operação de servidor. O aluno pode revogar. Revogação é monotônica.

As consultas da API futura recebem `userId` da sessão, nunca do corpo como prova de identidade.

## Controles já ativos na API

- Validação de ambiente na subida. Falha de configuração encerra o processo.
- CORS sem `*`. Origens precisam ser `http`, `https` ou `exp`. Lista vazia recusa navegadores.
- Throttle de 100 requisições por minuto em memória. Vale para uma instância. Várias instâncias exigirão um limite compartilhado; isso ainda não é necessário.
- Filtro único de erro. Resposta 500 não inclui stack, SQL nem o valor recebido. Detalhes de validação trazem caminho e mensagem.
- Logs estruturados sem `authorization`, `cookie`, senha e token.
- Cabeçalhos de segurança e `Cache-Control: no-store`.
- Ambientes `development`, `test` e `production` são distintos. Swagger só abre fora de produção.
- Segredos locais ficam em `apps/api/.env`, ignorado pelo Git. `.env.example` contém só o padrão de desenvolvimento.

O PostgreSQL local usa usuário, senha e banco `meutreino`. Esse trio é padrão de desenvolvimento documentado, não credencial de produção.

## Privacidade e LGPD

Registros de treino e a nota de desconforto são dados pessoais. A nota de desconforto é informação informada pelo usuário sobre o próprio corpo. Ela não é diagnóstico. O compartilhamento com profissional depende de consentimento `professional_sharing` e da permissão `read_feedback`.

Minimização da 1.0: não há data de nascimento, sexo, altura, peso nem contato de emergência. O perfil guarda nome de exibição, sistema de unidades e início da semana. O locale suportado é somente `pt-BR`.

Consentimentos são linhas append-only em `consent_records`, com finalidade, versão do documento, concessão ou recusa, e instante. Uma mudança de escolha cria outra linha. Finalidades: `terms_of_use`, `privacy_policy`, `health_data_processing`, `professional_sharing`.

Finalidades declaradas:

| Dado                                       | Finalidade                                                   |
| ------------------------------------------ | ------------------------------------------------------------ |
| E-mail e identificador do provedor         | Conta e recuperação de acesso                                |
| Nome de exibição                           | Identificar o aluno na interface                             |
| Fichas, agenda, sessões, séries e feedback | Organizar e acompanhar o treino pedido pelo usuário          |
| Nota de desconforto                        | Registrar o que o usuário escolheu anotar, sem interpretação |
| Foto de equipamento                        | Ajudar o usuário a reconhecer a máquina                      |
| Identificador de transação                 | Confirmar a assinatura comprada na loja                      |
| Vínculo profissional                       | Compartilhar somente o que o aluno autorizou                 |

Não há analytics de terceiros, publicidade, rastreador nem SDK de anúncio.

Exportação e exclusão estão em operação. O procedimento está em [ACCOUNT_LIFECYCLE.md](./ACCOUNT_LIFECYCLE.md). A foto de perfil é JPEG, PNG ou WebP, até 5 MB, conferida pelos bytes iniciais e servida só para o dono. Foto de equipamento continua limitada a 15 MB no modelo e ainda não tem upload de produto.

## Apple App Privacy

Rascunho para a ficha da App Store. Nenhum dado é usado para rastreamento.

| Categoria Apple                                            | Coletado | Vinculado à identidade | Finalidade            |
| ---------------------------------------------------------- | -------- | ---------------------- | --------------------- |
| Endereço de e-mail                                         | Sim      | Sim                    | Funcionalidade do app |
| Nome                                                       | Sim      | Sim                    | Funcionalidade do app |
| ID de usuário                                              | Sim      | Sim                    | Funcionalidade do app |
| Conteúdo do usuário: fichas, notas, fotos de equipamento   | Sim      | Sim                    | Funcionalidade do app |
| Saúde e fitness: treinos registrados e nota de desconforto | Sim      | Sim                    | Funcionalidade do app |
| Compras: identificador de transação e estado da assinatura | Sim      | Sim                    | Funcionalidade do app |
| Identificadores do dispositivo: plataforma e versão do app | Sim      | Sim                    | Funcionalidade do app |
| Localização, contatos, histórico de navegação, publicidade | Não      | —                      | —                     |

`NSHealthShareUsageDescription` e HealthKit ficam de fora. O app não lê o app Saúde.

## Google Play Data Safety

| Tipo                              | Coletado                                        | Compartilhado                                           | Obrigatório                   |
| --------------------------------- | ----------------------------------------------- | ------------------------------------------------------- | ----------------------------- |
| E-mail                            | Sim                                             | Não                                                     | Sim, para conta por e-mail    |
| Nome                              | Sim                                             | Somente com profissional autorizado, o nome de exibição | Sim                           |
| Fotos                             | Sim, fotos de equipamento enviadas pelo usuário | Não                                                     | Não                           |
| Saúde e fitness                   | Sim                                             | Sessões e feedback somente com permissão ativa          | Sim para a função de registro |
| Informações financeiras de compra | Identificador e estado, sem número de cartão    | Não                                                     | Sim para assinantes           |
| ID do dispositivo                 | Plataforma e versão                             | Não                                                     | Sim                           |

Compartilhamento significa o profissional autorizado pelo aluno, não um SDK de anúncio. A transmissão usa HTTPS. Dados em trânsito são criptografados. Dados em repouso dependem da criptografia do disco do provedor de banco e do sandbox do aparelho. O usuário pode solicitar exportação e exclusão. A política de retenção está no modelo de dados.

## Pendências de segurança antes da publicação

- Trocar o limite em memória se houver mais de uma instância da API.
- Levar foto e exportação para armazenamento privado fora do disco local da API.
- Homologar Apple e Google em development build com as credenciais reais.
- Guardar prova de consentimento se a revisão jurídica exigir retenção depois da exclusão. Hoje o consentimento é apagado com a conta.
- Revisar a ficha das lojas quando os campos finais de coleta estiverem fechados.
- Não registrar corpo de notificação de cobrança. `subscription_events` guarda `payload_hash`.
