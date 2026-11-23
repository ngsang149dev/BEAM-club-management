import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9500 + Math.floor(Math.random() * 400);
const base = fs.mkdtempSync(process.cwd() + '/.tmp/cdp-');
const profile = base + '/profile';
const home = base + '/home';
fs.mkdirSync(profile);
fs.mkdirSync(home);
const chrome = spawn(CHROME, [
  '--headless=old', '--window-size=1440,2200', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--disable-crash-reporter', '--disable-breakpad', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'
], { env: { ...process.env, HOME: home }, stdio: ['ignore', 'ignore', 'ignore'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let up = false;
for (let i = 0; i < 80; i++) {
  try { if ((await fetch('http://127.0.0.1:' + PORT + '/json/version')).ok) { up = true; break; } } catch (e) {}
  await sleep(200);
}
if (!up) { console.log('CHROME_NOT_UP'); chrome.kill('SIGKILL'); process.exit(1); }

const url = process.argv[2];
const target = await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank', { method: 'PUT' }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const pair = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? pair.reject(new Error(JSON.stringify(msg.error))) : pair.resolve(msg.result);
  }
});
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params }));
});
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
for (let i = 0; i < 80; i++) {
  const rr = await send('Runtime.evaluate', { expression: "(document.querySelector('[data-scale-readout]')||{}).textContent", returnByValue: true });
  if (rr.result.value && rr.result.value !== '—') break;
  await sleep(200);
}
await sleep(700);
const expression = [
  '(() => {',
  '  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };',
  '  const out = { page: location.pathname.split("/").pop(), viewport: [innerWidth, innerHeight], frames: [], clipped: [], overflowX: [], tiny: [] };',
  '  document.querySelectorAll("[data-frame]").forEach((block) => {',
  '    const device = block.querySelector("[data-device]");',
  '    const viewport = block.querySelector("[data-viewport]");',
  '    const ui = block.querySelector(".ui");',
  '    out.frames.push({ kind: device.className.replace("device ",""), device: rect(device), viewport: rect(viewport), tf: getComputedStyle(device).transform, scroll: [ui.scrollWidth, ui.scrollHeight, ui.clientWidth, ui.clientHeight] });',
  '  });',
  '  document.querySelectorAll(".ui *").forEach((el) => {',
  '    const cs = getComputedStyle(el);',
  '    if (cs.display === "none" || cs.visibility === "hidden") return;',
  '    const r = el.getBoundingClientRect();',
  '    if (r.width === 0 || r.height === 0) return;',
  '    const txt = (el.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 38);',
  '    if (cs.overflowY !== "visible" && el.scrollHeight > el.clientHeight + 5 && el.clientHeight > 12 && !el.matches(".ui-scroll, .ui-cols, .ui-sheet-body, .ui-m-sheet-body, .ui-sheet, .ui-main, .ui-cards, .ui-sheet-grid")) {',
  '      out.clipped.push({ cls: String(el.className).slice(0, 50), txt, by: el.scrollHeight - el.clientHeight });',
  '    }',
  '    if (el.scrollWidth > el.clientWidth + 3 && el.clientWidth > 8 && !["auto","scroll"].includes(cs.overflowX)) {',
  '      out.overflowX.push({ cls: String(el.className).slice(0, 50), txt, by: el.scrollWidth - el.clientWidth });',
  '    }',
  '  });',
  '  document.querySelectorAll(".ui h1, .ui h2, .ui .ui-btn, .ui .ui-tab, .ui .ui-sub").forEach((el) => {',
  '    const fs = parseFloat(getComputedStyle(el).fontSize);',
  '    if (fs < 9) out.tiny.push({ cls: String(el.className).slice(0, 40), txt: (el.innerText || "").trim().slice(0, 30), fs });',
  '  });',
  '  return out;',
  '})()'
].join('\n');
const result = await send('Runtime.evaluate', { expression, returnByValue: true });
const v = result.result.value;
console.log('PAGE', v.page, 'viewport', v.viewport.join('x'));
v.frames.forEach((f) => console.log(' FRAME', f.kind, 'dev', f.device.w + 'x' + f.device.h, 'vp', f.viewport.w + 'x' + f.viewport.h, 'tf', f.tf, 'scroll', f.scroll.join(',')));
const uniq = (a) => [...new Map(a.map((x) => [x.cls + x.txt, x])).values()];
uniq(v.clipped).slice(0, 14).forEach((x) => console.log(' CLIP', x.cls, '|', x.txt, '| +' + x.by));
uniq(v.overflowX).slice(0, 14).forEach((x) => console.log(' OX', x.cls, '|', x.txt, '| +' + x.by));
v.tiny.slice(0, 8).forEach((x) => console.log(' TINY', x.fs, x.cls, x.txt));
ws.close();
chrome.kill('SIGKILL');
process.exit(0);

