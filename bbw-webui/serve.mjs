/**
 * 本地静态服务（仅开发/自用）。
 * 关键点：所有响应带 no-store，避免改完代码后浏览器还拿旧的 index.html。
 *
 *   node serve.mjs [port]
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const PORT = Number(process.argv[2] || 8123);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let p = normalize(decodeURIComponent(url.pathname));
    if (p.includes("..")) throw new Error("bad path");
    if (p.endsWith("/")) p += "index.html";
    let file = join(ROOT, p);
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(file, "index.html");
    } catch {
      file = join(ROOT, "index.html"); // SPA 回退
    }
    const buf = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store, must-revalidate",
      Pragma: "no-cache",
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 " + e.message);
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`serve ${ROOT} -> http://127.0.0.1:${PORT}/`);
});
