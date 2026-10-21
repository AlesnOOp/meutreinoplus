# Ciclo da conta

## Criação

O cadastro grava usuário, perfil, identidade `email`, consentimentos `terms_of_use` e `privacy_policy` na versão `2026-10-20`, e um token de verificação. O e-mail de desenvolvimento sai pelo Mailpit em `http://localhost:8025` quando `EMAIL_DELIVERY=smtp` e o SMTP aponta para `127.0.0.1:1025`. Sem SMTP explícito de produção, não há envio para um provedor real: o padrão local é o Mailpit. `EMAIL_DELIVERY=capture` guarda a mensagem só no processo, usado pelos testes.

O link usa `APP_LINK_BASE`, por padrão `meutreino://`. Confirmação: `meutreino://verify-email?token=`. Recuperação: `meutreino://reset-password?token=`. Troca de e-mail: `meutreino://confirm-email?token=`.

## Perfil

Nome, foto opcional, e-mail, idioma fixo `pt-BR`, peso `kg` ou `lb`, distância `km` ou `mi`, tema, fuso e preferência de e-mail de produto. O sistema de unidades antigo acompanha a unidade de peso. Não há peso corporal, altura, idade, sexo nem dado clínico.

A foto é JPEG, PNG ou WebP, conferida pelos bytes iniciais, até 5 MB. O arquivo fica em `MEDIA_ROOT` (`var/media` por padrão), fora da URL pública. Leitura e exclusão exigem a sessão do dono.

## Exportação

`POST /api/v1/me/export` gera na hora um JSON com a conta, os consentimentos, os metadados das sessões e os metadados da foto. Não inclui hash de senha nem token. O arquivo fica em `EXPORT_ROOT`, modo `0600`, por 7 dias. O download exige a sessão do dono. Outro usuário recebe 404. Arquivo vencido responde `410 export_expired`.

## Exclusão

A exclusão é imediata. Não há janela de 30 dias nem botão que só registra intenção. O pedido exige reautenticação e o texto `EXCLUIR MINHA CONTA`. A API tenta avisar por e-mail e, em seguida, apaga os dados pessoais que já existem:

- treinos, fichas, agenda, equipamentos, academias, vínculos profissionais e permissões;
- sessões, dispositivos, tokens, identidades, consentimentos, exportações, perfil e mídia;
- e-mail, hash de senha e verificação.

O usuário permanece com `status = deleted`, sem e-mail e sem senha, para a chave interna não ser reutilizada. Sessões são apagadas nessa transação.

Exceções que ficam:

- `billing_retention_records` copia o provedor e o identificador original da transação da loja, com o UUID interno, por 5 anos e sem e-mail. Não há assinatura nesta etapa, então a tabela só recebe linha quando uma assinatura já existir.
- `audit_logs` permanecem com o ator desligado.
- `security_audit_events` permanecem com `user_id` nulo. O evento `account_deleted` guarda o SHA-256 do UUID interno, não o e-mail.
- Exercício do usuário citado por outra pessoa é anonimizado para "Exercício removido" em vez de apagado.

Os consentimentos são apagados com a conta. Se uma revisão jurídica exigir guardar a prova de aceite, isso ainda não está implementado.

Arquivos de foto e de exportação são removidos depois do commit. O aplicativo também apaga o SQLite daquele usuário e o refresh token.

A tela de exclusão existe dentro da conta autenticada, que é o caminho pedido pela App Store e pela Play Console para exclusão de conta. A URL pública de exclusão fora do app ainda não existe.
