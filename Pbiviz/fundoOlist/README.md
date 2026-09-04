# fundoOlist

Um Custom Visual de Power BI minúsculo: só uma cor de fundo sólida, sem texto, sem gráfico, sem interatividade. Pensado pra resolver um problema específico — o fundo da PÁGINA do relatório (a cor atrás de todos os visuais) é estático no Power BI, mas o resto do dashboard (tabelaOlist, barrasOlist, cardsOlist etc.) já troca de claro pra escuro dinamicamente via medida. Este visual fecha essa lacuna: cobre a página inteira, fica atrás de tudo, e muda de cor junto com o resto.

Desenvolvido como parte de um portfólio de BI, projeto irmão do [tabelaOlist](../tabelaOlist/README.md), [barrasOlist](../barrasOlist/README.md) e do [temaOlist](../temaOlist/README.md) (o botão que troca o tema).

## Como usar

1. Adicione este visual ao relatório.
2. Vincule a mesma medida "Modo Claro/Escuro" (`Modo Visual`, ou equivalente) que os outros visuais da família já usam, no campo de mesmo nome.
3. Redimensione/posicione o visual pra cobrir a página inteira (ou a área de fundo desejada).
4. Clique direito nele → **Enviar para trás** (ou Ctrl+Shift+[ ) — assim ele fica atrás de todos os outros visuais em vez de cobri-los.

Pronto: como todos os outros visuais desta família já têm fundo transparente por padrão (deixam o que estiver atrás aparecer), a cor deste visual "vaza" por baixo deles e funciona como um fundo de página dinâmico.

## Funcionalidades

### A única coisa que ele faz
Preenche 100% da própria área com o tom "surface sunken" do design system Olist (`#F4F6FC` no claro, `#060A1C` no escuro) — o mesmo tom de fundo de página usado no mockup por trás dos cartões brancos/escuros. Sem card, sem borda, sem sombra, sem cantos arredondados (é pra parecer o próprio fundo da página, não mais um cartão em cima dela).

### Zero configuração
Sem card no painel de formatação — o único "ajuste" é o campo de medida "Modo Claro/Escuro", igual aos outros visuais.

## Stack técnica

- **TypeScript** + [Power BI Visuals SDK](https://learn.microsoft.com/power-bi/developer/visuals/) (`powerbi-visuals-tools` 7.2.1, API 5.11.1)
- **LESS** — sem fonte embutida (não há texto neste visual) e sem D3
- **Jest** + **ts-jest** pro teste da lógica de resolução de tema
- Utilitário oficial: `powerbi-visuals-utils-formattingmodel`

## Arquitetura

- `capabilities.json` — só o role `modoVisual` (Measure, opcional).
- `src/visual.ts` — um único `<div>` cuja `background-color` é setada a cada `update()`.
- `src/themeLogic.ts` — `resolveThemeMode`, testável isoladamente.
- `style/visual.less` — só a cor de fundo (sem `@font-face`, sem mixins).

## Rodando localmente

```bash
npm install
npm start          # pbiviz start — conecta no Power BI Desktop/Service em modo desenvolvedor
npm test           # roda a suíte de testes (Jest)
npm run lint       # eslint
npm run package    # gera o .pbiviz pra importar em um relatório
```

## Limitações conhecidas

- **Clicar nele seleciona o visual, e isso não dá pra impedir por código.** Como ele cobre a página inteira e fica no fundo, todo clique numa área "vazia" cai nele — e o Power BI desenha contorno de seleção e cabeçalho por cima do fundo. O conteúdo do visual já usa `pointer-events: none` (não reage ao mouse), mas o contorno é desenhado pelo **host**, fora do alcance do código de qualquer custom visual: não existe API pra um visual se declarar "não selecionável". Mitigações do lado do relatório:
  - **Formato → Geral → Cabeçalho do visual → desligado** — tira os ícones ("...", modo foco) que aparecem ao passar o mouse.
  - **Exibição → Bloquear objetos** — impede mover/redimensionar sem querer ao clicar.
  - No **modo de leitura/apresentação**, que é como o relatório é consumido, nada disso aparece.
- Como qualquer visual do Power BI, ele tem uma borda de seleção/redimensionamento no modo de edição do relatório — normal, não aparece no modo de leitura/apresentação.
- Se outro visual entre este e o fundo real da página tiver o PRÓPRIO fundo opaco (não transparente), a cor deste visual fica escondida atrás dele — funciona melhor com os visuais desta família (que já são transparentes por padrão) ou com visuais nativos configurados com fundo desligado.
