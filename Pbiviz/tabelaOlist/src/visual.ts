"use strict";

import powerbi from "powerbi-visuals-api";
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import DataView = powerbi.DataView;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;

import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";
import { VisualFormattingSettingsModel } from "./settings";
import {
    CellStatus,
    ColumnFormatting,
    toNumber,
    resolveStatus,
    computeColumnAggregate,
    resolveThemeMode
} from "./formattingLogic";

import "./../style/visual.less";

// cor primária, fonte e cores de status não são mais configuráveis pelo
// painel de formatação (removido a pedido do usuário) — ficam fixas na
// identidade Olist, mesmo padrão já usado no barrasOlist
const PRIMARY_COLOR = "#0A4EE4";
const FONT_FAMILY = "Plus Jakarta Sans";
const POSITIVE_COLOR = "#587A2E";
const NEUTRAL_COLOR = "#1C8484";
const NEGATIVE_COLOR = "#B9700A";

// tokens fixos do design system Olist para os dois temas — a mesma medida
// DAX (role "modoVisual") pode acionar o escuro em vários visuais ao mesmo
// tempo. Aplicados via CSS custom properties (--ds-color-*) em cada render,
// nos dois elementos que persistem entre renders (tableContainer e
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

interface TooltipItem {
    displayName: string;
    value: string;
}

interface GlobalStyles {
    positiveColor: string;
    neutralColor: string;
    negativeColor: string;
    showTotals: boolean;
    frozenColumnCount: number;
    showSearchBox: boolean;
    isHighContrast: boolean;
    hcForeground: string;
    hcBackground: string;
    isDarkMode: boolean;
}

interface RowEntry {
    row: powerbi.DataViewTableRow;
    originalIndex: number;
}

interface VirtualScrollContext {
    entries: RowEntry[];
    tbody: HTMLTableSectionElement;
    topSpacer: HTMLTableRowElement;
    bottomSpacer: HTMLTableRowElement;
    rowHeight: number;
    buildRow: (entry: RowEntry) => HTMLTableRowElement;
    // linhas <tr> atualmente no DOM — evita um querySelectorAll a cada
    // repaint de scroll (chamado com muita frequência via requestAnimationFrame)
    renderedRows: HTMLTableRowElement[];
}

interface ColumnResizeState {
    col: powerbi.DataViewMetadataColumn;
    colElement: HTMLTableColElement;
    startX: number;
    startWidth: number;
}

const DEFAULT_COL_WIDTH = 140;
// colunas sem "Ordem de exibição" definida caem bem depois de qualquer valor
// que o usuário realmente digite, senão um empate com a posição natural de
// outra coluna ignora silenciosamente a mudança do usuário
const UNORDERED_COLUMN_OFFSET = 10000;

export class Visual implements IVisual {
    private target: HTMLElement;
    private host: IVisualHost;
    private selectionManager: ISelectionManager;
    private formattingSettingsService: FormattingSettingsService;
    private formattingSettings: VisualFormattingSettingsModel;
    private dataView: DataView;
    private rootContainer: HTMLElement;
    private titleElement: HTMLElement;
    private toolbar: HTMLElement;
    private searchInput: HTMLInputElement;
    private truncationBadge: HTMLElement;
    private tableContainer: HTMLElement;
    private customTooltip: HTMLDivElement;
    private rowSelectionEntries: Array<{ tr: HTMLTableRowElement; selectionId: powerbi.visuals.ISelectionId }> = [];
    private formatterCache: Map<string, valueFormatter.IValueFormatter> = new Map();
    private columnFormattingCache: Map<string, ColumnFormatting> = new Map();
    private virtualCtx: VirtualScrollContext | null = null;
    private scrollRaf: number | null = null;
    private resizeState: ColumnResizeState | null = null;
    private searchDebounceTimer: number | null = null;

    constructor(options: VisualConstructorOptions) {
        this.target = options.element;
        this.host = options.host;
        this.selectionManager = this.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        // o elemento que o Power BI aloca pro visual normalmente já é
        // transparente, mas fica explícito aqui — sem isso, o "recorte" das
        // quatro quinas fora do border-radius do card (ver .visual-root)
        // podia ficar branco em vez de mostrar o fundo real do canvas do
        // relatório atrás do visual
        this.target.style.backgroundColor = "transparent";

        this.rootContainer = document.createElement("div");
        this.rootContainer.className = "visual-root";
        this.target.appendChild(this.rootContainer);

        // título opcional (mesmo padrão do "title" do Card do design system
        // Olist — ver mockup), sempre acima da barra de busca
        this.titleElement = document.createElement("div");
        this.titleElement.className = "chart-title";
        this.titleElement.style.display = "none";
        this.rootContainer.appendChild(this.titleElement);

        this.toolbar = document.createElement("div");
        this.toolbar.className = "table-toolbar";

        this.searchInput = document.createElement("input");
        this.searchInput.type = "search";
        this.searchInput.className = "table-search-input";
        this.searchInput.placeholder = "Buscar...";
        this.searchInput.setAttribute("aria-label", "Buscar na tabela");
        this.searchInput.addEventListener("input", () => this.handleSearchInput());

        this.truncationBadge = document.createElement("span");
        this.truncationBadge.className = "truncation-badge";
        this.truncationBadge.style.display = "none";

        this.toolbar.appendChild(this.searchInput);
        this.toolbar.appendChild(this.truncationBadge);

        this.tableContainer = document.createElement("div");
        this.tableContainer.className = "custom-table-container";

        this.rootContainer.appendChild(this.toolbar);
        this.rootContainer.appendChild(this.tableContainer);

        // até o primeiro update() com dados chegar, mostra um skeleton em vez de
        // ficar em branco (não há um evento de "carregando" exposto pela API pro
        // visual, então isso cobre só a primeira renderização)
        this.toolbar.style.display = "none";
        this.renderSkeleton();

        // tooltip customizada (não a nativa do Power BI) para seguir a identidade
        // visual Olist — anexada ao <body> pra não ficar cortada pelo
        // overflow:auto/scroll do container da tabela
        this.customTooltip = document.createElement("div");
        this.customTooltip.className = "custom-tooltip";
        this.customTooltip.style.display = "none";
        document.body.appendChild(this.customTooltip);

        this.selectionManager.registerOnSelectCallback(() => this.applySelectionStyles());

        // clique direito fora de qualquer linha (área vazia) abre o menu de filtros do visual
        // (linhas chamam stopPropagation no próprio contextmenu, então isso só dispara na área vazia)
        this.tableContainer.addEventListener("contextmenu", (event: MouseEvent) => {
            event.preventDefault();
            this.selectionManager.showContextMenu({}, { x: event.clientX, y: event.clientY });
        });

        this.tableContainer.addEventListener("scroll", () => this.handleScroll());
    }

