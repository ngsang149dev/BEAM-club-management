import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const profile = process.cwd() + '/.tmp/cdp-profile';
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(process.cwd() + '/.tmp/cdp-home', { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=old', '--window-size=1440,2200', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--disable-crash-reporter', '--disable-breakpad', '--no-first-run',
  '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile, 'about:blank'
], {
  env: { ...process.env, HOME: process.cwd() + '/.tmp/cdp-home' },
  stdio: ['ignore', 'ignore', 'ignore']
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60; i++) {
  try {
    const res = await fetch('http://127.0.0.1:' + PORT + '/json/version');
    if (res.ok) break;
  } catch (e) {}
  await sleep(250);
}

const url = process.argv[2];
const target = await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank', { method: 'PUT' }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const pair = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? pair.reject(new Error(JSON.stringify(msg.error))) : pair.resolve(msg.result);
  }
});
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, { resolve, reject });
  ws.send(JSON.stringify({ id: n, method, params }));
});
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
for (let i = 0; i < 80; i++) {
  const ready = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
  if (ready.result.value === 'complete') break;
  await sleep(100);
}
for (let i=0;i<40;i++){const rr=await send('Runtime.evaluate',{expression:"(document.querySelector('[data-scale-readout]')||{}).textContent",returnByValue:true}); if(rr.result.value && rr.result.value!=='—') break; await sleep(150);} await sleep(400);
const expression = [
  '(() => {',
  '  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };',
  '  const out = { readout: (document.querySelector("[data-scale-readout]")||{}).textContent, transformInline: (document.querySelector("[data-device]")||{}).style.transform, vpDisplay: getComputedStyle(document.querySelector("[data-viewport]")).display, devW: getComputedStyle(document.querySelector("[data-device]")).width, page: location.pathname.split("/").pop(), viewport: [innerWidth, innerHeight], frames: [], clipped: [], overflowX: [], tinyText: [] };',
  '  document.querySelectorAll("[data-frame]").forEach((block) => {',
  '    const device = block.querySelector("[data-device]");',
  '    const viewport = block.querySelector("[data-viewport]");',
  '    const ui = block.querySelector(".ui");',
  '    const r = rect(device), vr = rect(viewport);',
  '    out.frames.push({ kind: device.className, device: r, viewport: vr, transform: getComputedStyle(device).transform, uiScroll: ui ? [ui.scrollWidth, ui.scrollHeight, ui.clientWidth, ui.clientHeight] : null, deviceScroll: [device.scrollWidth, device.scrollHeight] });',
  '  });',
  '  document.querySelectorAll(".ui *").forEach((el) => {',
  '    const cs = getComputedStyle(el);',
  '    if (cs.display === "none" || cs.visibility === "hidden") return;',
  '    const r = rect(el);',
  '    if (r.w === 0 || r.h === 0) return;',
  '    const txt = (el.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 42);',
  '    if (cs.overflowY !== "visible" && el.scrollHeight > el.clientHeight + 5 && el.clientHeight > 12 && !el.matches(".ui-scroll, .ui-cols, .ui-sheet-body, .ui-m-sheet-body, .ui-sheet, .ui-main, .ui-cards, .ui-sheet-grid")) {',
  '      out.clipped.push({ cls: el.className.toString().slice(0, 60), txt, scroll: el.scrollHeight, client: el.clientHeight });',
  '    }',
  '    if (el.scrollWidth > el.clientWidth + 3 && el.clientWidth > 8 && cs.overflowX !== "auto" && cs.overflowX !== "scroll") {',
  '      out.overflowX.push({ cls: el.className.toString().slice(0, 60), txt, scroll: el.scrollWidth, client: el.clientWidth });',
  '    }',
  '  });',
  '  document.querySelectorAll(".ui h1, .ui h2, .ui .ui-card-title, .ui .ui-btn, .ui .ui-tab, .ui .ui-pagehead .ui-sub").forEach((el) => {',
  '    const fs = parseFloat(getComputedStyle(el).fontSize);',
  '    if (fs < 9) out.tinyText.push({ cls: el.className.toString().slice(0, 40), txt: (el.innerText || "").trim().slice(0, 30), fs });',
  '  });',
  '  return out;',
  '})()'
].join('\n');
const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
const v=result.result.value; console.log('PAGE',v.page,'viewport',v.viewport.join('x')); v.frames.forEach(f=>console.log(' FRAME',f.kind,'dev',f.device.w+'x'+f.device.h,'vp',f.viewport.w+'x'+f.viewport.h,'tf',f.transform,'scroll',f.uiScroll&&f.uiScroll.join(','))); const uniq=(a)=>[...new Map(a.map(x=>[x.cls+x.txt,x])).values()]; uniq(v.clipped).slice(0,12).forEach(x=>console.log(' CLIP',x.cls,'|',x.txt,'|',x.scroll+'>'+x.client)); uniq(v.overflowX).slice(0,12).forEach(x=>console.log(' OX',x.cls,'|',x.txt,'|',x.scroll+'>'+x.client)); v.tinyText.slice(0,8).forEach(x=>console.log(' TINY',x.fs,x.cls,x.txt));
await send('Page.close');
ws.close();
chrome.kill('SIGKILL');
process.exit(0);

