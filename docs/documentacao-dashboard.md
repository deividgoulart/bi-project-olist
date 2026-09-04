# Documentação do Dashboard — Operações e CX

| | |
|---|---|
| **Área solicitante** | Operações e CX |
| **Data do levantamento** | 25/06/2026 |
| **Versão** | 1.0 |
| **Responsável pela aprovação** | Diretora de Operações e CX |

> **Nota sobre a natureza do projeto.** O cenário de negócio — área solicitante, stakeholders, metas e infraestrutura — é fictício, construído como exercício de método. Os dados são reais: o *Brazilian E-Commerce Public Dataset by Olist*, publicado no Kaggle. Onde o cenário simulado e a implementação real divergem, ambos estão documentados separadamente.

---

## 01 Visão Geral

### 1.1 Objetivo do Dashboard

Mostrar, numa tela única, a relação entre **prazo de entrega** e **satisfação do cliente**, permitindo identificar rapidamente onde os atrasos estão concentrados e como isso se reflete nas avaliações.

A pergunta central: *onde a demora na entrega está custando nota?*

### 1.2 Público-alvo

| Perfil | Uso | Necessidade |
|---|---|---|
| Coordenadores de CX e Logística | Diário | Identificar gargalos operacionais por região, categoria e seller |
| Diretora de Operações e CX | Executivo | Acompanhar indicadores contra metas |

**Nível de maturidade analítica:** intermediário. Já utilizam relatórios e alguns dashboards, mas com forte dependência de Excel e análises manuais.

### 1.3 Contexto do Negócio

Operação de marketplace com entregas realizadas por sellers distribuídos por todo o país. A satisfação do cliente é medida por avaliação pós-entrega (nota de 1 a 5), e a hipótese de trabalho da área é que o atraso na entrega é o principal fator de nota baixa — hipótese que até então não era possível verificar com agilidade.

### 1.4 Dores Anteriores Identificadas

- Análise feita em **relatórios mensais de Excel**, cruzando pedidos e avaliações manualmente.
- Processo lento: quando o gargalo era identificado, o mês já havia fechado.
- Dificuldade de enxergar a relação entre prazo e nota, por serem bases tratadas separadamente.
- Sem visão de onde o problema se concentra — região, categoria ou seller.

### 1.5 Frequência de Uso Esperada

- **Coordenadores:** diária, acompanhamento operacional.
- **Diretoria:** semanal e em fechamentos mensais.
- **Atualização dos dados:** diária.

---

## 02 Fontes de Dados

### 2.1 Infraestrutura técnica

**Cenário previsto no levantamento:** base transacional de e-commerce com extração diária para o data warehouse, consumida pelo Power BI.

**Implementação atual:** os dados vêm de arquivos CSV do dataset público da Olist, tratados diretamente no Power Query. Não há data warehouse nem pipeline agendado — o projeto é conceitual, e a camada de transformação que num cenário real estaria no ELT foi implementada no próprio Power Query.

| Camada | Cenário previsto | Implementação atual |
|---|---|---|
| Origem | Base transacional | CSV (dataset público) |
| Transformação | ELT no data warehouse | Power Query (M) |
| Modelagem | Data warehouse | Modelo tabular do Power BI |
| Visualização | Power BI | Power BI |

### 2.2 Sistemas de Origem e Tabelas Utilizadas

Seis arquivos do dataset, dos nove disponíveis:

| Arquivo | Consulta | Conteúdo |
|---|---|---|
| `olist_orders_dataset.csv` | `fatoPedidos` | Pedidos, status e datas do ciclo de entrega |
| `olist_order_items_dataset.csv` | `fatoItensPedido` | Itens de cada pedido, com produto e seller |
| `olist_order_reviews_dataset.csv` | `olist_order_reviews_dataset` | Avaliações pós-entrega |
| `olist_customers_dataset.csv` | `dimCliente` | Clientes e localização |
| `olist_products_dataset.csv` | `dimProduto` | Produtos e categorias |
| `olist_sellers_dataset.csv` | `dimVendedor` | Sellers |

