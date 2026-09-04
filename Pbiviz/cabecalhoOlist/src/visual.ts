"use strict";

import powerbi from "powerbi-visuals-api";
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;

import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { VisualFormattingSettingsModel } from "./settings";
import { resolveThemeMode } from "./headerLogic";

import "./../style/visual.less";

// mesmos tokens fixos usados em tabelaOlist/barrasOlist — só os dois que esse
// visual realmente usa (ink pro título, blue pro texto pequeno em cima). O
// azul muda de tom no escuro (não é o mesmo #0A4EE4 literal usado nas barras/
// séries dos outros visuais) porque aqui é decoração de texto sobre o fundo
// do relatório, não uma cor que precisa continuar igual pra identificar dado
const DS_TOKENS = {
    light: { ink: "#131B33", blue: "#0A4EE4" },
    dark: { ink: "#E8ECFB", blue: "#4C86FF" }
};

export class Visual implements IVisual {
    private target: HTMLElement;
    private rootContainer: HTMLElement;
    private eyebrowElement: HTMLElement;
    private titleElement: HTMLElement;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    constructor(options: VisualConstructorOptions) {
        this.target = options.element;
        this.formattingSettingsService = new FormattingSettingsService();

        this.target.style.backgroundColor = "transparent";

        this.rootContainer = document.createElement("div");
        this.rootContainer.className = "visual-root";

        this.eyebrowElement = document.createElement("span");
        this.eyebrowElement.className = "header-eyebrow";

        this.titleElement = document.createElement("h1");
        this.titleElement.className = "header-title";

        this.rootContainer.appendChild(this.eyebrowElement);
        this.rootContainer.appendChild(this.titleElement);
        this.target.appendChild(this.rootContainer);
    }

    public update(options: VisualUpdateOptions): void {
        const dataView = options.dataViews?.[0];
        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
        const headerStyle = this.formattingSettings.headerStyleCard;

        // medida opcional (role "modoVisual") que deixa uma única medida DAX
        // controlar o tema claro/escuro de vários visuais ao mesmo tempo,
        // igual em tabelaOlist/barrasOlist
        const themeColumn = dataView?.categorical?.values?.find(v => v.source.roles?.["modoVisual"]);
        const isDarkMode = themeColumn ? resolveThemeMode(themeColumn.values[0]) === "dark" : false;
        const ds = isDarkMode ? DS_TOKENS.dark : DS_TOKENS.light;
        this.rootContainer.style.setProperty("--ds-color-ink", ds.ink);
        this.rootContainer.style.setProperty("--ds-color-blue", ds.blue);

        const eyebrowText = headerStyle.eyebrowText.value ?? "";
        this.eyebrowElement.textContent = eyebrowText;
        this.eyebrowElement.style.display = eyebrowText.trim().length > 0 ? "" : "none";

        this.titleElement.textContent = headerStyle.titleText.value ?? "";
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
