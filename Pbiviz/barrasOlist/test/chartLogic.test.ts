import {
    toNumber,
    formatCompactNumber,
    niceCeil,
    getContrastTextColor,
    computeAverage,
    sortCategoryOrder,
    computeTopNSelection,
    aggregateByGrouping,
    resolveThemeMode,
    CategoryTotal
} from "../src/chartLogic";

describe("toNumber", () => {
    it("passa números diretamente", () => {
        expect(toNumber(42)).toBe(42);
        expect(toNumber(0)).toBe(0);
        expect(toNumber(-3.5)).toBe(-3.5);
    });

    it("converte strings numéricas", () => {
        expect(toNumber("42")).toBe(42);
    });

    it("retorna 0 para null/undefined/valores não numéricos", () => {
        expect(toNumber(null)).toBe(0);
        expect(toNumber(undefined)).toBe(0);
        expect(toNumber("abc")).toBe(0);
    });
});

describe("formatCompactNumber", () => {
    it("abrevia milhares, milhões e bilhões", () => {
        expect(formatCompactNumber(1500)).toBe("1.5K");
        expect(formatCompactNumber(2500000)).toBe("2.5M");
        expect(formatCompactNumber(3200000000)).toBe("3.2B");
    });

    it("não abrevia valores abaixo de mil", () => {
        expect(formatCompactNumber(950)).toBe("950");
        expect(formatCompactNumber(0)).toBe("0");
    });

    it("remove o .0 quando o número é redondo", () => {
        expect(formatCompactNumber(2000)).toBe("2K");
        expect(formatCompactNumber(1000000)).toBe("1M");
    });

    it("lida com valores negativos", () => {
        expect(formatCompactNumber(-1500)).toBe("-1.5K");
    });
});

describe("niceCeil", () => {
    it("arredonda pro próximo número redondo acima do valor", () => {
        expect(niceCeil(21)).toBe(25);
        expect(niceCeil(13)).toBe(20);
        expect(niceCeil(42)).toBe(50);
        expect(niceCeil(97)).toBe(100);
        expect(niceCeil(3)).toBe(5);
    });

    it("funciona em qualquer escala de magnitude, não só dezenas", () => {
        expect(niceCeil(0.21)).toBeCloseTo(0.25);
        expect(niceCeil(210)).toBe(250);
    });

    it("retorna 1 pra valores zero ou negativos (não existe 'redondo' abaixo de zero aqui)", () => {
        expect(niceCeil(0)).toBe(1);
        expect(niceCeil(-5)).toBe(1);
    });
});

describe("getContrastTextColor", () => {
    it("retorna texto escuro sobre fundo claro", () => {
        expect(getContrastTextColor({ r: 255, g: 255, b: 255 })).toBe("#1F2937");
    });

    it("retorna texto branco sobre fundo escuro", () => {
        expect(getContrastTextColor({ r: 10, g: 20, b: 30 })).toBe("#FFFFFF");
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

describe("computeAverage", () => {
    it("calcula a média de uma lista de valores", () => {
        expect(computeAverage([1, 2, 3, 4])).toBe(2.5);
    });

    it("retorna null para lista vazia", () => {
        expect(computeAverage([])).toBeNull();
    });

    it("lida com valores negativos", () => {
        expect(computeAverage([-10, 10])).toBe(0);
    });
});

describe("sortCategoryOrder", () => {
    const categories = ["SP", "RJ", "MG"];
    const totals: Record<string, number> = { SP: 300, RJ: 100, MG: 200 };

    it("modo 'nenhum' mantém a ordem original", () => {
        expect(sortCategoryOrder(categories, totals, "nenhum")).toEqual(["SP", "RJ", "MG"]);
    });

    it("ordena por categoria (texto) crescente e decrescente", () => {
        expect(sortCategoryOrder(categories, totals, "categoriaAsc")).toEqual(["MG", "RJ", "SP"]);
        expect(sortCategoryOrder(categories, totals, "categoriaDesc")).toEqual(["SP", "RJ", "MG"]);
    });

    it("ordena por valor crescente e decrescente", () => {
        expect(sortCategoryOrder(categories, totals, "valorAsc")).toEqual(["RJ", "MG", "SP"]);
        expect(sortCategoryOrder(categories, totals, "valorDesc")).toEqual(["SP", "MG", "RJ"]);
    });

    it("não modifica o array original", () => {
        const original = categories.slice();
        sortCategoryOrder(categories, totals, "valorDesc");
        expect(categories).toEqual(original);
    });
});

describe("computeTopNSelection", () => {
    const totals: CategoryTotal[] = [
        { category: "SP", total: 500 },
        { category: "RJ", total: 300 },
        { category: "MG", total: 100 },
        { category: "BA", total: -400 }
    ];

    it("mantém tudo quando topN é 0 ou maior/igual ao total de categorias", () => {
        expect(computeTopNSelection(totals, 0)).toEqual({ kept: ["SP", "RJ", "MG", "BA"], grouped: [] });
        expect(computeTopNSelection(totals, 10)).toEqual({ kept: ["SP", "RJ", "MG", "BA"], grouped: [] });
    });

    it("seleciona as N categorias de maior magnitude absoluta, resto vai pro grupo", () => {
        const result = computeTopNSelection(totals, 2);
        expect(result.kept).toEqual(["SP", "BA"]);
        expect(result.grouped).toEqual(["RJ", "MG"]);
    });
});

describe("aggregateByGrouping", () => {
    it("mantém categorias 'kept' e soma as 'grouped' num rótulo único", () => {
        const values = new Map([["SP", 500], ["RJ", 300], ["MG", 100], ["BA", -400]]);
        const result = aggregateByGrouping(values, ["SP", "BA"], ["RJ", "MG"], "Outros");
        expect(result.get("SP")).toBe(500);
        expect(result.get("BA")).toBe(-400);
        expect(result.get("Outros")).toBe(400);
        expect(result.size).toBe(3);
    });

    it("não cria o rótulo 'Outros' se não houver categorias agrupadas", () => {
        const values = new Map([["SP", 500]]);
        const result = aggregateByGrouping(values, ["SP"], [], "Outros");
        expect(result.has("Outros")).toBe(false);
    });

    it("com aggregation 'average', usa a média em vez da soma nas 'grouped'", () => {
        const values = new Map([["SP", 5], ["RJ", 3], ["MG", 4], ["BA", 1]]);
        const result = aggregateByGrouping(values, ["SP"], ["RJ", "MG", "BA"], "Outros", "average");
        expect(result.get("SP")).toBe(5);
        expect(result.get("Outros")).toBeCloseTo((3 + 4 + 1) / 3);
    });
});
