/*
 * KokoroVoice backend (Node built-ins only — no npm install needed)
 * Serves UI + API: config, daemon (24/7 background), Ollama proxy, TTS voices,
 * LiveKit tokens, recordings/transcripts, live transcript bridge.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const REC = path.join(DATA, 'recordings');
const AGENT_DIR = path.join(ROOT, 'agent');
const CONFIG_PATH = path.join(DATA, 'config.json');
const PID_PATH = path.join(DATA, 'worker.pid');
const LIVEKIT_KEYS = { devkey: 'devsecret' };
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880';
const OLLAMA = 'http://127.0.0.1:11434';
const SYNTH = process.env.SYNTH_URL || 'http://127.0.0.1:8123';
const PORT = process.env.PORT || 4001;

for (const d of [DATA, REC]) fs.mkdirSync(d, { recursive: true });

/* ---------------------------------------------------------------- config */
const DEFAULT_CONFIG = {
  name: 'Bella', business: 'Sunny Dental Care', language: 'en', tone: 'warm and professional',
  instructions: '',
  llm: 'qwen2.5:7b-instruct', llm_temperature: 0.3, stt_model: 'base',
  tts_provider: 'kokoro', tts_voice: 'af_bella', tts_speed: 0.9, tts_emotion: 'natural',
  hinglish: true,
  welcome: "Hi, I'm Bella, your virtual assistant. How can I help you today?",
  max_turns: 40, idle_timeout_s: 60, record_calls: false,
  tree: [
    { id: 'n1', kind: 'greeting', message: 'Thanks for calling. How can I help you today?' },
    { id: 'n2', kind: 'condition', listen_for: ['book', 'appointment', 'schedule'], action: 'book', reply: 'Great, I can help you book that. May I have your name and a preferred time please?' },
    { id: 'n3', kind: 'condition', listen_for: ['price', 'cost', 'fees', 'charge'], action: 'reply', reply: 'The consultation is 500 rupees, and booking is free. Would you like me to book a slot for you?' },
    { id: 'n4', kind: 'condition', listen_for: ['human', 'agent', 'person', 'manager', 'complaint', 'refund'], action: 'escalate', reply: 'Of course, let me connect you to a human agent right away.' },
    { id: 'n5', kind: 'condition', listen_for: ['bye', 'goodbye', 'thank you', 'thanks', 'done'], action: 'end', reply: 'Thank you for calling, have a wonderful day!' },
  ],
};
let config = { ...DEFAULT_CONFIG };
try { config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; } catch (e) {}
const saveConfig = () => fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

/* ---------------------------------------------------------------- live call events */
const callState = { current: null, events: [] };

/* ---------------------------------------------------------------- LiveKit JWT (HS256) */
function base64url(b) { return Buffer.from(b).toString('base64url'); }
function livekitJwt(room, identity) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64url(JSON.stringify({
    iss: 'devkey', sub: 'devkey', api_key: 'devkey', exp: now + 7200, nbf: now - 10,
    video: { room, roomJoin: true, roomList: true, roomRecord: false, canPublish: true, canSubscribe: true },
  }));
  const sig = crypto.createHmac('sha256', 'devsecret').update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

/* ---------------------------------------------------------------- daemon manager */
let workerProc = null;
let autoRestart = true;
let shuttingDown = false;

function pidfile() { return fs.existsSync(PID_PATH) ? parseInt(fs.readFileSync(PID_PATH, 'utf8'), 10) : null; }

function startWorker() {
  // hard-replace any stale worker so old code can never mask new code:
  const stale = pidfile();
  if (stale) { try { process.kill(stale, 'SIGKILL'); } catch (e) {} }
  if (workerProc && workerProc.exitCode === null) {
    try { workerProc.kill('SIGKILL'); } catch (e) {}
    workerProc = null;
  }
  const py = path.join(AGENT_DIR, '.venv/bin/python');
  const errLog = fs.openSync(path.join(DATA, 'worker.log'), 'a');
  workerProc = spawn(py, [path.join(AGENT_DIR, 'agent.py')], {
    cwd: AGENT_DIR,
    env: { ...process.env, VOICEAGENT_DATA: DATA, NODE_URL: `http://127.0.0.1:${PORT}`,
      LIVEKIT_URL, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecret' },
    stdio: ['ignore', errLog, errLog],
  });
  fs.writeFileSync(PID_PATH, String(workerProc.pid));
  workerProc.on('exit', () => {
    workerProc = null;
    fs.writeFileSync(PID_PATH, '');
    if (autoRestart && !shuttingDown) setTimeout(startWorker, 1500);
  });
}
function stopWorker(sig, restart) {
  shuttingDown = true;
  const targets = [];
  if (workerProc && workerProc.exitCode === null) targets.push(workerProc.pid);
  const p = pidfile(); if (p) targets.push(p);
  try { for (const t of targets) process.kill(t, sig); } catch (e) {}
  fs.writeFileSync(PID_PATH, '');
  if (restart !== undefined) autoRestart = restart;
  setTimeout(() => {
    try { for (const t of targets) process.kill(t, 'SIGKILL'); } catch (e) {}
    if (workerProc) workerProc = null; // never leave a zombie guarding respawn
    shuttingDown = false;
  }, 1200);
}
function resumeWorker() {
  const p = pidfile();
  if (p) { try { process.kill(p, 0); process.kill(p, 'SIGCONT'); } catch (e) {} }
}
function workerState() {
  const p = pidfile();
  let state = 'stopped';
  if (p) { try { process.kill(p, 0); state = 'running'; } catch (e) { state = 'stopped'; } }
  return { pid: p || null, state };
}
function cleanupStaleWorkers() {
  try {
    require('child_process').execSync('pkill -f "[a]gent/agent.py" 2>/dev/null; pkill -f "[s]ynth_server.py" 2>/dev/null', { timeout: 3000 });
  } catch (e) {}
  fs.writeFileSync(PID_PATH, '');
}

/* ---------------------------------------------------------------- tiny fetch helpers */
function fetchJson(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET', timeout: timeoutMs },
      (res) => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } }); });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}

