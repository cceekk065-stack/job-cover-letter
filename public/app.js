(() => {
  "use strict";

  const STORAGE_KEY = "coverletter-session-v1";
  const PW_KEY = "coverletter-pw";
  const TOTAL = 4;

  const $ = (id) => document.getElementById(id);
  const els = {
    loginView: $("loginView"), loginForm: $("loginForm"), pw: $("pw"), loginError: $("loginError"),
    chatView: $("chatView"), messages: $("messages"), chatForm: $("chatForm"), input: $("input"),
    sendBtn: $("sendBtn"), progress: $("progress"), progressText: $("progressText"), steps: $("steps"),
    finalBox: $("finalBox"), toast: $("toast"),
    copyAllBtn: $("copyAllBtn"), txtBtn: $("txtBtn"), docBtn: $("docBtn"), endBtn: $("endBtn"), resetBtn: $("resetBtn"),
  };

  // ---------- 상태 (브라우저 임시 저장) ----------
  const emptyState = () => ({ history: [], summaries: [], completed: 0, step: 1, ended: false, savedAt: null });
  let state = load();
  let busy = false;

  function load() {
    try { return { ...emptyState(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") }; }
    catch { return emptyState(); }
  }
  function save() {
    state.savedAt = new Date().toISOString();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 저장 공간 부족 등 무시 */ }
  }

  // ---------- 마크다운 (안전한 최소 렌더러) ----------
  function esc(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function inline(s) {
    return esc(s)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>");
  }
  function renderMarkdown(md) {
    const out = [];
    let list = null;
    const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const raw of md.split("\n")) {
      const line = raw.trimEnd();
      let m;
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { close(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); }
      else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(m[1])}</li>`); }
      else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(m[1])}</li>`); }
      else if (line.trim() === "") { close(); }
      else if (/^-{3,}$/.test(line.trim())) { close(); out.push("<hr>"); }
      else { close(); out.push(`<p>${inline(line)}</p>`); }
    }
    close();
    return out.join("");
  }

  // ---------- 제어 표기 처리 ----------
  function parseMarkers(text) {
    let step = null;
    const s = text.match(/\[\[STEP:(\d)\]\]/);
    if (s) step = Number(s[1]);
    const done = text.includes("[[문항완료]]");
    const end = text.includes("[[종료]]");
    const clean = text.replace(/\[\[STEP:\d\]\]/g, "").replace(/\[\[문항완료\]\]/g, "").replace(/\[\[종료\]\]/g, "").trim();
    return { step, done, end, clean };
  }

  // ---------- 화면 ----------
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (els.toast.hidden = true), 1800);
  }

  function addBubble(role, text, opts = {}) {
    const div = document.createElement("div");
    div.className = `msg ${role}` + (opts.summary ? " summary" : "");
    if (role === "model") {
      div.innerHTML = renderMarkdown(text);
      const actions = document.createElement("div");
      actions.className = "msg-actions";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "📋 복사";
      copy.onclick = () => copyText(text);
      actions.appendChild(copy);
      div.appendChild(actions);
    } else {
      div.textContent = text;
    }
    els.messages.appendChild(div);
    els.messages.scrollTop = els.messages.scrollHeight;
    return div;
  }

  function renderAll() {
    els.messages.innerHTML = "";
    for (const m of state.history) {
      if (m.role === "user") addBubble("user", m.text);
      else addBubble("model", parseMarkers(m.text).clean, { summary: m.summary });
    }
    updateProgress();
  }

  function updateProgress() {
    els.progress.hidden = false;
    els.progressText.textContent = `문항 ${state.completed}/${TOTAL} 완료`;
    const current = state.ended ? 5 : state.step;
    for (const li of els.steps.children) {
      const n = Number(li.dataset.step);
      li.className = n === current ? "active" : n < current ? "done" : "";
    }
    els.finalBox.hidden = !state.ended;
    els.input.disabled = state.ended;
    els.sendBtn.disabled = state.ended || busy;
  }

  function showChat() {
    els.loginView.hidden = true;
    els.chatView.hidden = false;
    renderAll();
    els.input.focus();
  }

  // ---------- 서버 통신 ----------
  async function api(path, body) {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data.error || `오류가 발생했습니다 (HTTP ${r.status})`);
      err.status = r.status;
      throw err;
    }
    return data;
  }

  async function askModel() {
    busy = true;
    updateProgress();
    const typing = document.createElement("div");
    typing.className = "msg model typing";
    typing.textContent = "컨설턴트가 답변을 작성 중입니다…";
    els.messages.appendChild(typing);
    els.messages.scrollTop = els.messages.scrollHeight;

    try {
      const { text } = await api("/api/chat", {
        password: sessionStorage.getItem(PW_KEY),
        history: state.history.map(({ role, text }) => ({ role, text })),
      });
      typing.remove();
      const { step, done, end, clean } = parseMarkers(text);
      const entry = { role: "model", text };
      if (step) state.step = step;
      if (done) {
        entry.summary = true;
        state.summaries.push(clean);
        state.completed = Math.min(TOTAL, state.completed + 1);
      }
      state.history.push(entry);
      if (end || state.completed >= TOTAL) state.ended = true;
      save();
      addBubble("model", clean, { summary: done });
    } catch (e) {
      typing.remove();
      if (e.status === 401) { logout(e.message); return; }
      const div = addBubble("error", `⚠️ ${e.message}`);
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "다시 시도";
      retry.style.marginLeft = "8px";
      retry.onclick = () => { div.remove(); askModel(); };
      div.appendChild(retry);
    } finally {
      busy = false;
      updateProgress();
    }
  }

  function logout(msg) {
    sessionStorage.removeItem(PW_KEY);
    els.chatView.hidden = true;
    els.loginView.hidden = false;
    els.loginError.textContent = msg || "";
    els.pw.value = "";
    els.pw.focus();
  }

  // ---------- 결과 저장 (복사 / 다운로드) ----------
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove();
    }
    toast("복사되었습니다.");
  }

  function summaryText() {
    if (state.summaries.length) {
      return state.summaries.map((s, i) => `===== 문항 ${i + 1} =====\n${s}`).join("\n\n");
    }
    return "";
  }

  function transcriptText() {
    return state.history
      .map((m) => `[${m.role === "user" ? "나" : "컨설턴트"}]\n${parseMarkers(m.text).clean}`)
      .join("\n\n");
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const stamp = () => new Date().toISOString().slice(0, 10);

  els.copyAllBtn.onclick = () => {
    const t = summaryText();
    if (!t) { toast("아직 완성된 문항 요약본이 없습니다."); return; }
    copyText(t);
  };

  els.txtBtn.onclick = () => {
    if (!state.history.length) { toast("저장할 내용이 없습니다."); return; }
    const body =
      `맞춤형 자소서 컨설팅 결과 (${stamp()})\n\n` +
      `■ 완성 문항 요약 (${state.completed}/${TOTAL})\n\n${summaryText() || "(아직 완성된 문항이 없습니다)"}\n\n` +
      `■ 전체 대화 기록\n\n${transcriptText()}\n`;
    download(`자소서_컨설팅_${stamp()}.txt`, "﻿" + body, "text/plain;charset=utf-8");
  };

  els.docBtn.onclick = () => {
    if (!state.history.length) { toast("저장할 내용이 없습니다."); return; }
    const sums = state.summaries.length
      ? state.summaries.map((s, i) => `<h2>문항 ${i + 1}</h2>${renderMarkdown(s)}`).join("<br>")
      : "<p>(아직 완성된 문항이 없습니다)</p>";
    const log = state.history
      .map((m) => `<h3>${m.role === "user" ? "나" : "컨설턴트"}</h3>${renderMarkdown(parseMarkers(m.text).clean)}`)
      .join("");
    const html =
      `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">` +
      `<head><meta charset="utf-8"><title>자소서 컨설팅 결과</title>` +
      `<style>body{font-family:'Malgun Gothic',sans-serif;line-height:1.6}h1{font-size:18pt}h2{font-size:14pt;color:#2453d6}h3{font-size:11pt;color:#555}</style></head>` +
      `<body><h1>맞춤형 자소서 컨설팅 결과 (${stamp()})</h1>` +
      `<h1>■ 완성 문항 요약 (${state.completed}/${TOTAL})</h1>${sums}` +
      `<br style="page-break-before:always"><h1>■ 전체 대화 기록</h1>${log}</body></html>`;
    download(`자소서_컨설팅_${stamp()}.doc`, "﻿" + html, "application/msword");
  };

  els.endBtn.onclick = () => {
    if (!confirm("컨설팅을 종료하고 결과 제출 안내로 이동할까요?")) return;
    state.ended = true;
    save();
    updateProgress();
    els.finalBox.scrollIntoView({ behavior: "smooth" });
  };

  els.resetBtn.onclick = () => {
    if (!confirm("지금까지의 대화와 저장된 내용이 모두 삭제됩니다. 먼저 다운로드해 두셨나요?\n처음부터 다시 시작할까요?")) return;
    state = emptyState();
    save();
    renderAll();
    askModel();
  };

  // ---------- 이벤트 ----------
  els.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = els.pw.value.trim();
    els.loginError.textContent = "";
    try {
      await api("/api/login", { password: pw });
      sessionStorage.setItem(PW_KEY, pw);
      showChat();
      const last = state.history[state.history.length - 1];
      if (!state.ended && (!last || last.role === "user")) askModel();
    } catch (err) {
      els.loginError.textContent = err.status === 401
        ? "비밀번호가 올바르지 않습니다. 강사님이 안내해 주신 4자리를 다시 확인해 주세요."
        : err.message;
      els.pw.select();
    }
  });

  els.chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = els.input.value.trim();
    if (!text || busy || state.ended) return;
    state.history.push({ role: "user", text });
    save();
    addBubble("user", text);
    els.input.value = "";
    askModel();
  });

  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      els.chatForm.requestSubmit();
    }
  });

  // ---------- 시작 ----------
  if (sessionStorage.getItem(PW_KEY)) {
    showChat();
    const last = state.history[state.history.length - 1];
    if (!state.ended && (!last || last.role === "user")) askModel();
  } else {
    els.pw.focus();
  }
})();
