import powerbi from "powerbi-visuals-api";
import {
    toNumber,
    normalizeStatusWord,
    resolveStatus,
    computeColumnAggregate,
    resolveThemeMode,
    ColumnFormatting
} from "../src/formattingLogic";

function makeColumn(displayName: string): powerbi.DataViewMetadataColumn {
    return { displayName } as powerbi.DataViewMetadataColumn;
}

function baseColumnFormatting(overrides: Partial<ColumnFormatting> = {}): ColumnFormatting {
    return {
        hideColumn: false,
        show: true,
        colorSource: "compareText",
        positiveValue: "",
        neutralValue: "",
        negativeValue: "",
        statusColumnName: "",
        columnWidth: null,
        columnOrder: null,
        showInTooltip: false,
        totalAggregation: "sum",
        ...overrides
    };
}

describe("toNumber", () => {
    it("passa números diretamente", () => {
        expect(toNumber(42)).toBe(42);
        expect(toNumber(0)).toBe(0);
        expect(toNumber(-3.5)).toBe(-3.5);
    });

    it("converte strings numéricas, inclusive com vírgula decimal", () => {
        expect(toNumber("42")).toBe(42);
        expect(toNumber("3,5")).toBe(3.5);
    });

    it("retorna null para null/undefined", () => {
        expect(toNumber(null)).toBeNull();
        expect(toNumber(undefined)).toBeNull();
    });

    it("retorna null para strings não numéricas", () => {
        expect(toNumber("abc")).toBeNull();
        expect(toNumber("")).toBeNull();
    });
});

describe("normalizeStatusWord", () => {
    it("reconhece variações em português e inglês, com ou sem acento/maiúsculas", () => {
        expect(normalizeStatusWord("Positivo")).toBe("positive");
        expect(normalizeStatusWord("POSITIVE")).toBe("positive");
        expect(normalizeStatusWord("neutro")).toBe("neutral");
        expect(normalizeStatusWord("Neutral")).toBe("neutral");
        expect(normalizeStatusWord("negativo")).toBe("negative");
        expect(normalizeStatusWord("Negative")).toBe("negative");
    });

    it("retorna none para palavras desconhecidas", () => {
        expect(normalizeStatusWord("qualquer coisa")).toBe("none");
        expect(normalizeStatusWord("")).toBe("none");
    });
});

describe("resolveStatus", () => {
    const columns = [makeColumn("Valor"), makeColumn("Status Nota")];

    it("modo compareText: compara com positiveValue/neutralValue/negativeValue", () => {
        const colFormat = baseColumnFormatting({
            colorSource: "compareText",
            positiveValue: "No Prazo",
            negativeValue: "Atrasado"
        });

        expect(resolveStatus("No Prazo", colFormat, columns, ["No Prazo", "x"])).toBe("positive");
        expect(resolveStatus("Atrasado", colFormat, columns, ["Atrasado", "x"])).toBe("negative");
        expect(resolveStatus("Outra coisa", colFormat, columns, ["Outra coisa", "x"])).toBe("none");
    });

    it("modo statusColumn: lê o status de outra coluna da mesma linha", () => {
        const colFormat = baseColumnFormatting({
            colorSource: "statusColumn",
            statusColumnName: "Status Nota"
        });

        expect(resolveStatus("5", colFormat, columns, ["5", "Positivo"])).toBe("positive");
        expect(resolveStatus("1", colFormat, columns, ["1", "Negativo"])).toBe("negative");
    });

    it("modo statusColumn: retorna none se a coluna de status não existe", () => {
        const colFormat = baseColumnFormatting({
            colorSource: "statusColumn",
            statusColumnName: "Coluna Inexistente"
        });

        expect(resolveStatus("5", colFormat, columns, ["5", "Positivo"])).toBe("none");
    });
});

describe("resolveThemeMode", () => {
    it("reconhece texto 'dark'/'escuro', sem distinguir maiúsculas/acentos", () => {
        expect(resolveThemeMode("dark")).toBe("dark");
        expect(resolveThemeMode("Dark")).toBe("dark");
        expect(resolveThemeMode("escuro")).toBe("dark");
        expect(resolveThemeMode("ESCURO")).toBe("dark");
    });

    it("reconhece número 1 como escuro, qualquer outro número como claro", () => {
        expect(resolveThemeMode(1)).toBe("dark");
        expect(resolveThemeMode(0)).toBe("light");
        expect(resolveThemeMode(2)).toBe("light");
    });

    it("reconhece texto 'light'/'claro' e qualquer texto desconhecido como claro", () => {
        expect(resolveThemeMode("light")).toBe("light");
        expect(resolveThemeMode("claro")).toBe("light");
        expect(resolveThemeMode("qualquer coisa")).toBe("light");
    });

    it("retorna 'light' por padrão quando o campo não está preenchido", () => {
        expect(resolveThemeMode(null)).toBe("light");
        expect(resolveThemeMode(undefined)).toBe("light");
        expect(resolveThemeMode("")).toBe("light");
    });
});

describe("computeColumnAggregate", () => {
    const rows: powerbi.DataViewTableRow[] = [[5], [4], [3], [null]];

    it("soma, média, mínimo e máximo ignoram valores nulos", () => {
        expect(computeColumnAggregate(rows, 0, "sum")).toBe(12);
        expect(computeColumnAggregate(rows, 0, "average")).toBe(4);
        expect(computeColumnAggregate(rows, 0, "min")).toBe(3);
        expect(computeColumnAggregate(rows, 0, "max")).toBe(5);
    });

    it("contagem conta valores não vazios (não filtra nulos numericamente)", () => {
        expect(computeColumnAggregate(rows, 0, "count")).toBe(3);
    });

    it("retorna null pra 'none' ou agregação desconhecida", () => {
        expect(computeColumnAggregate(rows, 0, "none")).toBeNull();
        expect(computeColumnAggregate(rows, 0, "unknown")).toBeNull();
    });

    it("retorna null quando não há nenhum valor numérico válido", () => {
        const allNull: powerbi.DataViewTableRow[] = [[null], [undefined]];
        expect(computeColumnAggregate(allNull, 0, "sum")).toBeNull();
    });
});
