import { timingSafeEqual } from "node:crypto";

// 오늘의 비밀번호 (고정). 바꾸려면 이 값만 수정하세요.
export const APP_PASSWORD = "2026";

export function checkPassword(input) {
  const expected = APP_PASSWORD;
  const given = String(input ?? "");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
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