/* ---------------------------------------------------------------- HTTP server */
function send(res, code, body, type) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, {
    'Content-Type': type || (typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json'),
    'Content-Length': buf.length,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}
function routes(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const method = req.method;

  let bodyChunks = [];
  req.on('data', c => bodyChunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(bodyChunks).toString('utf8');
    let json;
    try { json = body ? JSON.parse(body) : {}; } catch (e) { json = {}; }
    handle(req, res, method, p, url, json);
  });
}

async function handle(req, res, method, p, url, json) {
  /* static */
  if (method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, fs.readFileSync(path.join(ROOT, 'public', 'index.html')), 'text/html');
  if (method === 'GET' && /^\/\w+\.(js|css)$/.test(p)) {
    const f = path.join(ROOT, 'public', path.basename(p));
    if (fs.existsSync(f)) return send(res, 200, fs.readFileSync(f), p.endsWith('.js') ? 'text/javascript' : 'text/css');
  }

  if (p === '/api/status') {
    const [ollama, synth, lk] = await Promise.all([
      fetchJson(`${OLLAMA}/api/tags`), fetchJson(`${SYNTH}/health`, 1500), checkLiveKit(),
    ]);
    return send(res, 200, {
      livekit_up: lk, livekit_url: LIVEKIT_URL, ollama_up: !!(ollama && ollama.models),
      ollama_models: (ollama && ollama.models) ? ollama.models.map(m => m.name) : [],
      synth_up: !!synth, worker: workerState(), auto_restart: autoRestart,
    });
  }
  if (p === '/api/config') {
    if (method === 'GET') return send(res, 200, config);
    if (method === 'PUT') {
      const clean = (v, d) => (typeof v === 'string' && v && v !== 'undefined') ? v : d;
      config = {
        ...DEFAULT_CONFIG, ...config, ...json,
        tts_provider: clean(json.tts_provider ?? config.tts_provider, 'kokoro'),
        tts_voice: clean(json.tts_voice ?? config.tts_voice, 'af_bella'),
        llm: clean(json.llm ?? config.llm, 'qwen2.5:7b-instruct'),
        stt_model: clean(json.stt_model ?? config.stt_model, 'base'),
        language: clean(json.language ?? config.language, 'en'),
        tone: clean(json.tone ?? config.tone, 'warm and professional'),
        welcome: clean(json.welcome ?? config.welcome, DEFAULT_CONFIG.welcome),
      };
      saveConfig(); return send(res, 200, { ok: true, config });
    }
  }
  if (p === '/api/ollama/models') {
    const ollama = await fetchJson(`${OLLAMA}/api/tags`);
    return send(res, 200, (ollama && ollama.models) ? ollama.models : []);
  }
  if (p === '/api/oss') {
    const synth = await fetchJson(`${SYNTH}/health`, 1500);
    const voices = synth ? await fetchJson(`${SYNTH}/voices`, 1500) : null;
    return send(res, 200, { providers: (synth && synth.providers) || [], voices: (voices && voices.voices) || [] });
  }
  if (p === '/api/tts/test' && method === 'POST') {
    const r = await postJson(`${SYNTH}/tts`, JSON.stringify(json));
    if (!r || r.__status !== 200 || !r.__body || r.__body.length === 0) {
      return send(res, 502, { error: 'TTS engine produced no audio — is the TTS service running?' });
    }
    return send(res, 200, r.__body);
  }

  /* daemon */
  if (p === '/api/daemon/start') { autoRestart = true; startWorker(); return send(res, 200, workerState()); }
  if (p === '/api/daemon/stop') { autoRestart = false; stopWorker('SIGTERM'); return send(res, 200, { stopped: true, ...workerState() }); }
  if (p === '/api/daemon/pause') {
    const t = pidfile() || (workerProc && workerProc.pid);
    if (t) { try { process.kill(t, 'SIGSTOP'); } catch (e) {} }
    return send(res, 200, { paused: true, pid: t || null, state: 'paused' });
  }
  if (p === '/api/daemon/resume') {
    const t = pidfile() || (workerProc && workerProc.pid);
    if (t) { try { process.kill(t, 'SIGCONT'); } catch (e) {} }
    return send(res, 200, { resumed: true, pid: t || null, state: 'running' });
  }
  if (p === '/api/daemon/install') {
    const plist = path.join(os.homedir(), 'Library/LaunchAgents/com.kokorovo.daemon.plist');
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.kokorovo.daemon</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${path.join(ROOT, 'server.cjs')}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>StandardOutPath</key><string>${path.join(DATA, 'backend.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(DATA, 'backend.log')}</string>
</dict></plist>`;
    fs.writeFileSync(plist, content);
    require('child_process').exec(`launchctl bootstrap gui/$(id -u) "${plist}" 2>/dev/null; launchctl enable gui/$(id -u)/com.kokorovo.daemon`, () => {});
    return send(res, 200, { ok: true, plist });
  }

  /* token */
  if (p === '/api/token') {
    const room = url.searchParams.get('room') || `demo-${Date.now()}`;
    return send(res, 200, { url: LIVEKIT_URL, room, token: livekitJwt(room, `browser-${Date.now()}`) });
  }

  /* recordings */
  if (p === '/api/recordings') {
    try {
      const calls = {};
      for (const f of fs.readdirSync(REC)) {
        const m = f.match(/^call-([a-zA-Z0-9_]+)(-user|-agent)?\.(wav|txt)$/);
        if (!m) continue;
        const id = m[1];
        calls[id] = calls[id] || { id, started: 0, files: [], transcript: null };
        if (!m[2]) calls[id].transcript = f; else calls[id].files.push(f);
      }
      return send(res, 200, { calls: Object.values(calls).sort((a, b) => b.id.localeCompare(a.id)) });
    } catch (e) { return send(res, 200, { calls: [] }); }
  }
  const tf = p.match(/^\/api\/recordings\/file\/(.+)$/);
  if (tf) {
    const safe = path.basename(decodeURIComponent(tf[1]));
    const fp = path.join(REC, safe);
    if (fs.existsSync(fp)) return send(res, 200, fs.readFileSync(fp), fp.endsWith('.wav') ? 'audio/wav' : 'text/plain; charset=utf-8');
    return send(res, 404, { error: 'missing' });
  }

  /* live bridge */
  if (p === '/api/call/events') {
    if (method === 'POST') { if (json.call_id) callState.current = json.call_id;
      callState.events.push({ ...json, t: Date.now() });
      if (callState.events.length > 600) callState.events.splice(0, callState.events.length - 600);
      return send(res, 200, { ok: true }); }
    if (method === 'DELETE') { callState.events = []; callState.current = null; return send(res, 200, { ok: true }); }
    return send(res, 200, callState);
  }

  return send(res, 404, { error: 'not found' });
}

function postJson(url, dataStr) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', timeout: 60000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dataStr) } },
      (res) => { const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => resolve({ __body: Buffer.concat(ch), __status: res.statusCode })); });
    req.on('timeout', () => { req.destroy(); resolve({ __status: 0 }); });
    req.on('error', () => resolve({ __status: 0 }));
    req.end(dataStr);
  });
}
function checkLiveKit() {
  return new Promise((resolve) => {
    const u = new URL(LIVEKIT_URL.replace(/^ws/, 'http'));
    const req = http.request({ hostname: u.hostname, port: u.port, path: '/', method: 'GET', timeout: 1200 },
      (res) => resolve(true));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

const server = http.createServer((req, res) => routes(req, res));

/* ---------------------------------------------------------------- infra + boot */
function ensureInfra() {
  Promise.resolve(checkLiveKit()).then((lk) => {
    if (!lk) {
      const lkProc = spawn('livekit-server', ['--config', path.join(AGENT_DIR, 'livekit.yaml')], { stdio: 'ignore', detached: true });
      lkProc.unref();
      console.log('[infra] livekit-server spawned');
    }
  });
  fetchJson(`${SYNTH}/health`, 1200).then((s) => {
    if (!s) {
      const py = path.join(AGENT_DIR, '.venv/bin/python');
      const sp = spawn(py, [path.join(AGENT_DIR, 'synth_server.py')], { cwd: AGENT_DIR, env: { ...process.env, VOICEAGENT_DATA: DATA }, stdio: 'ignore', detached: true });
      sp.unref();
      console.log('[infra] synth server spawned');
    }
  });
  cleanupStaleWorkers();
  setTimeout(() => startWorker(), 2000); // 24/7 background daemon
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`KokoroVoice UI + API  =>  http://127.0.0.1:${PORT}`);
  console.log(`LiveKit at ${LIVEKIT_URL} | Ollama at ${OLLAMA} | Synth at ${SYNTH}`);
  ensureInfra();
});