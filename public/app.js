/* KokoroVoice frontend */
const $ = (id) => document.getElementById(id);
const ACTIONS = ['reply', 'book', 'escalate', 'end'];
let config = null;
let livekitToken = null;
let room = null;
let pollTimer = null;

const tabs = document.querySelectorAll('#tabs button');
const TONE_PRESETS = {
  professional: 'poised, articulate and confident',
  friendly: 'warm, upbeat and approachable',
  empathetic: 'warm, compassionate and empathetic',
  energetic: 'cheerful, energetic and upbeat',
  formal: 'polite, formal and courteous',
  custom: '',
};
function tonePresetFor(tone) {
  const t = (tone || '').trim().toLowerCase();
  for (const [k, v] of Object.entries(TONE_PRESETS)) {
    if (v && t === v.toLowerCase()) return k;
  }
  return 'custom';
}
$('cfg-tone-preset').onchange = () => {
  const sel = $('cfg-tone-preset');
  if (sel.value === 'custom') { $('cfg-tone').disabled = false; return; }
  const phrase = TONE_PRESETS[sel.value];
  if (phrase) $('cfg-tone').value = phrase.charAt(0).toUpperCase() + phrase.slice(1);
  $('cfg-tone').disabled = true;
};
tabs.forEach(b => b.addEventListener('click', () => {
  tabs.forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  document.querySelectorAll('.tab').forEach(s => s.classList.remove('active'));
  $('tab-' + b.dataset.tab).classList.add('active');
  if (b.dataset.tab === 'recordings') loadRecordings();
}));

async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('json')) return r.json();
  return r;
}

async function refreshStatus() {
  const st = await api('/api/status');
  setPill('lv-status', st.livekit_up, 'livekit');
  setPill('ollama-status', st.ollama_up, 'ollama ' + (st.ollama_models || []).join(','));
  setPill('synth-status', st.synth_up, 'tts');
  const w = st.worker.state;
  $('worker-status').className = 'pill ' + (w === 'running' ? 'ok' : 'bad');
  $('worker-status').textContent = 'daemon ' + w + (w === 'running' ? ' (pid ' + st.worker.pid + ')' : '');
  if (config === null) {
    config = await api('/api/config');
    renderConfig();
    renderTree();
    await loadOss();
  }
  $('auto-restart').checked = st.auto_restart;
}
function setPill(id, ok, text) {
  const el = $(id);
  el.className = 'pill ' + (ok === null || ok === undefined ? '' : ok ? 'ok' : 'bad');
  el.textContent = text + (ok ? ' ✓' : ok === false ? ' ✗' : '');
}

/* ---------------- config forms ---------------- */
function renderConfig() {
  $('cfg-name').value = config.name; $('cfg-business').value = config.business;
  $('cfg-welcome').value = config.welcome || '';
  const tone = config.tone || '';
  $('cfg-tone').value = tone;
  const preset = tonePresetFor(config.tone);
  $('cfg-tone-preset').value = preset;
  $('cfg-tone').disabled = preset !== 'custom';
  $('cfg-instructions').value = config.instructions || '';
  $('cfg-llm_temp').value = config.llm_temperature;
  $('cfg-stt').value = config.stt_model || 'base';
  $('cfg-speed').value = config.tts_speed || 1.0;
  $('cfg-lang').value = config.language || 'en';
  $('cfg-emotion').value = config.tts_emotion || 'natural';
  $('call-name').textContent = config.name || 'Bella';
  $('call-avatar').textContent = (config.name || 'B')[0].toUpperCase();
}
function readConfigFromDom() {
  config.name = $('cfg-name').value || 'Bella';
  config.business = $('cfg-business').value || 'your business';
  config.welcome = $('cfg-welcome').value;
  config.tone = $('cfg-tone').value || 'warm and professional';
  config.instructions = $('cfg-instructions').value || '';
  config.llm_temperature = parseFloat($('cfg-llm_temp').value) || 0.5;
  config.stt_model = $('cfg-stt').value;
  config.tts_speed = parseFloat($('cfg-speed').value) || 1.0;
  config.language = $('cfg-lang').value;
  config.tts_emotion = $('cfg-emotion').value;
  if ($('cfg-llm').value) config.llm = $('cfg-llm').value;
  if ($('cfg-tts').value) config.tts_provider = $('cfg-tts').value;
  if ($('cfg-voice').value) config.tts_voice = $('cfg-voice').value;
}

