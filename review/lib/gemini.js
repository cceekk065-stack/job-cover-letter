// Gemini 호출 + 모델 자동 전환 (기존 컨설팅 앱과 같은 방식)
// 지정 모델 → 기본 후보 → 이 API 키로 실제 쓸 수 있는 Flash 모델 순서로 시도합니다.

const PREFERRED_MODELS = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-flash-lite-latest"];
const DISCOVERY_TTL_MS = 10 * 60 * 1000;
const BASE = () => process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

export class GeminiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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

/** payload를 보내고 { text, model }을 돌려줍니다. 실패하면 GeminiError를 던집니다. */
export async function generate(payload) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError(500, "서버에 GEMINI_API_KEY가 설정되지 않았습니다. 강사님께 문의해 주세요.");

  const queue = [process.env.GEMINI_MODEL, ...PREFERRED_MODELS].filter(Boolean);
  const tried = new Set();
  let discoveredAdded = false;
  let quotaHit = false;
  let lastError = "AI 서버에 연결하지 못했습니다.";

  while (queue.length) {
    const model = queue.shift();
    if (tried.has(model)) continue;
    tried.add(model);

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
        const text = (cand?.content?.parts || [])
          .filter((p) => !p.thought)
          .map((p) => p.text || "")
          .join("")
          .trim();
        if (text) return { text, model, finishReason: cand?.finishReason };
        if (cand?.finishReason === "SAFETY") {
          throw new GeminiError(502, "AI가 안전 정책으로 답변을 거부했습니다. 표현을 바꿔 다시 시도해 주세요.");
        }
        lastError = "AI가 빈 답변을 보냈습니다. 다시 시도해 주세요.";
        break;
      }

      if (r.status === 400 || r.status === 401 || r.status === 403) {
        const msg = r.data.error?.message || "";
        if (/api key|API_KEY|permission/i.test(msg) || r.status !== 400) {
          throw new GeminiError(500, "Gemini API 키가 올바르지 않습니다. 강사님께 문의해 주세요.");
        }
        lastError = msg || `요청 오류 (HTTP ${r.status})`;
        break; // 이 모델이 요청 형식을 지원하지 않음 → 다음 모델
      }
      if (r.status === 404) break; // 모델 없음
      if (r.status === 429) { quotaHit = true; break; } // 이 모델 한도 초과
      lastError = r.data.error?.message || `Gemini 오류 (HTTP ${r.status})`;
      await sleep(800);
    }

    if (!queue.length && !discoveredAdded) {
      discoveredAdded = true;
      queue.push(...(await discoverModels(apiKey)));
    }
  }

  throw new GeminiError(
    quotaHit ? 429 : 502,
    quotaHit ? "지금 사용하는 사람이 많아 무료 사용량이 잠시 찼습니다. 1분 뒤 다시 시도해 주세요." : lastError
  );
}
