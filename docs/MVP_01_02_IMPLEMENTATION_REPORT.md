# MeuTreino+ — MVP 01 + MVP 02: relatório de implementação

Data: 22/10/2026. Implementação local, sem commit, push, deploy, migrações ou acesso à VPS/bancos compartilhados. A integração audiovisual foi suspensa por ausência de fornecedor/licença comprovados, conforme o limite aprovado no pedido.

## 1. Base e preservação do trabalho anterior

Branch inicial/final: `main`. HEAD inicial/final: `cd95a0dbc4d1c887a9265161fe3a2b90c621e023`.

O estado inicial já continha:

```text
 M apps/api/test/recovery04.security-spec.ts
 M apps/mobile/src/plans/plan-store.ts
 M apps/mobile/test/plan-reconciliation.test.cjs
?? docs/RECOVERY_04_2_CORRECAO_ACK_Q.md
?? docs/MVP_FUNCTIONAL_INVENTORY.md
?? docs/MVP_GAP_ANALYSIS.md
?? docs/MVP_DEMO_ROADMAP.md
```

Os sete arquivos acima foram preservados byte a byte, com comparação SHA-256 antes/depois. Não houve edição, formatação, staging ou commit desses arquivos. Os componentes novos apenas chamam as funções públicas existentes de sincronização; não alteram implementação de reconciliação, payloads, chaves idempotentes, snapshots, revisões ou guard de sessões. A pausa e a revisão independente pendente do Recovery 04.2 permanecem válidas.

Foram lidos os três documentos de MVP e rastreados os módulos de identidade, catálogo, SQLite, HTTP, fotografia, schema e documentação de conteúdo antes da implementação.

## 2. MVP 01 — Primeiro acesso e retomada

- Cadastro, confirmação, login, rotação e logout existentes foram reutilizados, sem alterar contratos de autenticação.
- A tela de confirmação inicia um novo formulário quando chega outro link, inclusive com a rota já montada. O usuário confirma pelo link/código recebido por e-mail; não há consulta a SQL/outbox no fluxo normal.
- `index.tsx` encaminha para `/home` quando há identidade offline cacheada admitida pelo store.
- O layout privado deixa de ficar indefinidamente carregando no estado offline sem conta: retorna à entrada. Não admite conta ausente.
- A política de cache exige refresh token existente, identificação anterior no SecureStore, conta cacheada com o mesmo ID, status active e falha de rede/servidor transitória. Erros de autorização/validação e dados sem prova anterior não habilitam acesso offline.
- O indicador global distingue conta com última sessão validada, modo offline e pendências locais. Atualiza contagem a cada cinco segundos e no foreground. Oferece reconectar/sincronizar usando os stores existentes e não continua sob outra identidade após bootstrap.
- A contagem de pendências inclui fotos: sair com foto ainda não enviada passa pela confirmação de descarte já existente, em vez de perder a pendência por ela estar fora da sync_queue geral.

Refresh tokens permanecem no SecureStore e access tokens em memória, conforme a implementação anterior. Não foi criado armazenamento alternativo de segredos. Revogação remota é reconhecida quando há contato com a API; não se afirma detectar uma revogação nova sem rede.

**Comprovado automaticamente:** HTTP de cadastro → mensagem por SMTP local real → confirmação → login → refresh → consulta da conta → logout → rejeição do refresh revogado. Teste do store de produção com SQLite em arquivo cobre conta inexistente, cache de outra identidade, reinício offline, retorno online, logout com foto pendente e reabertura após desconexão.

**Ainda não homologado:** recebimento em provedor externo de e-mail, deep link no iPhone, SecureStore físico e navegação visual completa. O receptor SMTP de teste é local e descartável; não é homologação de entregabilidade externa.

## 3. MVP 02 — Fotografia

### Captura e experiência

Permissões agora descrevem perfil e equipamentos corretamente. Negação gera explicação; quando o sistema não pode perguntar novamente, a tela oferece Abrir configurações. Ao retornar dos Ajustes, o próximo pedido reconsulta a permissão, sem presumir concessão. Busy/cancelamento/erros deixam o fluxo recuperável.

O payload é base64, não URI temporária. Seu formato é identificado pelos bytes, pois o contrato instalado de `expo-image-picker` documenta que base64 pode representar JPEG enquanto mimeType descreve o arquivo original. São aceitos JPEG/PNG/WebP; arquivo em outro formato só entra se o picker efetivamente o converter para um dos formatos aceitos. Não foi criado conversor HEIC próprio.

