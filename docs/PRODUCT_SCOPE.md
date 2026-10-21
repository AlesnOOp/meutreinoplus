# Escopo do produto — MeuTreino+ 1.0

**Nome:** MeuTreino+  
**Slogan:** Seu treino. Seu ritmo. Sua evolução.  
**Plataformas:** iOS e Android  
**Idioma da interface:** português brasileiro  
**Modelo:** assinatura mensal e anual, com 30 dias de teste oferecido pelas lojas, sem anúncios

## Problema

Fichas de academia ficam espalhadas entre papel, aplicativos genéricos e anotações pessoais. O histórico de carga, repetições e frequência se perde. O MeuTreino+ guarda a ficha definida pelo aluno ou por um profissional autorizado e registra o que foi executado.

## Limite do produto

O MeuTreino+ é uma ferramenta de organização, registro e acompanhamento. O usuário ou o profissional autorizado define os exercícios. A plataforma armazena e apresenta essas informações.

O aplicativo não é um personal trainer virtual. A versão 1.0 não faz o seguinte:

- Prescrever exercícios automaticamente.
- Recomendar cargas, séries ou repetições.
- Criar planos de treinamento com IA.
- Diagnosticar lesões ou condições médicas.
- Interpretar sintomas como aconselhamento clínico.
- Substituir profissionais de educação física.

Carga progressiva é um rótulo escolhido por quem montou a ficha. O aplicativo não calcula a próxima carga. A escala subjetiva de cinco níveis descreve a percepção do exercício naquela sessão: muito ruim, ruim, regular, bom e excelente. Ela não diagnostica lesão e não define carga. O texto `PERCEIVED_LEVEL_DISCLAIMER_PT` no pacote compartilhado registra essa distinção.

## O que a versão 1.0 precisa sustentar

A fundação prepara estes domínios. As telas e os endpoints de negócio ainda não existem.

### Conta

Cadastro, autenticação, perfil, unidades métricas ou imperiais, início da semana, idioma `pt-BR`, exportação e exclusão de conta.

### Academias e equipamentos

Academias usadas pelo aluno, número ou identificação da máquina, apelido, fotografia opcional e vínculo do equipamento com exercícios.

### Biblioteca de exercícios

Nome em português, nome alternativo, grupo muscular principal, grupos secundários, equipamentos necessários, tipo de atividade, instruções opcionais e referências visuais licenciadas. Exercícios criados pelo usuário são linhas de `exercises` com `origin = user`. Exercícios de sistema têm `origin = system` e não têm dono. Imagens e vídeos de terceiros só entram com licença. O banco recusa referência visual de sistema que não seja `licensed_exercise_reference`.

### Fichas

Nome, descrição opcional, exercícios ordenados, séries independentes, repetições, carga fixa, progressiva, peso corporal ou duração, intervalos, notas, duplicação e arquivamento. O aluno continua dono da ficha mesmo quando um profissional é o autor.

### Agenda

Uma agenda ativa por aluno, dias da semana de segunda a domingo, fichas, atividades aeróbicas (caminhada, corrida, bicicleta, spinning, HIIT e elíptico), descanso e reagendamento por edição da agenda.

### Execução

Início e término da sessão e de cada exercício, séries concluídas com carga e repetições efetivas, pausa, exercício pulado, treino interrompido, retomada e duração. Uma edição posterior da ficha não altera a sessão já registrada. A sessão concluída ou interrompida fica travada.

### Feedback

Escala de 1 a 5 por exercício, comentário opcional e desconforto informado pelo usuário, sem diagnóstico e sem recomendação.

### Histórico

Sessões, frequência, duração, cargas, repetições, volume registrado, histórico por exercício e gráficos de evolução. O volume é a soma do que foi registrado, não uma inferência de condicionamento.

### Profissionais

Perfis, convite, consentimento, autoria, permissões de leitura de fichas, edição de fichas, leitura de sessões e leitura de feedback, e revogação pelo aluno. O portal completo do profissional fica fora da 1.0.

## Fora desta fundação

- Telas de treino, cadastro e histórico.
- Motor completo de sincronização.
- Login, Sign in with Apple e Google Sign-In implementados.
- Cobrança real, verificação de recibos e notificações das lojas.
- Armazenamento de objetos para fotografias.
- Catálogo semeado de exercícios. Não há dados fictícios apresentados como treinos reais.
- Analytics de terceiros, publicidade e SDKs de anúncio.

## Assinatura

Há dois produtos de loja previstos: mensal e anual. O teste de 30 dias é oferta introdutória da Apple e do Google. O acesso do aplicativo depende do estado sincronizado da assinatura, descrito em [ARCHITECTURE.md](./ARCHITECTURE.md). Não existe teste interno contado a partir do cadastro.
