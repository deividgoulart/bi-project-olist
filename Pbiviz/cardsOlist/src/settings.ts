"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import FormattingSettingsModel = formattingSettings.Model;

// sem cards estáticos: a única formatação deste visual é por medida (rótulo
// + estilo do cartão), construída dinamicamente em buildCardStyleCards() —
// mesmo padrão de barrasOlist (buildSeriesColorCards), necessário porque o
// número de medidas/cartões só é conhecido em tempo de execução
export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    cards = [];
}
