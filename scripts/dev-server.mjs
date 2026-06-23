// Local full-stack dev server: serves public/ AND runs the real /api/analyze
// function — so you can test end-to-end without a Vercel account.
//
//   node --env-file=.env.local scripts/dev-server.mjs
//   (or: npm run dev:local)
//
// `vercel dev` is still the production-faithful way to run it; this is just a
// zero-account local option.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import analyze from "../api/analyze.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "public");
const PORT = process.env.PORT || 8127;
const TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// Adapt a Node response to the Vercel handler's res.status().json() shape.
function vercelRes(nodeRes) {
  return {
    statusCode: 200,
    setHeader: (k, v) => nodeRes.setHeader(k, v),
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      nodeRes.statusCode = this.statusCode;
      nodeRes.setHeader("Content-Type", "application/json");
      nodeRes.end(JSON.stringify(obj));
    },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/analyze") {
    const raw = await readBody(req);
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "Invalid JSON body." }));
    }
    return analyze({ method: req.method, body, headers: req.headers }, vercelRes(res));
  }

  // Static files
  let path = decodeURIComponent(url.pathname);
  if (path === "/") path = "/index.html";
  try {
    const file = await readFile(join(PUBLIC, path));
    res.setHeader("Content-Type", TYPES[extname(path)] || "application/octet-stream");
    res.end(file);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}).listen(PORT, () => {
  const keyOk = !!process.env.ANTHROPIC_API_KEY;
  console.log(`CalorieSnap dev server: http://localhost:${PORT}`);
  console.log(keyOk ? "ANTHROPIC_API_KEY loaded ✓" : "WARNING: ANTHROPIC_API_KEY not set");
});
