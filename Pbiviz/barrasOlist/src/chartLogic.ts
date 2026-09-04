"use strict";

// Lógica pura (sem dependência do host do Power BI ou do DOM/D3) usada pelo
// visual.ts — extraída pra um módulo próprio pra poder ser testada com Jest
// isoladamente, sem precisar mockar a API inteira do Power BI.

import powerbi from "powerbi-visuals-api";

export function toNumber(value: powerbi.PrimitiveValue): number {
    const n = typeof value === "number" ? value : parseFloat(String(value));
    return isNaN(n) ? 0 : n;
}

export function formatCompactNumber(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${(value / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
    if (abs >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
    return `${Math.round(value)}`;
}

// "número redondo" acima de um valor — usado como teto de referência da
// "barra preenchida" (estilo mockup): em vez do trilho representar 100% do
// espaço disponível sem nenhum significado, ele passa a representar esse
// teto arredondado (ex: maior valor 21 -> teto 25), igual a como eixos de
// gráfico escolhem onde parar. Algoritmo clássico "nice numbers" (1/2/2.5/5/10
// × potência de 10) — cada fração até 1/2/2.5/5/10 vira o múltiplo mais
// próximo dessa "família" de números redondos.
export function niceCeil(value: number): number {
    if (value <= 0) return 1;
    const exponent = Math.floor(Math.log10(value));
    const magnitude = Math.pow(10, exponent);
    const fraction = value / magnitude;

    let niceFraction: number;
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 2.5) niceFraction = 2.5;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;

    return niceFraction * magnitude;
}

// usado pelos presets de rótulo "dentro da barra" e "badge" — texto branco ou
// escuro conforme a luminância da cor de fundo, pra continuar legível com
// qualquer cor de série/tema configurada pelo usuário
export function getContrastTextColor(rgb: { r: number; g: number; b: number }): string {
    const yiq = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
    return yiq >= 140 ? "#1F2937" : "#FFFFFF";
}

// campo de medida opcional ("modoVisual") que deixa uma única medida DAX
// controlar o tema (claro/escuro) de vários visuais ao mesmo tempo. Aceita
// texto ("dark"/"escuro"/"light"/"claro", sem distinguir maiúsculas/acentos)
// ou número (1 = escuro, qualquer outro = claro). Sem o campo preenchido
// (null/undefined), o padrão é sempre "light".
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

export function computeAverage(values: number[]): number | null {
    if (values.length === 0) return null;
    const sum = values.reduce((s, v) => s + v, 0);
    return sum / values.length;
}

export type SortMode = "nenhum" | "categoriaAsc" | "categoriaDesc" | "valorAsc" | "valorDesc";

export function sortCategoryOrder(categories: string[], totals: Record<string, number>, mode: SortMode): string[] {
    const sorted = categories.slice();
    if (mode === "categoriaAsc") {
        sorted.sort((a, b) => a.localeCompare(b));
    } else if (mode === "categoriaDesc") {
        sorted.sort((a, b) => b.localeCompare(a));
    } else if (mode === "valorAsc") {
        sorted.sort((a, b) => (totals[a] ?? 0) - (totals[b] ?? 0));
    } else if (mode === "valorDesc") {
        sorted.sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0));
    }
    // "nenhum": mantém a ordem original (da consulta)
    return sorted;
}

export interface CategoryTotal {
    category: string;
    total: number;
}

// decide quais categorias permanecem individuais e quais caem no agrupamento
// "Outros" — só a decisão (nomes), não a soma dos valores em si (isso
// depende da estrutura de dados do visual.ts, que não é pura)
export function computeTopNSelection(totals: CategoryTotal[], topN: number): { kept: string[]; grouped: string[] } {
    if (topN <= 0 || topN >= totals.length) {
        return { kept: totals.map(t => t.category), grouped: [] };
    }
    const sorted = totals.slice().sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    return {
        kept: sorted.slice(0, topN).map(t => t.category),
        grouped: sorted.slice(topN).map(t => t.category)
    };
}

export type OthersAggregation = "sum" | "average";

// agrega um mapa categoria -> valor: categorias "kept" mantêm seu valor
// original, categorias "grouped" viram uma única entrada com o rótulo
// informado — somadas (padrão, faz sentido pra medidas aditivas como
// contagem/receita) ou com a média (faz mais sentido pra medidas que já são
// uma média/taxa/nota, tipo "score médio" ou "% de atraso" — somar todas as
// categorias fora do Top N ali estouraria a escala sem significado nenhum)
export function aggregateByGrouping(
    valueByCategory: Map<string, number>,
    kept: string[],
    grouped: string[],
    othersLabel: string,
    aggregation: OthersAggregation = "sum"
): Map<string, number> {
    const result = new Map<string, number>();
    kept.forEach(category => result.set(category, valueByCategory.get(category) ?? 0));
    const groupedValues = grouped.map(category => valueByCategory.get(category) ?? 0);
    const sum = groupedValues.reduce((total, v) => total + v, 0);
    const aggregated = aggregation === "average" && groupedValues.length > 0 ? sum / groupedValues.length : sum;
    if (grouped.length > 0) {
        result.set(othersLabel, aggregated);
    }
    return result;
}
