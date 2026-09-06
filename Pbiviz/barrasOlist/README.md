# barrasOlist

Um Custom Visual de gráfico de barras/colunas para Power BI, construído do zero com o Power BI Visuals SDK e SVG + D3 (sem biblioteca de gráficos pronta) — modelo de dados flexível o bastante pra funcionar tanto com múltiplas medidas quanto com uma coluna de legenda gerando séries dinamicamente, igual ao gráfico de colunas nativo.

Desenvolvido como parte de um portfólio de BI, projeto irmão do [tabelaOlist](../tabelaOlist/README.md).

## Screenshots

> _Espaço reservado — capturas de tela do visual rodando no Power BI Desktop devem ser adicionadas aqui._

| Estilo | Preview |
|---|---|
| Identidade Olist (claro) | `![claro](docs/screenshots/olist-claro.png)` |
| Identidade Olist (escuro, via medida) | `![escuro](docs/screenshots/olist-escuro.png)` |
| Combo coluna + linha, eixo duplo | `![combo-eixo-duplo](docs/screenshots/combo-eixo-duplo.png)` |

## Funcionalidades

### Identidade visual Olist
Um único visual fixo (sem presets pra escolher), com as cores, tipografia (Plus Jakarta Sans embutida no CSS), raios e sombra do design system Olist. Um campo de medida opcional ("Modo Claro/Escuro") deixa uma medida DAX alternar entre o tema claro e o escuro do mockup original — a mesma medida pode ser arrastada em vários visuais (como o [tabelaOlist](../tabelaOlist/README.md)) pra trocar todos juntos. Um título opcional (card "Título" no formatting pane) fica numa faixa de largura inteira no topo, acima da legenda.

### Modelo de dados flexível
Um único par de papéis (`Valores` + `Legenda`, opcional) cobre os dois jeitos mais comuns de ter múltiplas séries: várias medidas soltas em `Valores` (cada uma vira uma série, nomeada pela própria medida) **ou** uma medida só + um campo em `Legenda` (as séries saem dos valores distintos desse campo).

### Hierarquia no eixo, com drill-down
O papel `categoria` aceita uma hierarquia (ex: `Ano` > `Mês`). O visual declara `drilldown` no `capabilities.json`, então o Power BI desenha os **botões de nível no cabeçalho** e oferece "Drill down"/"Drill up" no clique direito — a navegação é gerenciada pelo host, não pelo visual.

Quando o usuário expande todos os níveis de uma vez, o eixo desenha **um rótulo por nível, empilhado**: o nível mais profundo colado no eixo (`jan`, `fev`) e os níveis pais numa faixa abaixo, cada um escrito **uma única vez, centrado sobre o trecho que cobre**, com divisória entre os grupos — a mesma leitura de um eixo nativo. Se os rótulos não couberem deitados, inclinam automaticamente e a margem inferior cresce junto.

O agrupamento respeita a ordem exibida: como um rótulo só pode cobrir barras contíguas, ordenar por valor faz os anos se intercalarem e cada trecho vira seu próprio grupo. É o comportamento correto, e está fixado em teste.

### Combo (coluna + linha) e eixo duplo
Cada série tem, no painel de formatação: **Tipo** (Coluna/Barra ou Linha) e **Eixo** (Primário ou Secundário) — pode combinar livremente, por exemplo uma medida em % (0-100) como coluna no eixo primário e uma nota (0-5) como linha no eixo secundário, cada uma com sua própria escala e formato de número. "Linha" só é respeitada com orientação em Colunas (vertical); em Barras (horizontal) a série sempre desenha como barra normal. Série em eixo secundário ou do tipo linha nunca entra no Empilhado/Empilhado 100% — fica sempre "solta" por cima; as demais barras do eixo primário continuam empilhando normalmente entre si. Orientação e modo de série (agrupado, empilhado, empilhado 100%) continuam configuráveis globalmente.

### Barra preenchida (estilo mockup)
Opção por série ("Estilo da barra": Padrão ou Preenchida) que troca o retângulo comum por um trilho fino arredondado (ocupando a largura toda) + um preenchimento em pill por cima — o mesmo visual das barras de "Categorias com mais avaliações ruins" do mockup original. Só tem efeito com Tipo = Coluna/Barra e orientação em Barras (horizontal); nos demais casos a série desenha normal. O trilho não representa o range do eixo — representa um teto fixo calculado a partir do maior valor entre as barras preenchidas, arredondado pro próximo "número redondo" (ex: maior valor 21 → teto 25), pra todas ficarem comparáveis entre si.

