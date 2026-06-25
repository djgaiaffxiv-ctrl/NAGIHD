// NAGIHD — renderer · © 2026 NAGI STUDIOS
const $ = (s) => document.querySelector(s);

/* Estado */
const state = {
  input: null,
  info: null,
  mode: 'anime',
  targetH: 1080,
  interpolate: false,
  enc: 'nvenc',
  quality: 17,
  sharpen: 0.9,
  denoise: false,
  codec: 'h264',
  busy: false
};

const MODE_HINTS = {
  anime: 'Modelo anime: bordes nítidos, colores planos limpios. Ideal para dibujos y animación.',
  real: 'Modelo general: limpia ruido y define detalle en grabaciones reales (x4).',
  gameplay: 'Modelo rápido tipo vídeo: nitidez para clips de juegos y capturas.'
};

/* Controles de ventana */
$('#min').onclick = () => window.nagi.minimize();
$('#max').onclick = () => window.nagi.maximize();
$('#close').onclick = () => window.nagi.close();

/* Comprobar motores */
async function checkEngines() {
  const e = await window.nagi.checkEngines();
  const banner = $('#engineBanner');
  if (!e.realesrgan || (state.interpolate && !e.rife)) {
    banner.classList.remove('hidden');
    $('#engineMsg').textContent = !e.realesrgan
      ? 'Faltan los motores de IA. Ejecuta  npm run fetch-bin  para instalarlos en bin\\.'
      : 'Falta el motor RIFE (fluidez). Ejecuta  npm run fetch-bin.';
  } else {
    banner.classList.add('hidden');
  }
  return e;
}
$('#installBtn').onclick = () => window.nagi.openBin();

/* Cargar vídeo */
async function loadVideo(file) {
  if (!file) return;
  const res = await window.nagi.probe(file);
  if (!res.ok) { alert('No se pudo leer el vídeo:\n' + res.error); return; }
  state.input = file;
  state.info = res.info;
  showWork();
  // Miniatura real (asíncrona, no bloquea)
  const thumb = $('#thumb');
  thumb.style.backgroundImage = '';
  thumb.textContent = '🎬';
  const at = Math.min(res.info.duration / 2 || 1, 3);
  window.nagi.thumb(file, at).then(url => {
    if (url && state.input === file) { thumb.style.backgroundImage = `url("${url}")`; thumb.textContent = ''; }
  });
}

function showWork() {
  $('#dropZone').classList.add('hidden');
  $('#progressPanel').classList.add('hidden');
  $('#resultPanel').classList.add('hidden');
  $('#workPanel').classList.remove('hidden');

  const i = state.info;
  $('#fname').textContent = state.input.split(/[\\/]/).pop();
  $('#fname').title = state.input;
  const mins = Math.floor(i.duration / 60), secs = Math.round(i.duration % 60);
  $('#specs').textContent = `${i.width}×${i.height} · ${i.fps} fps · ${mins}:${String(secs).padStart(2,'0')} · ${i.hasAudio ? 'con audio' : 'sin audio'}`;
  updateResHint();
}

function updateResHint() {
  const i = state.info; if (!i) return;
  const factor = (state.targetH / i.height).toFixed(2);
  const outW = Math.round(i.width * state.targetH / i.height / 2) * 2;
  let extra = '';
  if (state.targetH <= i.height) extra = ' ⚠ La salida no es mayor que el original.';
  else if (state.targetH / i.height > 2.6) extra = ' 💡 Salto grande: 1080p/1440p suele verse más nítido que 4K en fuentes pequeñas.';
  $('#resHint').textContent = `${i.width}×${i.height} → ${outW}×${state.targetH}  (×${factor})${extra}`;
}

/* Selección de archivo */
$('#pickBtn').onclick = pick;
$('#changeBtn').onclick = pick;
async function pick() {
  const f = await window.nagi.importVideo();
  if (f) loadVideo(f);
}

