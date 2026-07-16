"use strict";
/**
 * Local print bridge — a tiny HTTP service the ERP web app calls to print a
 * PDF to a chosen local printer with NO browser print dialog.
 *
 * Zero npm dependencies (pure Node http): the smaller the surface, the fewer
 * the ways in. The security model is the whole point of this file — a bridge
 * that will silently print anything a localhost caller sends is a bridge any
 * open browser tab can abuse, so every request must clear three gates.
 */
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { listPrinters, printPdf, IS_WIN } = require("./print-adapter");

const HOST = "127.0.0.1";                 // localhost only — never 0.0.0.0
const PORT = Number(process.env.BRIDGE_PORT || 47600);

// --- per-install pairing token (Gate 1) ------------------------------------
// Generated once on first run, stored locally, and the web app must present it
// on every request. An unrelated website cannot read it (it's not in the DOM,
// not in a cookie, not reachable cross-origin), so it cannot forge a job.
const TOKEN_FILE = path.join(__dirname, "..", ".bridge-token");
function loadOrCreateToken() {
  try { return fs.readFileSync(TOKEN_FILE, "utf8").trim(); }
  catch { const t = crypto.randomBytes(24).toString("hex");
          fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 }); return t; }
}
const TOKEN = loadOrCreateToken();

// --- allowed web origins (Gate 2) ------------------------------------------
// Only your ERP's origin(s) may talk to the bridge. Everything else is refused
// before any body is read.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  "https://erp.example.com,http://localhost:5173").split(",").map(s => s.trim());

function corsAndGuard(req, res) {
  const origin = req.headers.origin || "";
  const allowed = ALLOWED_ORIGINS.includes(origin);
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "content-type,x-bridge-token");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
  return allowed;
}

function timingSafeEq(a, b) {
  const A = Buffer.from(a || ""), B = Buffer.from(b || "");
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => { size += c.length;
      if (size > limit) { reject(new Error("payload too large")); req.destroy(); }
      else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const allowedOrigin = corsAndGuard(req, res);       // Gate 2: Origin
  if (req.method === "OPTIONS") { res.writeHead(allowedOrigin ? 204 : 403).end(); return; }

  const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json" });
                                res.end(JSON.stringify(obj)); };

  // health is open (no secrets) so the web app can detect "is the bridge up?"
  if (req.method === "GET" && req.url === "/health")
    return json(200, { ok: true, platform: process.platform, mock: !IS_WIN });

  if (!allowedOrigin) return json(403, { error: "origin_not_allowed" });          // Gate 2
  if (!timingSafeEq(req.headers["x-bridge-token"], TOKEN))                         // Gate 1
    return json(401, { error: "bad_or_missing_token" });

  try {
    if (req.method === "GET" && req.url === "/printers")
      return json(200, await listPrinters());

    if (req.method === "POST" && req.url === "/print") {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      const pdf = Buffer.from(body.pdfBase64 || "", "base64");
      if (!pdf.length) return json(400, { error: "empty_pdf" });                   // Gate 3: validate
      if (pdf.subarray(0, 5).toString() !== "%PDF-")                               // must actually be a PDF
        return json(400, { error: "not_a_pdf" });
      const printer = String(body.printer || "").trim();
      if (!printer) return json(400, { error: "no_printer" });
      const jobId = crypto.randomUUID();
      const result = await printPdf(pdf, printer, jobId);
      return json(200, { ok: true, ...result });
    }
    return json(404, { error: "not_found" });
  } catch (e) {
    return json(500, { error: "print_failed", detail: String(e.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`print-bridge on http://${HOST}:${PORT}  (${IS_WIN ? "WINDOWS real-print" : "MOCK mode — non-Windows dev box"})`);
  console.log(`pairing token: ${TOKEN}  (the web app sends this as x-bridge-token)`);
  console.log(`allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
});
