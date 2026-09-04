"use strict";

import powerbi from "powerbi-visuals-api";
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;

import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { VisualFormattingSettingsModel } from "./settings";
import { resolveThemeMode } from "./themeLogic";

import "./../style/visual.less";

const DS_TOKENS = {
    light: { blue: "#0A4EE4", blueHover: "#001647" },
    dark: { blue: "#4C86FF", blueHover: "#B9D1FF" }
};

export class Visual implements IVisual {
    private target: HTMLElement;
    private rootContainer: HTMLElement;
    private linkElement: HTMLElement;
    private labelElement: HTMLElement;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    constructor(options: VisualConstructorOptions) {
        this.target = options.element;
        this.formattingSettingsService = new FormattingSettingsService();

        this.target.style.backgroundColor = "transparent";

        this.rootContainer = document.createElement("div");
        this.rootContainer.className = "visual-root";

        // NOTA: este visual é só decorativo — o SDK de visual customizado do
        // Power BI não expõe uma API pública pra disparar navegação por
        // bookmark/drillthrough a partir do código do visual (só formas e
        // botões NATIVOS do Power BI têm essa ação embutida). Pra ele
        // realmente voltar a página, sobreponha um botão nativo transparente
        // (Inserir > Botões > Voltar) por cima deste visual no relatório.
        this.linkElement = document.createElement("div");
        this.linkElement.className = "back-link";
        this.linkElement.setAttribute("role", "button");
        this.linkElement.tabIndex = 0;

        const arrow = document.createElement("span");
        arrow.className = "back-arrow";
        arrow.textContent = "←";
        arrow.setAttribute("aria-hidden", "true");

        this.labelElement = document.createElement("span");

        this.linkElement.appendChild(arrow);
        this.linkElement.appendChild(this.labelElement);
        this.rootContainer.appendChild(this.linkElement);
        this.target.appendChild(this.rootContainer);
    }

    public update(options: VisualUpdateOptions): void {
        const dataView = options.dataViews?.[0];
        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
        const buttonStyle = this.formattingSettings.buttonStyleCard;

        const themeColumn = dataView?.categorical?.values?.find(v => v.source.roles?.["modoVisual"]);
        const isDarkMode = themeColumn ? resolveThemeMode(themeColumn.values[0]) === "dark" : false;
        const ds = isDarkMode ? DS_TOKENS.dark : DS_TOKENS.light;
        this.rootContainer.style.setProperty("--ds-color-blue", ds.blue);
        this.rootContainer.style.setProperty("--ds-color-blue-hover", ds.blueHover);

        const label = buttonStyle.label.value || "Voltar";
        this.labelElement.textContent = label;
        this.linkElement.setAttribute("aria-label", label);
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
