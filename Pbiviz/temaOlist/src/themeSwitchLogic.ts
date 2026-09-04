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

// valores distintos (ignora null/undefined), convertidos pra texto
export function distinctValues(raw: powerbi.PrimitiveValue[]): string[] {
    const set = new Set<string>();
    raw.forEach(v => {
        if (v !== null && v !== undefined && String(v).trim().length > 0) {
            set.add(String(v));
        }
    });
    return Array.from(set);
}

export interface ThemeOptionPair {
    lightValue: string;
    darkValue: string;
}

// entre os valores distintos do campo vinculado (esperado: 2, ex: "Claro" e
// "Escuro"), acha um que resolve pra "dark" via resolveThemeMode e outro que
// não — null se não achar exatamente essa combinação (campo errado, hierar-
// quia com mais de 2 valores úteis, ou nenhum valor reconhecido como escuro)
export function resolveThemeOptionPair(values: string[]): ThemeOptionPair | null {
    const darkValue = values.find(v => resolveThemeMode(v) === "dark");
    const lightValue = values.find(v => resolveThemeMode(v) === "light");
    if (!darkValue || !lightValue || darkValue === lightValue) return null;
    return { lightValue, darkValue };
}

export interface FilterColumnTarget {
    table: string;
    column: string;
}

// queryName de uma coluna vem como "NomeDaTabela.NomeDaColuna" — divide no
// primeiro ponto (nomes de tabela/coluna no Power BI não têm ponto, então
// isso é seguro). Mesmo padrão usado no filtroOlist.
export function parseColumnTarget(queryName: string): FilterColumnTarget {
    const dotIndex = queryName.indexOf(".");
    if (dotIndex === -1) return { table: queryName, column: queryName };
    return {
        table: queryName.substring(0, dotIndex),
        column: queryName.substring(dotIndex + 1)
    };
}