`olist_geolocation_dataset.csv`, `olist_order_payments_dataset.csv` e `product_category_name_translation.csv` não são usados — nenhum indicador do escopo depende deles.

---

## 03 Transformações dos Dados

### 3.1 Processo ETL/ELT

Todo o tratamento acontece no **Power Query**, em modo Import. A sequência: leitura dos CSVs → tipagem → filtros de escopo → junções → colunas calculadas → remoção de colunas não utilizadas.

Duas consultas são intermediárias e não vão para o modelo: `olist_order_reviews_dataset` (consolidação das avaliações) alimenta `fatoPedidos`, que por sua vez restringe `fatoItensPedido`.

### 3.2 Principais Transformações Aplicadas

**Definição do escopo — `fatoPedidos`**

1. Filtro `order_status = "delivered"`. O dashboard trata de entrega e satisfação, então só pedidos efetivamente entregues entram.
2. Exclusão de pedidos sem data de entrega registrada (8 registros).
3. Filtro para pedidos com avaliação — sem nota, não há o que analisar do lado de satisfação.

**Consolidação das avaliações — `olist_order_reviews_dataset`**

Um pedido pode ter mais de uma avaliação na base de origem. A consulta ordena por `review_answer_timestamp` decrescente e agrupa por `order_id`, mantendo **apenas a avaliação mais recente**. Sem esse passo, o pedido seria duplicado na junção e distorceria toda a contagem.

**Colunas calculadas de negócio — `fatoPedidos`**

| Coluna | Regra |
|---|---|
| `dias_entrega` | Dias entre a compra e a entrega ao cliente |
| `atrasado` | 1 quando a entrega real superou a estimada, senão 0 |
| `dias_atraso` | Texto: "No prazo", ou "N dias" de atraso — usado como rótulo |

**Anonimização — `dimVendedor`**

O `seller_id` original é substituído por um rótulo sequencial ("Vendedor 1", "Vendedor 2", …) gerado por coluna de índice. O identificador real nunca chega ao relatório. Atende diretamente à restrição do Canvas de não expor dados sensíveis.

**Tratamento de nulos — `dimProduto`**

Categorias em branco viram `"Não categorizado"`, para que os produtos sem classificação continuem visíveis na análise em vez de sumirem silenciosamente.

**Restrição ao escopo — `fatoItensPedido`**

Junção do tipo *inner* com `fatoPedidos`, garantindo que a tabela de itens contenha apenas itens de pedidos dentro do escopo (entregues e avaliados).

**Redução de colunas**

Todas as consultas removem colunas não utilizadas por nenhum indicador. Reduz memória e tempo de atualização, e mantém o painel de campos limpo para quem monta relatório.

### 3.3 Modelo Dimensional

Modelo estrela com **dois fatos em grãos diferentes**:

```
              dimCalendario
                    │
              fatoPedidos ────── dimCliente
             (grão: pedido)
                    │
             fatoItensPedido
              (grão: item)
                ╱        ╲
        dimProduto      dimVendedor

          Tema  (desconectada — alimenta o tema claro/escuro)
```

| Tabela | Grão | Linhas |
|---|---|---|
| `fatoPedidos` | 1 por pedido | 95.824 |
| `fatoItensPedido` | 1 por item de pedido | 109.362 |
| `dimCliente` | 1 por cliente | 99.441 |
| `dimProduto` | 1 por produto | 32.951 |
| `dimVendedor` | 1 por seller | 3.095 |
| `dimCalendario` | 1 por data | — |
| `Tema` | 2 linhas (Claro/Escuro) | 2 |

**Decisão de modelagem: atributos trazidos ao grão do item.**

`fatoItensPedido` carrega colunas calculadas via `RELATED` — categoria do produto, nome do vendedor, datas de entrega e dias de atraso. À primeira vista é redundante, já que essas informações existem nas dimensões.

