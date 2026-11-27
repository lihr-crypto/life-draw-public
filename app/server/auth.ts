import { getChatGPTUser } from "../chatgpt-auth";

const DEVICE_COOKIE = "life_draw_device";
const DEVICE_MAX_AGE = 60 * 60 * 24 * 365;

export type RequestIdentity = {
  userId: string;
  displayName: string;
  setCookie?: string;
};

function cookieValue(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key !== name) continue;
    const value = valueParts.join("=");
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

function isLoopback(request: Request): boolean {
  try {
    const hostname = new URL(request.url).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function makeDeviceId(): string {
  return `dev_${globalThis.crypto.randomUUID()}`;
}

/**
 * The local identity is deliberately cookie based.  This keeps two browser
 * contexts independent even when the Sites starter injects the same mock
 * sign-in headers into both contexts, and it never accepts a caller supplied
 * identity header.
 */
export async function getRequestIdentity(
  request: Request,
): Promise<RequestIdentity | null> {
  if (process.env.NODE_ENV === "development" && isLoopback(request)) {
    const existing = cookieValue(request, DEVICE_COOKIE);
    const deviceId = existing && /^dev_[a-zA-Z0-9_-]{20,100}$/.test(existing)
      ? existing
      : makeDeviceId();
    const suffix = deviceId.slice(-6);
    return {
      userId: deviceId,
      displayName: `本机设备 ${suffix}`,
      ...(existing === deviceId
        ? {}
        : {
            setCookie: `${DEVICE_COOKIE}=${encodeURIComponent(deviceId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEVICE_MAX_AGE}`,
          }),
    };
  }

  const user = await getChatGPTUser().catch(() => null);
  if (!user) return null;
  return { userId: user.userId, displayName: user.displayName };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