Há validação de base64, tamanho máximo de 5 MB e dimensões máximas de 25 megapixels. `Image.getSize` verifica decodificação pelo mecanismo nativo antes de salvar, e o preview trata falha de exibição. Isso é código implementado, não prova de execução em aparelho.

### Persistência e fila

A foto é gravada no SQLite **antes** da chamada HTTP. O sync publica metadados pelo caminho existente antes de tentar enviar a foto de equipamento recém-criado. Falha HTTP preserva bytes e photo_pending; a tela distingue salvo localmente de enviado ao servidor.

ACK de upload só limpa a pendência se os bytes, tipo e estado ainda corresponderem ao envio confirmado. Um novo arquivo ou exclusão durante o envio não é apagado pelo ACK antigo. Download não sobrescreve foto local pendente. Exclusão vira pendência durável mesmo após perda de ACK de upload, pois pode já existir cópia remota. Ausência do equipamento no snapshot remoto não apaga uma foto ainda pendente.

Após operações de foto, o snapshot atualiza a versão do equipamento, que a API incrementa; isso evita continuar usando a versão anterior ao upload na próxima edição de metadados. Nenhuma chave/payload de operações genéricas já tentadas foi modificada.

### API e armazenamento privado

`sharp` foi adicionado **após autorização expressa do usuário**, com download de dependência autorizado. Versão resolvida: 0.35.5, libvips 8.18.7, testada no host local. Instalação com scripts desativados e cache temporário; nenhuma outra dependência existente foi atualizada no lockfile. As novas entradas de plataforma são da árvore sharp/libvips.

A API confere base64/tamanho e assinatura do formato permitido, lê metadados, verifica MIME real, limite de pixels e multiplicidade de páginas, e executa `stats()` para decodificar a imagem. Não considera apenas metadata() como prova de decodificação. Arquivo truncado ou assinatura isolada é recusado. Há limite de duas validações simultâneas; excesso retorna 429 recuperável, mantendo a foto local.

Uploads/exclusões são serializados por row lock do equipamento em `meutreino.equipment`, com propriedade revalidada na transação. Repetição dos mesmos bytes/tipo da foto atual é no-op: não cria outro MediaAsset nem incrementa novamente a versão. Isso recupera a perda de ACK consecutiva sem um novo contrato HTTP ou migração.

O armazenamento privado local, endpoints e checagens de propriedade anteriores foram reutilizados. O teste HTTP confirma bytes baixados e impede leitura/escrita por outro usuário. Exercícios associados ao equipamento permanecem intactos.

**Limite da deduplicação:** é por igualdade com a foto atual, não um recibo histórico permanente para qualquer upload antigo. Não introduz CAS entre fotos de dispositivos diferentes; uma nova substituição continua tendo a semântica existente de substituição. Não afirmar resolução distribuída de fotos fora de ordem.

## 4. Biblioteca audiovisual — decisão pendente

Busca em código, docs e configurações rastreadas não identificou fornecedor/API previamente escolhido ou contrato comercial. Não foram utilizadas chaves privadas nem baixadas imagens externas.

Evidências documentais:

- `docs/EXERCISE_CATALOG.md`: conteúdo inicial são 12 textos próprios, sem mídia de terceiros; mídia futura exige fonte, fornecedor/autor, licença, condições, atribuição e URL.
- `docs/PRODUCT_SCOPE.md`: referências de sistema precisam ser licenciadas.
- `docs/DATA_MODEL.md`: separação entre referência licenciada de sistema e conteúdo do usuário.
- Prisma possui visualAssetId/kind, mas não entrega ao app um descritor audiovisual completo nem contém os campos documentais de licença/atribuição no MediaAsset atual.

| Informação obrigatória                    | Resultado                                |
| ----------------------------------------- | ---------------------------------------- |
| Fornecedor, endpoint e versão             | Não definidos nas evidências encontradas |
| Autenticação, credenciais e limites       | Não comprovados                          |
| Licença comercial para imagem/vídeo       | Não apresentada                          |
| Armazenamento/cache, TTL e redistribuição | Não autorizados documentalmente          |
| Idiomas, formatos e qualidade             | Dependem do fornecedor aprovado          |
| Correspondência de IDs internos/externos  | Não existe mapeamento implementado       |
| Offline, expiração e atribuição           | Dependem do contrato; não simulados      |

