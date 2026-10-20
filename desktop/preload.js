/* 桌面壳桥接：把主进程能力安全地暴露给页面 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('butlerDesktop', {
  desktop: true,
  info: () => ipcRenderer.invoke('butler-info'),
  openExternal: (url) => ipcRenderer.invoke('butler-open-external', url),
  checkUpdates: () => ipcRenderer.invoke('butler-check-updates'),
  onQuickCapture: (cb) => ipcRenderer.on('butler-quick-capture', () => { try { cb(); } catch (e) {} })
});
