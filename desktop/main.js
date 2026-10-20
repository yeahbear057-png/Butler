/* ============================================================
   管家 · Windows 桌面版主进程
   - app:// 协议加载本地打包的网页资源
   - 关闭壳内同源校验并补齐跨域响应头（云端网关不支持 OPTIONS 预检）
   - 单实例 / 窗口记忆 / 托盘 / 全局快捷键 / 外链走系统浏览器
   ============================================================ */
const { app, BrowserWindow, protocol, session, Tray, Menu, globalShortcut, ipcMain, shell, Notification, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_VERSION = app.getVersion();
const WEB_ROOT = path.join(__dirname, 'web');
const UPDATE_MANIFEST_URL = 'https://personal-info-butler-90491.app.workbuddy.host/app-version.json';

/* 部分虚拟化/远程桌面环境 GPU 进程会崩溃，管家属表单类应用，禁用硬件加速更稳 */
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');

/* 启动日志落盘：GUI 程序无控制台，排障用 */
try {
  const logFile = path.join(app.getPath('userData'), 'launch.log');
  const log = (msg) => { try { fs.appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n'); } catch (e) {} };
  global.__butlerLog = log;
  log('---- launch v' + APP_VERSION + ' ----');
  process.on('uncaughtException', (e) => log('UNCAUGHT: ' + (e && e.stack || e)));
  process.on('unhandledRejection', (e) => log('REJECTION: ' + (e && (e.stack || e.message) || e)));
  app.on('render-process-gone', (e, wc, d) => log('RENDER-GONE: ' + JSON.stringify(d)));
  app.on('child-process-gone', (e, d) => log('CHILD-GONE: ' + d.type + ' ' + d.reason + ' ' + d.exitCode));
} catch (e) {}
const log = global.__butlerLog || (() => {});

/* ---------------- 单实例 ---------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

/* ---------------- app:// 自定义协议 ---------------- */
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function serveFromWeb(url) {
  const u = new URL(url);
  let p = decodeURIComponent(u.pathname);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(WEB_ROOT, p));
  if (!file.startsWith(WEB_ROOT)) return new Response('Forbidden', { status: 403 });
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('Not Found', { status: 404 });
  const ext = path.extname(file).toLowerCase();
  return new Response(fs.readFileSync(file), {
    status: 200,
    headers: { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' }
  });
}

/* ---------------- 窗口状态记忆 ---------------- */
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return null; }
}
function saveWindowState(win) {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({
      x: win.getBounds().x, y: win.getBounds().y,
      width: win.getBounds().width, height: win.getBounds().height,
      maximized: win.isMaximized()
    }));
  } catch (e) { /* 忽略 */ }
}

let mainWindow = null;
let tray = null;
let quitting = false;

function createWindow() {
  const saved = loadWindowState() || {};
  const w = 1280, h = 820;
  mainWindow = new BrowserWindow({
    width: saved.width || w,
    height: saved.height || h,
    x: typeof saved.x === 'number' ? saved.x : undefined,
    y: typeof saved.y === 'number' ? saved.y : undefined,
    minWidth: 420,
    minHeight: 560,
    show: false,
    autoHideMenuBar: false,
    backgroundColor: '#F7F5F0',
    icon: path.join(__dirname, 'build', 'icon.png'),
    title: '管家',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      /* 云端网关不支持 OPTIONS 预检，必须关闭壳内同源校验（本地应用，页面均为自有资源，风险可控） */
      webSecurity: false
    }
  });

  if (saved.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => { log('ready-to-show'); mainWindow.show(); });
  mainWindow.webContents.on('did-fail-load', (e, code, desc, url) => log('DID-FAIL-LOAD ' + code + ' ' + desc + ' ' + url));
  mainWindow.webContents.on('did-finish-load', () => log('did-finish-load'));
  mainWindow.webContents.on('preload-error', (e, p, err) => log('PRELOAD-ERROR ' + p + ' ' + err));
  mainWindow.webContents.on('console-message', (e, level, message, line, source) => {
    /* level: 0 普通 / 1 提示 / 2 警告 / 3 错误，只落错误与警告，避免日志膨胀 */
    if (level >= 2) log('CONSOLE[' + level + '] ' + String(message).slice(0, 300) + ' @' + source + ':' + line);
  });
  mainWindow.loadURL('app://local/index.html');

  /* 新窗口一律走系统浏览器 */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  ['resize', 'move', 'close'].forEach((ev) => mainWindow.on(ev, () => saveWindowState(mainWindow)));

  /* 点关闭 = 缩到托盘（托盘里可真正退出），首次给一条系统通知 */
  mainWindow.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    mainWindow.hide();
    try {
      if (!global.__hideNotified) {
        global.__hideNotified = true;
        if (Notification.isSupported()) {
          new Notification({ title: '管家还在后台运行', body: '右键任务栏托盘图标可以打开或退出。' }).show();
        }
      }
    } catch (e2) { /* 忽略 */ }
  });
}

function showMainWindow() {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/* ---------------- 托盘 ---------------- */
function createTray() {
  try {
    const { nativeImage } = require('electron');
    const iconPath = path.join(__dirname, 'build', 'icon.png');
    const img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.setToolTip('管家 · ' + APP_VERSION);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开管家', click: showMainWindow },
      { label: '快速记录（Ctrl+Shift+Space）', click: () => { showMainWindow(); quickCapture(); } },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit(); } }
    ]));
    tray.on('double-click', showMainWindow);
  } catch (e) { /* 托盘失败不影响主流程 */ }
}

