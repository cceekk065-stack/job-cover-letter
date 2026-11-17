import { checkPassword, readBody } from "../lib/auth.js";
import { generate, GeminiError } from "../lib/gemini.js";
import { SYSTEM_PROMPT, RESPONSE_SCHEMA, CRITERIA, buildUserMessage } from "../lib/prompt.js";

const LIMITS = { company: 100, job: 100, jobInfo: 3000, question: 500, answer: 5000 };
const clip = (v, n) => String(v ?? "").trim().slice(0, n);

function parseJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("JSON 형식 아님");
  }
}

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === "string" ? v : "");

// 모델이 형식을 조금 어겨도 화면이 깨지지 않게 정리합니다.
function normalize(r) {
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))),
    summary: str(r.summary),
    criteria: arr(r.criteria)
      .map((c) => ({ name: str(c?.name), grade: ["상", "중", "하"].includes(c?.grade) ? c.grade : "중", comment: str(c?.comment) }))
      .filter((c) => c.name)
      .sort((a, b) => CRITERIA.indexOf(a.name) - CRITERIA.indexOf(b.name)),
    strengths: arr(r.strengths).map(str).filter(Boolean),
    improvements: arr(r.improvements)
      .map((i) => ({ quote: str(i?.quote), problem: str(i?.problem), suggestion: str(i?.suggestion) }))
      .filter((i) => i.problem || i.suggestion),
    revised: str(r.revised).trim(),
    interviewQuestions: arr(r.interviewQuestions).map(str).filter(Boolean),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST만 허용됩니다." });
    return;
  }

  const body = readBody(req);
  if (!checkPassword(body.password)) {
    res.status(401).json({ error: "비밀번호가 올바르지 않습니다. 다시 로그인해 주세요." });
    return;
  }

  const input = {
    company: clip(body.company, LIMITS.company),
    job: clip(body.job, LIMITS.job),
    jobInfo: clip(body.jobInfo, LIMITS.jobInfo),
    question: clip(body.question, LIMITS.question),
    answer: clip(body.answer, LIMITS.answer),
    limit: Math.max(0, Math.min(5000, parseInt(body.limit, 10) || 0)),
  };
  if (!input.question || input.answer.length < 30) {
    res.status(400).json({ error: "문항과 답변(30자 이상)을 입력해 주세요." });
    return;
  }

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: buildUserMessage(input) }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  // 형식이 깨진 답이 오면 한 번 더 요청합니다.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text, model } = await generate(payload);
      const result = normalize(parseJson(text));
      if (!result.revised || !result.summary) throw new Error("필수 항목 누락");
      res.status(200).json({ result, model });
      return;
    } catch (e) {
      if (e instanceof GeminiError) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      if (attempt === 1) {
        res.status(502).json({ error: "AI 답변 형식이 올바르지 않습니다. 다시 시도해 주세요." });
        return;
      }
    }
  }
}