    public destroy(): void {
        this.customTooltip.remove();
    }

    public update(options: VisualUpdateOptions) {
        this.dataView = options.dataViews?.[0];

        if (!this.dataView?.table) {
            this.renderEmptyState('Adicione campos em "Campos da Tabela" para exibir os dados.');
            return;
        }

        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualFormattingSettingsModel,
            this.dataView
        );

        if (this.dataView.table.rows.length === 0) {
            this.renderEmptyState("Nenhum dado encontrado para os filtros atuais.");
            return;
        }

        this.renderTable(this.dataView.table);

        // carrega tudo automaticamente, sem precisar de ação do usuário: a cada
        // update() (chamado de novo quando o lote anterior chega), se ainda
        // houver "segment" no metadata, pede o próximo lote na hora
        if (this.dataView.metadata?.segment) {
            this.host.fetchMoreData();
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const staticModel = this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
        const dynamicCards = this.buildColumnFormattingCards(this.dataView?.table?.columns ?? []);
        return { cards: [...staticModel.cards, ...dynamicCards] };
    }

    private buildColumnFormattingCards(columns: powerbi.DataViewMetadataColumn[]): powerbi.visuals.FormattingCard[] {
        const cards: powerbi.visuals.FormattingCard[] = columns.map((col, index) => {
            const objects: any = col.objects?.["columnFormatting"] || {};

            const makeToggle = (propertyName: string, displayName: string, uidSuffix: string, defaultValue: boolean): powerbi.visuals.FormattingSlice => ({
                displayName,
                uid: `${uidSuffix}_${index}`,
                control: {
                    type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                    properties: {
                        descriptor: {
                            objectName: "columnFormatting",
                            propertyName,
                            selector: { metadata: col.queryName }
                        },
                        value: objects[propertyName] ?? defaultValue
                    }
                }
            });

            const makeText = (propertyName: string, displayName: string, uidSuffix: string, placeholder: string): powerbi.visuals.FormattingSlice => ({
                displayName,
                uid: `${uidSuffix}_${index}`,
                control: {
                    type: powerbi.visuals.FormattingComponent.TextInput,
                    properties: {
                        descriptor: {
                            objectName: "columnFormatting",
                            propertyName,
                            selector: { metadata: col.queryName }
                        },
                        value: objects[propertyName] ?? "",
                        placeholder
                    }
                }
            });

            const makeNumber = (propertyName: string, displayName: string, uidSuffix: string, defaultValue: number): powerbi.visuals.FormattingSlice => ({
                displayName,
                uid: `${uidSuffix}_${index}`,
                control: {
                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                    properties: {
                        descriptor: {
                            objectName: "columnFormatting",
                            propertyName,
                            selector: { metadata: col.queryName }
                        },
                        value: objects[propertyName] ?? defaultValue,
                        options: {
                            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 1 }
                        }
                    }
                }
            });

            const hideColumnSlice = makeToggle("hideColumn", "Ocultar esta coluna (usar só como apoio)", "hideColumn", false);
            const showSlice = makeToggle("show", "Aplicar destaque de status (pill colorido)", "show", false);
            // ordem de exibição: mais confiável que a ordem em "Campos da Tabela",
            // já que o Power BI reordena o dataView internamente quando o papel
            // mistura campos de categoria com medidas (agrupamento antes, medida
            // depois). Ajuste manual — mudar uma coluna não reajusta as outras
            // automaticamente, então pode ser necessário renumerar mais de uma.
            const columnOrderSlice = makeNumber("columnOrder", "Ordem de exibição (1, 2, 3... — ajuste manual)", "columnOrder", index + 1);

            const colorSourceSlice: powerbi.visuals.FormattingSlice = {
                displayName: "Fonte da Cor",
                uid: `colorSource_${index}`,
                control: {
                    type: powerbi.visuals.FormattingComponent.Dropdown,
                    properties: {
                        descriptor: {
                            objectName: "columnFormatting",
                            propertyName: "colorSource",
                            selector: { metadata: col.queryName }
                        },
                        value: objects["colorSource"] ?? "compareText"
                    }
                }
            };

            const positiveValueSlice = makeText("positiveValue", "Valor Positivo (comparar texto)", "positiveValue", "Ex: True, 1, No Prazo");
            const neutralValueSlice = makeText("neutralValue", "Valor Neutro (comparar texto)", "neutralValue", "Opcional");
            const negativeValueSlice = makeText("negativeValue", "Valor Negativo (comparar texto)", "negativeValue", "Ex: False, 0, Atrasado");
            const statusColumnNameSlice = makeText("statusColumnName", "Nome da coluna de status (DAX)", "statusColumnName", "Ex: Status Nota");
            const showInTooltipSlice = makeToggle("showInTooltip", "Mostrar esta coluna na tooltip (hover)", "showInTooltip", false);

            const totalAggregationSlice: powerbi.visuals.FormattingSlice = {
                displayName: "Agregação no total (rodapé)",
                uid: `totalAggregation_${index}`,
                control: {
                    type: powerbi.visuals.FormattingComponent.Dropdown,
                    properties: {
                        descriptor: {
                            objectName: "columnFormatting",
                            propertyName: "totalAggregation",
                            selector: { metadata: col.queryName }
                        },
                        value: objects["totalAggregation"] ?? "sum"
                    }
                }
            };

            const card: powerbi.visuals.FormattingCard = {
                displayName: `Coluna: ${col.displayName}`,
                uid: `columnFormatting_card_${index}`,
                groups: [
                    {
                        displayName: undefined,
                        uid: `columnFormatting_group_${index}`,
                        slices: [
                            hideColumnSlice,
                            columnOrderSlice,
                            showSlice,
                            colorSourceSlice,
                            positiveValueSlice,
                            neutralValueSlice,
                            negativeValueSlice,
                            statusColumnNameSlice,
                            showInTooltipSlice,
                            totalAggregationSlice
                        ]
                    }
                ]
            };

            return card;
        });

