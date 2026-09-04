"use strict";

import powerbi from "powerbi-visuals-api";
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;

import * as models from "powerbi-models";

import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { VisualFormattingSettingsModel } from "./settings";
import { resolveThemeMode, distinctSortedValues, filterBySearchText, parseColumnTarget, FilterColumnTarget } from "./filterLogic";

import "./../style/visual.less";

const DS_TOKENS = {
    light: {
        ink: "#131B33", surface: "#FFFFFF", line: "#DDE2F0", blue: "#0A4EE4",
        shadow: "0 1px 2px rgba(19, 27, 51, .04), 0 8px 24px -12px rgba(19, 27, 51, .18)"
    },
    dark: {
        ink: "#E8ECFB", surface: "#0B1330", line: "#232D57", blue: "#4C86FF",
        shadow: "0 1px 2px rgba(0, 0, 0, .3), 0 12px 32px -14px rgba(0, 0, 0, .6)"
    }
};

// UM campo por instância do visual — para uma barra com vários filtros, use
// uma instância por campo, lado a lado.
//
// Duas tentativas de colocar vários campos num visual só já falharam, e vale
// registrar as duas para ninguém repetir:
//
// 1. Vários campos num ÚNICO papel de agrupamento: o Power BI trata como
//    hierarquia — as linhas viram as combinações existentes entre os campos,
//    dividindo um mesmo teto de redução de dados, e valores somem da lista.
//    Bug de dado silencioso. É a mesma razão pela qual um slicer nativo
//    aceita só um campo.
// 2. N papéis separados, cada um com seu próprio dataViewMapping: derruba a
//    geração de consulta do Power BI Desktop assim que o SEGUNDO campo é
//    vinculado ("Cannot read properties of null (reading 'aggregates')" em
//    visitRole, dentro de rewriteQuery). Testado com e sem a medida de tema,
//    e com `min: 1` em todas as conditions — o crash é o mesmo. Conclusão:
//    múltiplos dataViewMappings são ALTERNATIVAS (o host escolhe um válido
//    para a forma dos dados amarrados), não consultas paralelas devolvendo
//    um dataViews[] com uma entrada por campo. A frase "each valid mapping
//    produces a data view" na documentação foi lida errada aqui.
//
// O código continua agnóstico à quantidade (percorre papéis e dataViews), o
// que torna barato reverter/reexperimentar — mas não reexperimente o item 2
// sem uma evidência nova, o resultado já está estabelecido por dois testes.
const FIELD_ROLES = ["campo1"];

interface FilterField {
    role: string;
    queryName: string;
    displayName: string;
    columnTarget: FilterColumnTarget;
    optionValues: string[];
    selectedValues: string[];
    searchText: string;
    isOpen: boolean;
    anchor: HTMLElement;
    pill: HTMLElement;
    pillLabel: HTMLElement;
    popup: HTMLElement;
    searchInput: HTMLInputElement;
    clearRow: HTMLElement;
    rowsContainer: HTMLElement;
}

export class Visual implements IVisual {
    private target: HTMLElement;
    private host: IVisualHost;
    private rootContainer: HTMLElement;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private fields: FilterField[] = [];
    private isDarkMode = false;
    private viewportHeight = 0;

    constructor(options: VisualConstructorOptions) {
        this.target = options.element;
        this.host = options.host;
        this.formattingSettingsService = new FormattingSettingsService();
        this.formattingSettings = new VisualFormattingSettingsModel();
        this.target.style.backgroundColor = "transparent";

        this.rootContainer = document.createElement("div");
        this.rootContainer.className = "visual-root";
        this.target.appendChild(this.rootContainer);

        document.addEventListener("click", this.onDocumentClick);
        document.addEventListener("keydown", this.onDocumentKeydown);
        // Cada custom visual roda no SEU próprio iframe, com seu próprio
        // document: clicar em outro visual do relatório não gera clique
        // nenhum aqui dentro, então onDocumentClick não dispara e o popup
        // ficaria eternamente marcado como aberto. O blur da janela é o
        // único sinal que chega quando o foco vai pra outro visual.
        window.addEventListener("blur", this.onWindowBlur);
    }

