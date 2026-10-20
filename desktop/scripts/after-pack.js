/* afterPack：用 rcedit 给主程序写入图标与版本信息
   （electron-builder 内置的 exe 编辑需下载 winCodeSign 包，其解压需符号链接特权，故改走此钩子） */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const RCEDIT_CANDIDATES = [
  path.join(process.env.LOCALAPPDATA || '', 'electron-builder Cache', 'winCodeSign', 'winCodeSign-2.6.0', 'rcedit-x64.exe'),
  path.join(__dirname, '..', 'build', 'tools', 'rcedit-x64.exe')
];

function findRcedit() {
  for (const c of RCEDIT_CANDIDATES) {
    try { if (fs.existsSync(c)) return c; } catch (e) { /* 忽略 */ }
  }
  return null;
}

exports.default = async function (context) {
  const exe = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.exe');
  const rceditPath = findRcedit();
  if (!rceditPath) throw new Error('找不到 rcedit-x64.exe，无法写入图标');
  const icon = path.join(__dirname, '..', 'build', 'icon.ico');
  const v = context.packager.appInfo.version + '.0';

  execFileSync(rceditPath, [
    exe,
    '--set-icon', icon,
    '--set-version-string', 'ProductName', '管家',
    '--set-version-string', 'FileDescription', '管家 · 让零散记录长成体系',
    '--set-version-string', 'CompanyName', 'butler',
    '--set-version-string', 'LegalCopyright', '管家',
    '--set-product-version', v,
    '--set-file-version', v
  ], { stdio: 'inherit' });
  console.log('[after-pack] 已写入图标与版本信息 ->', exe);
};
