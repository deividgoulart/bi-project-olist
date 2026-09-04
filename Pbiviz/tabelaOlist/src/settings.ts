"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsModel = formattingSettings.Model;

class TableStyleCardSettings extends FormattingSettingsCard {
    showTotals = new formattingSettings.ToggleSwitch({
        name: "showTotals",
        displayName: "Mostrar totais no rodapé",
        value: false
    });

    frozenColumnCount = new formattingSettings.NumUpDown({
        name: "frozenColumnCount",
        displayName: "Quantidade de colunas congeladas",
        value: 0,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 5 }
        }
    });

    showSearchBox = new formattingSettings.ToggleSwitch({
        name: "showSearchBox",
        displayName: "Mostrar caixa de busca",
        value: true
    });

    name: string = "tableStyle";
    displayName: string = "Comportamento da Tabela";
    slices: Array<formattingSettings.Slice> = [
        this.showTotals,
        this.frozenColumnCount,
        this.showSearchBox
    ];
}

class ChartTitleCardSettings extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Mostrar título",
        value: false
    });

    text = new formattingSettings.TextInput({
        name: "text",
        displayName: "Texto do título",
        value: "",
        placeholder: "Ex: Detalhe de pedidos"
    });

    name: string = "chartTitle";
    displayName: string = "Título";
    slices: Array<formattingSettings.Slice> = [this.show, this.text];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    chartTitleCard = new ChartTitleCardSettings();
    tableStyleCard = new TableStyleCardSettings();
    cards = [this.chartTitleCard, this.tableStyleCard];
}