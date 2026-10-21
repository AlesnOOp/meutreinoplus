# Cronômetros

O tempo do treino e o tempo de descanso são calculados a partir de timestamps gravados. O intervalo de um segundo na tela só atualiza o “agora” usado na conta. Ele não é a fonte do tempo.

## Treino

`started_at` nasce com a sessão. Cada pausa, retomada e o encerramento viram uma linha em `session_time_events`, com `occurred_at` e o tipo `pause`, `resume`, `rest_start`, `rest_pause`, `rest_resume` ou `rest_finish`. A tabela é append-only.

`activeSeconds` soma os trechos em que a sessão estava em andamento. Os intervalos entre `pause` e `resume` ficam de fora. `elapsedSeconds` é a diferença de parede entre o início e o fim, ou entre o início e o instante atual enquanto a sessão está aberta. Ao finalizar, os dois valores são gravados: `duration_seconds` é o tempo efetivo e `elapsed_seconds` é o tempo de parede.

Os eventos entram na ordem em que foram registrados, não reordenados por `occurred_at`. Um relógio que anda para trás não reduz o tempo já acumulado: o trecho negativo vale zero. Um `occurred_at` mais de cinco minutos à frente do relógio do servidor é limitado ao agora do servidor, e um instante anterior a `started_at` é elevado até o início. A resposta marca `clockAdjusted` quando isso acontece. Um relógio atrasado, dentro dessa janela, é aceito e pode encurtar a duração daquele trecho.

Fechar o aplicativo ou ir para segundo plano não zera o cronômetro. Ao reabrir, a tela relê a sessão e recalcula com o instante atual.

## Descanso

O descanso configurado na série ou no exercício começa quando a série é concluída, se houver duração. A contagem regressiva é `rest_duration_seconds` menos o tempo efetivo desde `rest_start`. Dá para pausar, retomar, encerrar antes, reiniciar e alterar a duração. O estado também volta do SQLite pelos mesmos timestamps.

Quando o restante chega a zero e o descanso não está pausado, a projeção deixa de mostrar o cronômetro. A tela não depende de um alarme do sistema para isso.

## Notificações

Não há integração com notificação local. O aplicativo funciona sem permissão de notificação. O aviso de que o descanso terminou aparece na tela enquanto ela está aberta. Com o aplicativo em segundo plano, o término não gera alerta do sistema nesta etapa.
