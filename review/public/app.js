// ===== 설정 =====
const BLOG_URL = "https://blog.naver.com/eunkyungcareer";
const MAX_ITEMS = 6;
const STORE_KEY = "cl-review-v1";
const PW_KEY = "cl-review-pw";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const DEFAULT_QUESTIONS = ["지원 동기와 입사 후 포부를 작성해 주세요.", "직무와 관련된 경험을 작성해 주세요."];

let password = localStorage.getItem(PW_KEY) || "";
let state = load() || {
  company: "", job: "", jobInfo: "",
  items: DEFAULT_QUESTIONS.map((q) => ({ question: q, limit: "", answer: "", result: null, model: "" })),
};
const busy = new Set();

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 1800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast("복사했습니다");
}

const countWithSpaces = (s) => s.length;
const countNoSpaces = (s) => s.replace(/\s/g, "").length;

// ===== 로그인 =====
async function login(pw) {
  const r = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pw }),
  });
  return r.ok;
}

function showApp() {
  $("loginView").hidden = true;
  $("appView").hidden = false;
  $("topActions").hidden = false;
  renderAll();
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = $("pw").value.trim();
  $("loginError").textContent = "";
  try {
    if (await login(pw)) {
      password = pw;
      localStorage.setItem(PW_KEY, pw);
      showApp();
    } else {
      $("loginError").textContent = "비밀번호가 올바르지 않습니다. 다시 확인해 주세요.";
    }
  } catch {
    $("loginError").textContent = "서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
});

// ===== 지원 정보 =====
for (const key of ["company", "job", "jobInfo"]) {
  $(key).addEventListener("input", (e) => { state[key] = e.target.value; save(); });
}

// ===== 문항 =====
function renderAll() {
  $("company").value = state.company;
  $("job").value = state.job;
  $("jobInfo").value = state.jobInfo;
  const box = $("items");
  box.innerHTML = "";
  state.items.forEach((_, i) => box.appendChild(buildItem(i)));
  $("addItemBtn").disabled = state.items.length >= MAX_ITEMS;
  updateRunAll();
}

function buildItem(i) {
  const it = state.items[i];
  const el = $("itemTpl").content.firstElementChild.cloneNode(true);
  el.dataset.index = i;
  el.querySelector(".item-no").textContent = `문항 ${i + 1}`;
  const q = el.querySelector(".q");
  const limit = el.querySelector(".limit");
  const answer = el.querySelector(".answer");
  q.value = it.question;
  limit.value = it.limit;
  answer.value = it.answer;

  const updateCount = () => {
    const n = countWithSpaces(answer.value);
    const lim = parseInt(limit.value, 10);
    const over = lim > 0 && n > lim;
    el.querySelector(".count").innerHTML =
      `공백 포함 <b class="${over ? "over" : ""}">${n}</b>${lim > 0 ? ` / ${lim}자` : "자"} · 공백 제외 ${countNoSpaces(answer.value)}자` +
      (over ? ` <span class="over">(${n - lim}자 초과)</span>` : "");
  };
  updateCount();

  q.addEventListener("input", () => { it.question = q.value; save(); });
  limit.addEventListener("input", () => { it.limit = limit.value; save(); updateCount(); });
  answer.addEventListener("input", () => { it.answer = answer.value; save(); updateCount(); });

  el.querySelector(".remove").addEventListener("click", () => {
    if (busy.size) return toast("첨삭이 끝난 뒤에 삭제해 주세요");
    if (state.items.length <= 1) return toast("문항은 최소 1개가 필요합니다");
    if ((it.answer || it.result) && !confirm(`문항 ${i + 1}을(를) 삭제할까요?`)) return;
    state.items.splice(i, 1);
    save();
    renderAll();
  });
  el.querySelector(".review").addEventListener("click", () => reviewItem(i));

  if (busy.has(i)) renderLoading(el);
  else if (it.error) renderError(el, i, it.error);
  else if (it.result) renderResult(el, i);
  return el;
}

function itemEl(i) {
  return document.querySelector(`.item[data-index="${i}"]`);
}

$("addItemBtn").addEventListener("click", () => {
  if (state.items.length >= MAX_ITEMS) return;
  state.items.push({ question: "", limit: "", answer: "", result: null, model: "" });
  save();
  renderAll();
  itemEl(state.items.length - 1)?.querySelector(".q").focus();
});

// ===== 첨삭 요청 =====
function validate(it) {
  if (!it.question.trim()) return "문항을 입력해 주세요.";
  if (it.answer.trim().length < 30) return "답변을 30자 이상 입력해 주세요.";
  return "";
}

