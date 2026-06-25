// NAGIHD — genera assets/icon.ico (PNG-in-ICO) sin dependencias externas.
// © 2026 NAGI STUDIOS
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const R = 52; // radio de esquina

function lerp(a, b, t) { return a + (b - a) * t; }
// Degradado diagonal violeta (#a06bff) -> cian (#38e0ff)
const c1 = [160, 107, 255], c2 = [56, 224, 255];

const raw = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const t = (x + y) / (2 * SIZE);
    let r = Math.round(lerp(c1[0], c2[0], t));
    let g = Math.round(lerp(c1[1], c2[1], t));
    let b = Math.round(lerp(c1[2], c2[2], t));
    // brillo radial sutil
    const dx = x - SIZE * 0.35, dy = y - SIZE * 0.3;
    const glow = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 180);
    r = Math.min(255, r + glow * 40); g = Math.min(255, g + glow * 40); b = Math.min(255, b + glow * 40);

    // máscara de esquinas redondeadas (alpha)
    let a = 255;
    const inX = x < R ? R - x : (x > SIZE - 1 - R ? x - (SIZE - 1 - R) : 0);
    const inY = y < R ? R - y : (y > SIZE - 1 - R ? y - (SIZE - 1 - R) : 0);
    if (inX > 0 && inY > 0) {
      const d = Math.sqrt(inX * inX + inY * inY);
      a = d > R ? 0 : Math.max(0, Math.min(255, Math.round((R - d) * 255)));
    }
    const i = (y * SIZE + x) * 4;
    raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
  }
}

// Dibujar una "N" oscura simple (trazos rectos)
function setPx(x, y, col) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  raw[i] = col[0]; raw[i + 1] = col[1]; raw[i + 2] = col[2];
}
const ink = [18, 10, 34];
const thick = 22;
const top = 70, bot = 186, left = 76, right = 180;
for (let y = top; y <= bot; y++) {
  for (let t = 0; t < thick; t++) {
    setPx(left + t, y, ink);            // palo izquierdo
    setPx(right - t, y, ink);           // palo derecho
    // diagonal
    const dx = Math.round(left + (right - left) * (y - top) / (bot - top));
    setPx(dx + t - thick / 2, y, ink);
  }
}

/* ---- Codificar PNG ---- */
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tt = Buffer.from(type, 'ascii');
  const body = Buffer.concat([tt, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
// filtro 0 por línea
const stride = SIZE * 4;
const filtered = Buffer.alloc((stride + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  filtered[y * (stride + 1)] = 0;
  raw.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride);
}
const idat = zlib.deflateSync(filtered, { level: 9 });
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);

/* ---- Envolver en ICO ---- */
const icondir = Buffer.alloc(6);
icondir.writeUInt16LE(0, 0); icondir.writeUInt16LE(1, 2); icondir.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0; // 256 -> 0
entry[2] = 0; entry[3] = 0;
entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(6 + 16, 12);
const ico = Buffer.concat([icondir, entry, png]);

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
console.log('Icono generado:', path.join(outDir, 'icon.ico'), '(' + ico.length + ' bytes)');
