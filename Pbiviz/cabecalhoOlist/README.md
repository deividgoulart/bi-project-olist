# cabecalhoOlist

Um Custom Visual de Power BI pro bloco de título do dashboard — o texto pequeno em azul ("olist · operações") acima do título grande, igual ao mockup. Sem gráfico, sem tabela: só texto, com a identidade visual Olist.

Desenvolvido como parte de um portfólio de BI, projeto irmão do [tabelaOlist](../tabelaOlist/README.md) e do [barrasOlist](../barrasOlist/README.md).

## Funcionalidades

### Identidade visual Olist
Sem cartão próprio (sem fundo/borda/sombra) — o texto fica direto sobre o fundo do relatório, igual no mockup. Plus Jakarta Sans embutida via CSS. Um campo de medida opcional ("Modo Claro/Escuro") deixa uma medida DAX alternar entre claro e escuro — a mesma medida pode ser arrastada em vários visuais (tabelaOlist, barrasOlist, os outros visuais desta família) pra trocar todos juntos.

### Dois campos de texto
Card "Título" no painel de formatação:
- **Texto pequeno (acima do título)** — o "kicker" azul, uppercase, com letter-spacing (ex: "olist · operações").
- **Título** — o texto grande (ex: "Dashboard de operações e CX", ou "Detalhe de pedidos" numa página de drillthrough).

Nenhum dos dois é vinculado a dado — são só texto fixo, editável pelo autor do relatório. Se "Texto pequeno" ficar em branco, a linha some (só o título aparece).

## Stack técnica

- **TypeScript** + [Power BI Visuals SDK](https://learn.microsoft.com/power-bi/developer/visuals/) (`powerbi-visuals-tools` 7.2.1, API 5.11.1)
- **LESS** para os estilos — sem D3 (não há gráfico nem tabela)
- **Jest** + **ts-jest** pro teste da lógica de resolução de tema
- Utilitário oficial: `powerbi-visuals-utils-formattingmodel`

## Arquitetura

- `capabilities.json` — role `modoVisual` (Measure, opcional) e o objeto `headerStyle` (`eyebrowText`/`titleText`).
- `src/visual.ts` — cria os dois elementos de texto uma vez (no construtor) e só atualiza `textContent`/tokens de tema a cada `update()`.
- `src/headerLogic.ts` — `resolveThemeMode`, testável isoladamente.
- `style/visual.less` — tokens Olist (`--ds-color-ink`/`--ds-color-blue`) e a fonte embutida em base64.

## Rodando localmente

```bash
npm install
npm start          # pbiviz start — conecta no Power BI Desktop/Service em modo desenvolvedor
npm test           # roda a suíte de testes (Jest)
npm run lint       # eslint
npm run package    # gera o .pbiviz pra importar em um relatório
```

## Limitações conhecidas

- Sem quebra de linha automática "bonita" — título e texto pequeno muito longos cortam com reticências (`text-overflow: ellipsis`) em vez de quebrar em várias linhas, pra não estourar a altura do visual.
