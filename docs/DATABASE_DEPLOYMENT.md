# Implantação do PostgreSQL

Este documento descreve a topologia prevista para o MeuTreino+ e o que foi verificado no desenvolvimento local. Nenhuma migração foi executada na VPS `arbitro.hti.com.br`.

## Destino desejado

| Item              | Valor                     |
| ----------------- | ------------------------- |
| Servidor futuro   | `arbitro.hti.com.br`      |
| Database desejado | `meutreinodb`             |
| Schema de negócio | `meutreino`               |
| Convenção         | minúsculas e `snake_case` |

O PostgreSQL local continua sendo o ambiente de desenvolvimento. O Compose sobe o database `meutreino`, usuário `meutreino`, em `localhost:5432`. Esse usuário local é superusuário do container. A API de produção recusa superusuário.

## Database dedicado e Supabase self-hosted

O Supabase self-hosted da HTI não foi inspecionado nesta etapa. Não se assume que Auth, Storage ou PostgREST atendam um database adicional só porque o PostgreSQL aceita `CREATE DATABASE`.

Esses serviços, na topologia usual do Supabase, nascem ligados a um database específico e a schemas internos (`auth`, `storage`, `realtime`, `_realtime`, `supabase_migrations` e outros). Um database `meutreinodb` separado não herda esses componentes.

Antes de criar `meutreinodb` no servidor:

1. Confirmar com a operação da HTI se a instância permite um database extra sem quebrar Auth, Storage e PostgREST dos outros sistemas.
2. Se permitir, criar `meutreinodb` vazio, o schema `meutreino` e um papel de execução que não seja superusuário. Auth e Storage do Supabase continuam no database em que já estão. O MeuTreino+ usa o próprio JWT e o storage abstraído; não depende do Auth do Supabase.
3. Se um database extra não for compatível com a operação da instância, usar o database já compatível com os serviços necessários e criar somente o schema `meutreino`. Não criar tabelas do MeuTreino+ em `public` e não alterar objetos de outros sistemas.

A API de produção só sobe se `EXPECTED_DATABASE` for exatamente `current_database()`, se `meutreino.users` existir, se `public.users` não existir e se o papel conectado não for superusuário. Fora de produção, `EXPECTED_DATABASE` só é exigido quando a variável está definida.

## O que a migração local fez

A migração `20261020220000_meutreino_schema` moveu enums, tabelas e funções de negócio com `ALTER ... SET SCHEMA meutreino`. Isso preserva OID, dados e gatilhos. Não recria tabelas.

Verificação feita no PostgreSQL local depois da migração:

- Database `meutreino`.
- Tabelas de negócio no schema `meutreino`.
- `public.users` ausente.
- `public._prisma_migrations` presente.
- Usuários que já existiam continuaram na tabela movida.
- Doze exercícios de sistema foram inseridos na mesma migração.

O `search_path` do database não foi alterado. Num servidor compartilhado, mudar o `search_path` do database afetaria outros sistemas. A conexão da API envia `options=-c search_path=meutreino,public`.

## Histórico do Prisma

O Prisma 7.10.1 não tem configuração para o schema da tabela `_prisma_migrations`. O tipo `MigrationsConfigShape` só aceita caminho, shadow database e seed. O histórico permanece em `public._prisma_migrations`. Isso não é objeto de negócio do MeuTreino+.

`citext` e as funções da extensão permanecem em `public`. As funções de negócio foram movidas para `meutreino` e receberam `search_path = meutreino, public`.

O índice parcial `gyms_one_preferred_per_owner` está só no SQL. Um `migrate diff` futuro pode propor removê-lo. Não aplicar essa remoção.

## Papéis

A execução normal da API não usa superusuário. O papel de runtime deve poder usar o schema `meutreino` e ler e escrever as tabelas de negócio, sem `CREATEDB`, `CREATEROLE` ou acesso aos schemas internos do Supabase.

O papel de migração pode ser separado e só é usado no `prisma migrate deploy`. A senha desse papel não entra no aplicativo nem no exemplo de ambiente. Não coloque credencial administrativa do Supabase no mobile.

Exemplo de criação, para ser revisto e executado só com autorização na janela de implantação:

```sql
CREATE ROLE meutreino_app LOGIN PASSWORD 'substituir';
GRANT USAGE ON SCHEMA meutreino TO meutreino_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA meutreino TO meutreino_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA meutreino TO meutreino_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA meutreino
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO meutreino_app;
```

Não execute esse bloco no desenvolvimento local como parte do Prompt 02. O container local continua com o usuário `meutreino`.

## Backup e rollback

Antes de qualquer migração no servidor futuro:

1. Confirmar database, schema, usuário e endereço com a consulta abaixo.
2. Fazer backup lógico só dos objetos `meutreino` e de `public._prisma_migrations`. Não fazer dump indiscriminado de uma instância compartilhada sem combinar com a HTI.
3. Guardar o backup fora do container.
4. Aplicar `prisma migrate deploy` com a URL do papel de migração.
5. Subir a API com `EXPECTED_DATABASE` e o papel de execução.

```sql
SELECT current_database() AS database_name,
       current_schema() AS schema_name,
       current_user AS connected_user,
       inet_server_addr() AS server_address;
```

Rollback desta migração de schema, se ela ainda não tiver convivido com dados novos de produção: restaurar o backup. Não escrever uma migração destrutiva que mova objetos de volta sem esse backup e sem autorização explícita. `ALTER ... SET SCHEMA public` também exigiria que `public` não estivesse em uso por outro sistema com os mesmos nomes.

## Validação depois da implantação

```sql
SELECT n.nspname, c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND c.relname IN ('users', 'gyms', 'equipment', 'exercises', '_prisma_migrations')
ORDER BY n.nspname, c.relname;
```

O resultado esperado é `meutreino.users`, `meutreino.gyms`, `meutreino.equipment`, `meutreino.exercises` e `public._prisma_migrations`. Não deve existir `public.users`.

A API em produção falha ao iniciar se essa condição não for atendida.

## Storage

`MEDIA_STORAGE=local` grava arquivos em `MEDIA_ROOT` com permissão `0600`. Serve para desenvolvimento. Não é a solução de produção. A interface `ObjectStorage` isola a troca futura para Supabase Storage ou outro armazenamento persistente. Binário de imagem não fica em coluna PostgreSQL.
