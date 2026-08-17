/**
 * Общий код серверных эндпоинтов: рейт-лимит по IP и ответ JSON.
 *
 * Тот же паттерн рейт-лимита применён на обоих сетевых эндпоинтах проекта —
 * разборе рапорта и записи офтопика. Конкретные лимиты у каждого свои.
 */

const buckets = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 60_000;

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "неизвестный"
  );
}

export function checkRateLimit(key: string, limitPerMinute: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= limitPerMinute) return false;
  bucket.count += 1;
  return true;
}

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