function renderTree() {
  const wrap = $('tree');
  wrap.innerHTML = '';
  (config.tree || []).forEach((node, i) => { wrap.appendChild(nodeRow(node, i)); });
}
function nodeRow(node, i) {
  const div = document.createElement('div');
  div.className = 'tnode';
  div.innerHTML = `
    <div class="row">
      <input type="text" placeholder="trigger / keyword it should notice" value="${(node.listen_for || []).join(', ')}" />
      <select class="a">${ACTIONS.map(a => `<option ${node.action === a ? 'selected' : ''}>${a}</option>`).join('')}</select>
      <button class="mini del">✕</button>
    </div>
    <input type="text" class="msg wide" placeholder="what the agent should say here" value="${(node.message || '').replace(/"/g, '&quot;')}" />
    <input type="text" class="reply wide" placeholder="answer to use for this action" value="${(node.reply || '').replace(/"/g, '&quot;')}" style="margin-top:8px" />
    <small>Rule ${i + 1} · message is spoken when the trigger matches · answer is what the agent says</small>`;
  div.querySelector('.del').onclick = () => { config.tree.splice(i, 1); renderTree(); };
  return div;
}
function collectTree() {
  const nodes = [...document.querySelectorAll('#tree .tnode')].map((div, i) => {
    const msg = div.querySelector('.msg').value.trim();
    const reply = div.querySelector('.reply').value.trim();
    const listen_for = div.querySelector('input[placeholder^="trigger"]').value.split(',').map(s => s.trim()).filter(Boolean);
    const action = div.querySelector('.a').value;
    return { id: 'n' + (i + 1), kind: 'condition', message: msg, reply, listen_for, action };
  });
  config.tree = nodes;
}

