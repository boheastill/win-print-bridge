"use strict";
/**
 * Platform print adapter.
 *
 * On Windows (win32) this shells out to the real silent-print path:
 *   - list printers via PowerShell `Get-Printer`
 *   - silent-print a PDF via SumatraPDF `-print-to "<name>" -silent`
 *     (bundled SumatraPDF is the reliable way to print a PDF with NO dialog;
 *      the Windows shell "PrintTo" verb works too but is picky about the
 *      default PDF handler — SumatraPDF removes that dependency).
 *
 * On any other OS (so the whole bridge is demonstrable on a dev box with no
 * Windows and no printer) it falls back to a MOCK: printers are a fixed list
 * and a "print" writes the job into ./spool/ and returns success. The HTTP
 * surface, the security model, and the browser→bridge flow are IDENTICAL in
 * both modes — only the final spooler call differs. That honest line is in the
 * README; nothing here pretends a mock print is a real one.
 */
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const IS_WIN = process.platform === "win32";
const SPOOL = path.join(__dirname, "..", "spool");

function listPrinters() {
  if (!IS_WIN) {
    return Promise.resolve({
      mock: true,
      printers: [
        { name: "Front-Desk-Laser", default: true },
        { name: "Warehouse-Label-TT", default: false },
        { name: "Accounting-PDF", default: false },
      ],
    });
  }
  return new Promise((resolve, reject) => {
    // -NoProfile keeps it fast; ConvertTo-Json gives us a clean parse
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command",
       "Get-Printer | Select-Object Name,Default | ConvertTo-Json -Compress"],
      { timeout: 8000 },
      (err, stdout) => {
        if (err) return reject(err);
        let raw = JSON.parse(stdout || "[]");
        if (!Array.isArray(raw)) raw = [raw];
        resolve({
          mock: false,
          printers: raw.map((p) => ({ name: p.Name, default: !!p.Default })),
        });
      }
    );
  });
}

function printPdf(pdfBuffer, printerName, jobId) {
  fs.mkdirSync(SPOOL, { recursive: true });
  const file = path.join(SPOOL, `${jobId}.pdf`);
  fs.writeFileSync(file, pdfBuffer);

  if (!IS_WIN) {
    // mock: the job is durably on disk; a real Windows box would spool it now
    fs.appendFileSync(path.join(SPOOL, "printed.log"),
      `${jobId}\tMOCK printed to ${printerName}\t${file}\n`);
    return Promise.resolve({ mock: true, jobId, printer: printerName });
  }
  return new Promise((resolve, reject) => {
    // SumatraPDF must be bundled with the installer; -silent = no dialog, no UI
    const sumatra = path.join(__dirname, "..", "vendor", "SumatraPDF.exe");
    execFile(
      sumatra,
      ["-print-to", printerName, "-silent", "-exit-when-done", file],
      { timeout: 20000 },
      (err) => {
        if (err) return reject(err);
        resolve({ mock: false, jobId, printer: printerName });
      }
    );
  });
}

module.exports = { listPrinters, printPdf, IS_WIN };
