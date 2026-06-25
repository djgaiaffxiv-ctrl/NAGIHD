'use strict';
// Genera un icono SOLO con el logo NAGI (sin texto), que llena el lienzo.
// Uso:  electron tools/gen-icon-logo.js "<base-sin-ext>" "<ruta-logo.png>"
// Salida: <base>.png (256), <base>-512.png, <base>.ico (multi-tamano). Transparente.

const { app, BrowserWindow } = require('electron');
const fs = require('fs');

const BASE = process.argv[2];
const LOGO = process.argv[3];
if (!BASE || !LOGO) { console.error('Uso: electron gen-icon-logo.js <base> <logo.png>'); process.exit(1); }

const logoB64 = fs.readFileSync(LOGO).toString('base64');

// El logo ocupa ~94% del lienzo, centrado, fondo transparente.
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
 html,body{margin:0;width:512px;height:512px;background:transparent;overflow:hidden}
 .wrap{width:512px;height:512px;display:flex;align-items:center;justify-content:center}
 .mark{width:482px;height:482px;object-fit:contain}
</style></head><body><div class="wrap">
 <img class="mark" src="data:image/png;base64,${logoB64}"></div></body></html>`;

function buildIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const datas = [];
  entries.forEach((e, i) => {
    const dim = e.size >= 256 ? 0 : e.size;
    const o = 16 * i;
    dir.writeUInt8(dim, o); dir.writeUInt8(dim, o + 1);
    dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.buf.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += e.buf.length; datas.push(e.buf);
  });
  return Buffer.concat([header, dir, ...datas]);
}

async function main() {
  const win = new BrowserWindow({
    width: 512, height: 512, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', webPreferences: { offscreen: false }
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 700));

  const img = await win.webContents.capturePage();
  console.log('captura', img.getSize().width + 'x' + img.getSize().height, 'vacia:', img.isEmpty());

  fs.writeFileSync(BASE + '-512.png', img.toPNG());
  const png256 = img.resize({ width: 256, height: 256, quality: 'best' }).toPNG();
  fs.writeFileSync(BASE + '.png', png256);

  const sizes = [256, 128, 64, 48, 32, 16];
  const entries = sizes.map(s => ({
    size: s,
    buf: s === 256 ? png256 : img.resize({ width: s, height: s, quality: 'best' }).toPNG()
  }));
  fs.writeFileSync(BASE + '.ico', buildIco(entries));
  console.log('OK ->', BASE + '.{png,ico}');
  app.quit();
}

app.disableHardwareAcceleration();
app.whenReady().then(main).catch(e => { console.error(e); app.quit(); });
