# Academias e equipamentos

Cada pessoa cadastra as próprias academias. Não há catálogo público nem geolocalização obrigatória.

## Academia

Campos: UUID, dono, nome, apelido, unidade, cidade, observações, status `active` ou `archived`, preferencial, versão, criação e atualização.

Regras:

- Várias academias por usuário.
- No máximo uma preferencial ativa. A troca desmarca as outras na mesma transação e o índice `gyms_one_preferred_per_owner` impede duas ativas.
- Arquivar marca `archived` e tira a preferência. Equipamentos e vínculos permanecem.
- Outro usuário recebe 404. O corpo não envia `userId` como prova de dono.

## Equipamento

O equipamento pertence a uma academia e ao usuário dono dessa academia. Nome obrigatório. Número, apelido, observações e foto são opcionais. O número não é único nem global: a mesma identificação pode existir em outra academia, e a máquina pode não ter número.

A associação com exercícios é muitos para muitos, no contexto da academia do equipamento. Arquivar não apaga os vínculos.

## Fotos

O aplicativo permite escolher da biblioteca ou usar a câmera, quando o sistema autorizar. A captura pede JPEG com qualidade 0.7, o que comprime o arquivo na origem. PNG e WebP também são aceitos. Acima de 5 MB a imagem é recusada. A API confere o tipo declarado e os bytes iniciais do arquivo.

O arquivo fica fora do PostgreSQL, na chave `{userId}/equipment/{assetId}`. A linha em `media_assets` usa `kind = equipment_photo`. Substituir cria outro arquivo e marca o anterior como removido. Outro usuário não baixa a foto: a leitura passa pela academia e pelo equipamento que ele possui.

`MEDIA_STORAGE=local` é só desenvolvimento. Produção deve trocar a implementação de `ObjectStorage`. O limite da API é 5 MB para caber no corpo JSON. A checagem antiga do banco ainda permite até 15 MB; a API é o limite efetivo.

## API

Rotas autenticadas em `/api/v1`:

- `GET|POST /gyms`, `GET|PATCH /gyms/:gymId`, `POST /gyms/:gymId/archive`
- `GET|POST /gyms/:gymId/equipment`
- `GET|PATCH /gyms/:gymId/equipment/:equipmentId`
- `POST .../archive`
- `POST|GET|DELETE .../photo`

Listas usam `page` e `pageSize` até 50.
