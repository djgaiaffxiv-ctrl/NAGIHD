// NAGIHD — main process
// © 2026 NAGI STUDIOS
// Mejora de vídeo con IA: Real-ESRGAN (escalado) + RIFE (fluidez) + FFmpeg.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');

// Una sola instancia: evita que dos copias peleen por la caché GPU.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); }
  });
}
// Silencia los errores de caché de disco GPU/HTTP de Chromium (no afectan al render).
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');

/* ---------- Binarios ---------- */
function fixAsar(p) {
  return p ? p.replace('app.asar', 'app.asar.unpacked') : p;
}
let ffmpegPath = fixAsar(require('ffmpeg-static'));
let ffprobePath = fixAsar(require('ffprobe-static').path);

// bin/ con los motores de IA: en dev vive junto al proyecto; empaquetado, en resources/bin
function binRoot() {
  const packaged = path.join(process.resourcesPath || '', 'bin');
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, 'bin');
}
function realesrganExe() {
  return path.join(binRoot(), 'realesrgan', 'realesrgan-ncnn-vulkan.exe');
}
function realesrganModels() {
  return path.join(binRoot(), 'realesrgan', 'models');
}
function rifeExe() {
  return path.join(binRoot(), 'rife', 'rife-ncnn-vulkan.exe');
}
function rifeModelDir() {
  // El zip de RIFE trae varias carpetas de modelo; preferimos rife-v4.6, si no la primera rife-*.
  const root = path.join(binRoot(), 'rife');
  const prefer = path.join(root, 'rife-v4.6');
  if (fs.existsSync(prefer)) return prefer;
  try {
    const cand = fs.readdirSync(root)
      .filter(d => d.startsWith('rife-') && fs.statSync(path.join(root, d)).isDirectory());
    if (cand.length) return path.join(root, cand.sort().reverse()[0]);
  } catch (_) {}
  return prefer;
}

let mainWin = null;
let currentJob = null; // { procs: [], cancelled: bool, workDir }

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: '#0a0712',
    title: 'NAGIHD',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWin.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  // Auto-update (solo empaquetado)
  if (app.isPackaged) initAutoUpdate();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ---------- Auto-update ---------- */
function initAutoUpdate() {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-downloaded', async () => {
      const r = await dialog.showMessageBox(mainWin, {
        type: 'info',
        buttons: ['Reiniciar ahora', 'Más tarde'],
        defaultId: 0,
        title: 'NAGIHD',
        message: 'Hay una nueva versión lista.',
        detail: '¿Reiniciar para instalarla?'
      });
      if (r.response === 0) autoUpdater.quitAndInstall();
    });
    autoUpdater.on('error', () => {}); // silencioso
    autoUpdater.checkForUpdates();
  } catch (_) {}
}

/* ---------- Window controls ---------- */
ipcMain.on('win:minimize', () => mainWin && mainWin.minimize());
ipcMain.on('win:maximize', () => {
  if (!mainWin) return;
  if (mainWin.isMaximized()) mainWin.unmaximize();
  else mainWin.maximize();
});
ipcMain.on('win:close', () => mainWin && mainWin.close());

/* ---------- Diagnóstico de motores ---------- */
ipcMain.handle('engines:check', async () => {
  return {
    realesrgan: fs.existsSync(realesrganExe()),
    rife: fs.existsSync(rifeExe()),
    ffmpeg: !!ffmpegPath && fs.existsSync(ffmpegPath)
  };
});

ipcMain.handle('shell:openBin', async () => {
  const dir = binRoot();
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
  return dir;
});

