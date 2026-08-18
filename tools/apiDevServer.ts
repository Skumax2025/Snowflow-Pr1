/**
 * Плагин Vite: обслуживает каталог `api/` в режиме разработки.
 *
 * Без него `npm run dev` отдаёт на `/api/parse` четырёхсотую страницу Vite,
 * клиент считает это сбоем и уходит в деградацию — то есть ключ Gemini
 * локально не работает вообще, сколько его ни вставляй. На Vercel эти же
 * файлы обслуживаются платформой, здесь они поднимаются руками.
 */

import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";

/** Читает .env.local и .env, не перетирая уже заданные переменные. */
function loadEnvFiles(): void {
  for (const file of [".env.local", ".env"]) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const key = match[1] as string;
      const value = (match[2] ?? "").replace(/^["']|["']$/g, "");
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

export function apiDevServer(): Plugin {
  return {
    name: "snowflow-api-dev",
    configureServer(server: ViteDevServer) {
      loadEnvFiles();

      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/api/")) return next();

        const name = url.split("?")[0]?.slice("/api/".length) ?? "";
        if (!/^[a-z0-9_-]+$/i.test(name)) return next();

        try {
          const module = (await server.ssrLoadModule(`/../../api/${name}.ts`)) as {
            default?: (request: Request) => Promise<Response>;
          };
          const handler = module.default;
          if (!handler) return next();

          const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
          const request = new Request(`http://localhost${url}`, {
            method: req.method ?? "GET",
            headers: Object.entries(req.headers).map(
              ([k, v]) => [k, String(v ?? "")] as [string, string],
            ),
            body,
          });

          const response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(await response.text());
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : "сбой" }));
        }
      });
    },
  };
}
