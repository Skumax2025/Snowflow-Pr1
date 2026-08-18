/**
 * Архитектурные инварианты ГДД, проверяемые автоматически.
 *
 * Их легко нарушить незаметно, поэтому они проверяются не глазами, а тестом.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** Комментарии не код: запрет касается вызовов, а не упоминаний в тексте. */
function codeOf(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const coreFiles = filesUnder("src/core");
const configFiles = filesUnder("src/config");
const simFiles = filesUnder("src/sim");
const uiFiles = filesUnder("src/ui");
const apiFiles = filesUnder("api");

describe("Ядро headless", () => {
  it("не знает о DOM, окне и рендере", () => {
    for (const file of [...coreFiles, ...configFiles, ...simFiles]) {
      const text = codeOf(file);
      for (const forbidden of ["document.", "window.", "localStorage", "requestAnimationFrame"]) {
        expect(`${file}: ${text.includes(forbidden)}`).toBe(`${file}: false`);
      }
    }
  });

  it("UI не импортирует конкретные системы мимо сборки партии", () => {
    for (const file of uiFiles) {
      const text = readFileSync(file, "utf8");
      // Разрешены только сборка партии, конфиг и типы.
      const imports = [...text.matchAll(/from "([^"]+)"/g)].map((m) => m[1] as string);
      for (const path of imports) {
        if (!path.startsWith("../")) continue;
        expect(
          path.startsWith("../config") ||
            path === "../core/game.js" ||
            path.startsWith("../core/types") ||
            path.startsWith("../core/signalCheck"),
        ).toBe(true);
      }
    }
  });
});

describe("Единый источник случайности", () => {
  it("ни одна система не вызывает Math.random", () => {
    for (const file of [...coreFiles, ...configFiles, ...simFiles, ...uiFiles, ...apiFiles]) {
      expect(`${file}: ${codeOf(file).includes("Math.random")}`).toBe(`${file}: false`);
    }
  });
});

describe("Ключ к LLM", () => {
  it("живёт только в серверной функции, не в браузерном бандле", () => {
    for (const file of [...coreFiles, ...configFiles, ...simFiles, ...uiFiles]) {
      const text = readFileSync(file, "utf8");
      expect(`${file}: ${text.includes("GEMINI_API_KEY")}`).toBe(`${file}: false`);
      expect(`${file}: ${text.includes("process.env")}`).toBe(`${file}: false`);
    }
    const proxy = readFileSync("api/parse.ts", "utf8");
    expect(proxy.includes("process.env.GEMINI_API_KEY")).toBe(true);
  });
});

describe("Данные вне логики", () => {
  it("конфиги не содержат ветвлений игровой логики", () => {
    const values = readFileSync("src/config/default.ts", "utf8");
    expect(values.includes("if (")).toBe(false);
    expect(values.includes("function ")).toBe(false);
  });

  it("в модулях ядра нет магических чисел в ветвлениях сравнения характеристик", () => {
    // Точечная проверка: пороги и веса приходят из конфига, а не из литералов.
    const city = readFileSync("src/core/city.ts", "utf8");
    expect(city.includes("this.cfg.")).toBe(true);
    expect(/>\s*\d\d+/.test(city.replace(/clamp\([^)]*\)/g, ""))).toBe(false);
  });
});

describe("Канонические имена событий", () => {
  it("совпадают со словарём мастер-концепта", () => {
    const events = readFileSync("src/core/events.ts", "utf8");
    for (const name of [
      "вердикт_рапорта",
      "офтопик_обнаружен",
      "рапорт_отправлен",
      "сигнал_пойман",
      "сон_завершён",
      "радист_умер",
      "агрессивное_сработало",
      "поставка_доставлена",
      "поставка_потеряна",
      "подмешать_фантомный_сигнал",
    ]) {
      expect(events.includes(`"${name}"`)).toBe(true);
    }
  });
});