async function reviewItem(i) {
  const it = state.items[i];
  const problem = validate(it);
  if (problem) {
    toast(`문항 ${i + 1}: ${problem}`);
    return false;
  }
  if (busy.has(i)) return false;
  busy.add(i);
  it.error = "";
  updateRunAll();
  const el = itemEl(i);
  if (el) {
    el.querySelector(".review").disabled = true;
    renderLoading(el);
  }

  try {
    const r = await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password,
        company: state.company, job: state.job, jobInfo: state.jobInfo,
        question: it.question, limit: it.limit, answer: it.answer,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) {
      localStorage.removeItem(PW_KEY);
      throw new Error("비밀번호가 바뀌었습니다. 새로고침 후 다시 입력해 주세요.");
    }
    if (!r.ok) throw new Error(data.error || `오류가 발생했습니다 (HTTP ${r.status})`);
    it.result = data.result;
    it.model = data.model || "";
    it.reviewedAnswer = it.answer;
  } catch (e) {
    it.error = e.message || "네트워크 오류가 발생했습니다.";
  } finally {
    busy.delete(i);
    save();
    updateRunAll();
  }

  const cur = itemEl(i);
  if (cur) {
    cur.querySelector(".review").disabled = false;
    cur.querySelector(".review").textContent = "다시 첨삭";
    if (it.error) renderError(cur, i, it.error);
    else renderResult(cur, i);
  }
  return !it.error;
}

function updateRunAll() {
  const btn = $("reviewAllBtn");
  btn.disabled = busy.size > 0;
  btn.textContent = busy.size > 0 ? "⏳ 첨삭 중입니다…" : "✨ 전체 문항 첨삭 받기";
}

$("reviewAllBtn").addEventListener("click", async () => {
  const targets = state.items.map((it, i) => i).filter((i) => !validate(state.items[i]));
  if (!targets.length) return toast("문항과 답변(30자 이상)을 먼저 입력해 주세요");
  // 무료 한도를 아끼기 위해 한 문항씩 차례로 요청합니다.
  for (const i of targets) await reviewItem(i);
  toast("첨삭이 끝났습니다");
});

// ===== 결과 표시 =====
function renderLoading(el) {
  const box = el.querySelector(".result");
  box.hidden = false;
  box.innerHTML = `<div class="loading"><span class="spinner"></span>AI가 첨삭하고 있습니다… (약 20~40초)</div>`;
}

function renderError(el, i, msg) {
  const box = el.querySelector(".result");
  box.hidden = false;
  box.innerHTML = `<div class="result-error"><span>⚠️ ${esc(msg)}</span><button type="button">다시 시도</button></div>`;
  box.querySelector("button").addEventListener("click", () => reviewItem(i));
}

const highlightBlanks = (s) => esc(s).replace(/\[([^\]\n]{1,40})\]/g, "<mark>[$1]</mark>");

