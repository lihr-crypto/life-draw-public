import { requireMemberError, ServiceError } from "./errors";
import type { RequestIdentity } from "./auth";

export const MAX_JSON_BYTES = 256 * 1024;

export function jsonResponse(
  body: unknown,
  identity?: RequestIdentity | null,
  status = 200,
): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  if (identity?.setCookie) headers.set("set-cookie", identity.setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(
  error: unknown,
  identity?: RequestIdentity | null,
): Response {
  if (error instanceof ServiceError) {
    return jsonResponse(
      { error: error.message, code: error.code },
      identity,
      error.status,
    );
  }
  console.error("life-draw API error", error);
  return jsonResponse(
    { error: "服务暂时不可用，请稍后重试。", code: "internal_error" },
    identity,
    500,
  );
}

export function requireIdentity(
  identity: RequestIdentity | null,
): RequestIdentity {
  if (!identity) {
    throw new ServiceError(401, "authentication_required", "请先完成登录。");
  }
  return identity;
}

export function requireOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new ServiceError(403, "cross_origin", "缺少同源 Origin。");
  }
  let expected: string;
  let actual: string;
  try {
    expected = new URL(request.url).origin;
    actual = new URL(origin).origin;
  } catch {
    throw new ServiceError(403, "cross_origin", "请求来源无效。");
  }
  if (origin === "null" || actual !== expected) {
    throw new ServiceError(403, "cross_origin", "请求来源必须与当前站点相同。");
  }
}

export async function readJson(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length && Number(length) > MAX_JSON_BYTES) {
    throw new ServiceError(413, "payload_too_large", "请求内容过大。");
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    throw new ServiceError(400, "invalid_json", "请求内容无法读取。");
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_JSON_BYTES) {
    throw new ServiceError(413, "payload_too_large", "请求内容过大。");
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new ServiceError(400, "invalid_json", "请求必须是有效 JSON。");
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceError(400, "invalid_request", "请求格式无效。");
  }
  return value as Record<string, unknown>;
}

export function requiredString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new ServiceError(400, "invalid_request", `${field} 必须是文本。`);
  }
  const text = value.trim();
  if (!text || text.length > maxLength) {
    throw new ServiceError(400, "invalid_request", `${field} 无效。`);
  }
  return text;
}

export function optionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, field, maxLength);
}

export function ensureEmptyObject(value: unknown): void {
  asRecord(value);
}

export { requireMemberError };
