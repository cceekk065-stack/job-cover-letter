import { checkPassword, readBody } from "../lib/auth.js";
import { SYSTEM_PROMPT, KICKOFF_MESSAGE } from "../lib/prompt.js";

const MAX_TURNS = 120; // 대화가 너무 길어지면 오래된 부분은 잘라냅니다
const MAX_CHARS_PER_MESSAGE = 6000;
// 먼저 시도할 모델. 없거나 한도를 넘으면 아래 자동 탐색 목록으로 넘어갑니다.
const PREFERRED_MODELS = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-flash-lite-latest"];
const DISCOVERY_TTL_MS = 10 * 60 * 1000;

const BASE = () => process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";

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

// ---------- 사용 가능한 모델 자동 탐색 ----------
let discovered = { at: 0, models: [] };

function versionOf(name) {
  const m = name.match(/gemini-(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

async function discoverModels(apiKey) {
  if (Date.now() - discovered.at < DISCOVERY_TTL_MS && discovered.models.length) return discovered.models;
  try {
    const r = await fetch(`${BASE()}/v1beta/models?pageSize=1000`, { headers: { "x-goog-api-key": apiKey } });
    if (!r.ok) return [];
    const data = await r.json();
    const models = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      // 텍스트 대화용 Flash 계열만 (이미지·음성·실시간·임베딩 등 제외)
      .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/(image|tts|audio|live|embed|thinking|exp)/.test(n))
      .sort((a, b) => {
        const lite = (n) => (n.includes("lite") ? 1 : 0);
        const preview = (n) => (n.includes("preview") ? 1 : 0);
        return lite(a) - lite(b) || preview(a) - preview(b) || versionOf(b) - versionOf(a);
      });
    discovered = { at: Date.now(), models };
    return models;
  } catch {
    return [];
  }
}

async function callModel(model, apiKey, payload) {
  const url = `${BASE()}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, data };
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

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

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: toGeminiContents(history),
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
  };

  // 시도 순서: 환경변수 지정 모델 → 기본 후보 → 이 API 키로 실제 쓸 수 있는 Flash 모델
  const queue = [process.env.GEMINI_MODEL, ...PREFERRED_MODELS].filter(Boolean);
  let discoveredAdded = false;
  const tried = new Set();
  let quotaHit = false;
  let lastError = "AI 서버에 연결하지 못했습니다.";

  while (queue.length) {
    const model = queue.shift();
    if (tried.has(model)) continue;
    tried.add(model);

    // 같은 모델은 일시적 서버 오류(5xx)일 때만 한 번 더 시도합니다.
    for (let attempt = 0; attempt < 2; attempt++) {
      let r;
      try {
        r = await callModel(model, apiKey, payload);
      } catch {
        lastError = "AI 서버에 연결하지 못했습니다.";
        await sleep(800);
        continue;
      }

      if (r.ok) {
        const cand = r.data.candidates?.[0];
        const text = (cand?.content?.parts || []).map((p) => p.text || "").join("").trim();
        if (text) {
          res.status(200).json({ text, model });
          return;
        }
        res.status(502).json({
          error:
            cand?.finishReason === "SAFETY"
              ? "AI가 안전 정책으로 답변을 거부했습니다. 표현을 바꿔 다시 입력해 주세요."
              : "AI가 빈 답변을 보냈습니다. 다시 시도해 주세요.",
        });
        return;
      }

      if (r.status === 400 || r.status === 401 || r.status === 403) {
        const msg = r.data.error?.message || "";
        // 키 문제는 모델을 바꿔도 해결되지 않으므로 바로 알립니다.
        if (/api key|API_KEY|permission/i.test(msg) || r.status !== 400) {
          res.status(500).json({ error: "Gemini API 키가 올바르지 않습니다. 강사님께 문의해 주세요." });
          return;
        }
        lastError = msg || `요청 오류 (HTTP ${r.status})`;
        break; // 이 모델이 요청 형식을 지원하지 않는 경우 → 다음 모델
      }
      if (r.status === 404) break; // 모델 없음 → 다음 모델
      if (r.status === 429) { quotaHit = true; break; } // 이 모델 한도 초과 → 다음 모델
      lastError = r.data.error?.message || `Gemini 오류 (HTTP ${r.status})`;
      await sleep(800);
    }

    if (!queue.length && !discoveredAdded) {
      discoveredAdded = true;
      queue.push(...(await discoverModels(apiKey)));
    }
  }

  res.status(quotaHit ? 429 : 502).json({
    error: quotaHit
      ? "오늘 무료 사용량이 많아 잠시 지연되고 있습니다. 1분 뒤 '다시 시도'를 눌러 주세요."
      : lastError,
  });
}