**Decisão solicitada:** informar o fornecedor previamente escolhido e fornecer contrato/licença ou termos aplicáveis, plano de acesso e direitos de cache. Não é necessário enviar segredo privado pelo chat. A alternativa é aprovar conteúdo próprio encomendado com direitos explícitos; isso seria outra decisão de conteúdo, não uma troca silenciosa de API. Recomenda-se primeiro recuperar a escolha e os direitos já negociados.

**Contrato técnico proposto, ainda não implementado:** adapter isolado no backend; credencial somente no servidor; mapeamento explícito entre exercício interno estável e ID externo; descritor de mídia com fonte, licença, crédito, idioma, formato e política de expiração. Cache de arquivos limitado em disco, com quota/TTL derivados da licença; sem vídeos grandes em SQLite. Tela de detalhe e seleção contextual consomem o mesmo descritor; ausência de mídia/rede não bloqueia o texto. Se necessário, propor migração de mapeamento/licença antes de implementá-la, somente no schema meutreino e snake_case. Não renomear exercícios nem substituir IDs existentes.

Não foram implementados adapter, player, cache audiovisual, mapeamento fictício ou testes com fornecedor inventado. Os testes de mapeamento/HTTP/cache/atribuição dessa integração permanecem bloqueados pela decisão, não “aprovados por mocks”.

## 5. Contratos e migrações

Nenhuma migração criada/aplicada, nenhuma tabela alterada, nenhum objeto criado em public. Reutilizados photo_pending/base64/tipo do SQLite e MediaAsset/equipment existentes. Nenhuma alteração em contratos compartilhados de identidade, conflitos, reconciliação ou sessão. O novo campo photoPending é uma projeção local para a UI; não muda o contrato remoto.

A API de upload mantém o mesmo corpo e status de sucesso, com validação de conteúdo mais rigorosa; clientes que enviam arquivos inválidos antes tolerados agora recebem invalid_photo. Fotos grandes/demasiados pixels e validações concorrentes excedentes têm erro explícito. Nenhuma dependência de Supabase foi presumida.

## 6. Testes e verificações

| Grupo                                  | Resultado                 | Evidência e limite                                                                                             |
| -------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Contratos/projeções shared             | 70 aprovados              | Vitest, configuração temporária explicitando tsconfig do shared                                                |
| Unidade API                            | 22 aprovados              | Inclui 6 casos de decodificação real: JPEG/PNG/WebP, dados inválidos/truncados/MIME/limites                    |
| Mobile TypeScript                      | 10 aprovados              | Políticas de sessão, merge e confirmação                                                                       |
| Mobile CJS                             | 123 aprovados             | SQLite real em arquivo; inclui 8 regressões novas de fotografia/bootstrap; ponte Expo e transporte controlados |
| Segurança/Recoveries HTTP + PostgreSQL | 89 aprovados              | Três suítes security, incluindo o trabalho pendente preservado do Recovery 04.2                                |
| E2E HTTP de produto + SMTP             | 20 aprovados, 3 excluídos | Cinco suítes auth/catalog/plans/sessions/mvp-access; SMTP é protocolo real local                               |
| Typecheck, lint, build                 | Aprovados                 | Build API/shared e export web; não build/homologação nativa                                                    |

Total de casos distintos aprovados: **334**; repetições de suítes durante a correção não foram somadas novamente.

O comando agregado `npm test` encontrou uma falha de configuração preexistente: Vite/OXC tentou resolver expo/tsconfig.base durante a coleta dos testes shared. Os 70 testes passaram com `/tmp/mt-mvp-vitest.config.mjs`, oxc.tsconfig apontando explicitamente para packages/shared/tsconfig.json, sem editar testes/configuração de produção. API e mobile foram executados separadamente. Não declarar o script agregado original aprovado.

Uma repetição das suítes de segurança coincidiu com a regeneração do Prisma e falhou na coleta por arquivo gerado momentaneamente ausente. A geração foi encerrada e as suítes repetidas sequencialmente; não houve mudança nos testes para contornar a coleta.

Os três E2E históricos excluídos verificam população anterior em plans/sessions e nome fixo de database meutreino no catálogo, incompatíveis com o database descartável utilizado. O filtro exclui somente esses casos; nenhum teste foi modificado para escondê-los. A fixture antiga de foto com oito bytes foi substituída por PNG completo, e a resposta binária é comparada integralmente.