A razão é concreta: ao cruzar colunas de tabelas de grãos diferentes num visual **sem medida**, o mecanismo de eliminação de linhas do `SUMMARIZECOLUMNS` não se aplica, e o resultado é um produto cartesiano — uma tabela de detalhe explodia para centenas de milhares de linhas. Com os atributos no próprio grão do item, a tabela de detalhe consulta uma tabela só e o problema deixa de existir.

---

## 04 Estrutura do Dashboard

### Página 1 — Dashboard de operações e CX

Visão geral, respondendo "como estamos?" e "onde está o problema?".

| Elemento | Conteúdo |
|---|---|
| Cabeçalho | Título e sobretítulo |
| Filtros | Período (Ano-Mês), UF, Categoria, Seller |
| Cards de KPI | Os 5 indicadores contra suas metas |
| Evolução mensal | Combo: % de atraso e score médio ao longo dos meses |
| Atraso e score por UF | Barras por estado — ponto de entrada do drill-through |
| Categorias com mais avaliações ruins | Barras em pill, ordenadas |
| Piores sellers | Barras em pill, cruzando atraso e score |
| Tema | Interruptor claro/escuro |

### Página 2 — Detalhe de pedidos

Destino de drill-through, respondendo "quais pedidos exatamente?".

| Elemento | Conteúdo |
|---|---|
| Cards de recorte | Quantidade de pedidos, % de atraso e score médio do recorte |
| Tabela de itens | Pedido, categoria, seller, prazo estimado, entrega real, atraso e nota |
| Destaque de status | Coluna de atraso em pill colorido, verde para "No prazo" |
| Filtros | Período e UF |
| Voltar | Retorno à página de origem |

**Campos de drill-through:** categoria do produto, nome do vendedor e UF do cliente. Clicar em qualquer barra dessas dimensões na página 1 abre o detalhe já filtrado.

### Interatividade

- **Filtros cruzados:** clicar numa barra filtra os demais visuais da página.
- **Drill-through:** clique direito sobre uma barra → detalhe dos pedidos daquele recorte.
- **Tema claro/escuro:** um interruptor controla todos os visuais, via medida compartilhada.

---

## 05 Medidas

Nove medidas, organizadas em quatro pastas de exibição.

### Entrega e Prazo

**Tempo Médio de Entrega** — média de dias entre a compra e a entrega. Meta: ≤ 12 dias.
```dax
AVERAGE(fatoPedidos[dias_entrega])
```

**% Pedidos Atrasados** — proporção de pedidos entregues após a data estimada. Meta: ≤ 7%.
```dax
DIVIDE(
    CALCULATE(COUNTROWS(fatoPedidos), fatoPedidos[atrasado] = 1),
    COUNTROWS(fatoPedidos)
)
```

### Avaliação e Satisfação

**Score Médio** — nota média das avaliações, escala 1 a 5. Meta: ≥ 4,2.
```dax
AVERAGE(fatoPedidos[review_score])
```

**% Avaliações Ruins** — proporção de pedidos com nota 1 ou 2. Meta: ≤ 10%.
```dax
DIVIDE(
    CALCULATE(COUNTROWS(fatoPedidos), fatoPedidos[review_score] <= 2),
    COUNTROWS(fatoPedidos)
)
```

**% No Prazo com Nota 4-5** — indicador combinado de operação e satisfação: pedidos que chegaram no prazo *e* foram bem avaliados. Meta: ≥ 75%.
```dax
DIVIDE(
    CALCULATE(
        COUNTROWS(fatoPedidos),
        fatoPedidos[atrasado] = 0,
        fatoPedidos[review_score] >= 4
    ),
    COUNTROWS(fatoPedidos)
)
```

