"use strict";

import powerbi from "powerbi-visuals-api";

export type CellStatus = "positive" | "neutral" | "negative" | "none";

export interface ColumnFormatting {
    hideColumn: boolean;
    show: boolean;
    colorSource: string;
    positiveValue: string;
    neutralValue: string;
    negativeValue: string;
    statusColumnName: string;
    columnWidth: number | null;
    columnOrder: number | null;
    showInTooltip: boolean;
    totalAggregation: string;
}

export function toNumber(value: powerbi.PrimitiveValue): number | null {
    if (typeof value === "number") return value;
    if (value === null || value === undefined) return null;
    const parsed = parseFloat(value.toString().replace(",", "."));
    return isNaN(parsed) ? null : parsed;
}

export function normalizeStatusWord(raw: string): CellStatus {
    const clean = raw
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, ""); // remove acentos

    if (clean === "positivo" || clean === "positive") return "positive";
    if (clean === "neutro" || clean === "neutral") return "neutral";
    if (clean === "negativo" || clean === "negative") return "negative";
    return "none";
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

export function resolveStatus(
    rawText: string,
    colFormat: ColumnFormatting,
    columns: powerbi.DataViewMetadataColumn[],
    row: powerbi.DataViewTableRow
): CellStatus {
    if (colFormat.colorSource === "statusColumn" && colFormat.statusColumnName) {
        const statusColIndex = columns.findIndex(c => c.displayName === colFormat.statusColumnName);
        if (statusColIndex >= 0) {
            const statusRaw = row[statusColIndex]?.toString() ?? "";
            return normalizeStatusWord(statusRaw);
        }
        return "none";
    }

    // modo compareText
    if (colFormat.positiveValue && rawText === colFormat.positiveValue) return "positive";
    if (colFormat.neutralValue && rawText === colFormat.neutralValue) return "neutral";
    if (colFormat.negativeValue && rawText === colFormat.negativeValue) return "negative";
    return "none";
}

// Total do rodapé: cada coluna escolhe sua própria agregação (soma não faz
// sentido pra uma nota de review, por exemplo — ali o certo é média).
export function computeColumnAggregate(
    rows: powerbi.DataViewTableRow[],
    idx: number,
    aggregation: string
): number | null {
    if (aggregation === "count") {
        return rows.filter(row => row[idx] !== null && row[idx] !== undefined && row[idx] !== "").length;
    }

    const numbers = rows
        .map(row => toNumber(row[idx]))
        .filter((n): n is number => n !== null);

    if (numbers.length === 0) return null;

    switch (aggregation) {
        case "sum":
            return numbers.reduce((acc, n) => acc + n, 0);
        case "average":
            return numbers.reduce((acc, n) => acc + n, 0) / numbers.length;
        case "min":
            return Math.min(...numbers);
        case "max":
            return Math.max(...numbers);
        default:
            return null;
    }
}
