import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9444;
const profile = process.cwd() + '/.tmp/cdp-profile2';
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(process.cwd() + '/.tmp/cdp-home2', { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=old', '--window-size=1440,2200', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--disable-crash-reporter', '--disable-breakpad', '--no-first-run',
  '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile, 'about:blank'
], {
  env: { ...process.env, HOME: process.cwd() + '/.tmp/cdp-home2' },
  stdio: ['ignore', 'ignore', 'ignore']
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let up = false;
for (let i = 0; i < 80; i++) {
  try {
    const res = await fetch('http://127.0.0.1:' + PORT + '/json/version');
    if (res.ok) { up = true; break; }
  } catch (e) {}
  await sleep(250);
}
if (!up) { console.log('CHROME_NOT_UP'); chrome.kill('SIGKILL'); process.exit(1); }

const url = process.argv[2];
const target = await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank', { method: 'PUT' }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const pair = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? pair.reject(new Error(JSON.stringify(msg.error))) : pair.resolve(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description || ''));
  } else if (msg.method === 'Network.loadingFailed') {
    errors.push('netfail: ' + msg.params.errorText + ' ' + (msg.params.blockedReason||''));
  } else if (msg.method === 'Log.entryAdded') {
    errors.push('log: ' + msg.params.entry.text);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    errors.push('console: ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
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
await send('Network.enable');
await send('Log.enable');
await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs=[];addEventListener('error',e=>window.__errs.push(String(e.message)+' @ '+e.filename+':'+e.lineno));addEventListener('unhandledrejection',e=>window.__errs.push('rejection: '+String(e.reason)));` });
await send('Page.navigate', { url });
for (let i = 0; i < 100; i++) {
  const ready = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
  if (ready.result.value === 'complete') break;
  await sleep(100);
}
await sleep(2200);
const check = await send('Runtime.evaluate', { expression: `JSON.stringify({errs:window.__errs, readout:(document.querySelector('[data-scale-readout]')||{}).textContent, style:(document.querySelector('[data-device]')||{}).getAttribute('style'), jsLoaded:[...document.scripts].map(s=>s.src), resources:performance.getEntriesByType('resource').map(r=>r.name)})`, returnByValue: true });
console.log(check.result.value);
console.log('EVENTS', JSON.stringify(errors));
await send('Page.close');
ws.close();
chrome.kill('SIGKILL');
process.exit(0);

