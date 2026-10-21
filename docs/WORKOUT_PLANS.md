# Fichas de treino

A ficha é a configuração escolhida pelo aluno. O aplicativo não cria fichas sozinho e não sugere exercício, série, repetição ou carga.

## O que a ficha guarda

- Nome, descrição opcional e uma cor entre oito identificadores (`slate`, `blue`, `green`, `amber`, `red`, `violet`, `teal`, `pink`).
- Estado `active` ou `archived`. Arquivar não apaga revisões.
- Exercícios do catálogo geral ou personalizados do próprio aluno. O mesmo exercício pode aparecer mais de uma vez, porque cada linha tem o próprio identificador.
- Posição, observações, descanso padrão e séries.
- Para cada série: tipo (`normal`, `warmup`, `preparatory`, `drop_set`), repetições, carga, unidade e descanso. `drop_set` é só um rótulo. Não há cálculo de técnica avançada.
- Equipamento preferencial por academia, na tabela `workout_plan_exercise_equipment`. A ficha não é duplicada para cada academia. Leg press na Academia Centro pode apontar para a máquina 32 e, na Academia Shopping, para a máquina 08.

Carga nula significa ausência de carga externa, como peso corporal. Ela não vira zero. A carga digitada fica em `target_load` com `load_unit` (`kg` ou `lb`). `target_load_kg` é só a conversão de ida, com a libra internacional `0,45359237 kg`, em centésimos e arredondamento half-up. Cem libras viram `45,36 kg` e a leitura continua mostrando `100 lb`. O limite funcional é `2000 kg`, ou `4409,25 lb`.

Uma ficha aceita até 40 exercícios e cada exercício até 20 séries. O limite existe para manter uma sincronização transacional, não para prescrever volume.

## Onde isso aparece

A API autenticada fica em `/api/v1/workout-plans` e `/api/v1/workout-plan-conflicts`. O identificador do usuário sai do token. Recursos de outra pessoa respondem 404.

No aplicativo, as telas em `apps/mobile/src/app/(private)/plans` leem e gravam o SQLite `plans`. A fila `sync_queue` envia a ficha inteira numa operação `workout_plan`, para ordem e séries viajarem juntas. Ao voltar a rede, `syncPlans` envia a fila e busca as fichas do servidor.

Substituir um exercício pede confirmação: preservar as séries ou redefinir para uma série vazia.

## O que esta etapa não faz

Não executa treino, não mede tempo, não desenha gráfico, não monta a agenda semanal e não cobra. A coluna `workout_sessions.plan_version` fica pronta para uma sessão futura apontar a versão usada no início. O contrato dessa fotografia está em [WORKOUT_VERSIONING.md](./WORKOUT_VERSIONING.md).