function quickCapture() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('butler-quick-capture');
  }
}

/* ---------------- 应用菜单（中文） ---------------- */
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [
        { label: '快速记录', accelerator: 'Ctrl+Shift+Space', click: () => { showMainWindow(); quickCapture(); } },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    { role: 'editMenu', label: '编辑' },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'forceReload', label: '强制刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '检查更新…', click: () => checkForUpdates(true) },
        { label: '关于管家', click: () => {
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '关于管家',
            message: '管家 ' + APP_VERSION,
            detail: '让零散记录慢慢长成体系。\n数据存储在你自己的云账号下，电脑和手机登录同一账号即可同步。'
          });
        } }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- 轻量更新检查（读取线上版本清单） ---------------- */
const https = require('https');
function fetchUpdateManifest() {
  return new Promise((resolve) => {
    https.get(UPDATE_MANIFEST_URL, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null)).on('timeout', function () { this.destroy(); resolve(null); });
  });
}

function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

async function checkForUpdates(manual) {
  const m = await fetchUpdateManifest();
  if (!m || !m.version) {
    if (manual) dialog.showMessageBox(mainWindow, { type: 'info', title: '检查更新', message: '暂时无法连接更新服务，请稍后再试。' });
    return;
  }
  if (cmpVersion(m.version, APP_VERSION) > 0) {
    const r = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '发现新版本',
      message: '发现新版本 ' + m.version + '（当前 ' + APP_VERSION + '）',
      detail: m.notes ? m.notes : '是否前往下载最新安装包？',
      buttons: ['前往下载', '暂不更新'],
      defaultId: 0
    });
    if (r.response === 0 && m.url) shell.openExternal(m.url);
  } else if (manual) {
    dialog.showMessageBox(mainWindow, { type: 'info', title: '检查更新', message: '已经是最新版本 ' + APP_VERSION });
  }
}

/* ---------------- 生命周期 ---------------- */
app.on('second-instance', showMainWindow);

app.whenReady().then(() => {
  /* app:// 协议映射到本地 web 目录 */
  protocol.handle('app', (req) => serveFromWeb(req.url));

  /* 跨域兜底：去掉 Origin、补齐 CORS 响应头（有些接口即使关了 webSecurity 也要求头部齐全） */
  const ses = session.defaultSession;
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = Object.assign({}, details.requestHeaders);
    delete h.Origin; delete h.origin;
    cb({ requestHeaders: h });
  });
  ses.webRequest.onHeadersReceived((details, cb) => {
    const h = Object.assign({}, details.responseHeaders);
    h['Access-Control-Allow-Origin'] = ['*'];
    h['Access-Control-Allow-Headers'] = ['*'];
    h['Access-Control-Allow-Methods'] = ['GET,POST,PUT,PATCH,DELETE,OPTIONS'];
    h['Access-Control-Expose-Headers'] = ['*'];
    cb({ responseHeaders: h });
  });

  buildMenu();
  createWindow();
  createTray();

  globalShortcut.register('Ctrl+Shift+Space', () => { showMainWindow(); quickCapture(); });

  /* 渲染进程要的应用信息 */
  ipcMain.handle('butler-info', () => ({
    desktop: true, platform: process.platform, version: APP_VERSION
  }));
  ipcMain.handle('butler-open-external', (e, url) => {
    if (/^https?:/i.test(String(url))) shell.openExternal(url);
  });
  ipcMain.handle('butler-check-updates', () => checkForUpdates(true));

  /* 冒烟测试：BUTLER_SMOKE=1 时启动数秒后自动退出，验证窗口与页面渲染 */
  if (process.env.BUTLER_SMOKE === '1') {
    setTimeout(async () => {
      try {
        if (!mainWindow || mainWindow.isDestroyed()) throw new Error('window missing');
        if (!mainWindow.isVisible()) mainWindow.show();
        if (process.env.BUTLER_SMOKE_MOBILE === '1') {
          mainWindow.setContentSize(390, 844);
          await new Promise((r) => setTimeout(r, 600));
        }
        const probe = await mainWindow.webContents.executeJavaScript(`(() => {
          const q = (s) => document.querySelector(s);
          const vis = (s) => { const el = q(s); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          return {
            title: document.title,
            appView: vis('#appView'),
            boot: q('#boot') ? !q('#boot').classList.contains('hidden') : false,
            auth: vis('#authView') || vis('.auth-card') || vis('#authPanel'),
            tabbar: vis('#tabbar'),
            moreSheet: q('#moreSheet') ? !q('#moreSheet').classList.contains('hidden') : false,
            bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
            jsVer: window.__pib ? 'ok' : 'missing',
            err: (window.__bootErrors || []).slice(0, 3)
          };
        })()`);
        const img = await mainWindow.webContents.capturePage();
        const shot = path.join(app.getPath('userData'), 'smoke.png');
        fs.writeFileSync(shot, img.toPNG());
        log('SMOKE ' + JSON.stringify(probe) + ' shot=' + shot);
        console.log('SMOKE_OK ' + JSON.stringify(probe));
        app.exit(0);
      } catch (e) {
        log('SMOKE_FAIL ' + e.message);
        console.log('SMOKE_FAIL ' + e.message);
        app.exit(1);
      }
    }, 5000);
  }
});

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (e) {} });
app.on('window-all-closed', () => { /* 关闭即缩托盘，不退出 */ });