        return cards;
    }

    private getGlobalStyles(table: powerbi.DataViewTable): GlobalStyles {
        const tableStyleCard = this.formattingSettings.tableStyleCard;
        const palette = this.host.colorPalette;
        const isHighContrast = palette.isHighContrast;

        // medida opcional (role "modoVisual") que deixa uma única medida DAX
        // controlar o tema claro/escuro de vários visuais ao mesmo tempo —
        // lê a primeira linha porque é um valor "global", igual pra toda a
        // tabela, não algo que varia por linha
        const themeColIndex = table.columns.findIndex(c => c.roles?.["modoVisual"]);
        const isDarkMode = themeColIndex >= 0
            ? resolveThemeMode(table.rows[0]?.[themeColIndex]) === "dark"
            : false;

        return {
            // em alto contraste, cores de status viram texto/traço monocromático (foreground) —
            // preenchimentos grandes (cabeçalhos coloridos etc.) são neutralizados via CSS ".high-contrast"
            positiveColor: isHighContrast ? palette.foreground.value : POSITIVE_COLOR,
            neutralColor: isHighContrast ? palette.foreground.value : NEUTRAL_COLOR,
            negativeColor: isHighContrast ? palette.foreground.value : NEGATIVE_COLOR,
            showTotals: tableStyleCard.showTotals.value,
            frozenColumnCount: tableStyleCard.frozenColumnCount.value,
            showSearchBox: tableStyleCard.showSearchBox.value,
            isHighContrast,
            hcForeground: palette.foreground.value,
            hcBackground: palette.background.value,
            isDarkMode
        };
    }

    private getColumnFormatting(column: powerbi.DataViewMetadataColumn): ColumnFormatting {
        // chamado várias vezes por coluna a cada render (ordenação, colgroup,
        // e uma vez por célula em buildDataRow) — os objects da coluna não
        // mudam dentro de um mesmo render, então cacheamos por passe
        // (limpo em renderTable, junto com formatterCache)
        const cacheKey = column.queryName ?? column.displayName;
        const cached = this.columnFormattingCache.get(cacheKey);
        if (cached) return cached;

        const objects: any = column.objects?.["columnFormatting"] || {};
        const result: ColumnFormatting = {
            hideColumn: objects.hideColumn ?? false,
            show: objects.show ?? false,
            colorSource: objects.colorSource ?? "compareText",
            positiveValue: objects.positiveValue ?? "",
            neutralValue: objects.neutralValue ?? "",
            negativeValue: objects.negativeValue ?? "",
            statusColumnName: objects.statusColumnName ?? "",
            columnWidth: typeof objects.columnWidth === "number" ? objects.columnWidth : null,
            columnOrder: typeof objects.columnOrder === "number" ? objects.columnOrder : null,
            showInTooltip: objects.showInTooltip ?? false,
            totalAggregation: objects.totalAggregation ?? "sum"
        };
        this.columnFormattingCache.set(cacheKey, result);
        return result;
    }

    private buildHeaderContent(col: powerbi.DataViewMetadataColumn, allColumns: powerbi.DataViewMetadataColumn[]): HTMLElement {
        const container = document.createElement("span");
        container.style.display = "inline-flex";
        container.style.alignItems = "center";
        container.style.gap = "4px";

        const label = document.createElement("span");
        label.textContent = col.displayName;
        container.appendChild(label);

        if (col.sort === powerbi.SortDirection.Ascending || col.sort === powerbi.SortDirection.Descending) {
            const arrow = document.createElement("span");
            arrow.textContent = col.sort === powerbi.SortDirection.Ascending ? "▲" : "▼";
            arrow.style.fontSize = "9px";
            container.appendChild(arrow);

            // com mais de uma coluna ordenada (shift+clique), mostra a prioridade
            const sortedCount = allColumns.filter(c => c.sort !== undefined).length;
            if (sortedCount > 1 && col.sortOrder !== undefined) {
                const badge = document.createElement("span");
                badge.className = "sort-order-badge";
                badge.textContent = `${col.sortOrder + 1}`;
                container.appendChild(badge);
            }
        }

        return container;
    }

    // Replica o clique-para-ordenar da tabela nativa: reexecuta a query
    // ordenada pela coluna clicada, em vez de só reordenar em memória — assim
    // funciona igual com medidas DAX também. Shift+clique adiciona esta coluna
    // como critério secundário, preservando as colunas já ordenadas.
    private sortByColumn(col: powerbi.DataViewMetadataColumn, allColumns: powerbi.DataViewMetadataColumn[], additive: boolean): void {
        const nextDirection = col.sort === powerbi.SortDirection.Ascending
            ? powerbi.SortDirection.Descending
            : powerbi.SortDirection.Ascending;

        if (!additive) {
            this.host.applyCustomSort({
                sortDescriptors: [
                    { queryName: col.queryName, sortDirection: nextDirection }
                ]
            });
            return;
        }

        const existing = allColumns
            .filter(c => c.queryName !== col.queryName && c.sort !== undefined)
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
            .map(c => ({ queryName: c.queryName as string, sortDirection: c.sort as powerbi.SortDirection }));

        this.host.applyCustomSort({
            sortDescriptors: [...existing, { queryName: col.queryName, sortDirection: nextDirection }]
        });
    }

    private applySelectionStyles(): void {
        const selectedIds = this.selectionManager.getSelectionIds() as powerbi.visuals.ISelectionId[];
        const hasSelection = selectedIds.length > 0;

        this.rowSelectionEntries.forEach(({ tr, selectionId }) => {
            const isSelected = selectedIds.some(id => id.equals(selectionId));
            tr.classList.toggle("is-faded", hasSelection && !isSelected);
        });
    }

    // Tooltip própria (não a nativa do host) para poder seguir a identidade
    // visual Olist (cores, fonte, cartão com sombra), o que a tooltipService
    // nativa do Power BI não permite.
    private showCustomTooltip(items: TooltipItem[], styles: GlobalStyles, event: MouseEvent): void {
        if (items.length === 0) return;

        this.customTooltip.replaceChildren();
        this.customTooltip.className = "custom-tooltip";
        this.customTooltip.style.fontFamily = `${FONT_FAMILY}, 'Segoe UI', sans-serif`;
        this.customTooltip.style.setProperty("--primary-color", PRIMARY_COLOR);
        this.customTooltip.style.setProperty("--positive-color", styles.positiveColor);
        this.customTooltip.style.setProperty("--neutral-color", styles.neutralColor);
        this.customTooltip.style.setProperty("--negative-color", styles.negativeColor);

        // a tooltip fica anexada ao <body>, fora de rootContainer, então não
        // herda os --ds-color-* de lá — precisa receber os tokens direto
        const ds = styles.isDarkMode ? DS_TOKENS.dark : DS_TOKENS.light;
        this.customTooltip.style.setProperty("--ds-color-ink", ds.ink);
        this.customTooltip.style.setProperty("--ds-color-ink-soft", ds.inkSoft);
        this.customTooltip.style.setProperty("--ds-color-surface", ds.surface);
        this.customTooltip.style.setProperty("--ds-color-line", ds.line);
        this.customTooltip.style.setProperty("--ds-color-line-soft", ds.lineSoft);
        this.customTooltip.style.setProperty("--ds-shadow-card", ds.shadow);

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

    private getFormatter(column: powerbi.DataViewMetadataColumn): valueFormatter.IValueFormatter {
        const key = column.queryName ?? column.displayName;
        let formatter = this.formatterCache.get(key);
        if (!formatter) {
            formatter = valueFormatter.create({
                format: column.format,
                cultureSelector: this.host.locale
            });
            this.formatterCache.set(key, formatter);
        }
        return formatter;
    }

    // Respeita o format string de cada coluna (moeda, %, data, etc.) em vez de
    // usar o valor cru — funciona automaticamente com qualquer dataset plugado.
    private formatValue(value: powerbi.PrimitiveValue, column: powerbi.DataViewMetadataColumn): string {
        if (value === null || value === undefined) return "";

        // coluna de data pode chegar como string ISO ("2018-10-17T03:00:00.000Z")
        // em vez de Date — o formatador só aplica format string de data em Date
        // de verdade, então com string ele devolveria o ISO cru na célula
        if (column.type?.dateTime && !(value instanceof Date)) {
            const parsed = new Date(value.toString());
            if (!isNaN(parsed.getTime())) {
                return this.getFormatter(column).format(parsed);
            }
        }

        return this.getFormatter(column).format(value);
    }

    private renderEmptyState(message: string): void {
        this.titleElement.style.display = "none";
        this.toolbar.style.display = "none";
        this.tableContainer.replaceChildren();
        this.tableContainer.className = "custom-table-container";
        const placeholder = document.createElement("div");
        placeholder.className = "empty-state";
        placeholder.textContent = message;
        this.tableContainer.appendChild(placeholder);
    }

    // Conteúdo inicial do container, antes do primeiro update() com dados
    // chegar — evita a tela ficar em branco enquanto a consulta roda.
    private renderSkeleton(): void {
        const skeleton = document.createElement("div");
        skeleton.className = "table-skeleton";
        for (let i = 0; i < 8; i++) {
            const row = document.createElement("div");
            row.className = "skeleton-row";
            skeleton.appendChild(row);
        }
        this.tableContainer.appendChild(skeleton);
    }

    private handleSearchInput(): void {
        if (this.searchDebounceTimer !== null) {
            window.clearTimeout(this.searchDebounceTimer);
        }
        this.searchDebounceTimer = window.setTimeout(() => {
            this.searchDebounceTimer = null;
            if (this.dataView?.table) {
                this.renderTable(this.dataView.table);
            }
        }, 150);
    }

    private handleScroll(): void {
        if (this.scrollRaf !== null) return;
        this.scrollRaf = requestAnimationFrame(() => {
            this.scrollRaf = null;
            this.maybeFetchMoreData();
            this.repaintVirtualWindow();
        });
    }

    // Carregamento incremental: dataReductionAlgorithm em janelas (capabilities.json)
    // — pede mais dados ao Power BI conforme o usuário rola perto do fim, em vez
    // de um limite fixo. Em troca, os totais ficam parciais até tudo carregar
    // (ver "hasMoreData" em renderTable).
    private maybeFetchMoreData(): void {
        if (!this.dataView?.metadata?.segment) return;
        const nearBottom = this.tableContainer.scrollTop + this.tableContainer.clientHeight
            >= this.tableContainer.scrollHeight - 200;
        if (nearBottom) {
            this.host.fetchMoreData();
        }
    }

    private focusAdjacentRow(current: HTMLTableRowElement, direction: 1 | -1): void {
        let sibling = direction === 1 ? current.nextElementSibling : current.previousElementSibling;
        while (sibling && !sibling.classList.contains("custom-table-row")) {
            sibling = direction === 1 ? sibling.nextElementSibling : sibling.previousElementSibling;
        }
        if (sibling) {
            (sibling as HTMLElement).focus();
        }
    }

    private startColumnResize(
        event: MouseEvent,
        col: powerbi.DataViewMetadataColumn,
        colElement: HTMLTableColElement,
        th: HTMLTableCellElement
    ): void {
        event.preventDefault();
        this.resizeState = {
            col,
            colElement,
            startX: event.clientX,
            startWidth: th.getBoundingClientRect().width
        };

        const onMouseMove = (moveEvent: MouseEvent) => {
            if (!this.resizeState) return;
            const delta = moveEvent.clientX - this.resizeState.startX;
            const newWidth = Math.max(40, Math.round(this.resizeState.startWidth + delta));
            this.resizeState.colElement.style.width = `${newWidth}px`;
        };

        const onMouseUp = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            if (this.resizeState) {
                const finalWidth = parseInt(this.resizeState.colElement.style.width, 10);
                this.host.persistProperties({
                    merge: [{
                        objectName: "columnFormatting",
                        selector: { metadata: this.resizeState.col.queryName },
                        properties: { columnWidth: finalWidth }
                    }]
                });
            }
            this.resizeState = null;
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    }

    // Mede a altura real de uma linha renderizada para calcular a janela de
    // virtualização com precisão.
    private measureRowHeight(): void {
        if (!this.virtualCtx || this.virtualCtx.entries.length === 0) return;
        const { tbody, bottomSpacer, buildRow, entries } = this.virtualCtx;

        const sampleRow = buildRow(entries[0]);
        tbody.insertBefore(sampleRow, bottomSpacer);
        const height = sampleRow.getBoundingClientRect().height;
        tbody.removeChild(sampleRow);
        this.rowSelectionEntries = [];
        this.virtualCtx.rowHeight = height > 0 ? height : 32;
    }

    // Renderiza só as linhas dentro (+ margem) da janela visível, com
    // "spacers" no topo/rodapé mantendo a altura correta da barra de rolagem —
    // evita travar o navegador com milhares de linhas no DOM de uma vez.
    //
    // "targetScrollTop" é usado só na primeira pintura após um re-render completo
    // (ex: busca mudando o conjunto de linhas): nesse momento os spacers ainda não
    // têm altura, então o container ainda não tem scrollHeight suficiente — se a
    // gente tentasse restaurar this.tableContainer.scrollTop ANTES de calcular a
    // janela com base nele, o navegador simplesmente zera o valor (clamp), porque
    // o conteúdo visível ainda é pequeno demais para conter aquela posição.
    private repaintVirtualWindow(targetScrollTop?: number): void {
        if (!this.virtualCtx) return;
        const { tbody, topSpacer, bottomSpacer, buildRow, entries } = this.virtualCtx;
        const rowHeight = this.virtualCtx.rowHeight > 0 ? this.virtualCtx.rowHeight : 32;

        const scrollTop = targetScrollTop ?? this.tableContainer.scrollTop;
        const viewportHeight = this.tableContainer.clientHeight || 400;
        const buffer = 6;

        const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - buffer);
        const visibleCount = Math.ceil(viewportHeight / rowHeight) + buffer * 2;
        const endIndex = Math.min(entries.length, startIndex + Math.max(visibleCount, 1));

        for (const tr of this.virtualCtx.renderedRows) {
            tr.remove();
        }
        this.rowSelectionEntries = [];

        const fragment = document.createDocumentFragment();
        const newRenderedRows: HTMLTableRowElement[] = [];
        for (let i = startIndex; i < endIndex; i++) {
            const tr = buildRow(entries[i]);
            newRenderedRows.push(tr);
            fragment.appendChild(tr);
        }
        tbody.insertBefore(fragment, bottomSpacer);
        this.virtualCtx.renderedRows = newRenderedRows;

        (topSpacer.firstElementChild as HTMLElement).style.height = `${startIndex * rowHeight}px`;
        (bottomSpacer.firstElementChild as HTMLElement).style.height = `${(entries.length - endIndex) * rowHeight}px`;

        // só agora o container tem altura suficiente pra "aceitar" esse scrollTop
        if (targetScrollTop !== undefined) {
            this.tableContainer.scrollTop = targetScrollTop;
        }

        this.applySelectionStyles();
    }

    private renderTable(table: powerbi.DataViewTable) {
        const styles = this.getGlobalStyles(table);
        this.formatterCache.clear();
        this.columnFormattingCache.clear();

        // reconstruímos a tabela inteira a cada update()/busca/toggle de grupo —
        // sem isso, limpar o container abaixo reseta o scroll pro topo toda vez
        const previousScrollTop = this.tableContainer.scrollTop;

        // tokens fixos claro/escuro (ver DS_TOKENS) — setados sempre por
        // completo (nunca só o que mudou) porque rootContainer persiste
        // entre renders e um valor do tema anterior "vazaria" pro atual
        const ds = styles.isDarkMode ? DS_TOKENS.dark : DS_TOKENS.light;
        this.rootContainer.style.setProperty("--ds-color-ink", ds.ink);
        this.rootContainer.style.setProperty("--ds-color-ink-soft", ds.inkSoft);
        this.rootContainer.style.setProperty("--ds-color-surface", ds.surface);
        this.rootContainer.style.setProperty("--ds-color-surface-sunken", ds.surfaceSunken);
        this.rootContainer.style.setProperty("--ds-color-line", ds.line);
        this.rootContainer.style.setProperty("--ds-color-line-soft", ds.lineSoft);
        this.rootContainer.style.setProperty("--ds-shadow-card", ds.shadow);

        const titleCard = this.formattingSettings.chartTitleCard;
        const showTitle = titleCard.show.value && titleCard.text.value.trim().length > 0;
        this.titleElement.textContent = titleCard.text.value;
        this.titleElement.style.display = showTitle ? "block" : "none";

        this.tableContainer.replaceChildren();
        // fallback pra sans-serif do sistema: sem isso, se a fonte escolhida
        // (a Olist "Plus Jakarta Sans" por padrão) não estiver instalada na
        // máquina, o navegador cai pro serifado padrão em vez de um
        // sans-serif parecido — Power BI não carrega fontes do Google Fonts
        this.tableContainer.style.fontFamily = `${FONT_FAMILY}, 'Segoe UI', sans-serif`;
        this.tableContainer.style.setProperty("--primary-color", PRIMARY_COLOR);
        this.tableContainer.style.setProperty("--positive-color", styles.positiveColor);
        this.tableContainer.style.setProperty("--neutral-color", styles.neutralColor);
        this.tableContainer.style.setProperty("--negative-color", styles.negativeColor);

        const containerClasses = ["custom-table-container"];
        if (styles.isHighContrast) containerClasses.push("high-contrast");
        this.tableContainer.className = containerClasses.join(" ");

        this.rowSelectionEntries = [];
        this.virtualCtx = null;

        // campos exclusivos de tooltip (role "camposTooltip") ou de controle
        // de tema (role "modoVisual") nunca viram colunas renderizadas
        const isStructuralColumn = (col: powerbi.DataViewMetadataColumn) =>
            !!col.roles?.["camposTooltip"] || !!col.roles?.["modoVisual"];

        // colunas visíveis (exclui campos de tooltip e as marcadas como "ocultar"),
        // ordenadas por "Ordem de exibição" (campo numérico na formatação de cada
        // coluna, ajustado manualmente pelo usuário — sem nenhum reajuste
        // automático) — a ordem de "Campos da Tabela" no painel de campos NÃO é
        // confiável aqui, porque o papel mistura categorias e medidas e o Power BI
        // reordena o dataView internamente (categorias primeiro, medidas depois).
        // Colunas sem ordem definida (ou 0) vão pro fim, na posição natural entre si.
        const visibleColumnIndexes = table.columns
            .map((col, idx) => ({ col, idx }))
            .filter(({ col }) => !isStructuralColumn(col) && !this.getColumnFormatting(col).hideColumn)
            .sort((a, b) => {
                const rawOrderA = this.getColumnFormatting(a.col).columnOrder;
                const rawOrderB = this.getColumnFormatting(b.col).columnOrder;
                const orderA = rawOrderA && rawOrderA > 0 ? rawOrderA : UNORDERED_COLUMN_OFFSET + a.idx;
                const orderB = rawOrderB && rawOrderB > 0 ? rawOrderB : UNORDERED_COLUMN_OFFSET + b.idx;
                return orderA - orderB;
            });

        // tooltip mostra: campos da role "camposTooltip" (sempre) + campos normais
        // marcados individualmente com "Mostrar esta coluna na tooltip"
        const tooltipColumnEntries = table.columns
            .map((col, idx) => ({ col, idx }))
            .filter(({ col }) => {
                if (col.roles?.["camposTooltip"]) return true;
                return this.getColumnFormatting(col).showInTooltip;
            });

        // dataReductionAlgorithm em janelas (capabilities.json): "segment" continua
        // presente enquanto o Power BI ainda tem mais linhas pra entregar — nesse
        // caso os totais no rodapé são só do que já carregou (ver mais abaixo)
        const hasMoreData = !!this.dataView?.metadata?.segment;
        // sempre visível (não só enquanto carrega): dá uma referência constante
        // de quantas linhas estão no visual, antes e depois do carregamento
        // automático terminar
        this.truncationBadge.textContent = hasMoreData
            ? `${table.rows.length.toLocaleString("pt-BR")} linhas carregadas...`
            : `${table.rows.length.toLocaleString("pt-BR")} linhas`;
        this.truncationBadge.style.display = "inline-block";
        this.searchInput.style.display = styles.showSearchBox ? "block" : "none";
        this.toolbar.style.display = "flex";

        // busca: filtra por substring (case-insensitive) nas colunas visíveis,
        // já formatadas do jeito que aparecem na tela
        const searchQuery = this.searchInput.value.trim().toLowerCase();
        const filteredEntries: RowEntry[] = table.rows
            .map((row, originalIndex) => ({ row, originalIndex }))
            .filter(({ row }) => {
                if (!searchQuery) return true;
                return visibleColumnIndexes.some(({ col, idx }) =>
                    this.formatValue(row[idx], col).toLowerCase().includes(searchQuery)
                );
            });

        // colunas congeladas: soma a largura configurada (ou um padrão) das
        // colunas anteriores pra saber o "left" de cada uma ao rolar horizontal
        const safeFrozenColumnCount = Number.isFinite(styles.frozenColumnCount) ? styles.frozenColumnCount : 0;
        const frozenCount = Math.max(0, Math.min(Math.round(safeFrozenColumnCount), visibleColumnIndexes.length));
        const frozenLefts: number[] = [];
        {
            let cumulativeLeft = 0;
            for (let i = 0; i < frozenCount; i++) {
                frozenLefts.push(cumulativeLeft);
                const width = this.getColumnFormatting(visibleColumnIndexes[i].col).columnWidth ?? DEFAULT_COL_WIDTH;
                cumulativeLeft += width;
            }
        }

        const htmlTable = document.createElement("table");
        htmlTable.className = frozenCount > 0 ? "custom-table has-frozen-columns" : "custom-table";
        htmlTable.setAttribute("role", "table");

        // colgroup dá a cada coluna uma largura independente e redimensionável.
        // Com coluna(s) congelada(s) ativas, TODAS as colunas precisam de largura
        // explícita (table-layout: fixed via .has-frozen-columns): misturar
        // position:sticky com auto-layout confundiu o cálculo de largura das
        // colunas não congeladas (cabeçalho e dados desalinhando/sobrepondo).
        const colgroup = document.createElement("colgroup");
        const colElements: HTMLTableColElement[] = visibleColumnIndexes.map(({ col }) => {
            const colEl = document.createElement("col");
            const colFormat = this.getColumnFormatting(col);
            if (colFormat.columnWidth) {
                colEl.style.width = `${colFormat.columnWidth}px`;
            } else if (frozenCount > 0) {
                colEl.style.width = `${DEFAULT_COL_WIDTH}px`;
            }
            colgroup.appendChild(colEl);
            return colEl;
        });
        htmlTable.appendChild(colgroup);

        const thead = document.createElement("thead");
        thead.setAttribute("role", "rowgroup");
        const headerRow = document.createElement("tr");
        headerRow.setAttribute("role", "row");

        visibleColumnIndexes.forEach(({ col }, i) => {
            const th = document.createElement("th");
            th.setAttribute("role", "columnheader");
            th.setAttribute("aria-sort",
                col.sort === powerbi.SortDirection.Ascending ? "ascending" :
                    col.sort === powerbi.SortDirection.Descending ? "descending" : "none");
            th.tabIndex = 0;
            th.appendChild(this.buildHeaderContent(col, table.columns));

            if (i < frozenCount) {
                th.classList.add("frozen-col");
                th.style.left = `${frozenLefts[i]}px`;
            }

            const activateSort = (shiftKey: boolean) => this.sortByColumn(col, table.columns, shiftKey);
            th.addEventListener("click", (event: MouseEvent) => activateSort(event.shiftKey));
            th.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activateSort(event.shiftKey);
                }
            });

            if (i < visibleColumnIndexes.length - 1) {
                const handle = document.createElement("div");
                handle.className = "col-resize-handle";
                handle.addEventListener("mousedown", (event: MouseEvent) => {
                    event.stopPropagation();
                    this.startColumnResize(event, col, colElements[i], th);
                });
                th.appendChild(handle);
            }

            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        htmlTable.appendChild(thead);

        const tbody = document.createElement("tbody");
        tbody.setAttribute("role", "rowgroup");

        const buildDataRow = (row: powerbi.DataViewTableRow, rowIndex: number): HTMLTableRowElement => {
            const tr = document.createElement("tr");
            tr.className = "custom-table-row";
            tr.setAttribute("role", "row");
            tr.tabIndex = 0;

            visibleColumnIndexes.forEach(({ col, idx }, colPos) => {
                const td = document.createElement("td");
                td.setAttribute("role", "cell");
                const rawValue = row[idx];
                const colFormat = this.getColumnFormatting(col);

                td.appendChild(this.renderCell(rawValue, col, colFormat, styles, table.columns, row));

                if (colPos < frozenCount) {
                    td.classList.add("frozen-col");
                    td.style.left = `${frozenLefts[colPos]}px`;
                }

                tr.appendChild(td);
            });

            const selectionId = this.host.createSelectionIdBuilder()
                .withTable(table, rowIndex)
                .createSelectionId();
            this.rowSelectionEntries.push({ tr, selectionId });

            const tooltipItems: TooltipItem[] = tooltipColumnEntries.map(({ col, idx }) => ({
                displayName: col.displayName,
                value: this.formatValue(row[idx], col)
            }));

            tr.addEventListener("click", (event: MouseEvent) => {
                this.selectionManager.select(selectionId, event.ctrlKey)
                    .then(() => this.applySelectionStyles());
            });
            tr.addEventListener("contextmenu", (event: MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                this.selectionManager.showContextMenu(selectionId, { x: event.clientX, y: event.clientY });
            });
            tr.addEventListener("mouseenter", (event: MouseEvent) => {
                this.showCustomTooltip(tooltipItems, styles, event);
            });
            tr.addEventListener("mousemove", (event: MouseEvent) => {
                this.positionCustomTooltip(event);
            });
            tr.addEventListener("mouseleave", () => {
                this.hideCustomTooltip();
            });
            tr.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    this.selectionManager.select(selectionId, event.ctrlKey)
                        .then(() => this.applySelectionStyles());
                } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    this.focusAdjacentRow(tr, 1);
                } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    this.focusAdjacentRow(tr, -1);
                }
            });

            return tr;
        };

        const topSpacer = document.createElement("tr");
        topSpacer.className = "virtual-spacer";
        const topSpacerCell = document.createElement("td");
        topSpacerCell.colSpan = visibleColumnIndexes.length;
        topSpacerCell.style.padding = "0";
        topSpacerCell.style.border = "none";
        topSpacer.appendChild(topSpacerCell);

        const bottomSpacer = topSpacer.cloneNode(true) as HTMLTableRowElement;

        tbody.appendChild(topSpacer);
        tbody.appendChild(bottomSpacer);
        htmlTable.appendChild(tbody);

        this.virtualCtx = {
            entries: filteredEntries,
            tbody,
            topSpacer,
            bottomSpacer,
            rowHeight: 0,
            buildRow: (entry) => buildDataRow(entry.row, entry.originalIndex),
            renderedRows: []
        };

        if (styles.showTotals) {
            const filteredRows = filteredEntries.map(e => e.row);
            const tfoot = document.createElement("tfoot");
            const totalsRow = document.createElement("tr");
            totalsRow.setAttribute("role", "row");
            visibleColumnIndexes.forEach(({ col, idx }, i) => {
                const td = document.createElement("td");
                td.setAttribute("role", "cell");
                if (i === 0) {
                    // com carregamento incremental em andamento, o total só reflete
                    // o que já chegou até agora — deixa isso explícito
                    td.textContent = hasMoreData ? "Total (parcial)" : "Total";
                } else {
                    const colFormat = this.getColumnFormatting(col);
                    const aggregation = colFormat.totalAggregation;
                    const canAggregate = aggregation !== "none" && (col.type?.numeric || aggregation === "count");
                    if (canAggregate) {
                        const result = computeColumnAggregate(filteredRows, idx, aggregation);
                        if (result !== null) {
                            td.textContent = aggregation === "count" ? `${result}` : this.formatValue(result, col);
                        }
                    }
                }
                if (i < frozenCount) {
                    td.classList.add("frozen-col");
                    td.style.left = `${frozenLefts[i]}px`;
                }
                totalsRow.appendChild(td);
            });
            tfoot.appendChild(totalsRow);
            htmlTable.appendChild(tfoot);
        }

        this.tableContainer.appendChild(htmlTable);

        if (this.virtualCtx) {
            // com virtualização, os spacers só ganham altura dentro de
            // repaintVirtualWindow — restaurar o scroll precisa acontecer
            // DEPOIS disso (veja o comentário no método)
            this.measureRowHeight();
            this.repaintVirtualWindow(previousScrollTop);
        } else {
            // sem virtualização (layout agrupado), o conteúdo já está no
            // tamanho final aqui, então dá pra restaurar direto
            this.tableContainer.scrollTop = previousScrollTop;
        }

        this.applySelectionStyles();
    }

    private renderCell(
        value: powerbi.PrimitiveValue,
        column: powerbi.DataViewMetadataColumn,
        colFormat: ColumnFormatting,
        styles: GlobalStyles,
        columns: powerbi.DataViewMetadataColumn[],
        row: powerbi.DataViewTableRow
    ): HTMLElement {
        const wrapper = document.createElement("span");
        const rawText = value?.toString() ?? "";
        const displayValue = this.formatValue(value, column);

        if (!colFormat.show) {
            wrapper.textContent = displayValue;
            return wrapper;
        }

        const status = resolveStatus(rawText, colFormat, columns, row);

        if (status === "none") {
            wrapper.textContent = displayValue;
            return wrapper;
        }

        const colorMap: Record<Exclude<CellStatus, "none">, string> = {
            positive: styles.positiveColor,
            neutral: styles.neutralColor,
            negative: styles.negativeColor
        };
        const color = colorMap[status];

        const arrowSymbol: Record<Exclude<CellStatus, "none">, string> = {
            positive: "▲",
            neutral: "●",
            negative: "▼"
        };
        // em alto contraste o status não pode depender só da cor — reforça com um símbolo
        const statusPrefix = styles.isHighContrast ? `${arrowSymbol[status]} ` : "";
        const text = statusPrefix + displayValue;

        wrapper.textContent = text;
        wrapper.style.backgroundColor = `color-mix(in srgb, ${color} 16%, transparent)`;
        wrapper.style.color = color;
        wrapper.style.padding = "4px 12px";
        wrapper.style.borderRadius = "999px";
        wrapper.style.fontSize = "11px";
        wrapper.style.letterSpacing = ".04em";
        wrapper.style.fontWeight = "700";
        // a fonte variável (Plus Jakarta Sans embutida) às vezes não
        // interpola o eixo de peso só com font-weight — sem isso o pill
        // ficava fino mesmo pedindo 700 (mesmo caso do .wght() do LESS)
        wrapper.style.setProperty("font-variation-settings", '"wght" 700');
        wrapper.style.display = "inline-block";

        // fundo "pill" em alto contraste usa só o par garantido pelo host
        if (styles.isHighContrast) {
            wrapper.style.backgroundColor = styles.hcBackground;
            wrapper.style.color = styles.hcForeground;
            wrapper.style.border = `1px solid ${styles.hcForeground}`;
        }

        return wrapper;
    }
}
