// 로컬 테스트용 간이 서버: node dev-server.js  →  http://localhost:3000
// (Vercel 배포에는 사용되지 않습니다)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import review from "./api/review.js";
import login from "./api/login.js";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };
const routes = { "/api/review": review, "/api/login": login };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const fn = routes[url.pathname];
  if (fn) {
    let raw = "";
    for await (const c of req) raw += c;
    try { req.body = JSON.parse(raw || "{}"); } catch { req.body = {}; }
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
    return fn(req, res);
  }
  const file = path.join("public", url.pathname === "/" ? "index.html" : path.normalize(url.pathname));
  if (!file.startsWith("public")) { res.statusCode = 403; return res.end(); }
  try {
    res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end("Not found"); }
}).listen(process.env.PORT || 3000, () => console.log("http://localhost:" + (process.env.PORT || 3000)));
