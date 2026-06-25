// Captura la UI de NAGIHD a un PNG (solo para verificación visual).
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1180, height: 1080, show: true, x: 2200, y: 20,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, backgroundThrottling: false }
  });
  await win.loadFile(path.join(__dirname, '..', 'index.html'));
  await new Promise(r => setTimeout(r, 1400));
  const cmp = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', '_cmp.json'), 'utf8'));
  const r = await win.webContents.executeJavaScript(`(function(){
    try {
      document.getElementById('dropZone').classList.add('hidden');
      document.getElementById('workPanel').classList.add('hidden');
      document.getElementById('progressPanel').classList.add('hidden');
      document.getElementById('resultPanel').classList.remove('hidden');
      document.getElementById('resultIcon').textContent = '✅';
      document.getElementById('resultTitle').textContent = '¡Vídeo mejorado!';
      document.getElementById('resultMsg').textContent = 'mi_video_1080p.mp4  ·  1920×1080 @ 25 fps';
      document.getElementById('playBtn').innerHTML = '<span class="wb-ico">▶</span> VER VÍDEO';
      document.getElementById('playBtn').classList.remove('hidden');
      document.getElementById('revealBtn').classList.remove('hidden');
      document.getElementById('cmpBefore').src = ${JSON.stringify(cmp.before)};
      document.getElementById('cmpAfter').src = ${JSON.stringify(cmp.after)};
      document.getElementById('cmpCard').style.aspectRatio = '16 / 9';
      document.getElementById('cmpCard').style.setProperty('--x','46%');
      document.getElementById('cmpWrap').classList.remove('hidden');
      return 'OK panels=' + document.querySelectorAll('section:not(.hidden)').length;
    } catch(e) { return 'ERR ' + e.message; }
  })()`);
  console.log('inject:', r);
  win.webContents.invalidate();
  await new Promise(r => setTimeout(r, 700));
  const img = await win.webContents.capturePage();
  const out = path.join(__dirname, '..', 'assets', '_preview.png');
  fs.writeFileSync(out, img.toPNG());
  console.log('shot ->', out);
  app.quit();
});
