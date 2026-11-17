import { checkPassword, readBody } from "../lib/auth.js";
import { SYSTEM_PROMPT, KICKOFF_MESSAGE } from "../lib/prompt.js";

const MAX_TURNS = 120; // 대화가 너무 길어지면 오래된 부분은 잘라냅니다
const MAX_CHARS_PER_MESSAGE = 6000;
const DEFAULT_MODEL = "gemini-3.5-flash";

function toGeminiContents(history) {
  const cleaned = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === "user" || m.role === "model") && typeof m.text === "string")
    .map((m) => ({ role: m.role, text: m.text.slice(0, MAX_CHARS_PER_MESSAGE) }))
    .slice(-MAX_TURNS);

  // Gemini는 user로 시작해야 하며 같은 역할이 연속되면 안 되므로 정리합니다.
  const contents = [{ role: "user", parts: [{ text: KICKOFF_MESSAGE }] }];
  for (const m of cleaned) {
    const last = contents[contents.length - 1];
    if (last.role === m.role) {
      last.parts[0].text += "\n\n" + m.text;
    } else {
      contents.push({ role: m.role, parts: [{ text: m.text }] });
    }
  }
  return contents;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST만 허용됩니다." });
    return;
  }

  const { password, history } = readBody(req);
  if (!checkPassword(password)) {
    res.status(401).json({ error: "비밀번호가 올바르지 않습니다. 다시 로그인해 주세요." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "서버에 GEMINI_API_KEY가 설정되지 않았습니다. 강사님께 문의해 주세요." });
    return;
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const base = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
  const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: toGeminiContents(history),
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
  };

  // 일시적 오류(429, 5xx)는 최대 3회까지 재시도합니다.
  let lastError = "알 수 없는 오류";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));

      if (r.ok) {
        const cand = data.candidates?.[0];
        const text = (cand?.content?.parts || []).map((p) => p.text || "").join("").trim();
        if (text) {
          res.status(200).json({ text });
          return;
        }
        lastError =
          cand?.finishReason === "SAFETY"
            ? "AI가 안전 정책으로 답변을 거부했습니다. 표현을 바꿔 다시 입력해 주세요."
            : "AI가 빈 답변을 보냈습니다. 다시 시도해 주세요.";
        break;
      }

      lastError = data.error?.message || `Gemini 오류 (HTTP ${r.status})`;
      if (r.status === 404) {
        lastError = `모델 '${model}'을(를) 찾을 수 없습니다. Vercel 환경변수 GEMINI_MODEL을 확인해 주세요.`;
        break;
      }
      if (r.status !== 429 && r.status < 500) break;
      if (r.status === 429) lastError = "사용량이 많아 잠시 지연되고 있습니다. 10초 뒤 다시 시도해 주세요.";
    } catch (e) {
      lastError = "AI 서버에 연결하지 못했습니다.";
    }
    await new Promise((ok) => setTimeout(ok, 800 * 2 ** attempt));
  }

  res.status(502).json({ error: lastError });
}