    public destroy(): void {
        document.removeEventListener("click", this.onDocumentClick);
        document.removeEventListener("keydown", this.onDocumentKeydown);
        window.removeEventListener("blur", this.onWindowBlur);
    }

    private onDocumentClick = (): void => {
        // cliques dentro de qualquer pill/popup chamam stopPropagation na
        // origem, então tudo que chega aqui é, por definição, "clique fora"
        this.closeAllPopups();
    };

    private onDocumentKeydown = (event: KeyboardEvent): void => {
        if (event.key === "Escape") this.closeAllPopups();
    };

    private onWindowBlur = (): void => {
        // o host tira o foco do iframe por um instante ao aplicar um filtro
        // (applyJsonFilter) — fechar direto aqui mataria o popup no primeiro
        // clique numa opção, justamente o que a seleção múltipla evita.
        // Só fecha se, já fora da pilha atual, o foco realmente não estiver
        // mais neste visual.
        window.setTimeout(() => {
            if (!document.hasFocus()) this.closeAllPopups();
        }, 0);
    };

    public update(options: VisualUpdateOptions): void {
        const dataViews = options.dataViews ?? [];
        this.viewportHeight = options.viewport?.height ?? 0;
        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualFormattingSettingsModel,
            dataViews[0]
        );

        this.isDarkMode = this.resolveTheme(dataViews);

        // cada dataView corresponde a um mapeamento (um campo). A associação
        // é feita pelo "roles" da própria coluna, não pelo índice do array —
        // mapeamentos sem campo vinculado podem simplesmente não vir, e aí os
        // índices deixariam de corresponder aos papéis
        const bound: Array<{ role: string; column: powerbi.DataViewCategoryColumn }> = [];
        dataViews.forEach(dataView => {
            const categories = dataView?.categorical?.categories ?? [];
            categories.forEach(category => {
                const role = FIELD_ROLES.find(r => category.source.roles?.[r]);
                if (role && !bound.some(b => b.role === role)) {
                    bound.push({ role, column: category });
                }
            });
        });

        // ordem estável dos pills na barra: a ordem dos papéis (Campo 1..5),
        // não a ordem em que o host devolveu os dataViews
        bound.sort((a, b) => FIELD_ROLES.indexOf(a.role) - FIELD_ROLES.indexOf(b.role));

        if (bound.length === 0) {
            // Um update() pode chegar sem categorias por um instante logo
            // depois de aplicar o filtro, mesmo com o campo ainda vinculado.
            // Cair no estado "sem campo" aqui apagaria todo o DOM — e com ele
            // o popup aberto no meio de uma seleção múltipla. Os metadados
            // dizem o que está VINCULADO; as categorias, o que veio de DADO.
            // Se o vínculo continua lá, isto é transitório: mantém a tela.
            const stillBound = dataViews.some(dataView =>
                (dataView?.metadata?.columns ?? []).some(column =>
                    FIELD_ROLES.some(role => column.roles?.[role])));
            if (stillBound && this.fields.length > 0) return;

            this.fields = [];
            this.renderEmptyState();
            return;
        }

        this.syncFieldDom(bound);

        bound.forEach(({ role, column }) => {
            const field = this.fields.find(f => f.role === role);
            if (!field) return;
            field.displayName = this.resolveFieldLabel(column.source);
            field.columnTarget = parseColumnTarget(column.source.queryName ?? column.source.displayName);
            field.optionValues = distinctSortedValues(column.values);
        });

        // estado real do filtro (pode ter mudado por bookmark, "limpar
        // filtros" do relatório ou outra interação) — não confia só no que
        // este visual lembra de cliques anteriores
        this.syncSelectionsFromFilters(options.jsonFilters);

