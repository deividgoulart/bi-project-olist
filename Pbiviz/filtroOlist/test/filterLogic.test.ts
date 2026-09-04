import { resolveThemeMode, distinctSortedValues, parseColumnTarget, filterBySearchText } from "../src/filterLogic";

describe("resolveThemeMode", () => {
    test("undefined/null/empty falls back to light", () => {
        expect(resolveThemeMode(null)).toBe("light");
        expect(resolveThemeMode(undefined)).toBe("light");
        expect(resolveThemeMode("")).toBe("light");
    });

    test("numeric 1 is dark, anything else numeric is light", () => {
        expect(resolveThemeMode(1)).toBe("dark");
        expect(resolveThemeMode(0)).toBe("light");
    });

    test("text 'dark'/'escuro' is dark, case/accent-insensitive", () => {
        expect(resolveThemeMode("dark")).toBe("dark");
        expect(resolveThemeMode("Escuro")).toBe("dark");
    });

    test("anything else falls back to light", () => {
        expect(resolveThemeMode("claro")).toBe("light");
    });
});

describe("distinctSortedValues", () => {
    test("dedupes, drops empty/null/undefined, sorts alphabetically", () => {
        expect(distinctSortedValues(["SP", "RJ", "SP", null, undefined, "", "MG"]))
            .toEqual(["MG", "RJ", "SP"]);
    });

    test("stringifies numbers", () => {
        expect(distinctSortedValues([3, 1, 2, 1])).toEqual(["1", "2", "3"]);
    });

    test("empty input yields empty output", () => {
        expect(distinctSortedValues([])).toEqual([]);
    });

    test("sorts accented pt-BR text correctly", () => {
        expect(distinctSortedValues(["beleza", "Ávila", "eletrônicos"]))
            .toEqual(["Ávila", "beleza", "eletrônicos"]);
    });
});

describe("filterBySearchText", () => {
    const values = ["São Paulo", "Rio de Janeiro", "Minas Gerais", "Bahia"];

    test("empty search returns everything unchanged", () => {
        expect(filterBySearchText(values, "")).toEqual(values);
        expect(filterBySearchText(values, "   ")).toEqual(values);
    });

    test("matches substrings, case-insensitive", () => {
        expect(filterBySearchText(values, "rio")).toEqual(["Rio de Janeiro"]);
        expect(filterBySearchText(values, "RIO")).toEqual(["Rio de Janeiro"]);
    });

    test("matches accent-insensitive", () => {
        expect(filterBySearchText(values, "sao")).toEqual(["São Paulo"]);
    });

    test("no match yields an empty array", () => {
        expect(filterBySearchText(values, "xyz")).toEqual([]);
    });
});

describe("parseColumnTarget", () => {
    test("splits on the first dot into table and column", () => {
        expect(parseColumnTarget("Pedidos.UF")).toEqual({ table: "Pedidos", column: "UF" });
    });

    test("falls back to using the whole string for both when there's no dot", () => {
        expect(parseColumnTarget("SemPonto")).toEqual({ table: "SemPonto", column: "SemPonto" });
    });
});
