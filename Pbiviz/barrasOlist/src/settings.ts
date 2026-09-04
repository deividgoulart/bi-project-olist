"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsModel = formattingSettings.Model;

class ChartStyleCardSettings extends FormattingSettingsCard {
    orientationOptions: powerbi.IEnumMember[] = [
        { value: "colunas", displayName: "Colunas (vertical)" },
        { value: "barras", displayName: "Barras (horizontal)" }
    ];

    orientation = new formattingSettings.ItemDropdown({
        name: "orientation",
        displayName: "Orientação",
        items: this.orientationOptions,
        value: this.orientationOptions[0]
    });

    seriesModeOptions: powerbi.IEnumMember[] = [
        { value: "agrupado", displayName: "Agrupado (lado a lado)" },
        { value: "empilhado", displayName: "Empilhado" },
        { value: "empilhado100", displayName: "Empilhado 100%" }
    ];

    seriesMode = new formattingSettings.ItemDropdown({
        name: "seriesMode",
        displayName: "Modo de múltiplas séries",
        items: this.seriesModeOptions,
        value: this.seriesModeOptions[0]
    });

    barPadding = new formattingSettings.NumUpDown({
        name: "barPadding",
        displayName: "Espaçamento entre barras (%)",
        value: 30,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 80 }
        }
    });

    cornerRadius = new formattingSettings.NumUpDown({
        name: "cornerRadius",
        displayName: "Raio dos cantos (px)",
        value: 8,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 24 }
        }
    });

    sortModeOptions: powerbi.IEnumMember[] = [
        { value: "nenhum", displayName: "Padrão da consulta" },
        { value: "categoriaAsc", displayName: "Categoria (A-Z)" },
        { value: "categoriaDesc", displayName: "Categoria (Z-A)" },
        { value: "valorAsc", displayName: "Valor (crescente)" },
        { value: "valorDesc", displayName: "Valor (decrescente)" }
    ];

    sortMode = new formattingSettings.ItemDropdown({
        name: "sortMode",
        displayName: "Ordenar por",
        items: this.sortModeOptions,
        value: this.sortModeOptions[0]
    });

    topN = new formattingSettings.NumUpDown({
        name: "topN",
        displayName: "Mostrar só as N maiores categorias (0 = todas)",
        value: 0,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 }
        }
    });

    maxItemsVisible = new formattingSettings.NumUpDown({
        name: "maxItemsVisible",
        displayName: "Máximo de barras visíveis por vez (0 = todas, sem rolagem)",
        value: 0,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 200 }
        }
    });

    name: string = "chartStyle";
    displayName: string = "Estilo do Gráfico";
    slices: Array<formattingSettings.Slice> = [
        this.orientation,
        this.seriesMode,
        this.barPadding,
        this.cornerRadius,
        this.sortMode,
        this.topN,
        this.maxItemsVisible
    ];
}

class ReferenceLineCardSettings extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Mostrar linha de referência",
        value: false
    });

    modeOptions: powerbi.IEnumMember[] = [
        { value: "media", displayName: "Média dos valores exibidos" },
        { value: "fixo", displayName: "Valor fixo" }
    ];

    mode = new formattingSettings.ItemDropdown({
        name: "mode",
        displayName: "Tipo",
        items: this.modeOptions,
        value: this.modeOptions[0]
    });

    fixedValue = new formattingSettings.NumUpDown({
        name: "fixedValue",
        displayName: "Valor fixo (modo 'Valor fixo')",
        value: 0
    });

    color = new formattingSettings.ColorPicker({
        name: "color",
        displayName: "Cor da linha",
        value: { value: "#E74C3C" }
    });

    name: string = "referenceLine";
    displayName: string = "Linha de Referência";
    slices: Array<formattingSettings.Slice> = [this.show, this.mode, this.fixedValue, this.color];
}

class AxisStyleCardSettings extends FormattingSettingsCard {
    showCategoryAxis = new formattingSettings.ToggleSwitch({
        name: "showCategoryAxis",
        displayName: "Mostrar eixo de categoria",
        value: true
    });

    showValueAxis = new formattingSettings.ToggleSwitch({
        name: "showValueAxis",
        displayName: "Mostrar eixo de valores",
        value: true
    });

    showGridlines = new formattingSettings.ToggleSwitch({
        name: "showGridlines",
        displayName: "Mostrar linhas de grade",
        value: true
    });

    axisFontSize = new formattingSettings.NumUpDown({
        name: "axisFontSize",
        displayName: "Tamanho da fonte dos eixos",
        value: 11,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 8 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 24 }
        }
    });

    name: string = "axisStyle";
    displayName: string = "Eixos";
    slices: Array<formattingSettings.Slice> = [
        this.showCategoryAxis,
        this.showValueAxis,
        this.showGridlines,
        this.axisFontSize
    ];
}

class DataLabelsCardSettings extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Mostrar rótulos",
        value: false
    });

    labelFontSize = new formattingSettings.NumUpDown({
        name: "labelFontSize",
        displayName: "Tamanho da fonte",
        value: 10,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 8 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 24 }
        }
    });

    abbreviateNumbers = new formattingSettings.ToggleSwitch({
        name: "abbreviateNumbers",
        displayName: "Abreviar números grandes (1.2K, 3.4M)",
        value: false
    });

    name: string = "dataLabels";
    displayName: string = "Rótulos de Dados";
    slices: Array<formattingSettings.Slice> = [
        this.show,
        this.labelFontSize,
        this.abbreviateNumbers
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
        placeholder: "Ex: Evolução: % atraso x score médio (mensal)"
    });

    name: string = "chartTitle";
    displayName: string = "Título";
    slices: Array<formattingSettings.Slice> = [this.show, this.text];
}

class LegendStyleCardSettings extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Mostrar legenda",
        value: true
    });

    positionOptions: powerbi.IEnumMember[] = [
        { value: "top", displayName: "Topo" },
        { value: "bottom", displayName: "Rodapé" },
        { value: "right", displayName: "Direita" }
    ];

    position = new formattingSettings.ItemDropdown({
        name: "position",
        displayName: "Posição",
        items: this.positionOptions,
        value: this.positionOptions[0]
    });

    name: string = "legendStyle";
    displayName: string = "Legenda";
    slices: Array<formattingSettings.Slice> = [this.show, this.position];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    chartTitleCard = new ChartTitleCardSettings();
    chartStyleCard = new ChartStyleCardSettings();
    referenceLineCard = new ReferenceLineCardSettings();
    axisStyleCard = new AxisStyleCardSettings();
    dataLabelsCard = new DataLabelsCardSettings();
    legendStyleCard = new LegendStyleCardSettings();

    cards = [
        this.chartTitleCard,
        this.chartStyleCard,
        this.referenceLineCard,
        this.axisStyleCard,
        this.dataLabelsCard,
        this.legendStyleCard
    ];
}
