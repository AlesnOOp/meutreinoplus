# Recovery 04.1 — Contrato proposto para reconciliação definitiva

**Proposta para aprovação. Não implementada nesta execução.** A entrega atual contém apenas a contenção descrita em `RECOVERY_04_1_REPORT.md`. As decisões abaixo exigem evolução coordenada de contratos, API, persistência e interface; não são promessas de comportamento já disponível.

## Identidades e decisão explícita

Considere a mesma ficha P: versão oficial 1, origens locais A → B (eventualmente D), versão concorrente oficial C/2. O conflito é de A. A/B/D são identidades imutáveis da prescrição, não números oficiais. Uma decisão tem UUID próprio, usuário, aparelho, conflito, escolha, versão C esperada, conjunto de origens afetadas, revisão local capturada, hash do pedido e política explícita para as edições posteriores. Seu recibo registra o resultado exato e permanece imutável.

A interface deve mostrar separadamente a versão conflitante A, a edição posterior B e o servidor C. A decisão sobre A não autoriza automaticamente apagar B ou publicar B sobre C. A prévia apresenta os treinos afetados e os dois caminhos para B: **arquivar a edição local** ou **aplicar depois como nova edição derivada de C**. Sem essa decisão explícita, a reconciliação permanece bloqueada com ação disponível. Não inferir intenção a partir de timestamps.

## keep_server

P continua exatamente C; A não ganha vínculo oficial fictício nem é publicada como ficha viva. A e B permanecem arquivadas como origens locais, com a trilha da decisão. Se o usuário optar por arquivar as edições posteriores, as operações ainda não enviadas ficam `superseded` vinculadas ao recibo da decisão, nunca apagadas. O conteúdo de B permanece intacto e consultável.

Se escolher reaplicar B, criar uma origem **E**, nova operação, nova chave e novo hash. E contém o conteúdo explicitamente selecionado de B, `derivedFromOriginId=B.id` como proveniência, e base oficial C/2. Seu `parentId` operacional é nulo, pois a base é C comprovada. B conserva seu próprio `parentId=A.id`; não se altera seu payload, identidade ou snapshot. Se C avançar, o CAS cria novo conflito explícito de E; não se substitui a versão esperada pela mais recente.

Depois de E confirmado, a ficha viva terá uma revisão posterior a C com conteúdo escolhido pelo usuário. Até lá, a tela diferencia C oficial, E pendente e B arquivada. Um treino que usou B nunca é relabelado como E só porque as prescrições coincidem.

## keep_both

P continua C, e o servidor cria outra ficha Q com o conteúdo **A** mostrado na prévia, com novos IDs para ficha/exercícios/séries. O recibo inclui os mapas de identidade e a revisão oficial de Q. Repetir a decisão retorna a mesma Q, sem duplicação. Não publicar A em P: `keep_both` não pode executar `keep_local` disfarçado.

B continua origem histórica de P e não é alterada. O usuário pode arquivá-la ou criar uma nova edição E sobre Q, selecionando esse destino expressamente. E tem novos IDs remapeados, proveniência B e base oficial da revisão Q devolvida pelo recibo. A origem B e suas operações continuam intactas. Se também desejar reaplicar B sobre P, isso constitui outra ação explícita e outra operação sobre C, nunca um efeito oculto de guardar duas fichas.

## Treinos dependentes de A ou B

Um treino permanece ligado à origem usada no início. Ele não pode ser migrado para C, E ou Q por mera equivalência de conteúdo ou mudança de IDs. Origem já vinculada a uma revisão oficial mantém seu vínculo existente. Quando o vínculo oficial está ausente, a reconciliação definitiva precisa de materialização histórica **real no servidor**, separada da ficha viva.

Proposta: introduzir revisões históricas por UUID, com proprietário, ficha original P, origem, snapshot canônico, evidências de origem, hash e instante de importação, sem número oficial vivo inventado. O servidor valida a estrutura, referências, isolamento e imutabilidade e devolve recibo. Essa importação deve ser identificada como histórico importado, sem alegar publicação anterior nem alterar a revisão viva C. O contrato de sessão ganha referência discriminada `{kind: 'historical', revisionId}` mantendo compatibilidade com `{kind: 'version', planId, version}` existente. O snapshot A/B e as identidades do treino são preservados; a nova referência só é gravada após recibo oficial comprovado.

Isso exige desenho e aprovação de schema/guard/API/privacidade antes de implementação. Enquanto essa materialização não existir, `keep_server` e `keep_both` com treinos dependentes não publicados continuam bloqueados com a alternativa `keep_local`. Não limpar pendência de treino nem declarar sucesso de reconciliação incompleta.

## Operações já enviadas

Consultar recibos por chave original antes de decidir o destino de uma operação tentada. Se aceita, preservar o vínculo oficial exato, mesmo que a ficha viva tenha avançado. Se em conflito/rejeitada, preservar recibo e conteúdo original; a nova decisão apenas referencia esse resultado. Se o estado remoto for desconhecido, a decisão fica em verificação e o usuário retoma a mesma tentativa. Nunca reutilizar a chave de B para E, alterar o corpo/hash/base de B ou atribuir a B o resultado de outra origem.

Operações `pending` nunca tentadas, `in_flight`, `error`, `done` e `superseded` entram na análise. Ausência de recibo durante uma requisição em trânsito não prova rejeição: o protocolo definitivo deve oferecer fechamento/cancelamento idempotente da intenção original, ordenado no servidor com sua aplicação. Só depois desse fechamento pode marcar uma operação tentada como substituída. Não publicar E enquanto B ainda puder ser aceita sem decisão coordenada.

## Atomicidade, recuperação e convergência

1. SQLite exclusivo: capturar cadeia e revisão local, persistir pedido e hash imutáveis; bloquear novas dependências incompatíveis. Não manter transação SQLite aberta durante HTTP.
2. Servidor: CAS sobre C esperada e reivindicação da decisão; na mesma transação, criar ficha Q se aplicável, materializações históricas aprovadas, fechamento das operações antigas e recibo completo. Sem sucesso parcial.
3. SQLite exclusivo: aplicar o recibo exato, vínculos reais, arquivo lógico das operações, proveniência, E opcional e sua nova fila. Falha local reverte toda essa etapa; a intenção continua recuperável.
4. Após encerramento ou timeout, consultar/repetir a mesma decisão pelo UUID/hash. Não trocar escolha enquanto o resultado for desconhecido. Somente uma decisão confirmada libera ações incompatíveis.
5. Concorrência gera prévia atualizada e ação explícita; nenhuma troca silenciosa de base. Corrupção de origem ausente solicita recuperação assistida com backup preservado. O app deve distinguir espera de rede, autenticação, conflito novo e inconsistência local.

Critério de sucesso: toda operação ativa tem dependência oficial comprovada ou predecessora ativa alcançável; toda operação suspensa tem motivo e ação; nenhum treino perde sua origem. Rejeitar a reconciliação atomicamente se esse invariante não puder ser assegurado. Testar fechamento de operações concorrentes, importação histórica, reaplicação E, mapas de Q, perda de ACK em cada etapa, reinício e repetição antes de liberar a solução definitiva.
