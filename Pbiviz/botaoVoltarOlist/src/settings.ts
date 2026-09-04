"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsModel = formattingSettings.Model;

class ButtonStyleCardSettings extends FormattingSettingsCard {
    label = new formattingSettings.TextInput({
        name: "label",
        displayName: "Texto",
        value: "Voltar",
        placeholder: "Ex: Voltar"
    });

    name: string = "buttonStyle";
    displayName: string = "Botão";
    slices: Array<formattingSettings.Slice> = [this.label];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    buttonStyleCard = new ButtonStyleCardSettings();

    cards = [this.buttonStyleCard];
}
