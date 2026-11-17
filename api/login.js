import { checkPassword, readBody } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST만 허용됩니다." });
    return;
  }
  const { password } = readBody(req);
  if (!checkPassword(password)) {
    res.status(401).json({ ok: false, error: "비밀번호가 올바르지 않습니다." });
    return;
  }
  res.status(200).json({ ok: true });
}