$('btn-add-node').onclick = () => {
  config.tree = config.tree || [];
  config.tree.push({ id: 'n' + (config.tree.length + 1), kind: 'condition', message: '', reply: '', listen_for: [], action: 'reply' });
  renderTree();
};
$('btn-save-config').onclick = async () => {
  readConfigFromDom(); collectTree();
  await api('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
  flash('Saved decision flow + settings. Next call uses them.');
};
$('btn-save-voice').onclick = $('btn-save-config').onclick;

/* ---------------- models / oss ---------------- */
async function loadOss() {
  const oss = await api('/api/oss');
  const llmSel = $('cfg-llm');
  const st = await api('/api/status');
  const models = st.ollama_models || [];
  llmSel.innerHTML = models.map(m => `<option ${config.llm === m ? 'selected' : ''}>${m}</option>`).join('') || '<option>no models</option>';
  const ttsSel = $('cfg-tts');
  const normP = p => (typeof p === 'string' ? { key: p, name: p } : (p || {}));
  const provs = (oss.providers || []).map(normP);
  ttsSel.innerHTML = provs.map(p =>
    `<option value="${p.key}" ${config.tts_provider === p.key ? 'selected' : ''}>${p.name || p.key}</option>`).join('') || '<option value="kokoro">kokoro</option>';
  if (window.availableVoices === undefined) window.availableVoices = oss.voices || [];
  fillVoices(config.tts_provider, config.tts_voice);
  renderProviderInfo(provs);
}
function fillVoices(provider, selected) {
  const sel = $('cfg-voice');
  const voices = window.availableVoices || [];
  if (voices.length === 0) { sel.innerHTML = '<option value="af_heart">af_heart</option>'; return; }
  sel.innerHTML = voices.map(v =>
    `<option value="${v.id}" ${(selected || 'af_heart') === v.id ? 'selected' : ''}>${v.label} (${v.accent || v.lang || ''})</option>`).join('');
}
$('cfg-tts').onchange = (e) => fillVoices(e.target.value, 'af_heart');
function renderProviderInfo(providers) {
  const norm = (providers || []).map(p => typeof p === 'string' ? { name: p, key: p, installed: true } : (p || {}));
  $('provider-info').textContent = 'TTS engines available:\n' + norm.map(p =>
    `• ${p.name || p.key || p.id}${p.installed ? ' — installed' : ' — NOT installed  →  ' + (p.install || '?')}`).join('\n');
}

/* voice test */
$('btn-test-voice').onclick = async () => {
  readConfigFromDom();
  const text = $('tts-text').value || 'Hello, this is a test of my voice.';
  const btn = $('btn-test-voice'); btn.disabled = true; btn.textContent = 'synthesizing…';
  try {
    const r = await fetch('/api/tts/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: config.tts_voice, provider: config.tts_provider, speed: config.tts_speed, lang: config.language, emotion: config.tts_emotion }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      throw new Error((j && (j.error || j.detail)) || 'HTTP ' + r.status);
    }
    const blob = await r.blob();
    if (!blob || blob.size === 0) throw new Error('synthesis returned no audio (is the TTS service running?)');
    const url = URL.createObjectURL(blob);
    const audio = $('tts-audio');
    audio.src = url; audio.controls = true; audio.autoplay = true; audio.style.display = 'block';
    audio.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const secs = (blob.size / 48000).toFixed(1) + 's';  // 24k mono 16-bit
    try { await audio.play(); flashHint(`voice synthesized (${secs}) — press play on the bar above if it didn't start`); }
    catch (e) { flashHint(`voice synthesized (${secs}) — press the play button on the audio bar`); }
  } catch (e) { alert('TTS failed: ' + e.message); }
  btn.disabled = false; btn.textContent = '▶ Test voice';
};

/* ---------------- call studio ---------------- */
const lk = window.LivekitClient;
$('btn-call').onclick = async () => {
  if (!lk) { alert('livekit-client failed to load from CDN'); return; }
  const tok = await api('/api/token?room=call-' + Math.floor(Math.random() * 1e6));
  livekitToken = tok;
  room = new lk.Room({ adaptiveStream: true, dynacast: true, stopLocalTrackOnUnpublish: false });
  room.on(lk.RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === 'audio') {
      const el = track.attach(); el.volume = 1.0; el.play().catch(() => {});
      setCallState('in call');
    }
  });
  room.on(lk.RoomEvent.Disconnected, () => { setCallState('disconnected'); setAvatar(false); });
  room.on(lk.RoomEvent.ParticipantConnected, () => {});
  await room.connect(tok.url, tok.token);
  const mic = await lk.createLocalAudioTrack();
  window.__lstmic = mic;
  await room.localParticipant.publishTrack(mic);
  setCallState('connecting…'); setAvatar(true);
  $('btn-call').disabled = true; $('btn-hangup').disabled = false;
  startLevelMeter();
  pollEvents(true);
  addEvent('sys', 'call', `connected to ${tok.room}`);
};
$('btn-hangup').onclick = async () => {
  if (room) { await room.disconnect(); room = null; }
  window.__lstmic = null;
  $('btn-call').disabled = false; $('btn-hangup').disabled = true;
  setAvatar(false); setCallState('idle'); pollEvents(false);
};
function setCallState(s) { $('call-state').textContent = s; }
function setAvatar(on) { $('call-avatar').classList.toggle('on', on); }

let meterTrack = null;
async function startLevelMeter() {
  const bars = [...document.querySelectorAll('#level span')];
  let stream = null, borrowed = false;
  try {
    const t = window.__lstmic && window.__lstmic.mediaStreamTrack;
    stream = t ? new MediaStream([t]) : await navigator.mediaDevices.getUserMedia({ audio: true });
    borrowed = !!t;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser(); analyser.fftSize = 256;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    (function tick() {
      analyser.getByteFrequencyData(data);
      let avg = 0; for (let i = 0; i < data.length; i++) avg += data[i];
      avg = avg / data.length / 255;
      const n = Math.round(avg * bars.length);
      bars.forEach((b, i) => b.classList.toggle('on', i < n));
      if (room && room.state !== 'disconnected') requestAnimationFrame(tick);
      else bars.forEach(b => b.classList.remove('on'));
    })();
    if (!borrowed && stream) stream.getTracks().forEach(t => t.stop());
  } catch (e) {}
}

