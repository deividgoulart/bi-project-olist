# filtroOlist

Um Custom Visual de Power BI pro pill de filtro do mockup ("Período", "UF", "Categoria", "Seller") — um filtro de verdade (aplica no relatório, não é decorativo), com a identidade visual Olist. Suporta busca e seleção múltipla. **Um campo por instância**: para uma barra de filtros, coloque uma instância por campo, lado a lado.

Desenvolvido como parte de um portfólio de BI, projeto irmão do [tabelaOlist](../tabelaOlist/README.md) e do [barrasOlist](../barrasOlist/README.md).

## Funcionalidades

### Identidade visual Olist
Pill "fantasma" (sem seleção, borda fina) que vira um chip azul sólido quando há algo selecionado — igual `OlistDS.Button variant="ghost"` vs `OlistDS.Chip` no mockup. Plus Jakarta Sans embutida via CSS. Mesmo campo de medida opcional ("Modo Claro/Escuro") dos outros visuais da família.

### Filtro de verdade, com busca e seleção múltipla
Solte um campo em "Campo" — clicar no pill abre a lista com os valores distintos, um campo de busca no topo (filtra conforme digita, sem sensibilidade a maiúscula/acento) e uma checkbox por valor. Marcar/desmarcar aplica um filtro básico (`IBasicFilter`, operador "In") via `host.applyJsonFilter`, cross-filtrando os outros visuais da página — a cada clique, sem botão "Aplicar", e **sem fechar a lista**, pra poder marcar vários seguidos. Um link "Limpar seleção" aparece no topo quando há algo marcado; o "×" no chip faz o mesmo sem abrir a lista.

O visual lê `options.jsonFilters` a cada `update()`, então o pill reflete o filtro atual mesmo que ele tenha mudado por outro caminho (bookmark, "limpar filtros" do relatório, outra interação).

### O rótulo do pill
Sempre "Campo (N)" — incluindo "(0)" sem nada selecionado — e **nunca o valor selecionado**. As duas coisas são deliberadas: mostrar o valor (ex: "UF: São Paulo") deixava o texto com tamanho variável e, mesmo com truncamento configurado, estourava a largura na prática. E manter o "(0)" evita que o pill mude de largura ao ser usado, mantendo o espaçamento estável entre instâncias vizinhas.

### Altura da lista e onde ela abre
Um custom visual roda num iframe de limites fixos, então **a lista não consegue sair do retângulo do visual** — diferente de um slicer nativo, que o Power BI desenha por cima de tudo. O espaço da lista precisa existir dentro do visual, e esse espaço bloqueia interação com o que estiver embaixo (tooltip e drillthrough dos gráficos, por exemplo). Duas coisas atenuam isso:

- **Altura adaptativa**: a lista usa o espaço que o visual tem (mínimo de 96px) e rola dentro dele, em vez de exigir uma altura fixa. Dá pra deixar o visual bem mais baixo.
- **Card "Barra" → "Abrir a lista para cima"**: ancora os pills na base do visual e joga o espaço da lista pra cima deles, permitindo apontar a área ocupada pra uma região inofensiva do relatório (o cabeçalho, por exemplo) em vez dos gráficos.

### Rótulo configurável
Card **"Filtro: \<campo\>"** no painel de formatação, campo **Rótulo** — em branco usa o nome do campo (ex: "UF"); preencha pra sobrescrever (ex: renomear `uf_sigla` pra aparecer só "UF").

### Sincronizar entre páginas
O visual declara `"supportsSynchronizingFilterState": true`, então aparece no painel nativo **Exibição → Sincronizar segmentações**: dá pra fazer uma seleção valer em várias páginas, com ou sem exibir o pill em cada uma. O recurso exige **um campo por visual** — o que este visual cumpre, mas some se a medida "Modo Claro/Escuro" também estiver preenchida (ela conta como um segundo campo). Na prática é uma escolha por instância: sincronizar entre páginas **ou** acompanhar o modo escuro.

### Acessibilidade
Pill, busca e itens focáveis por teclado (Tab), `Enter`/`Espaço` marca/desmarca, `Esc` fecha, clique fora fecha. Lista com `role="listbox" aria-multiselectable="true"` e cada item com `role="option" aria-selected`. O `aria-label` do pill (só leitor de tela) continua descritivo, incluindo os valores selecionados — diferente do texto visível.

## Stack técnica