### Cores
Sem card global de cores — cada série (mesmo quando só existe uma) tem seu próprio color picker no painel de formatação, persistido por série (ou por medida, quando não há legenda). Sem override, série única cai na cor primária Olist e múltiplas séries caem na paleta categórica Olist, índice a índice.

### Interatividade
- **Ordenação** por categoria ou valor (crescente/decrescente), client-side.
- **Top N + "Outros"**: limita a exibição às N maiores categorias (por magnitude), agrupando o resto numa categoria sintética. Cada série escolhe sua própria agregação pro grupo "Outros" (Soma, padrão — pra medidas aditivas; ou Média — pra medidas que já são uma taxa/nota, onde somar o resto estouraria a escala sem sentido).
- **Máximo de barras/colunas visíveis + rolagem, com eixo fixo**: campo numérico ("Máximo de barras visíveis por vez", card "Estilo do Gráfico", 0 = desliga) diferente do Top N — em vez de agregar o excedente num "Outros", mantém todas as categorias intactas e só limita quantas aparecem de uma vez no espaço "confortável" do visual, com uma barra de rolagem (horizontal em Colunas, vertical em Barras) pra navegar até o resto. O eixo de valor fica fixo numa faixa própria fora da área que rola (como uma régua sempre visível), enquanto barras, linhas, grade e eixo de categoria rolam juntos. Pode ser combinado com Top N (o Top N roda primeiro, reduzindo a lista; a rolagem entra só se ainda sobrar mais categorias que o máximo).
- **Ocultar série pelo clique na legenda** (like a legenda nativa do Power BI) — estado só de UI, não persiste entre sessões.
- **Linha de referência** configurável (média dos valores exibidos, ou um valor fixo digitado, sempre no eixo primário), com domínio do eixo ajustado automaticamente pra sempre ficar visível.
- **Seleção/drillthrough**: clique seleciona/realça a barra ou ponto de linha e sincroniza com outros visuais da página; clique direito abre o menu nativo do Power BI.
- **Tooltip customizada** (não a nativa do Power BI), com o formato de número correto por série (cada série pode ter um format string bem diferente, sobretudo em combo/eixo duplo).

### Performance e robustez
- **Bundle enxuto**: importa só os submódulos do D3 realmente usados (seleção, escalas, eixos, formas, array, cor, interpolação, transição) em vez do pacote `d3` inteiro — evita empacotar força-dirigida, zoom, geo e outros ~20 submódulos não utilizados.
- **Transições suaves**: barras dos presets mais simples (sem decoração extra) reaproveitam o mesmo elemento SVG entre atualizações e animam posição/tamanho, em vez de destruir e reconstruir a cada render.
- Valores formatados respeitando o `format string` da medida, via `powerbi-visuals-utils-formattingutils`.
- Estado vazio tratado e um esqueleto de carregamento (barras animadas) na primeira renderização.

### Acessibilidade
- Navegação por teclado (Tab entre barras, setas esquerda/direita pra navegar, Enter/Espaço pra selecionar) e nas séries da legenda.
- Atributos ARIA (`role="img"` no gráfico, `role="button"` + `aria-label` por barra e por item de legenda).
- Modo de alto contraste: cores de série, eixos, trilhos e decorações caem pras cores garantidas pelo host (`foreground`/`background`), gradientes/padrões desligam e viram preenchimento sólido.

## Stack técnica

