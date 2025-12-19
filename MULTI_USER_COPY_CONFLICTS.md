# Multi-user: conflitos e divergencias de trades

## Como o bot funciona hoje (resumo honesto)
- Cada user em USER_ADDRESSES e monitorado separadamente.
- Todo trade novo encontrado para cada user vira um trade a ser copiado.
- A agregacao (quando ligada) junta trades pequenos apenas do MESMO user e do MESMO mercado/lado.
- Nao existe coordenacao entre users para decidir "quem manda" em um mesmo asset.

Resultado: se dois users compram o mesmo asset, o bot tende a comprar duas vezes (ou somar a exposicao).
Se um user vende e outro compra, o bot pode ficar "batendo cabeca" com sinais opostos.

## Objetivo desejado
Evitar compras divergentes e manter uma logica clara por mercado/asset:
- Escolher um unico "guia" por ativo (ou por mercado/condicao).
- Seguir o guia ate ele encerrar a posicao.
- Ignorar trades de outros users nesse mesmo ativo enquanto o guia estiver ativo.

## Proposta 1: "Leader por mercado" (simples e robusta)
Regra:
1) Ao detectar o PRIMEIRO trade novo para um conditionId/asset, defina o user desse trade como leader.
2) Registre leader + timestamp + condicao + lado + TTL.
3) Enquanto o leader estiver ativo (posicao aberta), ignore sinais de outros users nesse ativo.
4) Quando o leader zerar (sell total ou posicao fechada), libere o ativo para novo leader.

Vantagens:
- Evita conflito de sinais.
- Facil de entender e de auditar.

Riscos:
- Se o leader fizer uma entrada ruim, o bot fica preso a ele ate fechar.

## Proposta 2: "Leader com score dinamico" (mais inteligente)
Ideia:
- Cada user tem um score (ROI recente, acerto nos ultimos N trades, drawdown, etc.).
- O leader e escolhido pelo score, nao pelo primeiro trade.
- Troca de leader ocorre somente se:
  - O novo user for MUITO melhor (limiar), e
  - A diferenca de sinal for forte (ex: trade maior e mais recente).

Vantagens:
- Evita ficar preso a um user ruim.
Desvantagens:
- Mais complexo, exige historico e ajustes de parametros.

## Proposta 3: "Consenso / voto"
Regra:
- Quando varios users compram o mesmo lado, soma sinais.
- Quando ha conflito (compra vs venda), so executa se houver maioria ou volume maior do mesmo lado.
- Pode exigir um threshold (ex: 2/3 ou 60% do volume).

Vantagens:
- Reduz ruido de trades isolados.
Riscos:
- Trades mais rapidos podem ser perdidos se o consenso demorar.

## Regras operacionais (independente da estrategia)
- Cooldown por asset: evita flip-flop rapido (ex: 2-5 min).
- "Posicao do bot" manda: se ja temos exposicao, so reduzir quando o leader reduzir.
- Limites de risco: max por posicao/diario para evitar exposicao duplicada.

## Mudancas de dados (se for implementar)
1) Tabela/colecao para tracking de leader por conditionId:
   - conditionId, asset, leaderUser, startedAt, status, lastTradeAt
2) Logica de decisao antes de enviar para tradeExecutor.
3) (Opcional) Armazenar metricas por user para score dinamico.

## Minha sugestao de caminho
Comecar com a Proposta 1 (leader por mercado), pois:
- Resolve 80% do problema com baixa complexidade.
- Explicavel e facil de operar.

Depois, se quiser evoluir:
1) Adicionar score simples (ex: PnL 7d).
2) Permitir troca de leader apenas se score + volume superarem um limiar.

## Perguntas para fechar requisitos
- O leader deve ser global (um unico user manda em tudo) ou por conditionId?
- Em trades de venda parcial, seguimos proporcionalmente ou so quando ele zera?
- Em caso de "duas compras quase simultaneas", quem ganha?