/* live events */
function pollEvents(on) {
  clearInterval(pollTimer); pollTimer = null;
  if (!on) return;
  let lastT = 0, curCall = null;
  pollTimer = setInterval(async () => {
    try {
      const ev = await api('/api/call/events');
      const list = ev.events || [];
      const activeCall = ev.current || (list.length ? list[list.length - 1].call_id : null);
      if (activeCall && activeCall !== curCall) { curCall = activeCall; lastT = 0; if (list.length) setCallState('connected — listening…'); }
      (list || []).filter(e => (!activeCall || e.call_id === activeCall) && e.t > lastT).forEach(e => {
        lastT = e.t;
        if (e.type === 'transcript') {
          const you = e.speaker === 'user';
          addEvent(you ? 'user' : 'agent', you ? 'You' : 'Bella', e.text);
          setCallState(you ? 'you said: ' + (e.text.length > 40 ? e.text.slice(0, 40) + '…' : e.text) : 'Bella answering…');
        } else if (e.type === 'state') {
          const you = String(e.party || '').toLowerCase().includes('user');
          if (e.state === 'speaking') { setCallState(you ? '🎙 you are speaking…' : '🔊 Bella speaking…'); setAvatar(!you); }
          else if (e.state === 'thinking') { setCallState('💭 Bella is thinking…'); }
          else if (e.state === 'listening' || e.state === 'idle') { setCallState(you ? 'waiting for Bella…' : '👂 listening for you…'); setAvatar(false); }
          else if (e.state === 'away') { setCallState('waiting for you to speak…'); setAvatar(false); }
          else setCallState(String(e.state).replace(/_/g, ' '));
        } else if (e.type === 'action') addEvent('note', '▲', 'decision: ' + e.action);
        else if (e.type === 'sys') addEvent('sys', 'sys', e.text);
      });
    } catch (e) {}
  }, 800);
}
function addEvent(kind, spk, text) {
  const body = $('transcript-body');
  if (body.querySelector('.empty')) body.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'msg ' + kind;
  div.innerHTML = `<span class="spk">${spk}</span> ${escapeHtml(text)}`;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
let hintTimer = null;
function flashHint(msg) {
  let el = $('toast-hint');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-hint';
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#16233b;color:#dfe8f7;border:1px solid #2c3f63;padding:10px 16px;border-radius:10px;font-size:13px;z-index:999;box-shadow:0 6px 24px rgba(0,0,0,.35);transition:opacity .3s;';
    document.body.appendChild(el);
  }
  el.textContent = msg; el.style.opacity = '1';
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { el.style.opacity = '0'; }, 3500);
}
$('btn-clear-events').onclick = async () => { await api('/api/call/events', { method: 'DELETE' }); $('transcript-body').innerHTML = '<div class="empty">No active call yet.</div>'; };

/* ---------------- recordings ---------------- */
async function loadRecordings() {
  const rec = await api('/api/recordings');
  const wrap = $('recordings');
  if (!rec.calls || rec.calls.length === 0) { wrap.innerHTML = '<div class="empty">No recordings yet.</div>'; return; }
  wrap.innerHTML = '';
  for (const c of rec.calls) {
    const card = document.createElement('div');
    card.className = 'rec-card';
    let aud = '';
    for (const f of c.files) aud += `<audio controls src="/api/recordings/file/${f}"></audio>`;
    let tx = '';
    if (c.transcript) {
      const txt = await api('/api/recordings/file/' + c.transcript);
      tx = `<h4>Call ${c.transcript.replace(/^call-/, '').replace(/\.txt$/, '')}</h4>${aud}<pre>${escapeHtml(String(txt))}</pre>`;
    } else {
      tx = `<h4>Call ${c.id}</h4>${aud}<div class="empty">no transcript</div>`;
    }
    card.innerHTML = tx;
    wrap.appendChild(card);
  }
}
$('btn-refresh-rec').onclick = loadRecordings;

/* ---------------- daemon ---------------- */
$('daemon-start').onclick = async () => { await api('/api/daemon/start'); flash('daemon started'); refreshStatus(); };
$('daemon-stop').onclick = async () => { await api('/api/daemon/stop'); flash('daemon stopped'); refreshStatus(); };
$('daemon-pause').onclick = async () => { await api('/api/daemon/pause'); flash('daemon paused (SIGSTOP)'); refreshStatus(); };
$('daemon-resume').onclick = async () => { await api('/api/daemon/resume'); flash('daemon resumed (SIGCONT)'); refreshStatus(); };
$('auto-restart').onchange = async (e) => { if (!e.target.checked) await api('/api/daemon/stop'); else await api('/api/daemon/start'); };
$('daemon-install').onclick = async () => { const r = await api('/api/daemon/install', { method: 'POST' }); flash(r.ok ? 'launchd installed — starts at login' : 'failed'); };

let flashTimer = null;
function flash(msg) {
  const log = $('daemon-log');
  log.textContent = new Date().toLocaleTimeString() + '  ' + msg + '\n' + log.textContent;
  clearTimeout(flashTimer);
}
setInterval(refreshStatus, 4000);
refreshStatus();