/* Deslizador de comparación reutilizable (portada + resultado) */
function attachSlider(card, withIntro) {
  if (!card || card._sliderReady) return;
  card._sliderReady = true;
  let dragging = false;
  const setX = (clientX) => {
    const r = card.getBoundingClientRect();
    let p = (clientX - r.left) / r.width;
    p = Math.max(0.04, Math.min(0.96, p));
    card.style.setProperty('--x', (p * 100) + '%');
  };
  const down = (e) => { dragging = true; if (card._stopIntro) card._stopIntro(); setX((e.touches ? e.touches[0] : e).clientX); e.preventDefault(); };
  const move = (e) => { if (dragging) setX((e.touches ? e.touches[0] : e).clientX); };
  const up = () => { dragging = false; };
  card.addEventListener('mousedown', down);
  card.addEventListener('touchstart', down, { passive: false });
  window.addEventListener('mousemove', move);
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', up);
  window.addEventListener('touchend', up);
  if (withIntro) {
    let t = 0, intro = setInterval(() => {
      t += 0.04;
      card.style.setProperty('--x', (50 + Math.sin(t) * 26) + '%');
      if (t > Math.PI * 2) { clearInterval(intro); card.style.setProperty('--x', '50%'); }
    }, 30);
    card._stopIntro = () => { clearInterval(intro); };
  }
}
attachSlider($('#baCard'), true);

/* Drag & drop */
const dz = $('#dropZone');
['dragenter','dragover'].forEach(ev => document.addEventListener(ev, (e) => {
  e.preventDefault(); if (!state.busy) dz.classList.add('hover');
}));
['dragleave','drop'].forEach(ev => document.addEventListener(ev, (e) => {
  e.preventDefault(); dz.classList.remove('hover');
}));
document.addEventListener('drop', (e) => {
  if (state.busy) return;
  const f = e.dataTransfer.files[0];
  if (f && f.path) loadVideo(f.path);
});

/* Segmentos: modo, resolución, encoder */
function wireSeg(sel, attr, key, after) {
  document.querySelectorAll(`${sel} button`).forEach(b => {
    b.onclick = () => {
      document.querySelectorAll(`${sel} button`).forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const v = b.dataset[attr];
      state[key] = isNaN(+v) ? v : +v;
      if (after) after(v);
    };
  });
}
wireSeg('#modeSeg', 'mode', 'mode', (v) => { $('#modeHint').textContent = MODE_HINTS[v]; saveSettings(); });
wireSeg('#resSeg', 'h', 'targetH', () => { updateResHint(); saveSettings(); });
wireSeg('#encSeg', 'enc', 'enc', () => saveSettings());
wireSeg('#codecSeg', 'codec', 'codec', (v) => {
  $('#codecHint').textContent = v === 'h265'
    ? 'H.265: ~40% menos tamaño, ideal para 4K (algo menos compatible).'
    : 'H.264: reproducible en cualquier sitio.';
  saveSettings();
});

/* Interpolación + denoise */
$('#interpChk').onchange = (e) => { state.interpolate = e.target.checked; checkEngines(); saveSettings(); };
$('#denoiseChk').onchange = (e) => { state.denoise = e.target.checked; saveSettings(); };

/* Calidad */
$('#quality').oninput = (e) => { state.quality = +e.target.value; $('#qVal').textContent = e.target.value; saveSettings(); };

/* Nitidez extra (0–200% → unsharp 0–2.0) */
const SHARP_LABEL = (v) => v === 0 ? 'Off' : v < 60 ? 'Suave' : v < 120 ? 'Media' : v < 170 ? 'Alta' : 'Máx';
$('#sharpen').oninput = (e) => {
  const v = +e.target.value;
  state.sharpen = v / 100;
  $('#sVal').textContent = SHARP_LABEL(v);
  saveSettings();
};

