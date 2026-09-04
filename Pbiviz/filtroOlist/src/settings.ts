"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsModel = formattingSettings.Model;

// Único card estático do visual. O resto do painel é dinâmico: um card
// "Filtro: <campo>" por campo vinculado, construído em tempo de execução no
// getFormattingModel() (ver buildFieldStyleCards em visual.ts), porque a
// quantidade de campos só é conhecida no update().
class BarStyleCardSettings extends FormattingSettingsCard {
    // A lista não consegue sair do retângulo do próprio visual (cada custom
    // visual roda num iframe com limites fixos), então a área que ela ocupa
    // precisa existir dentro do visual — e essa área bloqueia interação com
    // o que estiver embaixo. Abrindo pra cima, o report author escolhe qual
    // região o visual vai cobrir: o cabeçalho, em vez dos gráficos.
    openUp = new formattingSettings.ToggleSwitch({
        name: "openUp",
        displayName: "Abrir a lista para cima",
        value: false
    });

    name: string = "barStyle";
    displayName: string = "Barra";
    slices: Array<formattingSettings.Slice> = [this.openUp];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    barStyleCard = new BarStyleCardSettings();

    cards = [this.barStyleCard];
}
