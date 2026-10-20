/* 把 build/icon.png 合成多尺寸 BMP 格式的标准 icon.ico（NSIS / rcedit 兼容） */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SRC = path.join(__dirname, '..', 'build', 'icon.png');
const OUT = path.join(__dirname, '..', 'build', 'icon.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function resizeBilinear(src, w, h) {
  const out = new PNG({ width: w, height: h });
  const sw = src.width, sh = src.height;
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) * sh / h - 0.5;
    const y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) * sw / w - 0.5;
      const x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = src.data[i00 + c] * (1 - tx) + src.data[i10 + c] * tx;
        const b = src.data[i01 + c] * (1 - tx) + src.data[i11 + c] * tx;
        out.data[o + c] = Math.round(a * (1 - ty) + b * ty);
      }
    }
  }
  return out;
}

/* 单个尺寸 -> BMP 格式条目（BITMAPINFOHEADER + BGRA 像素 + AND mask） */
function bmpEntry(png) {
  const w = png.width, h = png.height;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(w, 4);
  header.writeInt32LE(h * 2, 8);          /* XOR + AND 高度 */
  header.writeUInt16LE(1, 12);            /* planes */
  header.writeUInt16LE(32, 14);           /* bpp */
  header.writeUInt32LE(0, 20);            /* 无压缩 */
  header.writeUInt32LE(w * h * 4, 20 + 4);
  const xor = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((h - 1 - y) * w + x) * 4;  /* BMP 自下而上 */
      const di = (y * w + x) * 4;
      xor[di] = png.data[si + 2];
      xor[di + 1] = png.data[si + 1];
      xor[di + 2] = png.data[si];
      xor[di + 3] = png.data[si + 3];
    }
  }
  const maskRow = Math.ceil(w / 32) * 4;
  const and = Buffer.alloc(maskRow * h);    /* 全 0 = 不透明（alpha 已在 XOR 里） */
  return Buffer.concat([header, xor, and]);
}

const src = PNG.sync.read(fs.readFileSync(SRC));
const entries = SIZES.map((s) => bmpEntry(resizeBilinear(src, s, s)));

const count = entries.length;
const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(count, 4);
const dirEntries = [];
let offset = 6 + 16 * count;
entries.forEach((buf, i) => {
  const s = SIZES[i];
  const e = Buffer.alloc(16);
  e[0] = s >= 256 ? 0 : s;
  e[1] = s >= 256 ? 0 : s;
  e[2] = 0; e[3] = 0;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(buf.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += buf.length;
  dirEntries.push(e);
});
fs.writeFileSync(OUT, Buffer.concat([dir, ...dirEntries, ...entries]));
console.log('[make-ico] 写入', OUT, fs.statSync(OUT).size, 'bytes,', count, 'sizes');