/* Persistencia de ajustes */
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { mode, targetH, interpolate, enc, quality, sharpen, denoise, codec } = state;
    window.nagi.setSettings({ mode, targetH, interpolate, enc, quality, sharpen, denoise, codec });
  }, 300);
}
function setSeg(sel, attr, val) {
  document.querySelectorAll(`${sel} button`).forEach(b => {
    b.classList.toggle('active', b.dataset[attr] === String(val));
  });
}
async function loadSettings() {
  const s = await window.nagi.getSettings();
  if (!s || typeof s !== 'object') return;
  Object.assign(state, s);
  // Reflejar en la UI
  setSeg('#modeSeg', 'mode', state.mode);
  setSeg('#resSeg', 'h', state.targetH);
  setSeg('#encSeg', 'enc', state.enc);
  setSeg('#codecSeg', 'codec', state.codec);
  $('#interpChk').checked = !!state.interpolate;
  $('#denoiseChk').checked = !!state.denoise;
  $('#quality').value = state.quality; $('#qVal').textContent = state.quality;
  const sv = Math.round((state.sharpen || 0) * 100);
  $('#sharpen').value = sv; $('#sVal').textContent = SHARP_LABEL(sv);
  $('#modeHint').textContent = MODE_HINTS[state.mode] || '';
}

/* Iniciar (job completo o vista previa de 10s) */
async function runJob(preview) {
  const eng = await checkEngines();
  if (!eng.realesrgan) { alert('Primero instala los motores de IA (npm run fetch-bin).'); return; }
  if (state.interpolate && !eng.rife) { alert('Falta el motor RIFE para la fluidez.'); return; }

  let out = null;
  if (!preview) {
    const defName = state.input.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') + `_${state.targetH}p.mp4`;
    out = await window.nagi.saveOutput(defName);
    if (!out) return;
  }

  state.busy = true;
  showProgress(preview);

  const cfg = {
    input: state.input,
    output: out,
    mode: state.mode,
    targetH: state.targetH,
    interpolate: state.interpolate,
    targetFps: state.interpolate ? Math.min(120, Math.round(state.info.fps * 2)) : 0,
    useNvenc: state.enc === 'nvenc',
    quality: state.quality,
    sharpen: state.sharpen,
    denoise: state.denoise,
    hevc: state.codec === 'h265',
    previewSeconds: preview ? 10 : 0
  };

  const res = await window.nagi.startJob(cfg);
  state.busy = false;

  if (res.ok) {
    showResult(true, res.output, res.outInfo, null, res.preview);
  } else if (res.cancelled) {
    showWork();
  } else {
    showResult(false, null, null, res.error);
  }
}
$('#startBtn').onclick = () => runJob(false);
$('#previewBtn').onclick = () => runJob(true);

/* Progreso */
let progressUnsub = null;
function showProgress(preview) {
  $('#workPanel').classList.add('hidden');
  $('#resultPanel').classList.add('hidden');
  $('#progressPanel').classList.remove('hidden');
  $('#progTitle').textContent = preview ? 'Generando vista previa (10s)…' : 'Procesando…';
  $('#barFill').style.width = '0%';
  $('#progPct').textContent = '0%';
  $('#progLabel').textContent = 'Iniciando…';
  $('#stEta').textContent = '—'; $('#stFrames').textContent = '—';
  $('#stFps').textContent = '—'; $('#stElapsed').textContent = '0:00';
  document.querySelectorAll('.phases span').forEach(s => s.classList.remove('active','done'));

  if (progressUnsub) progressUnsub();
  progressUnsub = window.nagi.onProgress((d) => {
    $('#barFill').style.width = d.overall + '%';
    $('#progPct').textContent = d.overall + '%';
    $('#progLabel').textContent = d.label;
    if (d.eta != null) $('#stEta').textContent = '~' + fmtTime(d.eta);
    else if (d.overall >= 100) $('#stEta').textContent = '¡listo!';
    $('#stFrames').textContent = d.fdone ? `${d.fdone}/${d.ftotal}` : '—';
    $('#stFps').textContent = d.fps ? `${d.fps} fps` : '—';
    if (d.elapsed != null) $('#stElapsed').textContent = fmtTime(d.elapsed);
    const order = ['extract','upscale','interp','encode'];
    const idx = order.indexOf(d.phase);
    document.querySelectorAll('.phases span').forEach(s => {
      const si = order.indexOf(s.dataset.p);
      s.classList.toggle('active', s.dataset.p === d.phase);
      s.classList.toggle('done', idx > si && si !== -1);
    });
    if (d.phase === 'done') document.querySelectorAll('.phases span').forEach(s => s.classList.add('done'));
  });
}

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

