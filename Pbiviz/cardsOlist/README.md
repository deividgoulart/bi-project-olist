# cardsOlist

Um Custom Visual de Power BI pra fileira de cartões de indicador (KPI) do mockup — "Tempo médio entrega", "% atraso", "Score médio" etc., com a identidade visual Olist. Cada medida solta em "Valores" vira um cartão.

Desenvolvido como parte de um portfólio de BI, projeto irmão do [tabelaOlist](../tabelaOlist/README.md) e do [barrasOlist](../barrasOlist/README.md).

## Funcionalidades

### Identidade visual Olist
Cartões com fundo/borda/sombra fixos (`--ds-*`), Plus Jakarta Sans embutida via CSS. Mesmo campo de medida opcional ("Modo Claro/Escuro") dos outros visuais da família.

### Um cartão por medida
Solte quantas medidas quiser em "Valores" — cada uma vira um cartão (rótulo + valor), lado a lado, quebrando linha automaticamente se não couberem na largura do visual. O valor é formatado respeitando o format string da própria medida (útil pra sufixos como `"d"` em "11,2 d", `%`, moeda etc.).

### Estilo por cartão
Cada medida tem seu próprio card de formatação no painel ("Cartão: <nome da medida>"), com:
- **Rótulo** — em branco usa o nome da medida; digite algo pra sobrescrever.
- **Estilo** — Padrão (cinza/ink), Atenção (valor em âmbar, pra métricas de alerta como "% atraso") ou Destaque (cartão inteiro com fundo azul sólido e texto branco, pro indicador "hero" da fileira — igual "% no prazo + nota 4-5" no mockup).

## Stack técnica

- **TypeScript** + [Power BI Visuals SDK](https://learn.microsoft.com/power-bi/developer/visuals/) (`powerbi-visuals-tools` 7.2.1, API 5.11.1)
- **LESS** para os estilos — sem D3 (cartões são só texto, sem gráfico)
- **Jest** + **ts-jest** pra lógica de resolução de tema/variante
- Utilitários oficiais: `powerbi-visuals-utils-formattingmodel`, `powerbi-visuals-utils-formattingutils`

## Arquitetura

- `capabilities.json` — roles `valores` (Measure, múltiplas) e `modoVisual` (Measure, opcional); objeto `cardStyle` (`label`/`variant`), sempre por medida.
- `src/visual.ts` — lê as colunas de medida do `categorical.values` (sem categoria/agrupamento — é um "multi-row card"), monta um `.kpi-card` por medida e o painel de formatação dinâmico por medida (mesmo padrão de `buildSeriesColorCards` no barrasOlist).
- `src/cardLogic.ts` — `resolveThemeMode`/`resolveCardVariant`, testáveis isoladamente.
- `style/visual.less` — tokens Olist e as 3 variantes de cartão.

## Rodando localmente

```bash
npm install
npm start          # pbiviz start — conecta no Power BI Desktop/Service em modo desenvolvedor
npm test           # roda a suíte de testes (Jest)
npm run lint       # eslint
npm run package    # gera o .pbiviz pra importar em um relatório
```

## Limitações conhecidas

- Sem interatividade (seleção/cross-filter) — cartões de indicador não têm uma categoria pra filtrar por clique, igual o cartão nativo do Power BI.
- A ordem dos cartões segue a ordem em que as medidas foram adicionadas ao campo "Valores" — não há uma opção de reordenar pelo painel de formatação (mesma limitação documentada em [tabelaOlist](../tabelaOlist/README.md) pra ordem de colunas).
