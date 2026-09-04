import { resolveThemeMode } from "../src/themeLogic";

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