**Sem Dados de Avaliação** — indica se o recorte atual de filtros não retorna pedido nenhum. Para tratar estado vazio, não para agregação.
```dax
VAR ScoreZerado = ISBLANK([Score Médio]) || [Score Médio] = 0
VAR RuinsZerado = ISBLANK([% Avaliações Ruins]) || [% Avaliações Ruins] = 0
RETURN
    IF(ScoreZerado && RuinsZerado, "Sem dados", "Com dados")
```

### Volume

**Quantidade de Pedidos** — contagem de pedidos distintos no contexto.
```dax
DISTINCTCOUNT(fatoPedidos[order_id])
```

### Apoio a Visual

**Modo Visual** — alimenta o tema claro/escuro de todos os visuais a partir da tabela desconectada `Tema`.
```dax
IF(
    ISEMPTY('fatoItensPedido'),
    BLANK(),
    IF(SELECTEDVALUE('Tema'[Modo]) = "Escuro", "dark", "light")
)
```

> ⚠️ **O `ISEMPTY` é proposital e não deve ser simplificado.** O `SUMMARIZECOLUMNS` descarta as linhas em que *todas* as medidas são BLANK, e é esse descarte que faz um filtro vindo de uma tabela relacionada remover linhas de um agrupamento. Uma medida que nunca retorna BLANK desliga esse mecanismo — com ela presente num visual, filtros entre tabelas param de surtir efeito, silenciosamente.

**Status Atraso** — traduz o texto de atraso para as três palavras que o destaque em pill da tabela customizada reconhece.
```dax
SWITCH(
    TRUE(),
    ISBLANK(SELECTEDVALUE(fatoItensPedido[Dias Atrasados])), BLANK(),
    SELECTEDVALUE(fatoItensPedido[Dias Atrasados]) = "No prazo", "Positivo",
    "Negativo"
)
```

---

## 06 Controle de Acesso

**Não há RLS (Row-Level Security) implementado na V1.** Decisão consciente do levantamento, não omissão:

| Perfil | Acesso |
|---|---|
| Diretora de Operações e CX | Todos os dados |
| Coordenadores de CX e Logística | Todos os dados operacionais |

Como ambos os perfis precisam da visão completa e não há restrição por usuário no escopo, RLS acrescentaria complexidade sem benefício. A anonimização dos sellers, feita na camada de transformação, cobre a restrição de dados sensíveis levantada no Canvas.

**Se a V2 exigir RLS**, o caminho natural é uma dimensão de usuário relacionada a `dimVendedor` ou a região, com filtro por `USERPRINCIPALNAME()`.

---

## 07 Histórico de Mudanças

| Versão | Data | Mudanças |
|---|---|---|
| 1.0 | 2026-09 | Entrega inicial: modelo dimensional, 9 medidas, 2 páginas e 8 visuais customizados |

---

## 08 Anexos

| Documento | Link |
|---|---|
| Repositório do projeto | https://github.com/deividgoulart/bi-project-olist |
| Canvas de Requisitos | [`docs/img/canvas-de-requisitos.png`](img/canvas-de-requisitos.png) |
| Wireframe — Tela 1 | [`docs/img/wireframe-tela-1.jpg`](img/wireframe-tela-1.jpg) |
| Wireframe — Tela 2 | [`docs/img/wireframe-tela-2.jpg`](img/wireframe-tela-2.jpg) |
| Mockup aprovado | [`docs/img/mockup.png`](img/mockup.png) |
| Dataset de origem | [Brazilian E-Commerce Public Dataset by Olist](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce) |
| Metodologia seguida | [Criando dashboards do zero — Gabriela Costa](https://www.linkedin.com/pulse/criando-dashboards-do-zero-gabriela-costa-yswwf/) |

### Visuais customizados

Cada visual tem documentação própria no repositório, com decisões de implementação e limitações conhecidas: `tabelaOlist`, `barrasOlist`, `cardsOlist`, `filtroOlist`, `cabecalhoOlist`, `botaoVoltarOlist`, `temaOlist` e `fundoOlist`.
