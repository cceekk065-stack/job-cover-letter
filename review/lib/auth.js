import { timingSafeEqual } from "node:crypto";

// 교육생 비밀번호 (고정). 바꾸려면 이 값만 수정하세요.
export const APP_PASSWORD = "2026";

export function checkPassword(input) {
  const a = Buffer.from(String(input ?? ""));
  const b = Buffer.from(APP_PASSWORD);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}
