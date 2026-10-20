/* 打包前把站点静态资源复制进 desktop/web（sw.js / manifest 为 PWA 专属，不进桌面包） */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DEST = path.join(__dirname, '..', 'web');

const FILES = ['index.html', 'app.js', 'styles.css'];
const DIRS = ['icons', 'vendor'];

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });
FILES.forEach((f) => {
  fs.copyFileSync(path.join(ROOT, f), path.join(DEST, f));
});
DIRS.forEach((d) => {
  const src = path.join(ROOT, d);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(DEST, d), { recursive: true });
});
console.log('[prepare-web] 复制完成 ->', DEST);
