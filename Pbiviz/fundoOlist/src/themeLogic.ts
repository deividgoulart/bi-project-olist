"use strict";

import powerbi from "powerbi-visuals-api";

// mesma lógica usada nos outros visuais Olist — texto "dark"/"escuro" (sem
// acento/maiúscula) ou numérico 1 aciona o modo escuro; qualquer outra coisa
// (incluindo medida não vinculada) cai no modo claro
export function resolveThemeMode(raw: powerbi.PrimitiveValue): "light" | "dark" {
    if (raw === null || raw === undefined || raw === "") return "light";
    if (typeof raw === "number") return raw === 1 ? "dark" : "light";
    if (typeof raw === "boolean") return raw ? "dark" : "light";

    const clean = raw.toString()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");

    if (clean === "dark" || clean === "escuro" || clean === "1") return "dark";
    return "light";
}
