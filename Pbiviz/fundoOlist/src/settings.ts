"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import FormattingSettingsModel = formattingSettings.Model;

// zero-config — o único "ajuste" deste visual é o campo de medida opcional
// "Modo Claro/Escuro" (ver capabilities.json), não algo do painel de
// formatação
export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    cards = [];
}
