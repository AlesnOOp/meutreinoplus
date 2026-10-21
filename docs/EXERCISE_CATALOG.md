# Biblioteca de exercícios

Os exercícios ficam na tabela `exercises`. `origin = system` é a biblioteca geral. `origin = user` é o exercício personalizado, com `owner_user_id`. Não há segunda tabela de exercícios personalizados.

## Conteúdo inicial

A migração `20261020220000_meutreino_schema` insere doze textos originais em português, com UUID fixo de `10000000-0000-4000-8000-000000000001` a `...0012`. Não há imagem, GIF ou vídeo de terceiros. Não há prescrição de carga, séries ou repetições, nem texto clínico.

Cada descrição informa o movimento para organização do treino. As instruções dizem que o aplicativo não define a carga.

Se uma mídia externa for adicionada no futuro, a linha de mídia precisa registrar fonte, autor ou fornecedor, tipo de licença, condições, atribuição e URL original. Sem isso, a mídia não entra.

## Pesquisa

`GET /api/v1/exercises` filtra por nome ou nome alternativo, grupo muscular principal e tipo de equipamento. A resposta é paginada. Exercício de sistema ativo aparece para qualquer usuário autenticado. Exercício personalizado aparece só para o dono. Arquivado some da lista padrão e continua disponível com `includeArchived=true`.

`PATCH` e arquivamento de exercício de sistema respondem 403 `system_exercise`. O mesmo vale para exercício de outra pessoa, que responde 404 quando não é visível.

## Personalizado

`POST /api/v1/exercises` cria `origin = user`. Edição substitui músculos e tipos de equipamento. Grupo principal não se repete entre os secundários. Arquivar não apaga a linha.

O aplicativo mostra biblioteca e exercícios personalizados, com estados vazio, erro e confirmação antes de arquivar.
