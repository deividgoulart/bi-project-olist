"use strict";

// imports pontuais por submódulo (em vez de "d3" inteiro) — evita empacotar
// os ~30 submódulos do d3 (força, zoom, geo, hierarquia etc.) que este
// visual não usa, mantendo o bundle bem menor
import * as d3Selection from "d3-selection";
import * as d3Scale from "d3-scale";
import * as d3Axis from "d3-axis";
import * as d3Shape from "d3-shape";
import * as d3Array from "d3-array";
// import só por efeito colateral: registra .transition() nas seleções via
// merge de tipos declarativo do @types/d3-transition, usado nas transições
// suaves de posição/tamanho das barras
import "d3-transition";
const d3 = { ...d3Selection, ...d3Scale, ...d3Axis, ...d3Shape, ...d3Array };

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import DataView = powerbi.DataView;
import DataViewCategorical = powerbi.DataViewCategorical;
import DataViewValueColumnGroup = powerbi.DataViewValueColumnGroup;
import IViewport = powerbi.IViewport;

import { VisualFormattingSettingsModel } from "./settings";
import {
    toNumber,
    formatCompactNumber,
    niceCeil,
    computeAverage,
    sortCategoryOrder,
    computeTopNSelection,
    aggregateByGrouping,
    resolveThemeMode,
    SortMode,
    OthersAggregation,
    buildCategoryLevelSpans,
    splitConcatenatedLevels
} from "./chartLogic";

const OTHERS_LABEL = "Outros";

// identidade Olist fixa, sem card de "Cores e Identidade Visual" global —
// quem quiser outra cor por série já tem o "Cor" sempre disponível no
// formatting pane (ver buildSeriesColorCards)
const PRIMARY_COLOR = "#0A4EE4";
const FONT_FAMILY = "Plus Jakarta Sans";

// paleta usada quando há mais de uma série sem cor definida individualmente —
// tons do design system Olist, distintos o bastante pra várias séries lado a
// lado (índice a índice, sem depender de nenhuma escolha de modo)
const CATEGORICAL_PALETTE = ["#0A4EE4", "#B9700A", "#587A2E", "#0A1F9C", "#1C8484", "#001647"];

// tokens fixos do design system Olist para os dois temas — a mesma medida
// DAX (role "modoVisual") pode acionar o escuro em vários visuais ao mesmo
// tempo. Aplicados via CSS custom properties (--ds-color-*) em cada render,
// nos dois elementos que persistem entre renders (rootContainer e
// customTooltip) — por isso sempre setamos os dois conjuntos por completo,
// nunca só o que mudou, senão um valor de um tema "vaza" pro outro.
const DS_TOKENS = {
    light: {
        ink: "#131B33",
        inkSoft: "#4C5378",
        surface: "#FFFFFF",
        surfaceSunken: "#F4F6FC",
        line: "#DDE2F0",
        lineSoft: "#E9ECF6",
        shadow: "0 1px 2px rgba(19, 27, 51, .04), 0 8px 24px -12px rgba(19, 27, 51, .18)"
    },
    dark: {
        ink: "#E8ECFB",
        inkSoft: "#A6ADD1",
        surface: "#0B1330",
        surfaceSunken: "#060A1C",
        line: "#232D57",
        lineSoft: "#1A2246",
        shadow: "0 1px 2px rgba(0, 0, 0, .3), 0 12px 32px -14px rgba(0, 0, 0, .6)"
    }
};

// separador entre os níveis quando o eixo recebe uma hierarquia (ex: Ano > Mês
// vira "2018 · jan"). Vários campos num mesmo papel de agrupamento fazem o
// Power BI devolver colunas paralelas e alinhadas por linha — que para um eixo
// de gráfico é exatamente o comportamento desejado, ao contrário do que
// acontece num filtro (ver o README do filtroOlist)
const NIVEL_SEPARADOR = " · ";

function splitCategoryLevels(categories: powerbi.DataViewCategoryColumn[] | undefined): string[][] {
    const niveis = categories ?? [];
    if (niveis.length === 0) return [];
    return niveis[0].values.map((_, linha) =>
        niveis
            .map(nivel => String(nivel.values[linha] ?? "").trim())
            .filter(texto => texto.length > 0)
    );
}

function joinCategoryLevels(categories: powerbi.DataViewCategoryColumn[] | undefined): string[] {
    return splitCategoryLevels(categories).map(linha => linha.join(NIVEL_SEPARADOR));
}

type ChartType = "bar" | "line";
type AxisAssignment = "primary" | "secondary";

interface SeriesInfo {
    name: string;
    group: DataViewValueColumnGroup;
    valueColumn: powerbi.DataViewValueColumn;
    // true quando a série vem de um valor dinâmico do papel "legenda";
    // false quando vem de um campo de medida estático em "valores" (sem
    // legenda) — os dois casos usam fontes diferentes de identidade/cor,
    // ver buildSeriesInfos
    isLegendSeries: boolean;
    color: string;
    selectionId: ISelectionId;
    // combo/eixo duplo: "linha" só é respeitado com orientação "colunas" (ver
    // effectiveChartType em renderChart) — em "barras" toda série vira bar.
    // Séries em eixo secundário (de qualquer tipo) nunca entram no
    // empilhado/empilhado100, mesmo que o modo esteja ativo — ver renderChart.
    chartType: ChartType;
    axis: AxisAssignment;
    // como agregar essa série quando ela cai no agrupamento "Outros" do Top N
    // — soma faz sentido pra medidas aditivas, média pra medidas que já são
    // uma taxa/nota/média (ver aggregateByGrouping em chartLogic.ts)
    othersAggregation: OthersAggregation;
    // "barra preenchida" (estilo mockup Olist): trilho fino arredondado
    // ocupando a largura toda + um preenchimento em pill por cima, em vez do
    // retângulo comum — só tem efeito com orientação em Barras (horizontal) e
    // tipo Coluna/Barra, ver effectiveChartType/renderChart
    barFillStyle: "flat" | "pill";
}

interface BarDatum {
    categoryValue: string;
    seriesName: string;
    rawValue: number;
    y0: number;
    y1: number;
    color: string;
    selectionId: ISelectionId;
}

// BarDatum + a que eixo ele pertence — usado só na hora de desenhar (rectFor
// precisa saber qual das duas escalas de valor aplicar), não faz parte do
// contrato puro/testável de buildBarData
interface PositionedBarDatum extends BarDatum {
    axis: AxisAssignment;
}

interface LinePoint {
    categoryValue: string;
    value: number;
    color: string;
    selectionId: ISelectionId;
}

interface LineSeriesData {
    name: string;
    axis: AxisAssignment;
    color: string;
    points: LinePoint[];
}

interface TooltipItem {
    displayName: string;
    value: string;
}

export class Visual implements IVisual {
    private target: HTMLElement;
    private host: IVisualHost;
    private selectionManager: ISelectionManager;
    private formattingSettingsService: FormattingSettingsService;
    private formattingSettings: VisualFormattingSettingsModel;
    private dataView: DataView;
    private rootContainer: HTMLElement;
    private legendContainer: HTMLElement;
    private chartContainer: HTMLElement;
    private customTooltip: HTMLDivElement;
    private seriesInfos: SeriesInfo[] = [];
    // séries ocultadas por clique na legenda — estado só de UI (não
    // persistido via persistProperties), reseta se o visual for recriado,
    // igual ao comportamento padrão da legenda nativa do Power BI
    private hiddenSeriesNames: Set<string> = new Set();
    private lastViewport: IViewport | null = null;

    constructor(options: VisualConstructorOptions) {
        this.target = options.element;
        this.host = options.host;
        this.selectionManager = this.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.rootContainer = document.createElement("div");
        this.rootContainer.className = "barras-olist-root";

        this.legendContainer = document.createElement("div");
        this.legendContainer.className = "chart-legend";

        this.chartContainer = document.createElement("div");
        this.chartContainer.className = "chart-area";

        // o elemento que o Power BI aloca pro visual normalmente já é
        // transparente, mas fica explícito aqui — sem isso, o "recorte" das
        // quatro quinas fora do border-radius do card (ver .barras-olist-root)
        // podia ficar branco em vez de mostrar o fundo real do canvas do
        // relatório atrás do visual
        this.target.style.backgroundColor = "transparent";

        this.rootContainer.appendChild(this.chartContainer);
        this.target.appendChild(this.rootContainer);

        // tooltip customizada (não a nativa do Power BI) pra poder seguir a
        // identidade visual Olist — anexada ao <body> pra não ficar cortada
        // pelo overflow:hidden do container do gráfico
        this.customTooltip = document.createElement("div");
        this.customTooltip.className = "custom-tooltip";
        this.customTooltip.style.display = "none";
        document.body.appendChild(this.customTooltip);

        // até o primeiro update() com dados chegar, mostra um esqueleto em
        // vez de ficar em branco (não há evento de "carregando" exposto pela
        // API pro visual, então isso cobre só a primeira renderização)
        this.renderSkeleton();

        // clique/botão direito no fundo (fora de uma barra/ponto) limpa a
        // seleção ou abre o menu nativo — "fundo" inclui os wrappers extras
        // que só existem quando "Máximo de barras visíveis" está com eixos
        // fixos (chart-scroll-wrapper e chart-axis-pane), senão esse clique
        // parava de funcionar nesse modo (o alvo deixa de ser exatamente
        // chartContainer quando ele passa a ter filhos em vez do svg direto)
        const isChartBackground = (target: EventTarget | null): boolean =>
            target === this.rootContainer ||
            target === this.chartContainer ||
            (target instanceof HTMLElement &&
                (target.classList.contains("chart-scroll-wrapper") || target.classList.contains("chart-axis-pane")));

        this.rootContainer.addEventListener("contextmenu", (event: MouseEvent) => {
            if (isChartBackground(event.target)) {
                this.selectionManager.showContextMenu({}, { x: event.clientX, y: event.clientY });
                event.preventDefault();
            }
        });

        this.rootContainer.addEventListener("click", (event: MouseEvent) => {
            if (isChartBackground(event.target)) {
                this.selectionManager.clear();
            }
        });
    }

