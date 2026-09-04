# botaoVoltarOlist

Um Custom Visual de Power BI pro link "← Voltar" do mockup — seta + texto em azul, com a identidade visual Olist. **Puramente decorativo**: veja "Limitações conhecidas" antes de usar.

Desenvolvido como parte de um portfólio de BI, projeto irmão do [tabelaOlist](../tabelaOlist/README.md), [barrasOlist](../barrasOlist/README.md) e [cabecalhoOlist](../cabecalhoOlist/README.md).

## Funcionalidades

### Identidade visual Olist
Sem cartão próprio — o link fica direto sobre o fundo do relatório, ao lado do título (ver [cabecalhoOlist](../cabecalhoOlist/README.md), pensado pra ficar lado a lado com este visual, igual no mockup). Plus Jakarta Sans embutida via CSS. Mesmo campo de medida opcional ("Modo Claro/Escuro") dos outros visuais da família, incluindo um azul um pouco mais claro no modo escuro (pra manter contraste — ver `DS_TOKENS` em `visual.ts`).

### Texto configurável
Card "Botão" no painel de formatação, campo **Texto** (padrão "Voltar").

### Acessibilidade
Focável por teclado (Tab), com estado de foco visível e `Enter`/`Espaço` "clicando" nele (ver limitação abaixo sobre o que esse clique realmente faz).

## Stack técnica

- **TypeScript** + [Power BI Visuals SDK](https://learn.microsoft.com/power-bi/developer/visuals/) (`powerbi-visuals-tools` 7.2.1, API 5.11.1)
- **LESS** para os estilos — sem D3
- **Jest** + **ts-jest** pro teste da lógica de resolução de tema
- Utilitário oficial: `powerbi-visuals-utils-formattingmodel`

## Arquitetura

- `capabilities.json` — role `modoVisual` (Measure, opcional) e o objeto `buttonStyle` (`label`).
- `src/visual.ts` — renderiza a seta + o texto, com hover/focus em CSS.
- `src/themeLogic.ts` — `resolveThemeMode`, testável isoladamente.
- `style/visual.less` — tokens Olist e a fonte embutida em base64.

## Rodando localmente

```bash
npm install
npm start          # pbiviz start — conecta no Power BI Desktop/Service em modo desenvolvedor
npm test           # roda a suíte de testes (Jest)
npm run lint       # eslint
npm run package    # gera o .pbiviz pra importar em um relatório
```

## Limitações conhecidas

- **Este visual não navega sozinho.** O SDK de visual customizado do Power BI não expõe uma API pública pra disparar navegação por bookmark ou "voltar" de drillthrough a partir do código do visual — essa ação só existe nativamente em formas/botões nativos do Power BI (Inserir > Botões > Voltar). Clicar neste visual não faz nada além do próprio estado visual de hover/foco.
- **Pra ele funcionar de verdade**, sobreponha um botão nativo do Power BI (Inserir > Botões > Voltar, ou uma forma com Ação = Bookmark) exatamente por cima deste visual, do mesmo tamanho, na camada de CIMA (é ele que precisa receber o clique) — e deixe o preenchimento/contorno/texto do botão nativo 100% transparente, pra visualmente só aparecer este visual (com a cara do Olist) por baixo, mas quem processa o clique e navega é o botão nativo.
