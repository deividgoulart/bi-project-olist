"use strict";

import powerbi from "powerbi-visuals-api";
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import DataViewCategorical = powerbi.DataViewCategorical;

import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";
import { VisualFormattingSettingsModel } from "./settings";
import { resolveThemeMode, resolveCardVariant, CardVariant } from "./cardLogic";

import "./../style/visual.less";

const DS_TOKENS = {
    light: {
        ink: "#131B33", inkSoft: "#4C5378", surface: "#FFFFFF", line: "#DDE2F0",
        amber: "#B9700A", blue: "#0A4EE4",
        shadow: "0 1px 2px rgba(19, 27, 51, .04), 0 8px 24px -12px rgba(19, 27, 51, .18)"
    },
    dark: {
        ink: "#E8ECFB", inkSoft: "#A6ADD1", surface: "#0B1330", line: "#232D57",
        amber: "#D99A3F", blue: "#4C86FF",
        shadow: "0 1px 2px rgba(0, 0, 0, .3), 0 12px 32px -14px rgba(0, 0, 0, .6)"
    }
};

interface CardInfo {
    label: string;
    formattedValue: string;
    variant: CardVariant;
    queryName: string;
}

export class Visual implements IVisual {
    private target: HTMLElement;
    private rootContainer: HTMLElement;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;
    private cardInfos: CardInfo[] = [];

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

        const categorical: DataViewCategorical | undefined = dataView?.categorical;
        const measureColumns = (categorical?.values ?? []).filter(v => v.source.roles?.["valores"]);

        if (measureColumns.length === 0) {
            this.cardInfos = [];
            this.renderEmptyState();
            return;
        }

        const themeColumn = categorical?.values.find(v => v.source.roles?.["modoVisual"]);
        const isDarkMode = themeColumn ? resolveThemeMode(themeColumn.values[0]) === "dark" : false;

        this.cardInfos = measureColumns.map(col => {
            const objectsBag = col.source.objects?.["cardStyle"] as { label?: string; variant?: string } | undefined;
            const label = objectsBag?.label && objectsBag.label.trim().length > 0
                ? objectsBag.label
                : col.source.displayName;
            const formatter = valueFormatter.create({ format: col.source.format });
            const rawValue = col.values[0];
            const formattedValue = rawValue === null || rawValue === undefined ? "—" : formatter.format(rawValue);
            return {
                label,
                formattedValue,
                variant: resolveCardVariant(objectsBag?.variant),
                queryName: col.source.queryName ?? label
            };
        });

        this.renderCards(isDarkMode);
    }

    private renderEmptyState(): void {
        this.rootContainer.replaceChildren();
        this.rootContainer.className = "visual-root";
        const msg = document.createElement("div");
        msg.className = "empty-state";
        msg.textContent = "Adicione ao menos uma medida em \"Valores\" para exibir os cartões.";
        this.rootContainer.appendChild(msg);
    }

    private renderCards(isDarkMode: boolean): void {
        this.rootContainer.replaceChildren();
        this.rootContainer.className = "visual-root";

        const ds = isDarkMode ? DS_TOKENS.dark : DS_TOKENS.light;
        this.rootContainer.style.setProperty("--ds-color-ink", ds.ink);
        this.rootContainer.style.setProperty("--ds-color-ink-soft", ds.inkSoft);
        this.rootContainer.style.setProperty("--ds-color-surface", ds.surface);
        this.rootContainer.style.setProperty("--ds-color-line", ds.line);
        this.rootContainer.style.setProperty("--ds-color-amber", ds.amber);
        this.rootContainer.style.setProperty("--ds-color-blue", ds.blue);
        this.rootContainer.style.setProperty("--ds-shadow-card", ds.shadow);

        for (const card of this.cardInfos) {
            const cardEl = document.createElement("div");
            cardEl.className = `kpi-card kpi-card--${card.variant}`;
            cardEl.title = `${card.label}: ${card.formattedValue}`;

            const labelEl = document.createElement("span");
            labelEl.className = "kpi-card-label";
            labelEl.textContent = card.label;

            const valueEl = document.createElement("span");
            valueEl.className = "kpi-card-value";
            valueEl.textContent = card.formattedValue;

            cardEl.appendChild(labelEl);
            cardEl.appendChild(valueEl);
            this.rootContainer.appendChild(cardEl);
        }
    }

    // formatação por medida (rótulo + estilo do cartão) é dinâmica — o
    // número de cartões só é conhecido depois de ler o dataView, mesmo
    // padrão de buildSeriesColorCards no barrasOlist
    private buildCardStyleCards(): powerbi.visuals.FormattingCard[] {
        return this.cardInfos.map((card, index) => {
            const selector: powerbi.data.Selector = { metadata: card.queryName };

            const labelSlice: powerbi.visuals.FormattingSlice = {
                displayName: "Rótulo (em branco = nome da medida)",
                uid: `cardLabel_${index}`,
                control: {
                    type: powerbi.visuals.FormattingComponent.TextInput,
                    properties: {
                        descriptor: { objectName: "cardStyle", propertyName: "label", selector },
                        value: card.label,
                        placeholder: card.label
                    }
                }
            };

            const variantSlice: powerbi.visuals.FormattingSlice = {
                displayName: "Estilo",
                uid: `cardVariant_${index}`,
                control: {
                    type: powerbi.visuals.FormattingComponent.Dropdown,
                    properties: {
                        descriptor: { objectName: "cardStyle", propertyName: "variant", selector },
                        value: card.variant
                    }
                }
            };

            const formattingCard: powerbi.visuals.FormattingCard = {
                displayName: `Cartão: ${card.label}`,
                uid: `cardStyle_card_${index}`,
                groups: [
                    {
                        displayName: undefined,
                        uid: `cardStyle_group_${index}`,
                        slices: [labelSlice, variantSlice]
                    }
                ]
            };
            return formattingCard;
        });
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const model = this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
        model.cards.push(...this.buildCardStyleCards());
        return model;
    }
}