/* ---------- Diálogos de archivo ---------- */
ipcMain.handle('dialog:import', async () => {
  const res = await dialog.showOpenDialog(mainWin, {
    title: 'Elegir vídeo a mejorar',
    properties: ['openFile'],
    filters: [
      { name: 'Vídeo', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv', 'mpg', 'mpeg', 'ts'] },
      { name: 'Todos', extensions: ['*'] }
    ]
  });
  if (res.canceled) return null;
  return res.filePaths[0];
});

ipcMain.handle('dialog:saveOutput', async (e, defName) => {
  const res = await dialog.showSaveDialog(mainWin, {
    title: 'Guardar vídeo mejorado',
    defaultPath: defName || 'nagihd_mejorado.mp4',
    filters: [{ name: 'Vídeo MP4', extensions: ['mp4'] }]
  });
  if (res.canceled) return null;
  return res.filePath;
});

/* ---------- ffprobe ---------- */
function ffprobe(file) {
  return new Promise((resolve, reject) => {
    execFile(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,width,height,avg_frame_rate,nb_frames,duration',
      '-of', 'json', file
    ], { maxBuffer: 1024 * 1024 * 32 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        const data = JSON.parse(stdout);
        const streams = data.streams || [];
        const v = streams.find(s => s.codec_type === 'video');
        const a = streams.find(s => s.codec_type === 'audio');
        let fps = 30;
        if (v && v.avg_frame_rate && v.avg_frame_rate !== '0/0') {
          const [n, d] = v.avg_frame_rate.split('/').map(Number);
          if (d) fps = n / d;
        }
        const dur = parseFloat((data.format && data.format.duration) || (v && v.duration) || 0);
        let frames = v && v.nb_frames ? parseInt(v.nb_frames, 10) : 0;
        if (!frames && isFinite(dur) && isFinite(fps)) frames = Math.round(dur * fps);
        resolve({
          duration: isFinite(dur) ? dur : 0,
          width: v ? v.width : 0,
          height: v ? v.height : 0,
          fps: isFinite(fps) ? Math.round(fps * 1000) / 1000 : 30,
          frames,
          hasVideo: !!v,
          hasAudio: !!a
        });
      } catch (e2) { reject(e2); }
    });
  });
}

ipcMain.handle('media:probe', async (e, file) => {
  try { return { ok: true, info: await ffprobe(file) }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});

/* ---------- Ajustes persistentes ---------- */
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
ipcMain.handle('settings:get', async () => {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); }
  catch (_) { return {}; }
});
ipcMain.handle('settings:set', async (e, data) => {
  try { fs.writeFileSync(settingsPath(), JSON.stringify(data || {}, null, 2)); return true; }
  catch (_) { return false; }
});

