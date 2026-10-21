# Versionamento das fichas

Cada alteração confirmada aumenta `workout_plans.version` e grava uma linha em `workout_plan_revisions`. A linha contém a fotografia JSON da ficha naquela versão. Um gatilho `BEFORE UPDATE OR DELETE` recusa mudar ou apagar revisão. A exclusão da conta desliga esse gatilho só dentro da transação de purge, junto com as outras tabelas append-only, e apaga as revisões com a conta.

A ficha viva é a versão atual. Uma revisão antiga não é reescrita quando o aluno muda séries, ordem, equipamento ou nome. Remover um exercício da ficha atual apenas o desativa (`active = false`). A revisão anterior continua com a configuração daquele momento. Séries executadas, quando existirem, não apontam para a linha viva da série planejada.

## Sessão futura

`workout_sessions.plan_version` é obrigatório quando `workout_plan_id` está preenchido. Não há endpoint de execução nesta etapa. Quando a execução for implementada, o início da sessão deve gravar a versão corrente e ler a revisão correspondente. A tela histórica não pode ler a ficha viva.

## Concorrência

Toda mutação REST envia `baseVersion`. Se a versão no servidor for outra, a resposta é 409 `version_mismatch` e nada é gravado.

Na fila offline, o mesmo desencontro devolve `conflict` e guarda o payload em `workout_plan_conflicts`, com a mesma chave da operação. Repetir a operação não aplica por cima e não apaga a cópia. A resolução explícita tem três caminhos:

- `keep_server`: a ficha viva permanece. O aparelho passa a exibir essa versão.
- `keep_local`: o aluno pede para aplicar a cópia do aparelho. Ela vira uma revisão nova. As revisões anteriores ficam intactas.
- `keep_both`: o servidor cria outra ficha, com novos identificadores, e a original não muda.

Não existe um único botão de descarte irreversível da cópia local. Enquanto não houver rede, o aparelho mantém a ficha e adia a escolha.

O catálogo de academias e equipamentos continua com a resolução anterior. Esta política vale para fichas.
