/**
 * الجسر بين اللوحة والبرنامج (contextIsolation): اللوحة ما بتشوفش Node خالص.
 *  • naeemanDesktop: توكن تجديد جلسة الموظف في مخزن مشفّر بالجهاز
 *    (client/src/lib/api.js بيستعمله بدل الكوكي).
 *  • naeemanSetup: صفحة أوّل تشغيل بس (عنوان سيرفر المحل).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('naeemanDesktop', {
  getRefreshToken: () => ipcRenderer.invoke('session:get'),
  setRefreshToken: (token) => ipcRenderer.invoke('session:set', token),
  clearRefreshToken: () => ipcRenderer.invoke('session:clear'),
});

contextBridge.exposeInMainWorld('naeemanSetup', {
  current: () => ipcRenderer.invoke('setup:current'),
  save: (url) => ipcRenderer.invoke('setup:save', url),
});
