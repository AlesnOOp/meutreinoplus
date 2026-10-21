# Validação do Prompt 03

Data da execução local: 20 de outubro de 2026. Nenhuma migração foi enviada para `arbitro.hti.com.br`. Nenhum aplicativo foi publicado. Nenhuma ficha foi criada por prescrição automática.

## Ambiente efetivo

| Item               | Valor verificado                                                          |
| ------------------ | ------------------------------------------------------------------------- |
| Database           | `meutreino`                                                               |
| Schema de negócio  | `meutreino`                                                               |
| Usuário            | `meutreino`                                                               |
| Servidor           | `172.20.0.2` (PostgreSQL local no Docker, não a VPS)                      |
| Antes da migração  | 57 usuários, 12 exercícios, 0 fichas, 0 sessões                           |
| Depois da migração | 57 usuários, 12 exercícios, tabelas novas só em `meutreino`               |
| Migrações          | `20261020233000_workout_plan_structure` e `20261020234000_load_pound_cap` |

`public.workout_plans` não existe. `public._prisma_migrations` continua sendo a exceção do Prisma.

## Testes executados

- Prettier: `npm run format:check` passou.
- ESLint dos três workspaces: passou.
- Typecheck da API e do aplicativo: passou.
- Vitest compartilhado: 8 arquivos, 42 testes.
- Jest unitário da API: 8 suítes, 16 testes.
- Testes do aplicativo (`node:test`): 5 testes.
- E2E contra o PostgreSQL local: 4 suítes, 20 testes. Inclui saúde, identidade, catálogo e fichas.
- `nest build` passou. `expo export --platform web` gerou `apps/mobile/dist`, inclusive as rotas de fichas.

## O que o teste de API cobriu

O arquivo `apps/api/test/plans.e2e-spec.ts` fala com a API e com o PostgreSQL local. Passou em 7 testes:

- Criar, editar, duplicar, arquivar e restaurar ficha.
- Incluir o mesmo exercício duas vezes, reordenar, remover e substituir preservando ou redefinindo séries.
- Séries com cargas diferentes, duplicação de série, `100 lb` lido de volta como `100.00 lb` e gravado como `45.36 kg`, carga nula gravada como nula, repetição negativa rejeitada.
- Máquina 32 na Academia Centro e máquina 08 na Academia Shopping no mesmo exercício. Arquivar a máquina 32 mantém a ficha e marca o equipamento como arquivado.
- Outro usuário recebe 404. Versão antiga recebe 409 e a revisão anterior permanece.
- Sincronização divergente guarda o conflito, repetir a operação continua em conflito, `keep_both` cria a segunda ficha, `keep_local` gera revisão nova sem apagar a revisão do servidor, e uma criação repetida com a mesma chave fica em uma única ficha.

A suíte anterior de saúde, identidade e catálogo foi executada de novo depois desta etapa.

## O que não foi executado em aparelho

As telas de fichas foram compiladas no export web. Não houve toque em simulador, navegador ou aparelho físico. Fechar o aplicativo e reabrir não foi observado em dispositivo. O caminho de persistência local existe: a tela grava a ficha no SQLite antes da fila, e a API devolve a mesma árvore depois da sincronização. Isso não substitui a prova de fechar e abrir o app.

## Prontidão do Prompt 04

A ficha, as séries, a carga e o equipamento preferencial persistem no PostgreSQL e têm contrato de versão. A execução da sessão ainda não existe. O Prompt 04 pode usar `plan_version` e a revisão correspondente, desde que não leia a ficha viva como se fosse o treino já feito.