Ambiente PostgreSQL: container local mt-recovery01-postgres, etiqueta recovery01-disposable, armazenamento tmpfs, endpoint 127.0.0.1:55439 e database mt_recovery01_test_verified, cuja finalidade foi verificada. Media/exports/cache temporários em /tmp. Testes de segurança criam/removem suas sondas transacionais somente nesse ambiente isolado, não em produção.

Nenhum teste automatizado comprova câmera física, permissão do sistema, renderização do iPhone ou suspensão pelo iOS. Os testes de permissão cobrem a política de decisão usada pela tela, não o diálogo nativo.

## 7. Critérios de aceite observados

| Critério                                      | Situação                                                            |
| --------------------------------------------- | ------------------------------------------------------------------- |
| Criar conta, confirmar e entrar               | Comprovado HTTP/SMTP local; aparelho/correio externo pendentes      |
| Reabrir offline com identidade/cache anterior | Implementado e testado no store/SQLite; navegação nativa pendente   |
| Cadastrar academia/equipamento                | Reutilizado e coberto por E2E existentes                            |
| Fotografar e visualizar                       | Captura e validação conectadas; homologação física pendente         |
| Preservar foto e reenviar após ACK perdido    | Comprovado SQLite e deduplicação consecutiva PostgreSQL/HTTP        |
| Encontrar exercício no catálogo               | Fluxo existente preservado e testado                                |
| Referência audiovisual licenciada             | BLOQUEADO: fornecedor/licença/cache sem evidências                  |
| Associar equipamento ao exercício             | Fluxo existente preservado; vínculo coberto por HTTP e SQLite       |
| Usar exercício em ficha                       | Fluxo existente preservado; regressões de fichas/sessões executadas |

## 8. Homologação no iPhone

1. Usar ambiente de demonstração isolado com API alcançável pelo aparelho, correio de teste acessível normalmente e armazenamento privado persistente. Em iPhone físico, localhost aponta para o próprio aparelho; usar endereço local alcançável e configuração autorizada. Não publicar credenciais privadas no app.
2. Recompilar/reinstalar o aplicativo com as novas mensagens do plugin de permissões. Alterar app.json não atualiza sozinho os textos de um binário já instalado. Nenhuma compilação/instalação nativa foi executada nesta entrega.
3. Cadastrar pela UI, abrir o e-mail recebido e confirmar. Repetir com a tela de confirmação já aberta. Entrar, configurar perfil e fechar/reabrir online.
4. Sem rede, encerrar/reabrir e acessar home/dados cacheados. Em instalação sem login e depois de logout, verificar ausência de acesso privado. Reconectar e verificar rejeição de sessão revogada.
5. Criar academia/equipamento e associar exercício. Negar câmera, tentar novamente, abrir Ajustes e conceder; retornar e fotografar. Simulador não comprova câmera física.
6. Testar JPEG/PNG/WebP, imagem inválida, maior que 5 MB e dimensões acima do limite. Confirmar mensagem recuperável. Verificar preview e retorno após cancelamento do picker.
7. Capturar sem rede, encerrar/reabrir, conferir foto e pendência; reconectar e usar Sincronizar. Interromper resposta de upload em ambiente controlado, repetir e confirmar ausência de duplicação consecutiva e manutenção de edição posterior.
8. Em outra conta, confirmar ausência de acesso à imagem/equipamento. Reabrir os dados da conta original. Conferir associação e uso do exercício na ficha.
9. Registrar modelo/OS/versão/build, resultado por passo e evidência visual. Avaliar espaço ocupado pelo indicador global, teclado, fonte ampliada e leitor de tela. Não anunciar biblioteca audiovisual como entregue.

## 9. Riscos residuais e limites

- Biblioteca audiovisual depende de decisão/licença; é o único bloco de implementação deliberadamente suspenso por esse motivo.
- Homologação nativa e entregabilidade externa não realizadas; aprovação automática não equivale a produto demonstrado em iPhone.
- Arquivos privados dependem de volume persistente da API. PostgreSQL e filesystem não têm commit atômico comum: encerramento abrupto entre escrita/commit/limpeza pode deixar arquivo órfão. Não foi criado job de expurgo nesta entrega.
- Fotos entre dispositivos conservam a semântica de substituição existente, sem um novo protocolo de resolução de conflitos ou recibo histórico. A deduplicação testada é da imagem atual repetida.
- Foto pendente de equipamento removido remotamente é preservada e retorna erro; recuperação de vínculo exige decisão do usuário, não recriação silenciosa de identidade.
- Não há novo serviço de sincronização em background. Há indicador e ação explícita usando stores existentes; a atualização de conectividade da sessão mantém o bootstrap anterior.
- sharp/libvips foi executado no macOS local. Compatibilidade de empacotamento em outro host deve ser validada naquele ambiente antes de distribuir a API. npm emitiu avisos de engine de dependências Angular DevKit preexistentes com Node 24.13.1; não houve atualização dessas dependências.
- Valores originais da imagem são preservados; não foi implementada uma política nova de remoção de EXIF. Resumo histórico completo/evolução pertencem a outras entregas, não foram adicionados aqui.
- A revisão independente pendente do Recovery 04.2 continua pendente. Esta entrega não declara prontidão de produção nem autorização de commit.