    public destroy(): void {
        this.customTooltip.remove();
    }

    public update(options: VisualUpdateOptions): void {
        this.dataView = options.dataViews?.[0];
        this.lastViewport = options.viewport;
        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualFormattingSettingsModel,
            this.dataView
        );

        const categorical = this.dataView?.categorical;
        if (!categorical?.categories?.length || !categorical?.values?.length) {
            this.seriesInfos = [];
            this.renderEmptyState();
            return;
        }

        this.renderChart(categorical, options.viewport);
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const model = this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
        // sempre (mesmo com 1 série só): Tipo/Eixo/Estilo da barra fazem
        // sentido mesmo sem uma segunda série pra combinar, não só "Cor"
        model.cards.push(...this.buildSeriesColorCards(this.seriesInfos));
        return model;
    }

    private renderEmptyState(): void {
        this.rootContainer.replaceChildren();
        this.rootContainer.className = "barras-olist-root";
        const msg = document.createElement("div");
        msg.className = "empty-state";
        msg.textContent = "Adicione uma categoria e ao menos um valor para exibir o gráfico.";
        this.rootContainer.appendChild(msg);
    }

    private renderSkeleton(): void {
        const skeleton = document.createElement("div");
        skeleton.className = "chart-skeleton";
        const heights = [55, 80, 40, 95, 65, 45, 75];
        heights.forEach(h => {
            const bar = document.createElement("div");
            bar.className = "skeleton-bar";
            bar.style.height = `${h}%`;
            skeleton.appendChild(bar);
        });
        this.chartContainer.appendChild(skeleton);
    }

    // navegação por teclado entre barras (setas esquerda/direita) — segue a
    // ordem no DOM, independente da orientação do gráfico, pra manter o
    // comportamento previsível pra quem usa leitor de tela
    private focusAdjacentBar(current: SVGGElement, direction: 1 | -1): void {
        let sibling = direction === 1 ? current.nextElementSibling : current.previousElementSibling;
        while (sibling && !sibling.classList.contains("bar-item")) {
            sibling = direction === 1 ? sibling.nextElementSibling : sibling.previousElementSibling;
        }
        if (sibling) {
            (sibling as unknown as SVGElement).focus();
        }
    }

    private resolveSeriesColor(
        isLegendSeries: boolean,
        group: DataViewValueColumnGroup,
        valueColumn: powerbi.DataViewValueColumn,
        name: string,
        index: number,
        totalSeries: number
    ): string {
        // alto contraste: ignora paleta/override e usa só a cor garantida
        // pelo host, seguindo a diretriz de acessibilidade do Power BI de
        // desenhar apenas com foreground/background nesse modo
        if (this.host.colorPalette.isHighContrast) {
            return this.host.colorPalette.foreground.value;
        }

        // série vinda de "legenda" (valor dinâmico): a cor só pode ser presa a um
        // seletor de data-point/série (objects fica no grupo). Série vinda de uma
        // medida estática em "valores" (sem legenda): a cor é presa à própria
        // coluna de metadados da medida, igual à formatação por coluna do
        // tabelaOlist — cada medida tem seu próprio "objects", diferente de todas
        // compartilharem o objects do único grupo implícito
        const objectsBag: powerbi.DataViewObjects | undefined = isLegendSeries
            ? group.objects
            : valueColumn.source.objects;
        const overrideColor = (objectsBag?.["seriesStyle"] as any)?.fill?.solid?.color;
        if (overrideColor) return overrideColor;

        // sem override por série: cor primária fixa (série única) ou a
        // paleta categórica Olist (várias séries) — sem card global de
        // cores pra escolher entre elas; quem quiser outra cor define no
        // "Cor" por série (sempre disponível, ver buildSeriesColorCards)
        if (totalSeries <= 1) return PRIMARY_COLOR;
        return CATEGORICAL_PALETTE[index % CATEGORICAL_PALETTE.length];
    }

    // mesmo objectsBag usado pra cor (ver resolveSeriesColor) — chartType e
    // axis são enumerações simples, então o valor já vem como string direto
    // (sem o aninhamento fill.solid.color que as cores têm)
    private resolveSeriesStyleFlags(
        isLegendSeries: boolean,
        group: DataViewValueColumnGroup,
        valueColumn: powerbi.DataViewValueColumn
    ): { chartType: ChartType; axis: AxisAssignment; othersAggregation: OthersAggregation; barFillStyle: "flat" | "pill" } {
        const objectsBag: powerbi.DataViewObjects | undefined = isLegendSeries
            ? group.objects
            : valueColumn.source.objects;
        const seriesStyle = objectsBag?.["seriesStyle"] as any;
        const chartType: ChartType = seriesStyle?.chartType === "line" ? "line" : "bar";
        const axis: AxisAssignment = seriesStyle?.axis === "secondary" ? "secondary" : "primary";
        const othersAggregation: OthersAggregation = seriesStyle?.othersAggregation === "average" ? "average" : "sum";
        const barFillStyle: "flat" | "pill" = seriesStyle?.barFillStyle === "pill" ? "pill" : "flat";
        return { chartType, axis, othersAggregation, barFillStyle };
    }

    private buildSeriesInfos(categorical: DataViewCategorical): SeriesInfo[] {
        const groups = categorical.values.grouped();

        interface RawSeries {
            name: string;
            group: DataViewValueColumnGroup;
            valueColumn: powerbi.DataViewValueColumn;
            isLegendSeries: boolean;
            selectionId: ISelectionId;
        }

        const raw: RawSeries[] = [];
        for (const group of groups) {
            const isLegendSeries = group.name !== undefined;
            // sem legenda, o Power BI junta TODAS as medidas de "valores" (e
            // "meta") num único grupo implícito — cada coluna do papel
            // "valores" dentro de group.values é uma série própria (uma por
            // medida); a coluna de "meta" fica de fora daqui, ela não é uma
            // série, é lida à parte em extractMetaByCategory. Com legenda,
            // cada grupo já corresponde a uma série e só deve ter uma coluna
            // de valor (mais a de meta, também filtrada fora).
            const valueColumnsOnly = group.values.filter(v => v.source.roles?.["valores"]);
            for (const valueColumn of valueColumnsOnly) {
                const name = isLegendSeries ? String(group.name) : valueColumn.source.displayName;
                const selectionId = this.host.createSelectionIdBuilder()
                    .withSeries(categorical.values, isLegendSeries ? group : valueColumn)
                    .createSelectionId();
                raw.push({ name, group, valueColumn, isLegendSeries, selectionId });
            }
        }

        return raw.map((series, index) => {
            const { chartType, axis, othersAggregation, barFillStyle } = this.resolveSeriesStyleFlags(series.isLegendSeries, series.group, series.valueColumn);
            return {
                name: series.name,
                group: series.group,
                valueColumn: series.valueColumn,
                isLegendSeries: series.isLegendSeries,
                selectionId: series.selectionId,
                color: this.resolveSeriesColor(series.isLegendSeries, series.group, series.valueColumn, series.name, index, raw.length),
                chartType,
                axis,
                othersAggregation,
                barFillStyle
            };
        });
    }

    // mapa categoria -> série -> valor bruto. Fica desacoplado da posição
    // original da linha (diferente do acesso direto por índice que existia
    // antes) pra poder alimentar tanto o caso normal quanto o agrupamento
    // "Top N + Outros" (que precisa somar várias categorias originais numa
    // única entrada sintética) com a mesma lógica de leitura
    private buildCategoryValueMap(
        seriesInfos: SeriesInfo[],
        categoryValues: string[]
    ): Map<string, Map<string, number>> {
        const map = new Map<string, Map<string, number>>();
        categoryValues.forEach((category, i) => {
            const seriesMap = new Map<string, number>();
            seriesInfos.forEach(series => {
                seriesMap.set(series.name, toNumber(series.valueColumn.values[i]));
            });
            map.set(category, seriesMap);
        });
        return map;
    }

    private buildBarData(
        categoryValues: string[],
        categoryValueMap: Map<string, Map<string, number>>,
        seriesInfos: SeriesInfo[],
        seriesMode: string,
        categorical: DataViewCategorical
    ): BarDatum[] {
        const n = categoryValues.length;
        const result: BarDatum[] = [];
        const valueFor = (series: SeriesInfo, category: string): number => categoryValueMap.get(category)?.get(series.name) ?? 0;

        // índice de cada valor de categoria na coluna original — categoryValues
        // já vem ordenado/cortado pelo Top N, então não dá pra usar a posição
        // dele como índice
        // a chave tem que ser montada do mesmo jeito que em renderChart (todos
        // os níveis juntos), senão a busca falha e toda barra cai na identidade
        // da série — o que derruba cross-filter e drillthrough sem erro nenhum
        const categoryColumn = categorical.categories?.[0];
        const categoryIndexOf = new Map<string, number>();
        joinCategoryLevels(categorical.categories).forEach((key, index) => {
            if (!categoryIndexOf.has(key)) categoryIndexOf.set(key, index);
        });

        // identidade por ponto (categoria + série), não só por série: é o que o
        // Power BI usa pra cross-filtrar a categoria clicada e pra oferecer
        // "Drillthrough" no menu de contexto — sem a categoria na identidade a
        // opção simplesmente não aparece. O balde "Outros" do Top N não
        // corresponde a nenhuma categoria do modelo, então mantém a identidade
        // da série (e, corretamente, não oferece drillthrough: ele representa
        // várias categorias de uma vez)
        const idFor = (series: SeriesInfo, category: string): ISelectionId => {
            const index = categoryIndexOf.get(category);
            if (!categoryColumn || index === undefined) return series.selectionId;
            return this.host.createSelectionIdBuilder()
                .withCategory(categoryColumn, index)
                .withSeries(categorical.values, series.isLegendSeries ? series.group : series.valueColumn)
                .createSelectionId();
        };

        if (seriesMode === "agrupado" || seriesInfos.length <= 1) {
            for (let i = 0; i < n; i++) {
                const category = categoryValues[i];
                for (const series of seriesInfos) {
                    const raw = valueFor(series, category);
                    result.push({
                        categoryValue: category,
                        seriesName: series.name,
                        rawValue: raw,
                        y0: raw < 0 ? raw : 0,
                        y1: raw < 0 ? 0 : raw,
                        color: series.color,
                        selectionId: idFor(series, category)
                    });
                }
            }
            return result;
        }

        const seriesNames = seriesInfos.map(s => s.name);
        const stackRows: Array<Record<string, number>> = [];
        for (let i = 0; i < n; i++) {
            const category = categoryValues[i];
            const row: Record<string, number> = {};
            seriesInfos.forEach(s => { row[s.name] = valueFor(s, category); });
            stackRows.push(row);
        }

        const stackGen = d3.stack<Record<string, number>>().keys(seriesNames);
        if (seriesMode === "empilhado100") {
            stackGen.offset(d3.stackOffsetExpand);
        }
        const stacked = stackGen(stackRows);

        stacked.forEach((layer, sIdx) => {
            const series = seriesInfos[sIdx];
            layer.forEach((point, i) => {
                const category = categoryValues[i];
                result.push({
                    categoryValue: category,
                    seriesName: series.name,
                    rawValue: valueFor(series, category),
                    y0: point[0],
                    y1: point[1],
                    color: series.color,
                    selectionId: idFor(series, category)
                });
            });
        });

        return result;
    }

    private renderLegend(seriesInfos: SeriesInfo[], orientation: string): void {
        this.legendContainer.replaceChildren();
        seriesInfos.forEach(series => {
            const isHidden = this.hiddenSeriesNames.has(series.name);
            // "linha" só é efetivo em orientação Colunas — na legenda mostra
            // o que realmente é desenhado, não a preferência ignorada
            const isLine = orientation === "colunas" && series.chartType === "line";

            const item = document.createElement("div");
            item.className = isHidden ? "legend-item legend-item-hidden" : "legend-item";
            item.tabIndex = 0;
            item.setAttribute("role", "button");
            item.setAttribute("aria-pressed", String(!isHidden));
            item.setAttribute("aria-label", `Série ${series.name}, clique para ${isHidden ? "mostrar" : "ocultar"}`);

            const swatch = document.createElement("span");
            swatch.className = isLine ? "legend-swatch legend-swatch-line" : "legend-swatch";
            swatch.style.backgroundColor = isLine ? "transparent" : series.color;
            swatch.style.borderColor = isLine ? series.color : "";

            const label = document.createElement("span");
            label.className = "legend-label";
            label.textContent = series.name;

            item.appendChild(swatch);
            item.appendChild(label);

            // clicar numa série da legenda oculta/mostra ela no gráfico —
            // estado só de UI (this.hiddenSeriesNames), não fica salvo entre
            // sessões, igual à legenda nativa do Power BI
            const toggleSeries = (): void => {
                if (this.hiddenSeriesNames.has(series.name)) {
                    this.hiddenSeriesNames.delete(series.name);
                } else {
                    this.hiddenSeriesNames.add(series.name);
                }
                if (this.dataView?.categorical && this.lastViewport) {
                    this.renderChart(this.dataView.categorical, this.lastViewport);
                }
            };
            item.addEventListener("click", (event: MouseEvent) => {
                event.stopPropagation();
                toggleSeries();
            });
            item.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleSeries();
                }
            });

            this.legendContainer.appendChild(item);
        });
    }

    // Tooltip própria (não a nativa do host) para poder seguir a identidade
    // visual Olist (cores, fonte, cartão com sombra), o que a tooltipService
    // nativa do Power BI não permite.
    private showCustomTooltip(
        items: TooltipItem[],
        isDarkMode: boolean,
        event: MouseEvent,
        highContrast?: { foreground: string; background: string }
    ): void {
        if (items.length === 0) return;

        this.customTooltip.replaceChildren();
        this.customTooltip.className = "custom-tooltip";
        // fallback pra sans-serif do sistema só por segurança — a fonte em
        // si já vem embutida em base64 no CSS (ver @font-face em visual.less)
        this.customTooltip.style.fontFamily = `${FONT_FAMILY}, 'Segoe UI', sans-serif`;

        // a tooltip fica anexada ao <body>, fora de rootContainer, então não
        // herda os --ds-color-* de lá — precisa receber os tokens direto
        const ds = isDarkMode ? DS_TOKENS.dark : DS_TOKENS.light;
        this.customTooltip.style.setProperty("--ds-color-ink", ds.ink);
        this.customTooltip.style.setProperty("--ds-color-ink-soft", ds.inkSoft);
        this.customTooltip.style.setProperty("--ds-color-surface", ds.surface);
        this.customTooltip.style.setProperty("--ds-color-line", ds.line);
        this.customTooltip.style.setProperty("--ds-color-line-soft", ds.lineSoft);
        this.customTooltip.style.setProperty("--ds-shadow-card", ds.shadow);

        if (highContrast) {
            // alto contraste: ignora o preset decorativo e usa só as cores
            // garantidas pelo host, seguindo a diretriz de acessibilidade
            this.customTooltip.style.backgroundColor = highContrast.background;
            this.customTooltip.style.color = highContrast.foreground;
            this.customTooltip.style.border = `1px solid ${highContrast.foreground}`;
            this.customTooltip.style.boxShadow = "none";
        } else {
            this.customTooltip.style.backgroundColor = "";
            this.customTooltip.style.color = "";
            this.customTooltip.style.border = "";
            this.customTooltip.style.boxShadow = "";
        }

        items.forEach(item => {
            const row = document.createElement("div");
            row.className = "tooltip-row";

            const label = document.createElement("span");
            label.className = "tooltip-label";
            label.textContent = item.displayName;

            const value = document.createElement("span");
            value.className = "tooltip-value";
            value.textContent = item.value;

            row.appendChild(label);
            row.appendChild(value);
            this.customTooltip.appendChild(row);
        });

        this.customTooltip.style.display = "block";
        this.positionCustomTooltip(event);
    }

    private positionCustomTooltip(event: MouseEvent): void {
        if (this.customTooltip.style.display === "none") return;

        const offset = 14;
        let left = event.clientX + offset;
        let top = event.clientY + offset;

        const rect = this.customTooltip.getBoundingClientRect();
        if (left + rect.width > window.innerWidth) {
            left = event.clientX - rect.width - offset;
        }
        if (top + rect.height > window.innerHeight) {
            top = event.clientY - rect.height - offset;
        }

        this.customTooltip.style.left = `${Math.max(4, left)}px`;
        this.customTooltip.style.top = `${Math.max(4, top)}px`;
    }

    private hideCustomTooltip(): void {
        this.customTooltip.style.display = "none";
    }

    private buildSeriesColorCards(seriesInfos: SeriesInfo[]): powerbi.visuals.FormattingCard[] {
        return seriesInfos.map((series, index) => {
            // série de legenda: só dá pra mirar via seletor de data-point/série.
            // série de medida (sem legenda): mira a coluna de metadados da
            // medida diretamente, como a formatação por coluna do tabelaOlist —
            // necessário pra cada medida guardar sua própria cor persistida
            // (senão todas cairiam no mesmo "objects" do grupo implícito)
            const selector: powerbi.data.Selector = series.isLegendSeries
                ? series.selectionId.getSelector()
                : { metadata: series.valueColumn.source.queryName };
            const fillSlice: powerbi.visuals.FormattingSlice = {
                displayName: "Cor",
                uid: `seriesFill_${index}`,
                control: {
                    type: powerbi.visuals.FormattingComponent.ColorPicker,
                    properties: {
                        descriptor: {
                            objectName: "seriesStyle",
                            propertyName: "fill",
                            selector
                        },
                        value: { value: series.color }
                    }
                }
            };

            // opções de "Tipo"/"Eixo" vêm do enum declarado em capabilities.json
            // (seriesStyle.chartType/axis) — "Linha" fica sempre disponível
            // mas só tem efeito com orientação em Colunas (ver
            // effectiveChartType em renderChart); em Barras a escolha é
            // ignorada e a série sempre desenha como barra normal
            const chartTypeSlice: powerbi.visuals.FormattingSlice = {
                displayName: "Tipo",
                uid: `seriesChartType_${index}`,
                control: {
                    type: powerbi.visuals.FormattingComponent.Dropdown,
                    properties: {
                        descriptor: {
                            objectName: "seriesStyle",
                            propertyName: "chartType",
                            selector
                        },
                        value: series.chartType
                    }
                }
            };

            const axisSlice: powerbi.visuals.FormattingSlice = {
                displayName: "Eixo",
                uid: `seriesAxis_${index}`,
                control: {
                    type: powerbi.visuals.FormattingComponent.Dropdown,
                    properties: {
                        descriptor: {
                            objectName: "seriesStyle",
                            propertyName: "axis",
                            selector
                        },
                        value: series.axis
                    }
                }
            };

            // soma faz sentido pra medidas aditivas (contagem, receita); média
            // pra medidas que já são uma taxa/nota/média — somar essas no
            // agrupamento "Outros" do Top N estourava a escala sem sentido
            const othersAggregationSlice: powerbi.visuals.FormattingSlice = {
                displayName: "Agregação em 'Outros' (Top N)",
                uid: `seriesOthersAgg_${index}`,
                control: {
                    type: powerbi.visuals.FormattingComponent.Dropdown,
                    properties: {
                        descriptor: {
                            objectName: "seriesStyle",
                            propertyName: "othersAggregation",
                            selector
                        },
                        value: series.othersAggregation
                    }
                }
            };

            // "barra preenchida" (estilo mockup Olist): trilho fino
            // arredondado + preenchimento em pill, em vez do retângulo comum
            // — só tem efeito com Tipo = Coluna/Barra e orientação em Barras
            // (horizontal); nos demais casos a série renderiza normal
            const barFillStyleSlice: powerbi.visuals.FormattingSlice = {
                displayName: "Estilo da barra",
                uid: `seriesBarFillStyle_${index}`,
                control: {
                    type: powerbi.visuals.FormattingComponent.Dropdown,
                    properties: {
                        descriptor: {
                            objectName: "seriesStyle",
                            propertyName: "barFillStyle",
                            selector
                        },
                        value: series.barFillStyle
                    }
                }
            };

            const card: powerbi.visuals.FormattingCard = {
                displayName: `Série: ${series.name}`,
                uid: `seriesStyle_card_${index}`,
                groups: [
                    {
                        displayName: undefined,
                        uid: `seriesStyle_group_${index}`,
                        slices: [fillSlice, chartTypeSlice, axisSlice, othersAggregationSlice, barFillStyleSlice]
                    }
                ]
            };

            return card;
        });
    }

    private renderChart(categorical: DataViewCategorical, viewport: IViewport): void {
        const chartStyle = this.formattingSettings.chartStyleCard;
        const axisStyle = this.formattingSettings.axisStyleCard;
        const dataLabels = this.formattingSettings.dataLabelsCard;
        const legendStyle = this.formattingSettings.legendStyleCard;
        const refLineCard = this.formattingSettings.referenceLineCard;

        const orientation = chartStyle.orientation.value.value as string;
        const seriesMode = chartStyle.seriesMode.value.value as string;
        const sortMode = chartStyle.sortMode.value.value as SortMode;
        const topN = chartStyle.topN.value ?? 0;
        const maxItemsVisible = chartStyle.maxItemsVisible.value ?? 0;

        const palette = this.host.colorPalette;
        const isHighContrast = palette.isHighContrast;
        const hcForeground = palette.foreground.value;
        const hcBackground = palette.background.value;

        // medida opcional (role "modoVisual") que deixa uma única medida DAX
        // controlar o tema claro/escuro de vários visuais ao mesmo tempo —
        // lê o primeiro valor porque é um valor "global", igual pra todo o
        // gráfico, não algo que varia por categoria/série
        const themeColumn = categorical.values.find(v => v.source.roles?.["modoVisual"]);
        const isDarkMode = themeColumn ? resolveThemeMode(themeColumn.values[0]) === "dark" : false;

        // "linha" como tipo de série só é respeitado com orientação em
        // Colunas — combinar linha com Barras (horizontal) é raro e
        // complicado de desenhar bem, então a série cai pra barra normal
        const effectiveChartType = (s: SeriesInfo): ChartType => orientation === "colunas" ? s.chartType : "bar";

        const seriesInfos = this.buildSeriesInfos(categorical);
        this.seriesInfos = seriesInfos;
        // séries ocultadas pelo clique na legenda ficam fora da renderização
        // (barras, domínio do eixo, empilhamento, Top N, linha de
        // referência), mas continuam na legenda e no getFormattingModel()
        // pra poder ser reativadas / ter a cor configurada
        const visibleSeriesInfos = seriesInfos.filter(s => !this.hiddenSeriesNames.has(s.name));

        // combo/eixo duplo: séries em eixo secundário (barra ou linha) e
        // séries do tipo linha nunca participam do empilhado/empilhado100 —
        // não faz sentido empilhar uma escala diferente ou uma linha junto
        // com barras. Elas sempre desenham "soltas" (uma por categoria),
        // mesmo que o modo de série esteja em Empilhado/Empilhado 100%; só as
        // barras do eixo primário respeitam esse modo entre si.
        const primaryBarSeries = visibleSeriesInfos.filter(s => s.axis === "primary" && effectiveChartType(s) === "bar");
        const secondaryBarSeries = visibleSeriesInfos.filter(s => s.axis === "secondary" && effectiveChartType(s) === "bar");
        const primaryLineSeries = visibleSeriesInfos.filter(s => s.axis === "primary" && effectiveChartType(s) === "line");
        const secondaryLineSeries = visibleSeriesInfos.filter(s => s.axis === "secondary" && effectiveChartType(s) === "line");
        const hasSecondaryAxis = secondaryBarSeries.length > 0 || secondaryLineSeries.length > 0;

        const categoryColumn = categorical.categories[0];
        const originalCategoryValues = joinCategoryLevels(categorical.categories);
        const categoryLevelsLabel = categorical.categories.map(c => c.source.displayName).join(NIVEL_SEPARADOR);

        let workingCategoryValues = originalCategoryValues;
        let categoryValueMap = this.buildCategoryValueMap(visibleSeriesInfos, originalCategoryValues);

        // Top N + "Outros": decide com base no total (soma de todas as séries
        // visíveis) por categoria; depois agrega cada série — e a meta, se
        // houver — separadamente pro mesmo conjunto de categorias agrupadas
        if (topN > 0 && topN < workingCategoryValues.length) {
            const totalsList = workingCategoryValues.map(category => {
                const seriesMap = categoryValueMap.get(category);
                const total = seriesMap ? Array.from(seriesMap.values()).reduce((s, v) => s + v, 0) : 0;
                return { category, total };
            });
            const { kept, grouped } = computeTopNSelection(totalsList, topN);

            if (grouped.length > 0) {
                const newCategoryValueMap = new Map<string, Map<string, number>>();
                kept.forEach(category => newCategoryValueMap.set(category, categoryValueMap.get(category) ?? new Map()));

                const othersSeriesMap = new Map<string, number>();
                visibleSeriesInfos.forEach(series => {
                    const perCategory = new Map<string, number>();
                    workingCategoryValues.forEach(category => {
                        perCategory.set(category, categoryValueMap.get(category)?.get(series.name) ?? 0);
                    });
                    const aggregated = aggregateByGrouping(perCategory, kept, grouped, OTHERS_LABEL, series.othersAggregation);
                    othersSeriesMap.set(series.name, aggregated.get(OTHERS_LABEL) ?? 0);
                });
                newCategoryValueMap.set(OTHERS_LABEL, othersSeriesMap);

                categoryValueMap = newCategoryValueMap;
                workingCategoryValues = [...kept, OTHERS_LABEL];
            }
        }

        // ordenação — recalculada sobre o conjunto pós Top N (que pode
        // incluir "Outros")
        const sortTotals: Record<string, number> = {};
        workingCategoryValues.forEach(category => {
            const seriesMap = categoryValueMap.get(category);
            sortTotals[category] = seriesMap ? Array.from(seriesMap.values()).reduce((s, v) => s + v, 0) : 0;
        });
        const categoryValues = sortCategoryOrder(workingCategoryValues, sortTotals, sortMode);

        // barras do eixo primário respeitam o modo de série (agrupado ou
        // empilhado) entre si; barras do eixo secundário e todas as linhas
        // nunca empilham — sempre "agrupado" (ver comentário acima)
        const primaryBarData = this.buildBarData(categoryValues, categoryValueMap, primaryBarSeries, seriesMode, categorical);
        const secondaryBarData = this.buildBarData(categoryValues, categoryValueMap, secondaryBarSeries, "agrupado", categorical);
        const primaryLineBarData = this.buildBarData(categoryValues, categoryValueMap, primaryLineSeries, "agrupado", categorical);
        const secondaryLineBarData = this.buildBarData(categoryValues, categoryValueMap, secondaryLineSeries, "agrupado", categorical);

        const toLinesData = (series: SeriesInfo[], data: BarDatum[], axis: AxisAssignment): LineSeriesData[] =>
            series.map(s => ({
                name: s.name,
                axis,
                color: s.color,
                points: data
                    .filter(d => d.seriesName === s.name)
                    .map(d => ({ categoryValue: d.categoryValue, value: d.rawValue, color: d.color, selectionId: d.selectionId }))
            }));
        const lineSeriesData: LineSeriesData[] = [
            ...toLinesData(primaryLineSeries, primaryLineBarData, "primary"),
            ...toLinesData(secondaryLineSeries, secondaryLineBarData, "secondary")
        ];

        const primaryBars: PositionedBarDatum[] = primaryBarData.map(d => ({ ...d, axis: "primary" }));
        const secondaryBars: PositionedBarDatum[] = secondaryBarData.map(d => ({ ...d, axis: "secondary" }));
        const allBarData: PositionedBarDatum[] = [...primaryBars, ...secondaryBars];

        // "barra preenchida" (estilo mockup Olist) — calculado cedo, antes do
        // domínio do eixo de valor: quando alguma série de um eixo usa esse
        // estilo, o EIXO (não só a barra) passa a seguir o teto arredondado
        // do pill nesse eixo, senão o eixo mostra uma escala e a barra outra
        const pillStyleSeriesNames = new Set(
            visibleSeriesInfos.filter(s => orientation === "barras" && effectiveChartType(s) === "bar" && s.barFillStyle === "pill").map(s => s.name)
        );
        const isPillBar = (d: PositionedBarDatum): boolean => pillStyleSeriesNames.has(d.seriesName);
        const pillMaxByAxis: Record<AxisAssignment, number> = { primary: 1, secondary: 1 };
        const hasPillByAxis: Record<AxisAssignment, boolean> = { primary: false, secondary: false };
        (["primary", "secondary"] as const).forEach(axis => {
            const values = allBarData.filter(bd => isPillBar(bd) && bd.axis === axis).map(bd => Math.abs(bd.rawValue));
            if (values.length > 0) {
                hasPillByAxis[axis] = true;
                pillMaxByAxis[axis] = niceCeil(Math.max(...values));
            }
        });

        // a linha de referência sempre compara com o eixo primário — a
        // média, quando usada, soma só o que está nesse eixo (barra + linha),
        // pra não misturar com uma escala bem diferente do eixo secundário
        const showRefLine = refLineCard.show.value && seriesMode !== "empilhado100";
        const primaryAxisRawValues = [...primaryBarData, ...primaryLineBarData].map(d => d.rawValue);
        const refLineValue = showRefLine
            ? (refLineCard.mode.value.value === "fixo" ? refLineCard.fixedValue.value : computeAverage(primaryAxisRawValues))
            : null;

        // cada série pode ter seu próprio format string (moeda, %, decimais
        // diferentes...) — sobretudo relevante em combo/eixo duplo, onde as
        // duas séries quase sempre têm escalas e formatos bem diferentes.
        // "formatter"/"valuesSource" viram só o representante do eixo
        // primário (ticks do eixo, linha de referência); tooltip, rótulo e
        // aria-label de cada barra/ponto usam o formatter da própria série
        const primaryValuesSource = [...primaryBarSeries, ...primaryLineSeries][0]?.valueColumn.source
            ?? visibleSeriesInfos[0]?.valueColumn.source;
        const secondaryValuesSource = [...secondaryBarSeries, ...secondaryLineSeries][0]?.valueColumn.source;
        const formatter = valueFormatter.create({ format: primaryValuesSource?.format });
        const formatter2 = secondaryValuesSource ? valueFormatter.create({ format: secondaryValuesSource.format }) : formatter;

        const seriesFormatterCache = new Map<string, valueFormatter.IValueFormatter>();
        const formatterForSeries = (seriesName: string): valueFormatter.IValueFormatter => {
            const cached = seriesFormatterCache.get(seriesName);
            if (cached) return cached;
            const src = visibleSeriesInfos.find(s => s.name === seriesName)?.valueColumn.source;
            const f = valueFormatter.create({ format: src?.format });
            seriesFormatterCache.set(seriesName, f);
            return f;
        };

        this.rootContainer.replaceChildren();
        this.rootContainer.className = `barras-olist-root${isHighContrast ? " high-contrast" : ""}`;
        // fallback pra sans-serif do sistema só por segurança — a fonte em si
        // (Plus Jakarta Sans) já vem embutida em base64 no CSS, não depende
        // de instalação nem de internet (ver @font-face em visual.less)
        this.rootContainer.style.fontFamily = `${FONT_FAMILY}, 'Segoe UI', sans-serif`;
        this.rootContainer.style.color = isHighContrast ? hcForeground : "";
        this.rootContainer.style.backgroundColor = isHighContrast ? hcBackground : "";

        // tokens fixos claro/escuro (ver DS_TOKENS) — setados sempre por
        // completo (nunca só o que mudou) porque rootContainer persiste
        // entre renders e um valor do tema anterior "vazaria" pro atual
        const ds = isDarkMode ? DS_TOKENS.dark : DS_TOKENS.light;
        this.rootContainer.style.setProperty("--ds-color-ink", ds.ink);
        this.rootContainer.style.setProperty("--ds-color-ink-soft", ds.inkSoft);
        this.rootContainer.style.setProperty("--ds-color-surface", ds.surface);
        this.rootContainer.style.setProperty("--ds-color-surface-sunken", ds.surfaceSunken);
        this.rootContainer.style.setProperty("--ds-color-line", ds.line);
        this.rootContainer.style.setProperty("--ds-color-line-soft", ds.lineSoft);
        this.rootContainer.style.setProperty("--ds-shadow-card", ds.shadow);

        // título fica sempre numa faixa própria no topo, largura inteira —
        // por isso rootContainer fica sempre em coluna; a legenda "à direita"
        // (linha, não coluna) vira um wrapper interno só pro corpo (legenda +
        // área do gráfico), não pro visual inteiro
        this.rootContainer.style.flexDirection = "column";

        const titleCard = this.formattingSettings.chartTitleCard;
        const showTitle = titleCard.show.value && titleCard.text.value.trim().length > 0;
        if (showTitle) {
            const titleEl = document.createElement("div");
            titleEl.className = "chart-title";
            titleEl.textContent = titleCard.text.value;
            this.rootContainer.appendChild(titleEl);
        }

        const showLegend = legendStyle.show.value && seriesInfos.length > 1;
        const legendPosition = legendStyle.position.value.value as string;

        const bodyContainer = document.createElement("div");
        bodyContainer.className = "chart-body";
        bodyContainer.style.flexDirection = legendPosition === "right" ? "row" : "column";
        this.rootContainer.appendChild(bodyContainer);

        this.legendContainer = document.createElement("div");
        this.legendContainer.className = `chart-legend legend-${legendPosition}`;
        this.chartContainer = document.createElement("div");
        this.chartContainer.className = "chart-area";

        if (showLegend && legendPosition === "top") bodyContainer.appendChild(this.legendContainer);
        bodyContainer.appendChild(this.chartContainer);
        if (showLegend && (legendPosition === "bottom" || legendPosition === "right")) {
            bodyContainer.appendChild(this.legendContainer);
        }
        if (showLegend) this.renderLegend(seriesInfos, orientation);

        const titleHeight = showTitle ? 40 : 0;
        const legendHeight = showLegend && legendPosition !== "right" ? 30 : 0;
        const legendWidth = showLegend && legendPosition === "right" ? 140 : 0;

        const width = Math.max(viewport.width - legendWidth, 50);
        const height = Math.max(viewport.height - legendHeight - titleHeight, 50);

        const showCategoryAxis = axisStyle.showCategoryAxis.value;
        const showValueAxis = axisStyle.showValueAxis.value;
        const showGridlines = axisStyle.showGridlines.value;
        const axisFontSize = axisStyle.axisFontSize.value;

        const longestCategoryLabel = categoryValues.reduce((max, c) => Math.max(max, c.length), 0);

        // com hierarquia no eixo, cada categoria vira uma pilha de rótulos: o
        // nível mais profundo colado no eixo e os pais abaixo, cada um centrado
        // sob o trecho que ele cobre — o mesmo desenho que o Power BI nativo faz,
        // e bem mais legível que repetir "2018 · jan" em cada barra
        // O Power BI entrega hierarquia de duas formas diferentes, e o visual
        // precisa lidar com as duas:
        //   1. sem drilldown declarado -> uma coluna por nível, alinhadas por linha
        //   2. com drilldown declarado  -> UMA coluna só, valores já concatenados
        //      por espaço ("2016 out"), com identityFields trazendo um item por nível
        // Confirmado instrumentando o visual em execução, não por suposição.
        const niveisPorChave = new Map<string, string[]>();
        const colunasCategoria = categorical.categories ?? [];

        if (colunasCategoria.length > 1) {
            splitCategoryLevels(colunasCategoria).forEach(niveis => {
                const chave = niveis.join(NIVEL_SEPARADOR);
                if (!niveisPorChave.has(chave)) niveisPorChave.set(chave, niveis);
            });
        } else {
            const profundidadeDeclarada = colunasCategoria[0]?.identityFields?.length ?? 1;
            // só monta os níveis se TODAS as categorias dividirem com segurança —
            // dividir parte delas deixaria o eixo agrupando errado pela metade
            const divididos = originalCategoryValues.map(v => splitConcatenatedLevels(v, profundidadeDeclarada));
            if (profundidadeDeclarada > 1 && divididos.every(d => d !== null)) {
                originalCategoryValues.forEach((valor, i) => {
                    if (!niveisPorChave.has(valor)) niveisPorChave.set(valor, divididos[i] as string[]);
                });
            }
        }
        const profundidade = Math.max(1, ...Array.from(niveisPorChave.values(), n => n.length));
        const temHierarquia = orientation === "colunas" && showCategoryAxis && profundidade > 1;
        // no modo hierarquia o texto colado no eixo é só a folha ("jan"), então a
        // decisão de inclinar tem que olhar a folha, não a chave inteira
        const folhaDe = (chave: string): string => {
            const niveis = niveisPorChave.get(chave);
            return niveis && niveis.length > 0 ? niveis[niveis.length - 1] : chave;
        };
        const larguraTextoEixo = temHierarquia
            ? categoryValues.reduce((max, c) => Math.max(max, folhaDe(c).length), 0) * axisFontSize * 0.6
            : longestCategoryLabel * axisFontSize * 0.6;
        const larguraDisponivelPorCategoria =
            Math.max(viewport.width - 62, 50) / Math.max(categoryValues.length, 1);
        const rotacionarRotulos =
            orientation === "colunas" && showCategoryAxis && larguraTextoEixo > larguraDisponivelPorCategoria;

        const alturaLinhaNivel = axisFontSize + 8;
        const margin = { top: 12, right: 16, bottom: 12, left: 16 };
        if (orientation === "colunas") {
            const base = rotacionarRotulos ? Math.min(110, larguraTextoEixo * 0.72 + 18) : 30;
            margin.bottom = showCategoryAxis ? base + (temHierarquia ? (profundidade - 1) * alturaLinhaNivel : 0) : 8;
            margin.left = showValueAxis ? 46 : 8;
        } else {
            margin.left = showCategoryAxis ? Math.min(160, Math.max(60, longestCategoryLabel * 6.5)) : 8;
            margin.bottom = showValueAxis ? 30 : 8;
        }
        if (dataLabels.show.value) {
            if (orientation === "colunas") margin.top += 18; else margin.right += 46;
        }
        // eixo secundário: só desenhado em orientação Colunas (ver
        // effectiveChartType) — em Barras a escala secundária ainda é
        // respeitada no tamanho das barras, mas sem um segundo eixo visível
        // pra não empilhar dois eixos de valor horizontais
        if (hasSecondaryAxis && showValueAxis && orientation === "colunas") {
            margin.right += 46;
        }

        const innerWidth = Math.max(width - margin.left - margin.right, 10);
        const innerHeight = Math.max(height - margin.top - margin.bottom, 10);

        // "Máximo de barras visíveis": em vez de espremer todas as categorias
        // pra caber no espaço do visual, desenha só até maxItemsVisible no
        // tamanho "confortável" e deixa o resto pra fora, com uma barra de
        // rolagem no .chart-area (horizontal em Colunas, vertical em Barras)
        // pra ver o resto — o eixo de valor e a legenda continuam do jeito
        // que já eram, só o comprimento do eixo de categoria cresce.
        const scrollEnabled = maxItemsVisible > 0 && categoryValues.length > maxItemsVisible;
        const categoryAxisLength = scrollEnabled
            ? ((orientation === "colunas" ? innerWidth : innerHeight) / maxItemsVisible) * categoryValues.length
            : (orientation === "colunas" ? innerWidth : innerHeight);

        // "eixos fixos": com a rolagem ativa, o eixo de valor (a "régua" que
        // não muda dependendo de qual barra está visível) sai da área que
        // rola e vai pra uma faixa própria (svg separado) do lado/embaixo do
        // .chart-area — só o conteúdo que realmente pertence a uma categoria
        // específica (barras, linhas, grade, eixo de categoria) rola. Fora
        // do caso de rolagem, layout de sempre: um único svg, eixo dentro.
        const pinAxes = scrollEnabled && showValueAxis;
        const ariaLabel = `Gráfico de barras com ${categoryValues.length} categorias${visibleSeriesInfos.length > 1 ? ` e ${visibleSeriesInfos.length} séries` : ""}`;

        let contentPlot: d3Selection.Selection<SVGGElement, unknown, null, undefined>;
        let primaryAxisHost: d3Selection.Selection<SVGGElement, unknown, null, undefined> | null = null;
        let secondaryAxisHost: d3Selection.Selection<SVGGElement, unknown, null, undefined> | null = null;

        if (pinAxes) {
            this.chartContainer.style.overflowX = "hidden";
            this.chartContainer.style.overflowY = "hidden";
            this.chartContainer.style.display = "flex";
            this.chartContainer.style.flexDirection = orientation === "colunas" ? "row" : "column";

            const scrollWrapper = document.createElement("div");
            scrollWrapper.className = "chart-scroll-wrapper";
            scrollWrapper.style.overflowX = orientation === "colunas" ? "auto" : "hidden";
            scrollWrapper.style.overflowY = orientation === "barras" ? "auto" : "hidden";

            if (orientation === "colunas") {
                const leftPane = document.createElement("div");
                leftPane.className = "chart-axis-pane";
                primaryAxisHost = d3.select(leftPane).append("svg")
                    .attr("width", margin.left).attr("height", height).attr("class", "barras-olist-axis-svg")
                    .append("g").attr("transform", `translate(${margin.left},${margin.top})`);
                this.chartContainer.appendChild(leftPane);
                this.chartContainer.appendChild(scrollWrapper);

                if (hasSecondaryAxis) {
                    const rightPane = document.createElement("div");
                    rightPane.className = "chart-axis-pane";
                    secondaryAxisHost = d3.select(rightPane).append("svg")
                        .attr("width", margin.right).attr("height", height).attr("class", "barras-olist-axis-svg")
                        .append("g").attr("transform", `translate(0,${margin.top})`);
                    this.chartContainer.appendChild(rightPane);
                }

                const contentSvg = d3.select(scrollWrapper).append("svg")
                    .attr("width", categoryAxisLength + (hasSecondaryAxis ? 0 : margin.right))
                    .attr("height", height)
                    .attr("class", "barras-olist-svg")
                    .attr("role", "img")
                    .attr("aria-label", ariaLabel);
                contentPlot = contentSvg.append("g").attr("transform", `translate(0,${margin.top})`);
            } else {
                this.chartContainer.appendChild(scrollWrapper);

                const bottomPane = document.createElement("div");
                bottomPane.className = "chart-axis-pane";
                primaryAxisHost = d3.select(bottomPane).append("svg")
                    .attr("width", width).attr("height", margin.bottom).attr("class", "barras-olist-axis-svg")
                    .append("g").attr("transform", `translate(${margin.left},0)`);
                this.chartContainer.appendChild(bottomPane);

                const contentSvg = d3.select(scrollWrapper).append("svg")
                    .attr("width", width)
                    .attr("height", margin.top + categoryAxisLength)
                    .attr("class", "barras-olist-svg")
                    .attr("role", "img")
                    .attr("aria-label", ariaLabel);
                contentPlot = contentSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
            }
        } else {
            this.chartContainer.style.display = "";
            this.chartContainer.style.flexDirection = "";
            this.chartContainer.style.overflowX = scrollEnabled && orientation === "colunas" ? "auto" : "hidden";
            this.chartContainer.style.overflowY = scrollEnabled && orientation === "barras" ? "auto" : "hidden";

            const svgWidth = orientation === "colunas" ? margin.left + categoryAxisLength + margin.right : width;
            const svgHeight = orientation === "colunas" ? height : margin.top + categoryAxisLength + margin.bottom;

            const contentSvg = d3.select(this.chartContainer)
                .append("svg")
                .attr("width", svgWidth)
                .attr("height", svgHeight)
                .attr("class", "barras-olist-svg")
                .attr("role", "img")
                .attr("aria-label", ariaLabel);

            contentPlot = contentSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
        }

        const categoryScale = d3.scaleBand<string>()
            .domain(categoryValues)
            .range(orientation === "colunas" ? [0, categoryAxisLength] : [categoryAxisLength, 0])
            .padding((chartStyle.barPadding.value ?? 30) / 100);

        let valueDomainMin: number;
        let valueDomainMax: number;
        // quando a série usa "barra preenchida", o EIXO segue o mesmo teto
        // arredondado do pill (pillMaxByAxis), não o range real dos dados —
        // senão a barra vai até 25 mas o eixo continua mostrando outra
        // escala, como o usuário notou. Sem .nice() nesse caso: o número já
        // "é" redondo por construção (ver niceCeil), não precisa de mais
        // arredondamento (que podia inclusive mudar o valor, ex. 25 -> 30).
        if (hasPillByAxis.primary) {
            valueDomainMin = 0;
            valueDomainMax = pillMaxByAxis.primary;
        } else if (seriesMode === "empilhado100") {
            valueDomainMin = 0;
            valueDomainMax = 1;
        } else {
            const primaryItems = [...primaryBars, ...primaryLineBarData];
            valueDomainMin = Math.min(0, d3.min(primaryItems, d => d.y0) ?? 0);
            valueDomainMax = Math.max(0, d3.max(primaryItems, d => d.y1) ?? 0);
            // sem isso, uma linha de referência maior que qualquer barra
            // ficava fora do domínio do eixo e era desenhada fora da área
            // visível do SVG — por isso "não aparecia"
            if (refLineValue !== null) {
                valueDomainMin = Math.min(valueDomainMin, refLineValue);
                valueDomainMax = Math.max(valueDomainMax, refLineValue);
            }
            if (valueDomainMax === valueDomainMin) valueDomainMax = valueDomainMin + 1;
        }

        const valueScale = d3.scaleLinear()
            .domain([valueDomainMin, valueDomainMax]);
        if (!hasPillByAxis.primary) valueScale.nice();
        valueScale.range(orientation === "colunas" ? [innerHeight, 0] : [0, innerWidth]);

        // eixo secundário: domínio próprio (nunca 0-1 fixo do empilhado100 —
        // séries secundárias nunca empilham, ver comentário mais acima),
        // mas compartilha o mesmo range de pixels do eixo primário
        let valueScale2: d3Scale.ScaleLinear<number, number> | null = null;
        if (hasSecondaryAxis) {
            let secMin: number;
            let secMax: number;
            if (hasPillByAxis.secondary) {
                secMin = 0;
                secMax = pillMaxByAxis.secondary;
            } else {
                const secondaryItems = [...secondaryBars, ...secondaryLineBarData];
                secMin = Math.min(0, d3.min(secondaryItems, d => d.y0) ?? 0);
                secMax = Math.max(0, d3.max(secondaryItems, d => d.y1) ?? 0);
                if (secMax === secMin) secMax = secMin + 1;
            }
            valueScale2 = d3.scaleLinear().domain([secMin, secMax]);
            if (!hasPillByAxis.secondary) valueScale2.nice();
            valueScale2.range(orientation === "colunas" ? [innerHeight, 0] : [0, innerWidth]);
        }
        const scaleForAxis = (axis: AxisAssignment): d3Scale.ScaleLinear<number, number> => axis === "secondary" && valueScale2 ? valueScale2 : valueScale;

        const seriesSubScale = (() => {
            // barras do eixo primário: 1 "slot" só se empilhado (a pilha
            // inteira ocupa 1 posição), ou 1 slot por série se agrupado.
            // Barras do eixo secundário nunca empilham entre si — sempre 1
            // slot por série. Linhas não entram aqui: sempre centralizadas
            // na categoria inteira, ver renderização mais abaixo.
            const primarySlotKeys = primaryBarSeries.length === 0
                ? []
                : seriesMode === "agrupado" ? primaryBarSeries.map(s => s.name) : ["__primary_stack__"];
            const slotKeys = [...primarySlotKeys, ...secondaryBarSeries.map(s => s.name)];
            return slotKeys.length > 1
                ? d3.scaleBand<string>().domain(slotKeys).range([0, categoryScale.bandwidth()]).padding(0.08)
                : null;
        })();
        const slotKeyFor = (seriesName: string, axis: AxisAssignment): string =>
            axis === "primary" && seriesMode !== "agrupado" ? "__primary_stack__" : seriesName;

        if (showGridlines) {
            const gridGroup = contentPlot.append("g").attr("class", "grid-lines");
            const ticks = valueScale.ticks(5);
            if (orientation === "colunas") {
                gridGroup.selectAll("line")
                    .data(ticks)
                    .join("line")
                    .attr("x1", 0).attr("x2", categoryAxisLength)
                    .attr("y1", d => valueScale(d)).attr("y2", d => valueScale(d));
            } else {
                gridGroup.selectAll("line")
                    .data(ticks)
                    .join("line")
                    .attr("y1", 0).attr("y2", categoryAxisLength)
                    .attr("x1", d => valueScale(d)).attr("x2", d => valueScale(d));
            }
        }

        if (showCategoryAxis) {
            const axisGroup = contentPlot.append("g").attr("class", "category-axis").style("font-size", `${axisFontSize}px`);
            if (orientation === "colunas") {
                axisGroup.attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(categoryScale).tickSizeOuter(0));

                // no eixo fica só a folha; os pais vão nas linhas de baixo
                if (temHierarquia) {
                    axisGroup.selectAll<SVGTextElement, string>("text").text(d => folhaDe(String(d)));
                }

                if (rotacionarRotulos) {
                    axisGroup.selectAll<SVGTextElement, unknown>("text")
                        .attr("transform", "rotate(-45)")
                        .attr("text-anchor", "end")
                        .attr("dx", "-0.4em")
                        .attr("dy", "0.6em");
                }

                if (temHierarquia) {
                    const baseY = rotacionarRotulos ? Math.min(110, larguraTextoEixo * 0.72 + 8) : 24;
                    // um nível por linha, do mais próximo da folha para o mais raso
                    for (let nivel = profundidade - 2; nivel >= 0; nivel--) {
                        const linhaY = baseY + (profundidade - 2 - nivel) * alturaLinhaNivel;
                        const grupo = axisGroup.append("g").attr("class", "category-axis-level");

                        // um rótulo por trecho contíguo, centrado sobre ele — o
                        // agrupamento em si é testado em chartLogic.test.ts
                        const trechos = buildCategoryLevelSpans(categoryValues, niveisPorChave, nivel);
                        trechos.forEach((trecho, i) => {
                            const x0 = categoryScale(categoryValues[trecho.startIndex]) ?? 0;
                            const x1 = (categoryScale(categoryValues[trecho.endIndex]) ?? 0) + categoryScale.bandwidth();

                            if (trecho.label) {
                                grupo.append("text")
                                    .attr("x", (x0 + x1) / 2)
                                    .attr("y", linhaY + alturaLinhaNivel - 6)
                                    .attr("text-anchor", "middle")
                                    .text(trecho.label);
                            }
                            // divisória entre grupos, como o eixo nativo desenha
                            if (i < trechos.length - 1) {
                                grupo.append("line")
                                    .attr("class", "category-axis-divider")
                                    .attr("x1", x1).attr("x2", x1)
                                    .attr("y1", linhaY).attr("y2", linhaY + alturaLinhaNivel);
                            }
                        });
                    }
                }
            } else {
                axisGroup.call(d3.axisLeft(categoryScale).tickSizeOuter(0));
            }
        }

        if (showValueAxis) {
            const tickFormat = (d: number): string =>
                seriesMode === "empilhado100" ? `${Math.round(d * 100)}%` : formatter.format(d);

            if (pinAxes && primaryAxisHost) {
                primaryAxisHost.style("font-size", `${axisFontSize}px`).attr("class", "value-axis");
                if (orientation === "colunas") {
                    primaryAxisHost.call(d3.axisLeft(valueScale).ticks(5).tickFormat(tickFormat));
                } else {
                    primaryAxisHost.call(d3.axisBottom(valueScale).ticks(5).tickFormat(tickFormat));
                }
                if (secondaryAxisHost && valueScale2) {
                    secondaryAxisHost.style("font-size", `${axisFontSize}px`).attr("class", "value-axis value-axis-secondary");
                    secondaryAxisHost.call(d3.axisRight(valueScale2).ticks(5).tickFormat(d => formatter2.format(d)));
                }
            } else {
                const axisGroup = contentPlot.append("g").attr("class", "value-axis").style("font-size", `${axisFontSize}px`);
                if (orientation === "colunas") {
                    axisGroup.call(d3.axisLeft(valueScale).ticks(5).tickFormat(tickFormat));
                } else {
                    axisGroup.attr("transform", `translate(0,${categoryAxisLength})`).call(d3.axisBottom(valueScale).ticks(5).tickFormat(tickFormat));
                }

                if (valueScale2 && orientation === "colunas") {
                    const axisGroup2 = contentPlot.append("g")
                        .attr("class", "value-axis value-axis-secondary")
                        .attr("transform", `translate(${categoryAxisLength},0)`)
                        .style("font-size", `${axisFontSize}px`);
                    axisGroup2.call(d3.axisRight(valueScale2).ticks(5).tickFormat(d => formatter2.format(d)));
                }
            }
        }

        const zeroPos = valueScale(0);
        contentPlot.append("line")
            .attr("class", "zero-baseline")
            .attr(orientation === "colunas" ? "x1" : "y1", 0)
            .attr(orientation === "colunas" ? "x2" : "y2", categoryAxisLength)
            .attr(orientation === "colunas" ? "y1" : "x1", zeroPos)
            .attr(orientation === "colunas" ? "y2" : "x2", zeroPos);

        if (showRefLine && refLineValue !== null) {
            const refPos = valueScale(refLineValue);
            const refColor = isHighContrast ? hcForeground : refLineCard.color.value.value;
            contentPlot.append("line")
                .attr("class", "reference-line")
                .attr(orientation === "colunas" ? "x1" : "y1", 0)
                .attr(orientation === "colunas" ? "x2" : "y2", categoryAxisLength)
                .attr(orientation === "colunas" ? "y1" : "x1", refPos)
                .attr(orientation === "colunas" ? "y2" : "x2", refPos)
                .style("stroke", refColor);

            const refLabelText = refLineCard.mode.value.value === "fixo"
                ? formatter.format(refLineValue)
                : `Média: ${formatter.format(refLineValue)}`;
            contentPlot.append("text")
                .attr("class", "reference-line-label")
                .attr(orientation === "colunas" ? "x" : "y", orientation === "colunas" ? categoryAxisLength - 4 : 4)
                .attr(orientation === "colunas" ? "y" : "x", refPos - 4)
                .attr("text-anchor", orientation === "colunas" ? "end" : "start")
                .style("fill", refColor)
                .text(refLabelText);
        }

        // raio dos cantos fixo (identidade Olist: barras levemente
        // arredondadas), com um piso de 6px — respeita o campo numérico do
        // usuário acima desse piso
        const cornerRadius = Math.max(chartStyle.cornerRadius.value ?? 0, 6);

        // posição/tamanho no eixo de categoria+série (não muda com o valor) e
        // no eixo de valor (varia com y0/y1, e com qual escala/eixo a série
        // usa) ficam separados pra poder gerar o retângulo da barra
        const crossAxisStart = (d: PositionedBarDatum): number => {
            const base = categoryScale(d.categoryValue) ?? 0;
            if (!seriesSubScale) return base;
            const key = slotKeyFor(d.seriesName, d.axis);
            return base + (seriesSubScale(key) ?? 0);
        };
        const crossAxisSize = (): number => seriesSubScale ? seriesSubScale.bandwidth() : categoryScale.bandwidth();
        const rectFor = (d: PositionedBarDatum, y0: number, y1: number): { x: number; y: number; width: number; height: number } => {
            const scale = scaleForAxis(d.axis);
            if (orientation === "colunas") {
                return {
                    x: crossAxisStart(d),
                    y: Math.min(scale(y0), scale(y1)),
                    width: crossAxisSize(),
                    height: Math.abs(scale(y1) - scale(y0))
                };
            }
            return {
                x: Math.min(scale(y0), scale(y1)),
                y: crossAxisStart(d),
                width: Math.abs(scale(y1) - scale(y0)),
                height: crossAxisSize()
            };
        };
        const barX = (d: PositionedBarDatum): number => rectFor(d, d.y0, d.y1).x;
        const barY = (d: PositionedBarDatum): number => rectFor(d, d.y0, d.y1).y;
        const barWidth = (d: PositionedBarDatum): number => rectFor(d, d.y0, d.y1).width;
        const barHeight = (d: PositionedBarDatum): number => rectFor(d, d.y0, d.y1).height;

        // "barra preenchida" (estilo mockup Olist: trilho fino arredondado
        // ocupando a largura toda + preenchimento em pill por cima) — a
        // decisão de quais séries usam esse estilo e o teto por eixo
        // (pillMaxByAxis) já foram calculados mais acima, antes do domínio
        // do eixo de valor (pra o eixo poder seguir o mesmo teto)
        const pillThickness = (): number => Math.min(crossAxisSize(), 12);
        const pillY = (d: PositionedBarDatum): number => crossAxisStart(d) + (crossAxisSize() - pillThickness()) / 2;
        const pillFillWidth = (d: PositionedBarDatum): number =>
            Math.min(innerWidth, (Math.abs(d.rawValue) / pillMaxByAxis[d.axis]) * innerWidth);

        const barsGroup = contentPlot.append("g").attr("class", "bars-group");
        const barKey = (d: PositionedBarDatum): string => `${d.categoryValue}::${d.seriesName}`;
        const barGroups = barsGroup.selectAll<SVGGElement, PositionedBarDatum>("g.bar-item")
            .data(allBarData, barKey)
            .join("g")
            .attr("class", "bar-item")
            .style("pointer-events", "bounding-box")
            .attr("tabindex", 0)
            .attr("role", "button")
            .attr("aria-label", d => `${d.categoryValue}${visibleSeriesInfos.length > 1 ? `, ${d.seriesName}` : ""}: ${formatterForSeries(d.seriesName).format(d.rawValue)}`);

        barGroups.each((d, i, nodes) => {
            const g = d3.select(nodes[i]);
            const fill = d.color;

            if (isPillBar(d)) {
                // trilho + preenchimento: sempre reconstrói do zero (igual
                // aos outros formatos "decorados" que já existiram aqui —
                // só a barra simples de 1 <rect> reaproveita elemento pra
                // animar a transição)
                g.selectAll("*").remove();
                const thickness = pillThickness();
                const y = pillY(d);
                g.append("rect")
                    .attr("class", "bar-track")
                    .attr("x", 0).attr("y", y)
                    .attr("width", innerWidth).attr("height", thickness)
                    .attr("rx", thickness / 2).attr("ry", thickness / 2);
                g.append("rect")
                    .attr("class", "bar-fill")
                    .attr("x", 0).attr("y", y)
                    .attr("width", pillFillWidth(d)).attr("height", thickness)
                    .attr("rx", thickness / 2).attr("ry", thickness / 2)
                    .style("fill", fill);
                return;
            }

            // transições suaves: a barra é sempre um único <rect> sem
            // decoração extra, então o elemento é reaproveitado entre
            // renders pra animar a transição de posição/tamanho
            const existingBar = g.select<SVGRectElement>("rect.bar");
            const node = g.node();
            const canReuseBar = !existingBar.empty() && node !== null && node.children.length === 1;

            if (!canReuseBar) {
                g.selectAll("*").remove();
            }

            if (canReuseBar) {
                existingBar.transition().duration(250)
                    .attr("x", barX(d)).attr("y", barY(d))
                    .attr("width", barWidth(d)).attr("height", barHeight(d))
                    .attr("rx", cornerRadius).attr("ry", cornerRadius)
                    .style("fill", fill);
            } else {
                g.append("rect")
                    .attr("class", "bar")
                    .attr("x", barX(d)).attr("y", barY(d))
                    .attr("width", barWidth(d)).attr("height", barHeight(d))
                    .attr("rx", cornerRadius).attr("ry", cornerRadius)
                    .style("fill", fill);
            }
        });

        const hcColors = isHighContrast ? { foreground: hcForeground, background: hcBackground } : undefined;

        barGroups
            .on("click", (event: MouseEvent, d: PositionedBarDatum) => {
                this.selectionManager.select(d.selectionId, event.ctrlKey || event.metaKey).then(() => {
                    this.applySelectionStyles(barGroups, this.selectionManager.getSelectionIds() as ISelectionId[]);
                });
                event.stopPropagation();
            })
            .on("contextmenu", (event: MouseEvent, d: PositionedBarDatum) => {
                this.selectionManager.showContextMenu(d.selectionId, { x: event.clientX, y: event.clientY }, "categoria");
                event.preventDefault();
                event.stopPropagation();
            })
            .on("keydown", (event: KeyboardEvent, d: PositionedBarDatum) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    this.selectionManager.select(d.selectionId, event.ctrlKey || event.metaKey).then(() => {
                        this.applySelectionStyles(barGroups, this.selectionManager.getSelectionIds() as ISelectionId[]);
                    });
                } else if (event.key === "ArrowRight") {
                    event.preventDefault();
                    this.focusAdjacentBar(event.currentTarget as SVGGElement, 1);
                } else if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    this.focusAdjacentBar(event.currentTarget as SVGGElement, -1);
                }
            })
            .on("mouseenter", (event: MouseEvent, d: PositionedBarDatum) => {
                const items: TooltipItem[] = [
                    { displayName: categoryLevelsLabel, value: d.categoryValue },
                    ...(visibleSeriesInfos.length > 1 ? [{ displayName: "Série", value: d.seriesName }] : []),
                    { displayName: "Valor", value: formatterForSeries(d.seriesName).format(d.rawValue) }
                ];
                this.showCustomTooltip(items, isDarkMode, event, hcColors);
            })
            .on("mousemove", (event: MouseEvent) => {
                this.positionCustomTooltip(event);
            })
            .on("mouseleave", () => {
                this.hideCustomTooltip();
            });

        // séries do tipo "linha" (só respeitadas em orientação Colunas —
        // effectiveChartType já filtrou isso antes de chegar aqui): path
        // conectando os pontos + um círculo por ponto pra tooltip/seleção/
        // teclado, desenhadas por cima das barras (convenção usual de combo
        // chart)
        const linesGroup = contentPlot.append("g").attr("class", "lines-group");
        const linePointX = (categoryValue: string): number => (categoryScale(categoryValue) ?? 0) + categoryScale.bandwidth() / 2;

        lineSeriesData.forEach(series => {
            const scale = scaleForAxis(series.axis);
            // curva suave (monotone: nunca "estoura" acima/abaixo dos pontos
            // reais, ao contrário de uma spline genérica) + uma área bem sutil
            // sob a linha — deixa a linha "completa" sozinha, sem precisar de
            // configuração extra (ver conversa: "ou já deixar o padrão bonito")
            const lineGen = d3.line<LinePoint>()
                .x(p => linePointX(p.categoryValue))
                .y(p => scale(p.value))
                .curve(d3.curveMonotoneX);
            const areaGen = d3.area<LinePoint>()
                .x(p => linePointX(p.categoryValue))
                .y0(scale(0))
                .y1(p => scale(p.value))
                .curve(d3.curveMonotoneX);

            const seriesGroup = linesGroup.append("g").attr("class", "line-series");
            seriesGroup.append("path")
                .attr("class", "line-area")
                .attr("d", areaGen(series.points))
                .style("fill", series.color);
            seriesGroup.append("path")
                .attr("class", "line-path")
                .attr("d", lineGen(series.points))
                .style("stroke", series.color)
                .style("fill", "none");

            const pointGroups = seriesGroup.selectAll<SVGGElement, LinePoint>("g.line-point")
                .data(series.points, p => p.categoryValue)
                .join("g")
                .attr("class", "line-point")
                .attr("transform", p => `translate(${linePointX(p.categoryValue)},${scale(p.value)})`)
                .attr("tabindex", 0)
                .attr("role", "button")
                .attr("aria-label", p => `${p.categoryValue}, ${series.name}: ${formatterForSeries(series.name).format(p.value)}`);

            pointGroups.each((p, i, nodes) => {
                const g = d3.select(nodes[i]);
                g.selectAll("*").remove();
                // anel na cor de fundo por baixo do ponto cheio — o ponto
                // "flutua" sobre a linha em vez de se misturar com o traço
                g.append("circle").attr("class", "line-point-ring").attr("r", 6).style("fill", "var(--ds-color-surface)");
                g.append("circle").attr("class", "line-point-dot").attr("r", 4).style("fill", p.color);
                // círculo invisível maior só pra facilitar clicar/passar o
                // mouse — o ponto visual é pequeno demais como alvo
                g.append("circle").attr("class", "line-point-hit").attr("r", 10).style("fill", "transparent");
            });

            pointGroups
                .on("click", (event: MouseEvent, p: LinePoint) => {
                    this.selectionManager.select(p.selectionId, event.ctrlKey || event.metaKey).then(() => {
                        this.applySelectionStyles(barGroups, this.selectionManager.getSelectionIds() as ISelectionId[]);
                    });
                    event.stopPropagation();
                })
                .on("contextmenu", (event: MouseEvent, p: LinePoint) => {
                    this.selectionManager.showContextMenu(p.selectionId, { x: event.clientX, y: event.clientY }, "categoria");
                    event.preventDefault();
                    event.stopPropagation();
                })
                .on("keydown", (event: KeyboardEvent, p: LinePoint) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        this.selectionManager.select(p.selectionId, event.ctrlKey || event.metaKey).then(() => {
                            this.applySelectionStyles(barGroups, this.selectionManager.getSelectionIds() as ISelectionId[]);
                        });
                    }
                })
                .on("mouseenter", (event: MouseEvent, p: LinePoint) => {
                    const items: TooltipItem[] = [
                        { displayName: categoryLevelsLabel, value: p.categoryValue },
                        { displayName: "Série", value: series.name },
                        { displayName: "Valor", value: formatterForSeries(series.name).format(p.value) }
                    ];
                    this.showCustomTooltip(items, isDarkMode, event, hcColors);
                })
                .on("mousemove", (event: MouseEvent) => this.positionCustomTooltip(event))
                .on("mouseleave", () => this.hideCustomTooltip());
        });

        if (dataLabels.show.value) {
            const fontSize = dataLabels.labelFontSize.value;
            const abbreviate = dataLabels.abbreviateNumbers.value;

            const labelText = (d: PositionedBarDatum): string => {
                // % só faz sentido pra barras do eixo primário empilhadas —
                // as do eixo secundário nunca empilham (ver comentários acima)
                if (seriesMode === "empilhado100" && d.axis === "primary") return `${Math.round((d.y1 - d.y0) * 100)}%`;
                return abbreviate ? formatCompactNumber(d.rawValue) : formatterForSeries(d.seriesName).format(d.rawValue);
            };

            // sempre fora da barra, na ponta — identidade Olist: rótulo
            // numérico simples, sem chip/contorno/posição interna
            // barra preenchida (pill): a ponta visível é pillFillWidth(d), não
            // barWidth(d) (que reflete a escala do eixo, não o teto próprio
            // do pill) — sem isso o rótulo ficava fora do lugar, na posição
            // que a barra "normal" teria
            const outsideX = (d: PositionedBarDatum): number => {
                if (orientation === "colunas") return barX(d) + barWidth(d) / 2;
                return isPillBar(d) ? pillFillWidth(d) + 4 : barX(d) + barWidth(d) + 4;
            };
            const outsideY = (d: PositionedBarDatum): number => {
                if (orientation === "colunas") return barY(d) - 4;
                return isPillBar(d) ? pillY(d) + pillThickness() / 2 + 3 : barY(d) + barHeight(d) / 2 + 3;
            };
            const outsideAnchor = orientation === "colunas" ? "middle" : "start";

            const labelsGroup = contentPlot.append("g").attr("class", "data-labels");
            const labelGroups = labelsGroup.selectAll<SVGGElement, PositionedBarDatum>("g.label-item")
                .data(allBarData)
                .join("g")
                .attr("class", "label-item");

            labelGroups.each((d, i, nodes) => {
                const g = d3.select(nodes[i]);
                g.selectAll("*").remove();
                g.append("text")
                    .attr("class", "bar-label")
                    .attr("x", outsideX(d)).attr("y", outsideY(d))
                    .attr("text-anchor", outsideAnchor)
                    .style("font-size", `${fontSize}px`)
                    .text(labelText(d));
            });
        }

        if (this.selectionManager.hasSelection()) {
            this.applySelectionStyles(barGroups, this.selectionManager.getSelectionIds() as ISelectionId[]);
        }
    }

    private applySelectionStyles(
        barGroups: d3Selection.Selection<SVGGElement, BarDatum, SVGGElement, unknown>,
        selectedIds: ISelectionId[]
    ): void {
        const hasSelection = selectedIds.length > 0;
        barGroups.style("opacity", d => {
            if (!hasSelection) return 1;
            return selectedIds.some(id => id.equals(d.selectionId)) ? 1 : 0.35;
        });
    }
}
