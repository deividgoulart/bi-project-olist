"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsModel = formattingSettings.Model;

class HeaderStyleCardSettings extends FormattingSettingsCard {
    eyebrowText = new formattingSettings.TextInput({
        name: "eyebrowText",
        displayName: "Texto pequeno (acima do título)",
        value: "olist · operações",
        placeholder: "Ex: olist · operações"
    });

    titleText = new formattingSettings.TextInput({
        name: "titleText",
        displayName: "Título",
        value: "Dashboard de operações e CX",
        placeholder: "Ex: Dashboard de operações e CX"
    });

    name: string = "headerStyle";
    displayName: string = "Título";
    slices: Array<formattingSettings.Slice> = [this.eyebrowText, this.titleText];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    headerStyleCard = new HeaderStyleCardSettings();

    cards = [this.headerStyleCard];
}
