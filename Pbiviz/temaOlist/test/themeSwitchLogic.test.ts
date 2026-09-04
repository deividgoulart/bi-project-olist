import { resolveThemeMode, distinctValues, resolveThemeOptionPair, parseColumnTarget } from "../src/themeSwitchLogic";

describe("resolveThemeMode", () => {
    test("undefined/null/empty falls back to light", () => {
        expect(resolveThemeMode(null)).toBe("light");
        expect(resolveThemeMode(undefined)).toBe("light");
        expect(resolveThemeMode("")).toBe("light");
    });

    test("text 'dark'/'escuro' is dark, case/accent-insensitive", () => {
        expect(resolveThemeMode("dark")).toBe("dark");
        expect(resolveThemeMode("Escuro")).toBe("dark");
        expect(resolveThemeMode("ESCURO")).toBe("dark");
    });

    test("anything else falls back to light", () => {
        expect(resolveThemeMode("Claro")).toBe("light");
        expect(resolveThemeMode("qualquer coisa")).toBe("light");
    });
});

describe("distinctValues", () => {
    test("dedupes and drops empty/null/undefined", () => {
        expect(distinctValues(["Claro", "Escuro", "Claro", null, undefined, ""]))
            .toEqual(["Claro", "Escuro"]);
    });
});

describe("resolveThemeOptionPair", () => {
    test("finds the dark value and the light value among exactly 2 values", () => {
        expect(resolveThemeOptionPair(["Claro", "Escuro"])).toEqual({ lightValue: "Claro", darkValue: "Escuro" });
        expect(resolveThemeOptionPair(["Escuro", "Claro"])).toEqual({ lightValue: "Claro", darkValue: "Escuro" });
    });

    test("works with any pair as long as one resolves to dark", () => {
        expect(resolveThemeOptionPair(["dark", "light"])).toEqual({ lightValue: "light", darkValue: "dark" });
    });

    test("returns null when nothing resolves to dark", () => {
        expect(resolveThemeOptionPair(["Claro", "Outro"])).toBeNull();
    });

    test("returns null with fewer than 2 distinct values", () => {
        expect(resolveThemeOptionPair([])).toBeNull();
        expect(resolveThemeOptionPair(["Escuro"])).toBeNull();
    });
});

describe("parseColumnTarget", () => {
    test("splits on the first dot into table and column", () => {
        expect(parseColumnTarget("Tema.Modo")).toEqual({ table: "Tema", column: "Modo" });
    });

    test("falls back to using the whole string for both when there's no dot", () => {
        expect(parseColumnTarget("SemPonto")).toEqual({ table: "SemPonto", column: "SemPonto" });
    });
});