function renderResult(el, i) {
  const it = state.items[i];
  const r = it.result;
  const box = el.querySelector(".result");
  box.hidden = false;
  el.querySelector(".review").textContent = "다시 첨삭";

  const cls = r.score >= 80 ? "" : r.score >= 60 ? "mid" : "low";
  const lim = parseInt(it.limit, 10);
  const n = countWithSpaces(r.revised);
  const limNote = lim > 0 ? (n > lim ? ` <b style="color:var(--danger)">(${n - lim}자 초과 — 줄여 주세요)</b>` : ` / ${lim}자`) : "자";
  const stale = it.reviewedAnswer !== undefined && it.reviewedAnswer !== it.answer;

  box.innerHTML = `
    ${stale ? `<p class="hint">ℹ️ 답변을 고친 뒤의 결과가 아닙니다. 고친 답변을 평가받으려면 <b>다시 첨삭</b>을 누르세요.</p>` : ""}
    <div class="score-row">
      <div class="score ${cls}"><div>${r.score}<small>/ 100</small></div></div>
      <p class="summary">${esc(r.summary)}</p>
    </div>

    <h3>📊 항목별 평가</h3>
    <table class="criteria"><tbody>
      ${r.criteria.map((c) => `<tr><th>${esc(c.name)}</th><td><span class="grade g${esc(c.grade)}">${esc(c.grade)}</span>${esc(c.comment)}</td></tr>`).join("")}
    </tbody></table>

    ${r.strengths.length ? `<h3>👍 잘한 점</h3><ul>${r.strengths.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}

    ${r.improvements.length ? `<h3>🔧 고칠 점</h3>${r.improvements.map((f) => `
      <div class="fix">
        ${f.quote ? `<q>${esc(f.quote)}</q>` : ""}
        <div>${esc(f.problem)}</div>
        <div class="arrow">→ ${esc(f.suggestion)}</div>
      </div>`).join("")}` : ""}

    <h3>📝 수정안</h3>
    <div class="revised">${highlightBlanks(r.revised)}</div>
    <div class="revised-meta">
      <span>공백 포함 ${n}${limNote} · 공백 제외 ${countNoSpaces(r.revised)}자 · <mark>[ ]</mark> 부분은 직접 채워 주세요</span>
      <span class="btns">
        <button type="button" class="ghost copy-rev">📋 수정안 복사</button>
        <button type="button" class="ghost apply-rev">내 답변에 넣기</button>
      </span>
    </div>

    ${r.interviewQuestions.length ? `<h3>🎤 면접 예상 질문</h3><ol>${r.interviewQuestions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>` : ""}
    ${it.model ? `<div class="model-note">사용 모델: ${esc(it.model)}</div>` : ""}
  `;

  box.querySelector(".copy-rev").addEventListener("click", () => copyText(r.revised));
  box.querySelector(".apply-rev").addEventListener("click", () => {
    if (!confirm("내 답변을 수정안으로 바꿀까요? [ ] 부분은 직접 채운 뒤 '다시 첨삭'을 눌러 보세요.")) return;
    it.answer = r.revised;
    save();
    const ta = el.querySelector(".answer");
    ta.value = r.revised;
    ta.dispatchEvent(new Event("input"));
    renderResult(el, i);
    ta.focus();
  });
}

// ===== 내보내기 =====
function buildReport() {
  const lines = ["AI 자소서 첨삭 결과", `지원: ${state.company || "-"} / ${state.job || "-"}`, ""];
  state.items.forEach((it, i) => {
    lines.push("━".repeat(30), `문항 ${i + 1}. ${it.question}${it.limit ? ` (${it.limit}자)` : ""}`, "");
    lines.push("[내 답변]", it.answer || "(미입력)", "");
    const r = it.result;
    if (!r) { lines.push("(첨삭 전)", ""); return; }
    lines.push(`[점수] ${r.score}/100`, `[총평] ${r.summary}`, "", "[항목별 평가]");
    r.criteria.forEach((c) => lines.push(`- ${c.name} (${c.grade}): ${c.comment}`));
    if (r.strengths.length) { lines.push("", "[잘한 점]"); r.strengths.forEach((s) => lines.push(`- ${s}`)); }
    if (r.improvements.length) {
      lines.push("", "[고칠 점]");
      r.improvements.forEach((f) => lines.push(`- "${f.quote}"`, `  문제: ${f.problem}`, `  제안: ${f.suggestion}`));
    }
    lines.push("", `[수정안] (공백 포함 ${r.revised.length}자)`, r.revised);
    if (r.interviewQuestions.length) {
      lines.push("", "[면접 예상 질문]");
      r.interviewQuestions.forEach((q, k) => lines.push(`${k + 1}. ${q}`));
    }
    lines.push("");
  });
  return lines.join("\n");
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const fileBase = () => `자소서첨삭_${(state.company || "결과").replace(/[\\/:*?"<>|\s]+/g, "_")}`;
const hasResults = () => state.items.some((it) => it.result);

$("copyAllBtn").addEventListener("click", () => {
  if (!hasResults()) return toast("아직 첨삭 결과가 없습니다");
  copyText(buildReport());
});
$("txtBtn").addEventListener("click", () => {
  if (!hasResults()) return toast("아직 첨삭 결과가 없습니다");
  download(`${fileBase()}.txt`, "﻿" + buildReport(), "text/plain;charset=utf-8");
});
$("docBtn").addEventListener("click", () => {
  if (!hasResults()) return toast("아직 첨삭 결과가 없습니다");
  const html = `<html><head><meta charset="utf-8"><title>자소서 첨삭</title></head>
    <body style="font-family:'Malgun Gothic';line-height:1.7"><pre style="white-space:pre-wrap;font-family:'Malgun Gothic'">${esc(buildReport())}</pre></body></html>`;
  download(`${fileBase()}.doc`, "﻿" + html, "application/msword");
});
$("resetBtn").addEventListener("click", () => {
  if (!confirm("입력한 내용과 첨삭 결과를 모두 지울까요? (먼저 다운로드해 두세요)")) return;
  localStorage.removeItem(STORE_KEY);
  state = {
    company: "", job: "", jobInfo: "",
    items: DEFAULT_QUESTIONS.map((q) => ({ question: q, limit: "", answer: "", result: null, model: "" })),
  };
  renderAll();
  window.scrollTo(0, 0);
});

// ===== 시작 =====
$("blogLink").href = BLOG_URL;
if (password) {
  login(password).then((ok) => (ok ? showApp() : localStorage.removeItem(PW_KEY))).catch(() => showApp());
}
