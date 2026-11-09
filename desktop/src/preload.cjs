/**
 * الجسر بين اللوحة والبرنامج (contextIsolation): اللوحة ما بتشوفش Node خالص.
 *  • naeemanDesktop: توكن تجديد جلسة الموظف في مخزن مشفّر بالجهاز
 *    (client/src/lib/api.js بيستعمله بدل الكوكي)، وطباعة الإيصال على طابعة
 *    الإيصالات من غير نافذة (client/src/lib/receipt.js)، وحالة سيرفر المحل.
 *  • naeemanSetup: صفحة أوّل تشغيل بس (اختيار الوضع: سيرفر المحل أو اتصال
 *    بسيرفر موجود).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('naeemanDesktop', {
  getRefreshToken: () => ipcRenderer.invoke('session:get'),
  setRefreshToken: (token) => ipcRenderer.invoke('session:set', token),
  clearRefreshToken: () => ipcRenderer.invoke('session:clear'),
  printHtml: (html, options) => ipcRenderer.invoke('print:html', html, options),
  hubStatus: () => ipcRenderer.invoke('hub:status'),
});

contextBridge.exposeInMainWorld('naeemanSetup', {
  state: () => ipcRenderer.invoke('setup:state'),
  saveRemote: (url) => ipcRenderer.invoke('setup:save', url),
  startHub: (input) => ipcRenderer.invoke('setup:hub', input),
  pickFolder: () => ipcRenderer.invoke('setup:pick-folder'),
});
