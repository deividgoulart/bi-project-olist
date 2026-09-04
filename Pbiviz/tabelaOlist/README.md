# tabelaOlist

Um Custom Visual de tabela para Power BI, construído do zero com o Power BI Visuals SDK — renderiza HTML/CSS totalmente customizado por célula, linha e cabeçalho, mas mantém as funcionalidades nativas que se espera de uma tabela real: ordenação, seleção/drillthrough, redimensionar colunas, tooltips, acessibilidade por teclado e alto contraste.

Desenvolvido como parte de um portfólio de BI usando o dataset público [Olist Brazilian E-Commerce](https://www.kaggle.com/olistbr/brazilian-ecommerce).

## Screenshots

> _Espaço reservado — capturas de tela do visual rodando no Power BI Desktop devem ser adicionadas aqui._

| Estilo | Preview |
|---|---|
| Identidade Olist (claro) | `![claro](docs/screenshots/olist-claro.png)` |
| Identidade Olist (escuro, via medida) | `![escuro](docs/screenshots/olist-escuro.png)` |
| Pill de status por coluna | `![status-pill](docs/screenshots/status-pill.png)` |

## Funcionalidades

### Identidade visual Olist
Um único visual fixo (sem presets pra escolher entre vários estilos prontos), sem nenhum card de cores no painel de formatação — cores (primária, status positivo/neutro/negativo), tipografia (Plus Jakarta Sans), raios e sombra ficam todos fixos na identidade Olist. Um campo de medida opcional ("Modo Claro/Escuro") deixa uma medida DAX alternar entre o tema claro e o escuro do mockup original — a mesma medida pode ser arrastada em vários visuais pra trocar todos juntos.

### Título
Card "Título" no painel de formatação (desligado por padrão) — liga um título de largura inteira acima da tabela, com texto livre.

### Formatação por coluna
Cada coluna pode receber um destaque de status: um pill colorido (fundo levemente tingido + texto na cor) quando o valor é classificado como positivo, neutro ou negativo. A classificação vem de duas fontes configuráveis: comparação direta com um valor de texto, ou uma coluna auxiliar de status (ex: medida DAX).

### Interatividade
- **Ordenação** por clique no cabeçalho (single-column) e shift+clique (multi-coluna, com badge de prioridade), via `applyCustomSort` — reexecuta a consulta, funciona com medidas DAX.
- **Drillthrough e seleção cruzada**: clique seleciona/realça a linha e sincroniza com outros visuais da página; clique direito abre o menu nativo do Power BI (drillthrough, filtros, exportar dados).
- **Redimensionar coluna** arrastando a borda do cabeçalho — a largura é persistida.
- **Ordem das colunas** controlada por um campo numérico "Ordem de exibição" na formatação de cada coluna (não pela ordem em "Campos da Tabela" — o Power BI reordena esse dataView internamente quando o papel mistura categorias e medidas, então a ordem do painel de campos não é confiável). Ajuste manual: mudar o número de uma coluna não reajusta as outras automaticamente, então pode ser necessário renumerar mais de uma pra evitar empates.
- **Congelar colunas** (quantidade configurável) ao rolar horizontalmente.
- **Busca/filtro rápido** embutido, com destaque de resultados e recálculo dos totais sobre o conjunto filtrado.
- **Totais no rodapé**, com agregação escolhida por coluna (soma, média, mínimo, máximo, contagem, ou nenhum) — marcados como "parcial" enquanto ainda há dados sendo carregados incrementalmente.
- **Tooltip customizada** (não a nativa do Power BI), com controle exato de quais campos aparecem por coluna, e um data role dedicado pra campos que só existem pra dar contexto no hover.

### Performance e robustez
- **Virtualização de linhas**: só a janela visível (+ margem) fica no DOM, mesmo com dezenas de milhares de linhas carregadas.
- **Carregamento incremental automático**: em vez de um limite fixo, carrega o restante das linhas sozinho assim que os dados chegam, sem precisar rolar até o fim nem clicar em nada (`dataReductionAlgorithm` em janelas + `fetchMoreData` disparado a cada `update()` enquanto ainda houver `segment`) — evita o corte silencioso padrão do Power BI em datasets grandes. Um indicador mostra quantas linhas já foram carregadas, e os totais no rodapé ficam marcados como "parcial" até tudo carregar.
- Valores formatados respeitando o `format string` de cada coluna (moeda, %, data etc.), via `powerbi-visuals-utils-formattingutils`.
- Estados vazios tratados ("adicione campos", "nenhum dado encontrado para os filtros atuais") e um skeleton de carregamento na primeira renderização.

### Acessibilidade
- Navegação completa por teclado (Tab, setas para mover entre linhas, Enter/Espaço para selecionar ou ordenar).
- Atributos ARIA (`role`, `aria-sort`) em toda a tabela.
- Modo de alto contraste: em vez de ignorar a configuração do SO, as cores de status viram símbolo + texto monocromático usando só as cores garantidas pelo host (`foreground`/`background`), e gradientes/zebrado/sombras decorativas são neutralizados.

## Stack técnica

- **TypeScript** + [Power BI Visuals SDK](https://learn.microsoft.com/power-bi/developer/visuals/) (`powerbi-visuals-tools` 7.2.1, API 5.11.1)
- **LESS** para os estilos
- **Jest** + **ts-jest** para testes unitários da lógica de formatação/agregação
- Utilitários oficiais: `powerbi-visuals-utils-formattingmodel`, `powerbi-visuals-utils-formattingutils`

## Arquitetura

- `capabilities.json` — data roles (`campos`, `camposTooltip`, `modoVisual`), objetos de formatação e o algoritmo de redução de dados.
- `src/visual.ts` — renderização, interatividade (seleção, ordenação, resize, reorder, virtualização) e o painel de formatação dinâmico por coluna.
- `src/formattingLogic.ts` — lógica pura (parsing numérico, resolução de status/tema, agregação de totais), sem dependência do host do Power BI — é o que torna a lógica testável isoladamente.
- `src/settings.ts` — modelo de formatação (título, comportamento da tabela — sem card de cores; cores/fonte fixas na identidade Olist, ver `PRIMARY_COLOR`/`FONT_FAMILY`/`POSITIVE_COLOR`/`NEUTRAL_COLOR`/`NEGATIVE_COLOR` em `visual.ts`).
- `style/visual.less` — a identidade visual Olist fixa (tokens `--ds-*` claro/escuro) e os estilos estruturais (sticky, virtualização, alto contraste).
- `test/` — suíte Jest para `formattingLogic.ts`.

## Rodando localmente

```bash
npm install
npm start          # pbiviz start — conecta no Power BI Desktop/Service em modo desenvolvedor
npm test           # roda a suíte de testes (Jest)
npm run lint       # eslint
npm run package    # gera o .pbiviz pra importar em um relatório
```

## Limitações conhecidas

- Com carregamento incremental, os totais no rodapé refletem só o que já foi carregado até o momento (por isso ficam marcados como "parcial") — role até o fim da tabela pra carregar tudo e ver o total real.
- Congelar mais de uma coluna usa a largura configurada (ou um valor padrão) pra calcular a posição — fica pixel-perfect depois que as colunas são redimensionadas manualmente ao menos uma vez.
- A tooltip customizada é posicionada manualmente (não usa o posicionamento automático nativo do Power BI), então pode ser cortada em monitores múltiplos ou nas bordas extremas da tela.
- **As quinas fora do canto arredondado do card aparecem brancas em vez de transparentes por padrão.** Isso não é o visual — é o próprio Power BI, que pinta um plano de fundo nativo atrás de todo visual (seção **Geral > Efeitos > Plano de fundo** no painel de formatação, existe em qualquer visual, nativo ou customizado). Pra ver as cores reais do canvas do relatório atrás do card, desligue esse plano de fundo (ou deixe 100% transparente) — é um ajuste por instância do visual em cada relatório, não algo que o código do visual consiga fixar como padrão.
