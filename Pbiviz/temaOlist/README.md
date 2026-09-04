# temaOlist

Um Custom Visual de Power BI: um switch (interruptor ☀/🌙) que alterna o relatório inteiro entre claro e escuro. Não é decorativo — clicar de fato muda a seleção de um campo do modelo (via `host.applyJsonFilter`, o mesmo mecanismo do [filtroOlist](../filtroOlist/README.md)), e todos os outros visuais desta família (tabelaOlist, barrasOlist, cardsOlist, cabecalhoOlist, botaoVoltarOlist, [fundoOlist](../fundoOlist/README.md)) já reagem a essa mudança através da medida opcional "Modo Claro/Escuro" que cada um já aceita.

Desenvolvido como parte de um portfólio de BI, projeto irmão do [tabelaOlist](../tabelaOlist/README.md) e do [barrasOlist](../barrasOlist/README.md).

## Como funciona (e o que precisa existir no modelo)

Este visual **não cria nada no modelo** — ele espera que já exista uma tabela desconectada com um campo de exatamente 2 valores, um dos quais reconhecível como "escuro" (texto "dark"/"escuro", sem diferenciar maiúscula/acento). No portfólio deste projeto isso já existe: a tabela `Tema` (coluna `Modo`, valores `{"Escuro", "Claro"}`) e a medida `Modo Visual = IF(SELECTEDVALUE('Tema'[Modo]) = "Escuro", "dark", "light")`, já usada como a medida "Modo Claro/Escuro" nos outros visuais.

1. Arraste `Tema[Modo]` (ou o campo equivalente do seu modelo) pro papel **"Campo de tema"**.
2. Pronto — clicar no switch seleciona "Claro" ou "Escuro" nesse campo (um filtro básico `IBasicFilter`, operador "In", um valor por vez), e a medida `Modo Visual` (lida pelos outros visuais) responde na hora.

Como o campo é de uma tabela **desconectada** (sem relacionamento com as tabelas de fatos), selecionar um valor aqui não filtra nenhum dado visível — só alimenta a medida de tema.

## Funcionalidades

### O switch em si
Trilho arredondado com uma bolinha que desliza — cinza + ☀ (claro) ou azul sólido + 🌙 (escuro), igual um toggle nativo de sistema operacional. Sem cartão, sem texto de rótulo — pensado pra ficar compacto, ao lado do título ([cabecalhoOlist](../cabecalhoOlist/README.md)) ou dos filtros ([filtroOlist](../filtroOlist/README.md)) no cabeçalho do dashboard.

### Autodetecção do par claro/escuro
Não importa a ordem dos 2 valores do campo nem seus nomes exatos — o visual identifica sozinho qual dos dois é o "escuro" (mesma lógica `resolveThemeMode` usada em todos os outros visuais desta família: texto "dark"/"escuro", case/acento-insensível) e trata o outro como "claro". Funciona com `{"Escuro","Claro"}`, `{"dark","light"}`, etc.

### Estado inicial
Antes de qualquer clique (sem filtro aplicado ainda), o switch mostra claro — o mesmo padrão da medida `Modo Visual`, que cai em `"light"` quando `SELECTEDVALUE` não tem nada selecionado.

### Sincronizar entre páginas
O filtro que este visual aplica é, por padrão do Power BI, **de página** — trocar pra escuro numa página não muda as outras. Pra resolver isso o visual declara `"supportsSynchronizingFilterState": true` no `capabilities.json`, o que faz ele aparecer no painel nativo **Exibição → Sincronizar segmentações**. Ali você marca em quais páginas o tema deve valer (coluna *Sincronizar*) e em quais o botão deve aparecer (coluna *Visível*) — dá pra sincronizar sem exibir, então as outras páginas seguem o tema escolhido sem precisar duplicar o switch no layout.

O recurso exige **um campo por visual**, e este visual tem exatamente um (o campo de tema), então não esbarra nessa limitação.

### Acessibilidade
`role="switch"` com `aria-checked`, focável por teclado (é um `<button>` de verdade — `Enter`/`Espaço` já funcionam nativamente, sem precisar de handler de teclado manual).

## Stack técnica

- **TypeScript** + [Power BI Visuals SDK](https://learn.microsoft.com/power-bi/developer/visuals/) (`powerbi-visuals-tools` 7.2.1, API 5.11.1)
- **`powerbi-models`** — construção do filtro básico (`BasicFilter`), mesmo uso do filtroOlist
- **LESS** — sem fonte embutida (só os ícones ☀/🌙) e sem D3
- **Jest** + **ts-jest** pra lógica de tema/detecção do par claro-escuro
- Utilitário oficial: `powerbi-visuals-utils-formattingmodel`

## Arquitetura

- `capabilities.json` — role `categoria` (Grouping, o campo de tema); objeto `general.filter` (registra este visual como produtor de filtro); `supportsSynchronizingFilterState` (habilita o painel Sincronizar segmentações).
- `src/visual.ts` — o switch (`<button role="switch">` + bolinha), sem card de formatação (zero-config).
- `src/themeSwitchLogic.ts` — `resolveThemeMode`, `distinctValues`, `resolveThemeOptionPair` (identifica qual valor é "escuro"), `parseColumnTarget`, todas testáveis isoladamente.
- `style/visual.less` — só o switch e um estado vazio/mal configurado.

## Rodando localmente

```bash
npm install
npm start          # pbiviz start — conecta no Power BI Desktop/Service em modo desenvolvedor
npm test           # roda a suíte de testes (Jest)
npm run lint       # eslint
npm run package    # gera o .pbiviz pra importar em um relatório
```

## Limitações conhecidas

- **Exatamente 2 valores esperados.** Se o campo vinculado tiver 0, 1 ou nenhum valor reconhecido como "escuro", o visual mostra uma mensagem em vez do switch. Com 3+ valores (incluindo um "escuro"), ele funciona mas escolhe arbitrariamente qual dos outros valores é o "claro" — não é o uso pretendido.
- Não faz sentido usar duas instâncias deste visual vinculadas a campos diferentes no mesmo relatório — o objetivo é ter um único campo de tema alimentando a medida "Modo Claro/Escuro" que todos os visuais leem.
- **O filtro é de página, não de relatório.** Sem configurar a sincronização (ver "Sincronizar entre páginas" acima), cada página mantém seu próprio estado de tema.