        this.applyThemeTokens();
        this.applyLayoutOptions();
        this.fields.forEach(field => {
            this.updatePillDisplay(field);
            if (field.isOpen) {
                this.renderPopupList(field);
                this.positionPopup(field);
            }
        });
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const staticModel = this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
        staticModel.cards.push(...this.buildFieldStyleCards());
        return staticModel;
    }

    // um card "Filtro: <campo>" por campo vinculado — mesmo padrão dinâmico do
    // cardsOlist/barrasOlist, necessário porque a quantidade de campos só é
    // conhecida em tempo de execução
    private buildFieldStyleCards(): powerbi.visuals.FormattingCard[] {
        return this.fields.map((field, index) => {
            const labelSlice: powerbi.visuals.FormattingSlice = {
                displayName: "Rótulo",
                uid: `filterLabel_${index}`,
                control: {
                    type: powerbi.visuals.FormattingComponent.TextInput,
                    properties: {
                        descriptor: {
                            objectName: "filterStyle",
                            propertyName: "label",
                            selector: { metadata: field.queryName }
                        },
                        value: field.displayName,
                        placeholder: "Em branco = nome do campo"
                    }
                }
            };

            return {
                displayName: `Filtro: ${field.displayName}`,
                uid: `filterStyleCard_${index}`,
                groups: [{
                    displayName: undefined,
                    uid: `filterStyleGroup_${index}`,
                    slices: [labelSlice]
                }]
            };
        });
    }

    private resolveTheme(dataViews: powerbi.DataView[]): boolean {
        for (const dataView of dataViews) {
            const themeColumn = dataView?.categorical?.values?.find(v => v.source.roles?.["modoVisual"]);
            if (themeColumn) return resolveThemeMode(themeColumn.values[0]) === "dark";
        }
        return false;
    }

    private resolveFieldLabel(source: powerbi.DataViewMetadataColumn): string {
        const objects = source.objects as powerbi.DataViewObjects | undefined;
        const raw = objects?.["filterStyle"]?.["label"];
        const override = raw === null || raw === undefined ? "" : String(raw).trim();
        return override.length > 0 ? override : source.displayName;
    }

    // O DOM só é reconstruído quando o CONJUNTO de campos vinculados muda —
    // uma simples mudança de seleção não reconstrói nada, preservando popup
    // aberto, texto digitado na busca e foco do teclado
    private syncFieldDom(bound: Array<{ role: string; column: powerbi.DataViewCategoryColumn }>): void {
        const nextKeys = bound.map(b => `${b.role}:${b.column.source.queryName ?? b.column.source.displayName}`);
        const currentKeys = this.fields.map(f => `${f.role}:${f.queryName}`);
        const unchanged = nextKeys.length === currentKeys.length && nextKeys.every((k, i) => k === currentKeys[i]);
        if (unchanged && this.rootContainer.contains(this.fields[0]?.anchor)) return;

        // Se por qualquer motivo o DOM precisar ser reconstruído enquanto uma
        // lista está aberta, o popup aberto seria destruído junto e pareceria
        // "fechou sozinho ao selecionar" — aplicar um filtro dispara update(),
        // então isso acontece exatamente no meio de uma seleção múltipla.
        // Guarda o que é estado de interação e devolve pro campo equivalente.
        const previous = new Map(this.fields.map(f => [`${f.role}:${f.queryName}`, f]));

        this.rootContainer.replaceChildren();
        this.rootContainer.className = "visual-root";
        this.fields = bound.map(({ role, column }) => {
            const field = this.createField(role, column);
            const old = previous.get(`${field.role}:${field.queryName}`);
            if (old) {
                field.selectedValues = old.selectedValues;
                field.searchText = old.searchText;
                field.searchInput.value = old.searchText;
                if (old.isOpen) {
                    field.isOpen = true;
                    field.popup.style.display = "block";
                    field.anchor.classList.add("filter-anchor--open");
                    this.rootContainer.classList.add("visual-root--popup-open");
                }
            }
            this.rootContainer.appendChild(field.anchor);
            return field;
        });
    }

    private createField(role: string, column: powerbi.DataViewCategoryColumn): FilterField {
        const anchor = document.createElement("div");
        anchor.className = "filter-anchor";

        const pill = document.createElement("div");
        pill.className = "filter-pill";
        pill.setAttribute("role", "button");
        pill.tabIndex = 0;

        const pillLabel = document.createElement("span");
        pillLabel.className = "filter-pill-label";
        pill.appendChild(pillLabel);
        anchor.appendChild(pill);

        const popup = document.createElement("div");
        popup.className = "filter-popup";
        popup.setAttribute("role", "listbox");
        popup.setAttribute("aria-multiselectable", "true");
        popup.style.display = "none";

        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.className = "filter-popup-search";
        searchInput.placeholder = "Buscar...";
        searchInput.setAttribute("aria-label", "Buscar valor");

        const clearRow = document.createElement("button");
        clearRow.setAttribute("type", "button");
        clearRow.className = "filter-popup-clear-all";
        clearRow.textContent = "Limpar seleção";

        const rowsContainer = document.createElement("div");
        rowsContainer.className = "filter-popup-rows";

        popup.appendChild(searchInput);
        popup.appendChild(clearRow);
        popup.appendChild(rowsContainer);
        anchor.appendChild(popup);

        const field: FilterField = {
            role,
            queryName: column.source.queryName ?? column.source.displayName,
            displayName: column.source.displayName,
            columnTarget: parseColumnTarget(column.source.queryName ?? column.source.displayName),
            optionValues: [],
            selectedValues: [],
            searchText: "",
            isOpen: false,
            anchor, pill, pillLabel, popup, searchInput, clearRow, rowsContainer
        };

        // nenhum clique dentro do pill ou do popup pode chegar ao document —
        // é o document que fecha o popup ao detectar clique fora, e marcar
        // uma opção reconstrói a lista, destacando o elemento clicado antes
        // do evento terminar de borbulhar (um teste "contains(target)" no
        // document daria falso e fecharia o popup sozinho)
        pill.addEventListener("click", event => {
            event.stopPropagation();
            this.togglePopup(field);
        });
        popup.addEventListener("click", event => event.stopPropagation());

        pill.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                this.togglePopup(field);
            }
        });

        searchInput.addEventListener("input", () => {
            field.searchText = searchInput.value;
            this.renderPopupList(field);
            this.positionPopup(field);
        });

        clearRow.addEventListener("click", () => this.clearField(field));

        return field;
    }

    private renderEmptyState(): void {
        this.rootContainer.replaceChildren();
        this.rootContainer.className = "visual-root";
        const msg = document.createElement("div");
        msg.className = "empty-state";
        msg.textContent = "Adicione um campo em \"Campo\" para exibir o filtro.";
        this.rootContainer.appendChild(msg);
    }

    private applyThemeTokens(): void {
        const ds = this.isDarkMode ? DS_TOKENS.dark : DS_TOKENS.light;
        this.rootContainer.style.setProperty("--ds-color-ink", ds.ink);
        this.rootContainer.style.setProperty("--ds-color-surface", ds.surface);
        this.rootContainer.style.setProperty("--ds-color-line", ds.line);
        this.rootContainer.style.setProperty("--ds-color-blue", ds.blue);
        this.rootContainer.style.setProperty("--ds-shadow-card", ds.shadow);
    }

    // A lista não consegue transbordar o retângulo do visual (cada custom
    // visual roda num iframe de limites fixos), então ela precisa caber na
    // altura que o visual tem. Em vez de exigir uma altura fixa generosa —
    // que vira área morta cobrindo os gráficos vizinhos e engolindo cliques,
    // tooltip e drillthrough deles — a lista se adapta ao espaço disponível e
    // rola dentro dele. Assim dá pra deixar o visual bem mais baixo.
    private applyLayoutOptions(): void {
        const openUp = this.formattingSettings.barStyleCard.openUp.value;
        // com abertura pra cima, os pills ancoram na base do visual e o espaço
        // da lista fica ACIMA deles — permite apontar a área ocupada pra uma
        // região inofensiva do relatório (o cabeçalho, por exemplo)
        this.rootContainer.classList.toggle("visual-root--bottom", openUp);

        // desconta o pill (44) e o "cromo" do popup (busca + limpar + paddings)
        const available = this.viewportHeight - 44 - 96;
        const rowsMaxHeight = Math.max(96, Math.min(260, available));
        this.rootContainer.style.setProperty("--popup-rows-max-height", `${Math.round(rowsMaxHeight)}px`);
    }

    // rótulo do pill: sempre "Campo (N)", incluindo "(0)" sem nada
    // selecionado — nunca mostra o valor em si. Texto de tamanho variável já
    // causou transbordo na prática; a contagem mantém a largura previsível e
    // constante, antes e depois de selecionar
    private updatePillDisplay(field: FilterField): void {
        const count = field.selectedValues.length;
        const hasSelection = count > 0;
        field.pill.classList.toggle("filter-pill--active", hasSelection);
        field.pillLabel.textContent = `${field.displayName} (${count})`;

        // o aria-label (só leitor de tela, sem custo de layout) continua
        // descritivo, diferente do texto visível
        field.pill.setAttribute("aria-label", count === 0
            ? field.displayName
            : count === 1
                ? `${field.displayName}: ${field.selectedValues[0]}`
                : `${field.displayName}: ${count} valores selecionados`);

        // o "×" é criado/removido só quando a presença dele muda — recriar a
        // cada render trocaria o nó embaixo de um clique em andamento
        const existingClear = field.pill.querySelector(".filter-pill-clear");
        if (hasSelection && !existingClear) {
            const clearBtn = document.createElement("span");
            clearBtn.className = "filter-pill-clear";
            clearBtn.textContent = "×";
            clearBtn.setAttribute("role", "button");
            clearBtn.setAttribute("aria-label", "Limpar filtro");
            clearBtn.tabIndex = 0;
            clearBtn.addEventListener("click", (event: MouseEvent) => {
                event.stopPropagation();
                this.clearField(field);
            });
            clearBtn.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    this.clearField(field);
                }
            });
            field.pill.appendChild(clearBtn);
        } else if (!hasSelection && existingClear) {
            existingClear.remove();
        }
    }

    private togglePopup(field: FilterField): void {
        // reconcilia a flag com o DOM antes de decidir: se por qualquer
        // caminho o popup ficou marcado como aberto sem estar visível, um
        // clique no pill fecharia algo já fechado e pareceria não fazer nada
        // (o usuário precisaria clicar duas vezes pra abrir)
        const reallyOpen = field.isOpen && field.popup.style.display !== "none";
        if (reallyOpen) this.closePopup(field);
        else this.openPopup(field);
    }

    // só um popup aberto por vez: numa barra com vários pills lado a lado,
    // dois dropdowns abertos se sobrepõem
    private openPopup(field: FilterField): void {
        this.fields.forEach(other => {
            if (other !== field) this.closePopup(other);
        });

        field.searchText = "";
        field.searchInput.value = "";
        field.isOpen = true;
        this.renderPopupList(field);
        field.popup.style.display = "block";
        field.anchor.classList.add("filter-anchor--open");
        this.rootContainer.classList.add("visual-root--popup-open");
        this.positionPopup(field);
        field.searchInput.focus();
    }

    private closePopup(field: FilterField): void {
        field.isOpen = false;
        field.popup.style.display = "none";
        field.anchor.classList.remove("filter-anchor--open");
        if (!this.fields.some(f => f.isOpen)) {
            this.rootContainer.classList.remove("visual-root--popup-open");
        }
    }

    private closeAllPopups(): void {
        this.fields.forEach(field => this.closePopup(field));
    }

    // reconstrói só o container das linhas — nunca a busca em si, pra não
    // perder foco/cursor de quem está digitando
    private renderPopupList(field: FilterField): void {
        field.clearRow.style.display = field.selectedValues.length > 0 ? "block" : "none";

        const filtered = filterBySearchText(field.optionValues, field.searchText);
        field.rowsContainer.replaceChildren();

        if (field.optionValues.length === 0 || filtered.length === 0) {
            const empty = document.createElement("div");
            empty.className = "filter-popup-item filter-popup-item--empty";
            empty.textContent = field.optionValues.length === 0 ? "Sem valores" : "Nenhum resultado";
            field.rowsContainer.appendChild(empty);
            return;
        }

        filtered.forEach(value => {
            const isSelected = field.selectedValues.includes(value);
            const item = document.createElement("div");
            item.className = isSelected ? "filter-popup-item filter-popup-item--selected" : "filter-popup-item";
            item.setAttribute("role", "option");
            item.setAttribute("aria-selected", isSelected ? "true" : "false");
            item.tabIndex = 0;

            const checkbox = document.createElement("span");
            checkbox.className = "filter-popup-checkbox";
            checkbox.setAttribute("aria-hidden", "true");
            if (isSelected) checkbox.textContent = "✓";

            const label = document.createElement("span");
            label.className = "filter-popup-item-label";
            label.textContent = value;

            item.appendChild(checkbox);
            item.appendChild(label);
            item.addEventListener("click", () => this.toggleValue(field, value));
            item.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    this.toggleValue(field, value);
                }
            });
            field.rowsContainer.appendChild(item);
        });
    }

    // o popup é "position: absolute" relativo ao .filter-anchor do próprio
    // campo (ver visual.less). Aqui só se decide virar pro lado/pra cima
    // quando não couber do jeito padrão — a posição em si é CSS.
    // Deliberadamente não é "position: fixed": o canvas do Power BI Desktop
    // aplica transform (zoom/pan da página), e "fixed" dentro de um ancestral
    // com transform passa a ser relativo A ELE, não à janela
    private positionPopup(field: FilterField): void {
        field.popup.classList.remove("filter-popup--above", "filter-popup--right");

        const anchorRect = field.anchor.getBoundingClientRect();
        const popupRect = field.popup.getBoundingClientRect();

        if (anchorRect.left + popupRect.width > window.innerWidth) {
            field.popup.classList.add("filter-popup--right");
        }

        // a escolha do autor do relatório manda; o cálculo automático só
        // decide quando ele não escolheu
        const openUp = this.formattingSettings.barStyleCard.openUp.value;
        if (openUp || anchorRect.bottom + popupRect.height + 6 > window.innerHeight) {
            field.popup.classList.add("filter-popup--above");
        }
    }

    // não fecha o popup — seleção múltipla continua até clicar fora ou Esc,
    // igual um slicer nativo
    private toggleValue(field: FilterField, value: string): void {
        const index = field.selectedValues.indexOf(value);
        if (index === -1) field.selectedValues.push(value);
        else field.selectedValues.splice(index, 1);

        this.applyAllFilters();
        // reflete na hora, sem esperar o próximo update(): applyJsonFilter é
        // assíncrono e o host só chama update() depois de confirmar o filtro
        this.updatePillDisplay(field);
        this.renderPopupList(field);
        this.positionPopup(field);
    }

    private clearField(field: FilterField): void {
        field.selectedValues = [];
        this.applyAllFilters();
        this.updatePillDisplay(field);
        if (field.isOpen) {
            this.renderPopupList(field);
            this.positionPopup(field);
        }
    }

    // Vários campos independentes compartilham a mesma propriedade
    // general/filter, então em vez de tentar remover seletivamente por alvo
    // (comportamento do merge não documentado para isso), limpa tudo e
    // re-aplica o conjunto ativo inteiro. Duas chamadas em vez de uma, mas
    // previsível independente da semântica interna de merge do host.
    // UMA chamada por clique, nunca duas. A versão anterior fazia sempre
    // "remove tudo" seguido de "merge do conjunto ativo", o que era à prova
    // de semântica de merge, mas gerava dois ciclos de update() por clique —
    // e um deles com o filtro momentaneamente vazio. Cada ciclo é uma chance
    // de o popup aberto ser derrubado no meio de uma seleção múltipla.
    private applyAllFilters(): void {
        const filters = this.fields
            .filter(field => field.selectedValues.length > 0)
            .map(field => new models.BasicFilter(
                { table: field.columnTarget.table, column: field.columnTarget.column },
                "In",
                field.selectedValues
            ).toJSON());

        if (filters.length === 0) {
            this.host.applyJsonFilter([], "general", "filter", powerbi.FilterAction.remove);
            return;
        }

        this.host.applyJsonFilter(filters, "general", "filter", powerbi.FilterAction.merge);
    }

    private syncSelectionsFromFilters(jsonFilters: powerbi.IFilter[] | undefined): void {
        const byTarget = new Map<string, string[]>();
        (jsonFilters ?? []).forEach(raw => {
            const basic = raw as models.IBasicFilter;
            const target = basic.target as models.IFilterColumnTarget;
            if (!target?.table || !target?.column) return;
            byTarget.set(
                `${target.table}.${target.column}`,
                (basic.values ?? [])
                    .filter(v => v !== null && v !== undefined)
                    .map(v => String(v))
            );
        });

        this.fields.forEach(field => {
            field.selectedValues = byTarget.get(`${field.columnTarget.table}.${field.columnTarget.column}`) ?? [];
        });
    }
}
