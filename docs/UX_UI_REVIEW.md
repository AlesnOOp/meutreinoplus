# MeuTreino+ — revisão de UX/UI

21 de outubro de 2026

A revisão foi aplicada ao aplicativo Expo existente, mantendo a API e o banco atuais. O objetivo é tornar o treino a ação central e tirar da home o menu extenso de administração da conta.

## Direção visual implementada

Violeta como cor de ação, lima no convite para treinar, coral em detalhes, superfícies claras e tema escuro com contraste próprio. Tipografia nativa do iOS, hierarquia de títulos, cartões, ícones vetoriais e estados de interação. Componentes compartilhados de botão, campo, seleção, aviso, carregamento, estado vazio, métricas e progresso.

Navegação principal: Início, Fichas, Treinar, Biblioteca e Você. A barra fica nas telas principais e não compete com o registro de uma série ou a edição de um formulário.

## Revisão por tela e fluxo

| Tela/fluxo | Mudança implementada |
|---|---|
| Boas-vindas | Composição visual própria, uma ação para começar, entrada secundária e consentimentos sociais apenas quando os provedores estão disponíveis. |
| Entrar | Texto curto, campos com foco visível, mostrar/ocultar senha e recuperação como ação secundária. |
| Criar conta | Hierarquia do formulário, orientação da senha junto ao campo e consentimentos com caixas reais de seleção. |
| Recuperar senha | Instrução voltada à pessoa, em vez da explicação técnica de proteção contra enumeração. |
| Confirmar e-mail | Aceita código ou link completo; sucesso tem tela própria e próxima ação. |
| Redefinir senha | Aceita código ou link completo; campos de senha com visibilidade controlada. |
| Confirmar novo e-mail | Recebe o sistema visual compartilhado; preserva a confirmação explícita e o encerramento de sessão. |
| Início | Painel com ação para continuar/iniciar treino, métricas locais reais e acesso às fichas. Conta e diagnóstico foram movidos para Você. |
| Minhas fichas | Cartões com exercícios/séries, cor da ficha, indicação de pendência e estado vazio orientado. |
| Nova/editar ficha | Paleta visual de cores e ação de salvar fixa no rodapé. |
| Detalhes da ficha | Iniciar treino em primeiro plano, métricas e exercícios agrupados; gerenciamento fica recolhido. |
| Ordem dos exercícios | Controles lado a lado, com os movimentos impossíveis desabilitados. |
| Escolher exercício | Busca consistente com a biblioteca e linhas de navegação claras. |
| Configurar exercício e séries | Repetições/carga lado a lado e logo no início; tipo de série, ações adicionais e equipamento/observações ficam em grupos recolhíveis; salvar permanece acessível. |
| Selecionar equipamento | Seleções recebem estados visuais e contraste dos temas. |
| Fichas arquivadas | Mantém recuperação e usa o estado vazio e os cartões das fichas. |
| Treinar | Ação para escolher uma ficha quando não há treino aberto; acesso direto à sessão em andamento e histórico local. |
| Iniciar treino | Seleção de academia recebe o padrão de seleção compartilhado; iniciar tem destaque de ação principal. |
| Sessão em andamento | Cronômetro grande, progresso dos exercícios e estados por exercício em cartões. |
| Registrar séries | Campos essenciais lado a lado; proteção contra toque repetido durante gravação; ações de pular/extra recolhidas. |
| Descanso | Contador destacado e controles existentes preservados. |
| Avaliação por exercício | Escala visual, rótulos acessíveis e separação entre registro de série e feedback opcional. |
| Resumo | Duração e métricas destacadas, com os registros preservados abaixo. |
| Biblioteca | Busca, filtros por todos os grupos/equipamentos em faixas horizontais, limpeza de filtros e cartões com grupo muscular. A digitação deixa de disparar sincronizações repetidas. |
| Novo/editar exercício | Grupos nomeados e seletores, detalhes opcionais recolhidos e salvar fixo. |
| Detalhes do exercício | Tipografia, contraste, avisos e ações recebem o sistema visual comum. |
| Academias | Cartões com localização/preferência e convite útil no estado vazio. |
| Nova/editar academia | Campos organizados, preferência como seleção e salvar fixo. |
| Detalhes da academia | Ações, textos e confirmações recebem o padrão compartilhado. |
| Equipamentos | Cartões com número de máquina; quando fora de uma academia, existe ação para escolher onde cadastrar. |
| Novo/editar equipamento | Campos redesenhados e salvar fixo. |
| Detalhes/foto do equipamento | Seção própria de fotos, nova hierarquia e ações diferenciadas. |
| Você | Novo agrupamento de perfil, academias, equipamentos, segurança, privacidade, suporte e saída. |
| Perfil | Unidades, aparência e opções adicionais em seções; prévia de tema sem salvar a preferência; salvar fixo. |
| Segurança da conta | Alteração de senha/e-mail em grupos separados e recolhíveis; ações de dispositivos em seção própria. |
| Contas vinculadas | Cada método em um cartão, com ações secundárias e instruções compreensíveis. |
| Dispositivos conectados | Cartão por dispositivo e identificação do aparelho atual. |
| Privacidade | Exportação e encerramento de conta em seções distintas. |
| Exclusão de conta | Aviso destrutivo explícito; botão depende da confirmação escrita e da senha. |
| Diagnóstico | Continua disponível em Você/Suporte, fora da experiência principal de treino. |

## Validação

- TypeScript do aplicativo: passou.
- ESLint do aplicativo: passou.
- Testes do aplicativo: 17 passaram (9 testes de política/merge/links e 8 de regressão).
- Exportação web: passou.
- Bundle iOS do Expo Router: gerado com sucesso.
- Inspeção visual no iPhone 16e/iOS 26.3: home, lista/detalhes/configuração de ficha, biblioteca e filtros, academias, Você e perfil.
- Tema escuro conferido no perfil pela prévia; a preferência da conta não foi salva durante a inspeção.

## Limites da validação

A revisão do código cobre os fluxos listados. Não foi executada uma bateria manual completa em todas as rotas, nem um treino completo no aparelho físico após o redesenho. Ainda precisam de homologação: Android, tamanhos máximos de fonte/VoiceOver, fotos/câmera em aparelho, OAuth e o fluxo completo de treino com interrupção e reconexão.

A revisão não inclui a entrega das funcionalidades que já estavam pendentes, como agenda, gráficos, cobrança e envio real de e-mail. As métricas mostradas no painel vêm do histórico disponível no aparelho; não são totais históricos garantidos entre todos os dispositivos.

## Como testar

A instância desta revisão usa `exp://127.0.0.1:8084`, com a API local na porta 3000 e a caixa de e-mails de teste em http://localhost:8025. O Expo está sem monitoramento automático de arquivos por causa do limite de watchers do macOS; mudanças posteriores de código exigem reiniciar o servidor para uma nova compilação confiável.
