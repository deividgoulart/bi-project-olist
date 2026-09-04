"use strict";

import powerbi from "powerbi-visuals-api";
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;

import * as models from "powerbi-models";

import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { VisualFormattingSettingsModel } from "./settings";
import {
    resolveThemeMode,
    distinctValues,
    resolveThemeOptionPair,
    parseColumnTarget,
    FilterColumnTarget,
    ThemeOptionPair
} from "./themeSwitchLogic";

import "./../style/visual.less";

export class Visual implements IVisual {
    private target: HTMLElement;
    private host: IVisualHost;
    private rootContainer: HTMLElement;
    private switchElement: HTMLElement;
    private thumbElement: HTMLElement;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private columnTarget: FilterColumnTarget | null = null;
    private optionPair: ThemeOptionPair | null = null;
    private isDarkMode = false;

    constructor(options: VisualConstructorOptions) {
        this.target = options.element;
        this.host = options.host;
        this.formattingSettingsService = new FormattingSettingsService();
        this.target.style.backgroundColor = "transparent";

        this.rootContainer = document.createElement("div");
        this.rootContainer.className = "visual-root";

        this.switchElement = document.createElement("button");
        this.switchElement.setAttribute("type", "button");
        this.switchElement.className = "theme-switch";
        this.switchElement.setAttribute("role", "switch");
        this.switchElement.addEventListener("click", () => this.toggle());

        this.thumbElement = document.createElement("span");
        this.thumbElement.className = "theme-switch-thumb";
        this.thumbElement.setAttribute("aria-hidden", "true");

        this.switchElement.appendChild(this.thumbElement);
        this.rootContainer.appendChild(this.switchElement);
        this.target.appendChild(this.rootContainer);
    }

    public update(options: VisualUpdateOptions): void {
        const dataView = options.dataViews?.[0];
        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);

        const categoryColumn = dataView?.categorical?.categories?.[0];

        if (!categoryColumn) {
            this.columnTarget = null;
            this.optionPair = null;
            this.renderEmptyState("Adicione um campo com 2 valores (ex: Tema[Modo]).");
            return;
        }

        this.columnTarget = parseColumnTarget(categoryColumn.source.queryName ?? categoryColumn.source.displayName);
        this.optionPair = resolveThemeOptionPair(distinctValues(categoryColumn.values));

        if (!this.optionPair) {
            this.renderEmptyState("O campo precisa ter 2 valores, um reconhecido como escuro (ex: \"Escuro\" e \"Claro\").");
            return;
        }

        // sincroniza com o filtro de verdade (pode ter mudado por bookmark,
        // "limpar filtros" do relatório, ou outra interação) — sem seleção
        // ainda (primeiro carregamento), cai no claro, igual a medida
        // "Modo Visual" (SELECTEDVALUE sem seleção também cai no claro)
        const currentFilter = options.jsonFilters?.[0] as models.IBasicFilter | undefined;
        const selected = currentFilter?.values?.[0] !== undefined && currentFilter.values[0] !== null
            ? String(currentFilter.values[0])
            : null;
        this.isDarkMode = selected !== null && resolveThemeMode(selected) === "dark";

        this.renderSwitch();
    }

    private renderEmptyState(message: string): void {
        this.rootContainer.replaceChildren();
        this.rootContainer.className = "visual-root";
        const msg = document.createElement("div");
        msg.className = "empty-state";
        msg.textContent = message;
        this.rootContainer.appendChild(msg);
    }

    private renderSwitch(): void {
        if (!this.rootContainer.contains(this.switchElement)) {
            this.rootContainer.replaceChildren();
            this.rootContainer.appendChild(this.switchElement);
        }
        this.rootContainer.className = "visual-root";

        this.switchElement.classList.toggle("theme-switch--dark", this.isDarkMode);
        this.switchElement.setAttribute("aria-checked", this.isDarkMode ? "true" : "false");
        this.switchElement.setAttribute("aria-label", this.isDarkMode ? "Tema escuro ativo — clique para mudar pro claro" : "Tema claro ativo — clique para mudar pro escuro");
        this.thumbElement.textContent = this.isDarkMode ? "🌙" : "☀";
    }

    private toggle(): void {
        if (!this.columnTarget || !this.optionPair) return;
        const nextValue = this.isDarkMode ? this.optionPair.lightValue : this.optionPair.darkValue;

        const filter = new models.BasicFilter(
            { table: this.columnTarget.table, column: this.columnTarget.column },
            "In",
            nextValue
        );
        this.host.applyJsonFilter(filter.toJSON(), "general", "filter", powerbi.FilterAction.merge);

        // atualiza a UI na hora, sem esperar o próximo update() — o
        // applyJsonFilter é assíncrono (dispara um novo update() só depois
        // que o host confirma o filtro)
        this.isDarkMode = !this.isDarkMode;
        this.renderSwitch();
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