## 10. Arquivos e verificação final

A lista e o estado Git abaixo são gerados após as verificações, distinguindo os arquivos anteriores preservados dos arquivos desta entrega.

Arquivos desta implementação (22, incluindo este relatório):

- `apps/api/package.json`
- `apps/api/src/catalog/catalog.service.ts`
- `apps/api/src/catalog/images.spec.ts`
- `apps/api/src/catalog/images.ts`
- `apps/api/test/catalog.e2e-spec.ts`
- `apps/api/test/mvp-access.e2e-spec.ts`
- `apps/mobile/app.json`
- `apps/mobile/src/app/(private)/_layout.tsx`
- `apps/mobile/src/app/index.tsx`
- `apps/mobile/src/app/verify-email.tsx`
- `apps/mobile/src/catalog/catalog-store.ts`
- `apps/mobile/src/catalog/equipment-screens.tsx`
- `apps/mobile/src/catalog/photo-policy.ts`
- `apps/mobile/src/session/connection-status.tsx`
- `apps/mobile/src/session/session-policy.test.ts`
- `apps/mobile/src/session/session-policy.ts`
- `apps/mobile/src/session/session-store.ts`
- `apps/mobile/test/mvp-bootstrap.test.cjs`
- `apps/mobile/test/mvp-photo.test.cjs`
- `apps/mobile/test/support/sqlite-harness.cjs`
- `docs/MVP_01_02_IMPLEMENTATION_REPORT.md`
- `package-lock.json`

Estado Git final (árvore propositalmente suja; trabalho anterior e MVP sem commit):

```text
 M apps/api/package.json
 M apps/api/src/catalog/catalog.service.ts
 M apps/api/src/catalog/images.ts
 M apps/api/test/catalog.e2e-spec.ts
 M apps/api/test/recovery04.security-spec.ts
 M apps/mobile/app.json
 M apps/mobile/src/app/(private)/_layout.tsx
 M apps/mobile/src/app/index.tsx
 M apps/mobile/src/app/verify-email.tsx
 M apps/mobile/src/catalog/catalog-store.ts
 M apps/mobile/src/catalog/equipment-screens.tsx
 M apps/mobile/src/plans/plan-store.ts
 M apps/mobile/src/session/session-policy.test.ts
 M apps/mobile/src/session/session-policy.ts
 M apps/mobile/src/session/session-store.ts
 M apps/mobile/test/plan-reconciliation.test.cjs
 M apps/mobile/test/support/sqlite-harness.cjs
 M package-lock.json
?? apps/api/src/catalog/images.spec.ts
?? apps/api/test/mvp-access.e2e-spec.ts
?? apps/mobile/src/catalog/photo-policy.ts
?? apps/mobile/src/session/connection-status.tsx
?? apps/mobile/test/mvp-bootstrap.test.cjs
?? apps/mobile/test/mvp-photo.test.cjs
?? docs/MVP_01_02_IMPLEMENTATION_REPORT.md
?? docs/MVP_DEMO_ROADMAP.md
?? docs/MVP_FUNCTIONAL_INVENTORY.md
?? docs/MVP_GAP_ANALYSIS.md
?? docs/RECOVERY_04_2_CORRECAO_ACK_Q.md
```

HEAD e branch inalterados. Arquivos anteriores conferidos por SHA-256; git diff --check aprovado. Sem staging, commit, push, deploy ou migrações. Nenhum arquivo temporário de teste adicionado ao repositório; sondas/configurações/logs ficam em /tmp. Manifesto e lockfile alterados exclusivamente para sharp e sua árvore. Verificação por padrões usuais de chave privada/token no conjunto desta entrega não encontrou credenciais; os valores SMTP de testes são fictícios/locais.
