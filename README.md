# Windows Local Print Bridge — runnable demo

A tiny local service that lets a browser-based ERP print a PDF straight to a
chosen local printer **with no browser print dialog**. Zero npm dependencies
(pure Node `http`) — the smaller the surface, the fewer the ways in.

> **Honest scope.** The actual Windows silent-print call needs Windows + a
> printer, so on any non-Windows box this runs in **MOCK mode**: printers are a
> fixed list and a "print" writes the job into `spool/` and returns success.
> **The HTTP surface, the three security gates, and the browser→bridge flow are
> identical in both modes** — only the final spooler call differs. On a real
> Windows machine the same code lists real printers and prints for real. Nothing
> here calls a mock print a real one.

## Run the demo (works on any OS, no printer needed)

```bash
node src/bridge.js
# note the "pairing token" it prints
```
Then serve `public/` and open `demo.html` (it stands in for your ERP):
```bash
npx serve public   # or: python3 -m http.server -d public 5173
```
Paste the token → **Detect printers** → **Silently print sample.pdf**. On
Windows it prints; elsewhere it lands in `spool/`.

## The security model (this is the whole point)

A bridge that prints anything a localhost caller sends is a bridge any open
browser tab can abuse. Every request clears three gates:

1. **Per-install pairing token** — generated once, stored `0600` locally, sent
   as `x-bridge-token`. An unrelated website can't read it (not in the DOM, not
   a cookie, not cross-origin readable), so it can't forge a job. Compared with
   `crypto.timingSafeEqual`.
2. **Origin allowlist** — only your ERP's configured origin(s) are answered;
   everything else is refused before the body is even read.
3. **Payload validation** — bind to `127.0.0.1` only (never `0.0.0.0`), enforce
   a size limit, and reject anything whose bytes don't start with `%PDF-`.

`/health` is the only open route (no secrets) so the web app can detect whether
the bridge is up.

## How this maps to the job's five questions

1. **A Windows printing / hardware-integration project** — this bridge, plus a
   Windows offline-first desktop app I'm building (native capture + on-device
   processing + a verifiable zero-egress boundary).
2. **Silent print to a selected printer** — bundle SumatraPDF and call
   `SumatraPDF.exe -print-to "<name>" -silent -exit-when-done <file>`. It prints
   a PDF with no UI and no dependency on the machine's default PDF handler (the
   Windows shell "PrintTo" verb works but is picky about that handler).
3. **Electron vs Node service vs other** — a **lightweight Node tray service**,
   not Electron. Electron ships a whole Chromium to do a headless job; a Node
   service (optionally with a systray icon and run-on-login) is smaller, starts
   faster, and has far less attack surface — which matters for something sitting
   on every workstation.
4. **Stopping an unrelated website** — the three gates above. This is the part
   most implementations get wrong, and it's the part I'd get right first.
5. **One-week POC** — bridge + printer detection + token/Origin security + one
   real silent print on one real workstation, packaged into an installer with
   SumatraPDF bundled, deployed and tested with your one pilot customer. The
   mock mode means your team can review the whole flow before touching a printer.

## Files
- `src/bridge.js` — pure-Node HTTP bridge + the three security gates
- `src/print-adapter.js` — Windows real-print (PowerShell + SumatraPDF) / mock fallback
- `public/demo.html` — a browser page that plays your ERP

## License
MIT
