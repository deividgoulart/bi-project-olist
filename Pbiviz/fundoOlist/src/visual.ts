"use strict";

import powerbi from "powerbi-visuals-api";
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;

import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { VisualFormattingSettingsModel } from "./settings";
import { resolveThemeMode } from "./themeLogic";

import "./../style/visual.less";

// mesmos tons de "surface-sunken" usados como fundo da página no mockup
// (não o "surface" branco/escuro dos cartões — este é o tom por trás deles)
const DS_TOKENS = {
    light: { surfaceSunken: "#F4F6FC" },
    dark: { surfaceSunken: "#060A1C" }
};

export class Visual implements IVisual {
    private target: HTMLElement;
    private rootContainer: HTMLElement;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    constructor(options: VisualConstructorOptions) {
        this.target = options.element;
        this.formattingSettingsService = new FormattingSettingsService();
        this.target.style.backgroundColor = "transparent";

        this.rootContainer = document.createElement("div");
        this.rootContainer.className = "visual-root";
        this.target.appendChild(this.rootContainer);
    }

    public update(options: VisualUpdateOptions): void {
        const dataView = options.dataViews?.[0];
        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);

        const themeColumn = dataView?.categorical?.values?.find(v => v.source.roles?.["modoVisual"]);
        const isDarkMode = themeColumn ? resolveThemeMode(themeColumn.values[0]) === "dark" : false;

        const ds = isDarkMode ? DS_TOKENS.dark : DS_TOKENS.light;
        this.rootContainer.style.setProperty("--ds-color-surface-sunken", ds.surfaceSunken);
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
