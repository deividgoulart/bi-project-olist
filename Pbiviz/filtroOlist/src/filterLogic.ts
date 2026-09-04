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

// valores distintos (ignora null/undefined), convertidos pra texto e
// ordenados alfabeticamente (pt-BR) — usados como as opções da lista simples
export function distinctSortedValues(raw: powerbi.PrimitiveValue[]): string[] {
    const set = new Set<string>();
    raw.forEach(v => {
        if (v !== null && v !== undefined && String(v).trim().length > 0) {
            set.add(String(v));
        }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

// mesma normalização (minúsculo, sem acento) do resolveThemeMode acima,
// reaproveitada aqui pra busca não-sensível a maiúscula/acento na lista
function normalizeForSearch(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
}

// busca simples client-side (substring, não-sensível a maiúscula/acento) —
// os valores já foram todos buscados do modelo (até o limite de
// dataReductionAlgorithm em capabilities.json), então filtrar a lista já
// carregada é suficiente, sem precisar do mecanismo nativo de "selfFilter"
export function filterBySearchText(values: string[], search: string): string[] {
    const clean = normalizeForSearch(search.trim());
    if (clean.length === 0) return values;
    return values.filter(v => normalizeForSearch(v).includes(clean));
}

export interface FilterColumnTarget {
    table: string;
    column: string;
}

// queryName de uma coluna vem como "NomeDaTabela.NomeDaColuna" — divide no
// primeiro ponto (nomes de tabela/coluna no Power BI não têm ponto, então
// isso é seguro). Padrão usado nas amostras oficiais de visual customizado
// pra montar o "target" de um filtro básico (IFilterColumnTarget).
export function parseColumnTarget(queryName: string): FilterColumnTarget {
    const dotIndex = queryName.indexOf(".");
    if (dotIndex === -1) return { table: queryName, column: queryName };
    return {
        table: queryName.substring(0, dotIndex),
        column: queryName.substring(dotIndex + 1)
    };
}