$('#cancelBtn').onclick = async () => {
  $('#cancelBtn').textContent = 'Cancelando…';
  $('#cancelBtn').disabled = true;
  await window.nagi.cancelJob();
  setTimeout(() => { $('#cancelBtn').textContent = 'Cancelar'; $('#cancelBtn').disabled = false; }, 500);
};

/* Resultado */
function showResult(ok, out, outInfo, error, isPreview) {
  $('#progressPanel').classList.add('hidden');
  $('#resultPanel').classList.remove('hidden');
  if (ok) {
    $('#resultIcon').textContent = isPreview ? '👁' : '✅';
    $('#resultTitle').textContent = isPreview ? 'Vista previa lista (10s)' : '¡Vídeo mejorado!';
    let msg = isPreview ? 'Muestra de 10s con tus ajustes actuales' : out.split(/[\\/]/).pop();
    if (outInfo) msg += `  ·  ${outInfo.width}×${outInfo.height} @ ${outInfo.fps} fps`;
    $('#resultMsg').textContent = msg;
    $('#playBtn').innerHTML = isPreview ? '<span class="wb-ico">▶</span> VER MUESTRA' : '<span class="wb-ico">▶</span> VER VÍDEO';
    $('#playBtn').classList.remove('hidden');
    $('#revealBtn').classList.toggle('hidden', !!isPreview);
    $('#playBtn').onclick = () => window.nagi.play(out);
    $('#revealBtn').onclick = () => window.nagi.reveal(out);
    $('#againBtn').textContent = isPreview ? 'Ajustar y reprobar' : 'Mejorar otro';
    loadComparison(out, outInfo);
  } else {
    $('#resultIcon').textContent = '⚠';
    $('#resultTitle').textContent = 'No se pudo completar';
    $('#resultMsg').textContent = error || 'Error desconocido.';
    $('#playBtn').classList.add('hidden');
    $('#revealBtn').classList.add('hidden');
    $('#cmpWrap').classList.add('hidden');
  }
}

/* Comparador real: mismo fotograma del original vs la salida mejorada */
async function loadComparison(out, outInfo) {
  const wrap = $('#cmpWrap');
  wrap.classList.add('hidden');
  if (!state.input || !out || !state.info) return;
  const at = Math.min((state.info.duration || 6) / 2, 6);
  let r;
  try { r = await window.nagi.compare(state.input, out, at); } catch (_) { return; }
  if (!r || !r.before || !r.after) return;
  if (outInfo && outInfo.width && outInfo.height) {
    $('#cmpCard').style.aspectRatio = `${outInfo.width} / ${outInfo.height}`;
  }
  $('#cmpBefore').src = r.before;
  $('#cmpAfter').src = r.after;
  $('#cmpCard').style.setProperty('--x', '50%');
  attachSlider($('#cmpCard'), false);
  wrap.classList.remove('hidden');
}
$('#againBtn').onclick = () => { state.input ? showWork() : reset(); };
function reset() {
  $('#resultPanel').classList.add('hidden');
  $('#workPanel').classList.add('hidden');
  $('#dropZone').classList.remove('hidden');
}

/* Init */
$('#modeHint').textContent = MODE_HINTS.anime;
loadSettings();
checkEngines();
