import { resolveThemeMode } from "../src/headerLogic";

describe("resolveThemeMode", () => {
    test("undefined/null/empty falls back to light", () => {
        expect(resolveThemeMode(null)).toBe("light");
        expect(resolveThemeMode(undefined)).toBe("light");
        expect(resolveThemeMode("")).toBe("light");
    });

    test("numeric 1 is dark, anything else numeric is light", () => {
        expect(resolveThemeMode(1)).toBe("dark");
        expect(resolveThemeMode(0)).toBe("light");
        expect(resolveThemeMode(2)).toBe("light");
    });

    test("boolean true/false maps to dark/light", () => {
        expect(resolveThemeMode(true)).toBe("dark");
        expect(resolveThemeMode(false)).toBe("light");
    });

    test("text 'dark'/'escuro' is dark, case/accent-insensitive", () => {
        expect(resolveThemeMode("dark")).toBe("dark");
        expect(resolveThemeMode("Dark")).toBe("dark");
        expect(resolveThemeMode("escuro")).toBe("dark");
        expect(resolveThemeMode("ESCURO")).toBe("dark");
        expect(resolveThemeMode("Escuro")).toBe("dark");
    });

    test("anything else falls back to light", () => {
        expect(resolveThemeMode("claro")).toBe("light");
        expect(resolveThemeMode("light")).toBe("light");
        expect(resolveThemeMode("qualquer coisa")).toBe("light");
    });
});