/* ---------- Miniatura del vídeo cargado ---------- */
ipcMain.handle('media:thumb', async (e, file, atSec) => {
  return new Promise((resolve) => {
    const out = path.join(os.tmpdir(), `nagihd_thumb_${Date.now()}.jpg`);
    const ss = String(Math.max(0, atSec || 1));
    execFile(ffmpegPath, ['-y', '-ss', ss, '-i', file, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', out],
      { timeout: 20000 }, (err) => {
        if (err || !fs.existsSync(out)) return resolve(null);
        try {
          const b64 = fs.readFileSync(out).toString('base64');
          fs.unlinkSync(out);
          resolve('data:image/jpeg;base64,' + b64);
        } catch (_) { resolve(null); }
      });
  });
});

/* ---------- Extrae un fotograma a PNG (para el comparador del resultado) ---------- */
function extractFrame(file, atSec, label) {
  return new Promise((resolve) => {
    const out = path.join(os.tmpdir(), `nagihd_cmp_${label}_${Date.now()}.png`);
    execFile(ffmpegPath, ['-y', '-ss', String(Math.max(0, atSec || 1)), '-i', file, '-frames:v', '1', out],
      { timeout: 30000 }, (err) => {
        if (err || !fs.existsSync(out)) return resolve(null);
        try {
          const b64 = fs.readFileSync(out).toString('base64');
          fs.unlinkSync(out);
          resolve('data:image/png;base64,' + b64);
        } catch (_) { resolve(null); }
      });
  });
}
// Compara: mismo instante del original (escalado por el navegador) vs la salida mejorada.
ipcMain.handle('media:compare', async (e, original, enhanced, atSec) => {
  const [a, b] = await Promise.all([
    extractFrame(original, atSec, 'src'),
    extractFrame(enhanced, atSec, 'out')
  ]);
  return { before: a, after: b };
});

/* ---------- Utilidades de proceso ----------
 * opts.stallMs: si pasa ese tiempo sin NINGUNA salida del proceso, se considera
 * bloqueado (p.ej. Real-ESRGAN sin VRAM) → se mata y se rechaza con un mensaje útil. */
function runProc(exe, args, opts, onLine) {
  opts = opts || {};
  const stallMs = opts.stallMs || 0;
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, opts);
    if (currentJob) currentJob.procs.push(p);
    let errBuf = '';
    let stalled = false;
    let abortReason = null;
    let watchdog = null;
    // El callback onLine puede pedir abortar el proceso con un motivo concreto.
    const ctl = { abort: (reason) => { abortReason = reason || 'ABORT'; try { p.kill('SIGKILL'); } catch (_) {} } };
    const pet = () => {
      if (!stallMs) return;
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        stalled = true;
        try { p.kill('SIGKILL'); } catch (_) {}
      }, stallMs);
    };
    const handle = (chunk) => {
      const s = chunk.toString();
      errBuf += s;
      if (onLine) s.split(/[\r\n]+/).forEach(l => { if (l.trim()) onLine(l.trim(), ctl); });
      if (errBuf.length > 64000) errBuf = errBuf.slice(-32000);
      pet();
    };
    if (p.stdout) p.stdout.on('data', handle);
    if (p.stderr) p.stderr.on('data', handle);
    pet();
    p.on('error', (e) => { if (watchdog) clearTimeout(watchdog); reject(e); });
    p.on('close', (code) => {
      if (watchdog) clearTimeout(watchdog);
      if (currentJob) currentJob.procs = currentJob.procs.filter(x => x !== p);
      if (abortReason) return reject(new Error(abortReason));
      if (stalled) return reject(new Error('STALL'));
      if (currentJob && currentJob.cancelled) return reject(new Error('Cancelado'));
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(exe)} salió con código ${code}\n${errBuf.slice(-800)}`));
    });
  });
}

function emit(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
}

/* ---------- Selección de modelo ---------- */
// modo: 'anime' | 'real' | 'gameplay'
function pickUpscale(mode, inH, targetH) {
  // Real-ESRGAN: animevideov3 admite x2/x3/x4; x4plus es nativo x4.
  if (mode === 'real') {
    return { model: 'realesrgan-x4plus', scale: 4 };
  }
  // anime / gameplay -> animevideov3 (rápido y nítido). Elegimos el menor factor que alcance el objetivo.
  const need = targetH / Math.max(1, inH);
  let scale = 4;
  if (need <= 2) scale = 2;
  else if (need <= 3) scale = 3;
  return { model: 'realesr-animevideov3', scale };
}

/* ---------- Pipeline principal ---------- */
ipcMain.handle('job:start', async (e, cfg) => {
  // cfg: { input, output, mode, targetH, interpolate, targetFps, useNvenc, quality }
  if (currentJob) return { ok: false, error: 'Ya hay un trabajo en curso.' };

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagihd_'));
  currentJob = { procs: [], cancelled: false, workDir };

  const framesIn = path.join(workDir, 'in');
  const framesUp = path.join(workDir, 'up');
  const framesInterp = path.join(workDir, 'interp');
  const audioPath = path.join(workDir, 'audio.m4a');
  fs.mkdirSync(framesIn, { recursive: true });
  fs.mkdirSync(framesUp, { recursive: true });

  const cleanup = () => {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
    currentJob = null;
  };

  // Modo vista previa: procesa solo los primeros N segundos a un archivo temporal.
  const preview = cfg.previewSeconds && cfg.previewSeconds > 0 ? Number(cfg.previewSeconds) : 0;
  if (preview && !cfg.output) {
    cfg.output = path.join(os.tmpdir(), `nagihd_preview_${Date.now()}.mp4`);
  }

  try {
    const info = await ffprobe(cfg.input);
    if (!info.hasVideo) throw new Error('El archivo no contiene vídeo.');
    const previewDur = preview ? Math.min(preview, info.duration || preview) : 0;
    const totalFrames = preview
      ? Math.max(1, Math.round(previewDur * info.fps))
      : Math.max(1, info.frames || Math.round(info.duration * info.fps));

    // Pesos de progreso global
    const W = { extract: 8, upscale: cfg.interpolate ? 56 : 70, interp: cfg.interpolate ? 16 : 0, encode: cfg.interpolate ? 20 : 22 };
    const phaseBase = { extract: 0, upscale: W.extract, interp: W.extract + W.upscale, encode: W.extract + W.upscale + W.interp };
    const jobStart = Date.now();
    let lastOverall = 0, curPhase = null, phaseStart = 0;
    const report = (phase, label, pct, fdone, ftotal) => {
      const now = Date.now();
      if (phase !== curPhase) { curPhase = phase; phaseStart = now; }
      const p = Math.max(0, Math.min(1, pct));
      let overall = Math.round(phaseBase[phase] + W[phase] * p);
      if (overall < lastOverall) overall = lastOverall; // nunca retrocede
      lastOverall = overall;
      const elapsed = (now - jobStart) / 1000;
      const eta = overall > 1 && overall < 100 ? Math.round(elapsed * (100 - overall) / overall) : null;
      let fps = null;
      if (fdone && now > phaseStart + 400) fps = Math.round((fdone / ((now - phaseStart) / 1000)) * 10) / 10;
      emit('job:progress', {
        phase, label, phasePct: Math.round(p * 100), overall,
        elapsed: Math.round(elapsed), eta,
        fdone: fdone || null, ftotal: ftotal || null, fps
      });
    };
    // Lee un porcentaje de una línea, aceptando coma o punto decimal (es-ES imprime "91,67%").
    const pctOf = (line) => {
      const m = line.match(/(\d+(?:[.,]\d+)?)\s*%/);
      return m ? parseFloat(m[1].replace(',', '.')) / 100 : null;
    };

    /* 1) Extraer fotogramas + audio */
    report('extract', 'Extrayendo fotogramas…', 0);
    const extractArgs = ['-y', '-i', cfg.input];
    if (preview) extractArgs.push('-t', String(previewDur));
    extractArgs.push(
      '-qscale:v', '1', '-qmin', '1', '-qmax', '1', '-vsync', '0',
      path.join(framesIn, 'frame_%08d.png')
    );
    await runProc(ffmpegPath, extractArgs, { stallMs: 120000 }, (line) => {
      const m = line.match(/frame=\s*(\d+)/);
      if (m) { const f = parseInt(m[1], 10); report('extract', 'Extrayendo fotogramas…', f / totalFrames, f, totalFrames); }
    });
    if (currentJob.cancelled) throw new Error('Cancelado');

    // Audio (si lo hay)
    let haveAudio = false;
    if (info.hasAudio) {
      try {
        const audioArgs = ['-y', '-i', cfg.input];
        if (preview) audioArgs.push('-t', String(previewDur));
        audioArgs.push('-vn', '-c:a', 'aac', '-b:a', '192k', audioPath);
        await runProc(ffmpegPath, audioArgs, {});
        haveAudio = fs.existsSync(audioPath);
      } catch (_) { haveAudio = false; }
    }

    /* 2) Escalado con IA (Real-ESRGAN) */
    if (!fs.existsSync(realesrganExe())) {
      throw new Error('Falta el motor Real-ESRGAN. Pulsa "Instalar motores" o ejecuta npm run fetch-bin.');
    }
    const { model, scale } = pickUpscale(cfg.mode, info.height, cfg.targetH);
    // Tile size SIEMPRE acotado (nunca auto/0): en GPUs débiles el tile automático puede
    // agotar la VRAM, perder el dispositivo Vulkan y reprocesar en bucle infinito.
    const tile = cfg.targetH >= 2160 ? 192 : (cfg.targetH >= 1440 ? 224 : 256);

    // Un intento de escalado con tile/hilos dados. Detecta reinicios (bucle) y aborta con 'LOOP'.
    const runUpscale = (tileSize, jobs, label) => {
      const args = ['-i', framesIn, '-o', framesUp, '-n', model, '-s', String(scale),
        '-t', String(tileSize), '-g', '0', '-f', 'png', '-m', realesrganModels()];
      if (jobs) args.push('-j', jobs);
      let upMax = 0, upRestarts = 0;
      return runProc(realesrganExe(), args, { stallMs: 180000 }, (line, ctl) => {
        const p = pctOf(line);
        if (p === null) return;
        if (p + 0.2 < upMax) { upRestarts++; if (upRestarts >= 2) return ctl.abort('LOOP'); upMax = p; }
        upMax = Math.max(upMax, p);
        report('upscale', label, p, Math.round(p * totalFrames), totalFrames);
      });
    };

    const upLabel = `Mejorando con IA (${model} ×${scale})…`;
    report('upscale', upLabel, 0);
    try {
      await runUpscale(tile, null, upLabel);
    } catch (e) {
      if (currentJob.cancelled || String(e.message) !== 'LOOP') throw e;
      // GPU justa: reintento automático en MODO SEGURO (mismo modelo/calidad), con tile
      // mínimo + 1 hilo → poquísima VRAM. Más lento pero completa sin bucle.
      try { fs.rmSync(framesUp, { recursive: true, force: true }); } catch (_) {}
      fs.mkdirSync(framesUp, { recursive: true });
      const safeLabel = `Modo seguro (GPU justa): ${model} ×${scale}…`;
      report('upscale', safeLabel, 0);
      await runUpscale(64, '1:1:1', safeLabel); // si vuelve a hacer bucle, propaga 'LOOP' → error
    }
    if (currentJob.cancelled) throw new Error('Cancelado');
    report('upscale', 'Mejora con IA completada', 1, totalFrames, totalFrames);

    /* 3) Interpolación de fotogramas (RIFE) — opcional */
    let assembleDir = framesUp;
    let assemblePattern = 'frame_%08d.png';
    let outFps = info.fps;

    if (cfg.interpolate) {
      if (!fs.existsSync(rifeExe())) {
        throw new Error('Falta el motor RIFE. Pulsa "Instalar motores" o ejecuta npm run fetch-bin.');
      }
      fs.mkdirSync(framesInterp, { recursive: true });
      report('interp', 'Generando fotogramas intermedios (RIFE)…', 0);
      const rifeArgs = [
        '-i', framesUp,
        '-o', framesInterp,
        '-m', rifeModelDir()
      ];
      const interpTotal = totalFrames * 2;
      let ipMax = 0, ipRestarts = 0;
      await runProc(rifeExe(), rifeArgs, { stallMs: 180000 }, (line, ctl) => {
        const p = pctOf(line);
        if (p === null) return;
        if (p + 0.2 < ipMax) { ipRestarts++; if (ipRestarts >= 2) return ctl.abort('LOOP'); ipMax = p; }
        ipMax = Math.max(ipMax, p);
        report('interp', 'Generando fotogramas intermedios (RIFE)…', p, Math.round(p * interpTotal), interpTotal);
      });
      if (currentJob.cancelled) throw new Error('Cancelado');
      assembleDir = framesInterp;
      assemblePattern = '%08d.png';
      outFps = info.fps * 2;
      // Respetar tope de FPS si el usuario lo pidió
      if (cfg.targetFps && outFps > cfg.targetFps) outFps = cfg.targetFps;
      report('interp', 'Interpolación completada', 1);
    }

    /* 4) Recomponer vídeo final */
    report('encode', 'Renderizando vídeo final…', 0);
    if (!cfg.output) throw new Error('Falta la ruta de salida.');

    const crf = String(cfg.quality || 17);
    const hevc = !!cfg.hevc; // H.265: archivos más pequeños a igual calidad
    // Cadena de filtros: (denoise opcional) → escalado → nitidez opcional (unsharp).
    const sharpAmt = cfg.sharpen == null ? 0.9 : Number(cfg.sharpen); // 0 = sin nitidez
    let vf = `scale=-2:${cfg.targetH}:flags=lanczos`;
    if (cfg.denoise) vf = `hqdn3d=2:1.5:6:6,${vf}`; // limpia ruido/artefactos de compresión
    if (sharpAmt > 0) vf += `,unsharp=5:5:${sharpAmt.toFixed(2)}:5:5:0.0`;

    const encArgs = ['-y', '-framerate', String(outFps), '-i', path.join(assembleDir, assemblePattern)];
    if (haveAudio) encArgs.push('-i', audioPath);

    if (cfg.useNvenc) {
      // Calidad constante (cq) + AQ adaptativo. -b:v 0 deja que la calidad mande sin tope artificial.
      encArgs.push('-vf', vf, '-c:v', hevc ? 'hevc_nvenc' : 'h264_nvenc', '-preset', 'p7', '-rc', 'vbr',
        '-cq', crf, '-b:v', '0', '-spatial-aq', '1', '-temporal-aq', '1',
        '-aq-strength', '12', '-pix_fmt', 'yuv420p');
      if (hevc) encArgs.push('-tag:v', 'hvc1');
    } else {
      encArgs.push('-vf', vf, '-c:v', hevc ? 'libx265' : 'libx264', '-preset', hevc ? 'medium' : 'slow',
        '-crf', crf, '-pix_fmt', 'yuv420p');
      if (hevc) encArgs.push('-tag:v', 'hvc1');
    }
    if (haveAudio) encArgs.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    encArgs.push('-movflags', '+faststart', cfg.output);

    // Para el progreso del encode necesitamos el total de fotogramas de salida
    const outTotal = cfg.interpolate ? totalFrames * 2 : totalFrames;
    await runProc(ffmpegPath, encArgs, { stallMs: 120000 }, (line) => {
      const m = line.match(/frame=\s*(\d+)/);
      if (m) { const f = parseInt(m[1], 10); report('encode', 'Renderizando vídeo final…', f / outTotal, f, outTotal); }
    });
    if (currentJob.cancelled) throw new Error('Cancelado');

    report('encode', 'Completado', 1);
    emit('job:progress', { phase: 'done', label: 'Completado', phasePct: 100, overall: 100 });

    const outInfo = await ffprobe(cfg.output).catch(() => null);
    cleanup();
    return { ok: true, output: cfg.output, outInfo, preview: !!preview };
  } catch (err) {
    const cancelled = currentJob && currentJob.cancelled;
    cleanup();
    let msg = String(err.message || err);
    if (msg === 'STALL') {
      msg = 'Un motor se quedó bloqueado (posible falta de memoria de GPU). ' +
        'Prueba una resolución de salida menor (p. ej. 1080p) o cierra otras apps que usen la GPU.';
    } else if (msg === 'LOOP') {
      msg = 'Tu GPU no puede con este vídeo ni en modo seguro (se queda sin memoria o es inestable). ' +
        'Prueba: una resolución de salida menor (720p), desactiva la fluidez, cierra otras apps que usen la GPU, ' +
        'o procesa un fragmento más corto. Si sigue fallando, la tarjeta gráfica es demasiado limitada para este vídeo.';
    }
    return { ok: false, cancelled: !!cancelled, error: cancelled ? 'Trabajo cancelado.' : msg };
  }
});

ipcMain.handle('job:cancel', async () => {
  if (!currentJob) return { ok: false };
  currentJob.cancelled = true;
  currentJob.procs.slice().forEach(p => { try { p.kill('SIGKILL'); } catch (_) {} });
  return { ok: true };
});

ipcMain.handle('shell:reveal', async (e, file) => {
  if (file && fs.existsSync(file)) shell.showItemInFolder(file);
  return true;
});
ipcMain.handle('shell:play', async (e, file) => {
  if (file && fs.existsSync(file)) shell.openPath(file);
  return true;
});