- **TypeScript** + [Power BI Visuals SDK](https://learn.microsoft.com/power-bi/developer/visuals/) (`powerbi-visuals-tools` 7.2.1, API 5.11.1)
- **SVG + D3** (submódulos individuais: `d3-selection`, `d3-scale`, `d3-axis`, `d3-shape`, `d3-array`, `d3-transition`) — sem biblioteca de gráficos pronta
- **LESS** para os estilos
- **Jest** + **ts-jest** para testes unitários da lógica de ordenação/agrupamento/formatação
- Utilitários oficiais: `powerbi-visuals-utils-formattingmodel`, `powerbi-visuals-utils-formattingutils`

## Arquitetura

- `capabilities.json` — data roles (`categoria`, `legenda`, `valores`, `modoVisual`), objetos de formatação (incluindo `seriesStyle.fill`/`chartType`/`axis`/`othersAggregation`/`barFillStyle`, sempre por série) e o mapeamento categórico de dados, mais `drilldown` apontando para o papel `categoria`.

> **Atenção ao alterar:** o `max` do papel `categoria` nas `conditions` precisa continuar em **1**. É contraintuitivo, mas está na documentação da Microsoft: o drill-down exige `max: 1`, e é o próprio host que libera a hierarquia depois. Subir esse valor para aceitar vários campos **desativa o drill-down**.
- `src/visual.ts` — renderização SVG (barras, linhas, eixo duplo), interatividade (seleção, ordenação, Top N, legenda, teclado) e o painel de formatação dinâmico por série.
- `src/chartLogic.ts` — lógica pura (conversão numérica, formatação compacta, contraste de texto, média, ordenação, agrupamento "Top N + Outros", resolução do tema claro/escuro), agrupamento dos níveis pais do eixo em trechos contíguos `buildCategoryLevelSpans`, divisão de hierarquia concatenada `splitConcatenatedLevels`), sem dependência do host do Power BI ou do DOM/D3 — testável isoladamente.
- `src/settings.ts` — modelo de formatação (título, estilo do gráfico, linha de referência, eixos, rótulos, legenda — sem card de cores; cor é sempre por série, ver `buildSeriesColorCards` em `visual.ts`).
- `style/visual.less` — a identidade visual Olist fixa (tokens `--ds-*` claro/escuro, fonte Plus Jakarta Sans embutida em base64) e os estilos estruturais.
- `test/` — suíte Jest para `chartLogic.ts`.

## Rodando localmente

```bash
npm install
npm start          # pbiviz start — conecta no Power BI Desktop/Service em modo desenvolvedor
npm test           # roda a suíte de testes (Jest)
npm run lint       # eslint
npm run package    # gera o .pbiviz pra importar em um relatório
```

## Limitações conhecidas

- A tooltip customizada é posicionada manualmente (não usa o posicionamento automático nativo do Power BI), então pode ser cortada em monitores múltiplos ou nas bordas extremas da tela.
- Séries ocultadas pela legenda e a ordenação/Top N são recalculados no cliente a cada render; com centenas de categorias e várias séries simultâneas isso é instantâneo, mas não foi otimizado pra volumes muito maiores que o típico de um gráfico de barras.
- O eixo secundário só é desenhado (linha do eixo + números à direita) com orientação em Colunas — em Barras (horizontal) a escala secundária ainda é respeitada no tamanho das barras, mas sem um segundo eixo visível.
- **As quinas fora do canto arredondado do card aparecem brancas em vez de transparentes por padrão.** Isso não é o visual — é o próprio Power BI, que pinta um plano de fundo nativo atrás de todo visual (seção **Geral > Efeitos > Plano de fundo** no painel de formatação, existe em qualquer visual, nativo ou customizado). Pra ver as cores reais do canvas do relatório atrás do card, desligue esse plano de fundo (ou deixe 100% transparente) — é um ajuste por instância do visual em cada relatório, não algo que o código do visual consiga fixar como padrão.

### Por que a hierarquia chega em dois formatos diferentes

Descoberto instrumentando o visual em execução, não deduzido — e o resultado contraria o que parece natural:

- **Sem `drilldown` declarado**, com vários campos no papel: o Power BI entrega **uma coluna por nível**, alinhadas por linha.
- **Com `drilldown` declarado**, ao expandir todos os níveis: entrega **uma coluna só**, com os valores **já concatenados por espaço** (`"2016 out"`), e `identityFields` com um item por nível.

O visual trata os dois casos. No segundo, a profundidade vem de `identityFields` — não de contar palavras no nome da coluna, que quebraria com um nível chamado "Mês Número".

A divisão do texto concatenado corta **pela direita**, assumindo que só o nível mais externo pode conter espaço: `"Rio de Janeiro jan"` vira `["Rio de Janeiro", "jan"]`. É uma heurística, e por isso tem trava: se **qualquer** categoria não dividir com segurança, o eixo inteiro volta ao rótulo de uma linha, em vez de agrupar metade certo e metade errado.