- **TypeScript** + [Power BI Visuals SDK](https://learn.microsoft.com/power-bi/developer/visuals/) (`powerbi-visuals-tools` 7.2.1, API 5.11.1)
- **`powerbi-models`** — construção do filtro básico (`BasicFilter`) no formato que `host.applyJsonFilter` espera
- **LESS** para os estilos — sem D3
- **Jest** + **ts-jest** pra lógica de tema/dedupe/busca/parse de coluna
- Utilitário oficial: `powerbi-visuals-utils-formattingmodel`

## Arquitetura

- `capabilities.json` — papel `campo1` (Grouping, máximo 1) e `modoVisual` (Measure, opcional); objetos `barStyle` (`openUp`), `filterStyle` (`label`) e `general.filter` (registra o visual como produtor de filtro). `dataReductionAlgorithm` no teto de 30.000 valores.
- `src/visual.ts` — um `FilterField` agrupando estado e DOM (pill, popup, busca, "limpar", container de linhas). O DOM só é reconstruído quando o campo vinculado muda; mudança de seleção não reconstrói nada, preservando popup aberto, busca digitada e foco. O código é agnóstico à quantidade de campos (percorre `FIELD_ROLES` e `options.dataViews`), resquício útil das tentativas de barra descritas abaixo.
- `src/filterLogic.ts` — `resolveThemeMode`, `distinctSortedValues`, `filterBySearchText`, `parseColumnTarget`, testáveis isoladamente.
- `style/visual.less` — tokens Olist, o pill/chip, a busca, "Limpar seleção" e a lista com checkbox.

### Por que não é uma barra de filtros (vários campos num visual só)

Foi tentado **duas vezes**, de formas diferentes, e as duas falharam. Vale registrar para ninguém repetir.

**Tentativa 1 — vários campos num único papel de agrupamento.** O Power BI trata isso como uma **hierarquia** (campo1 > campo2 > campo3, igual drill-down): as linhas devolvidas viram as *combinações* que existem entre os campos, todas competindo pelo mesmo teto de redução de dados. Valores de um campo que só apareciam combinados com valores cortados de outro simplesmente não chegavam ao visual — bug de dado incorreto e silencioso. É também a razão pela qual um slicer nativo aceita só um campo.

**Tentativa 2 — N papéis separados, cada um com seu próprio `dataViewMapping`.** Derruba a geração de consulta do próprio Power BI Desktop assim que o **segundo** campo é vinculado: `Cannot read properties of null (reading 'aggregates')` em `visitRole`, dentro de `rewriteQuery`. Testado com e sem a medida de tema, e com `min: 1` em todas as `conditions` (para que mapeamentos de campo vazio não fossem considerados válidos) — o crash é o mesmo nos três casos.

A conclusão da tentativa 2: múltiplos `dataViewMappings` são **alternativas** — o host escolhe *um* mapeamento válido para a forma dos dados amarrados — e não consultas paralelas devolvendo um `dataViews[]` com uma entrada por campo. A frase *"each valid mapping produces a data view"* na documentação foi lida errada aqui.

O problema que motivou as duas tentativas era visual: com instâncias vizinhas, o conteúdo de um visual pode transbordar sua caixa, e como o **Service renderiza um pouco maior que o Desktop**, um pill que cabia localmente cobria o visual ao lado depois de publicado. Isso é atacado hoje por outro caminho — rótulo de largura fixa ("Campo (N)", nunca o valor) e `min-width: 0` no wrapper flex.

### Por que não é `position: fixed`

A primeira versão anexava o popup ao `<body>` com `position: fixed`, igual a tooltip do barrasOlist/tabelaOlist — mas na prática ele aparecia grudado perto do visual, cortado. Causa: o Power BI Desktop aplica `transform` num ancestral do canvas (zoom/pan da página), e `position: fixed` dentro de um ancestral com `transform` passa a ser relativo **a ele**, não à janela (regra do CSS, não bug do Power BI). Trocado por `position: absolute` relativo ao `.filter-anchor` — imune ao problema, porque "absolute" já é relativo ao ancestral posicionado mais próximo.

## Rodando localmente

```bash
npm install
npm start          # pbiviz start — conecta no Power BI Desktop/Service em modo desenvolvedor
npm test           # roda a suíte de testes (Jest)
npm run lint       # eslint
npm run package    # gera o .pbiviz pra importar em um relatório
```

## Limitações conhecidas

- **Um campo por instância** — ver "Por que não é uma barra de filtros" acima. Não é preferência de design: os dois caminhos possíveis foram testados e falham.
- **A lista não sai do retângulo do visual.** Consequência do sandbox; o visual precisa ter altura para a lista, e essa área bloqueia interação com o que estiver embaixo. Atenuado pela altura adaptativa e pela opção de abrir para cima, não eliminado.
- **Até 30.000 valores distintos.** A busca é sobre a lista já carregada (client-side), não alcança valores além desse teto.
- **Sem "Selecionar tudo".** Marcar todos os valores visíveis exige clicar um por um.
