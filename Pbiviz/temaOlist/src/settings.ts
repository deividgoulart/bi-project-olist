"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import FormattingSettingsModel = formattingSettings.Model;

// zero-config — sem card no painel de formatação, o comportamento é sempre
// o mesmo: alterna entre os dois valores do campo vinculado
export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    cards = [];
}
