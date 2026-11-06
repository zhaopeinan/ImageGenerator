/**
 * 向渲染进程暴露受控 API（仅设置相关）。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shenbi', {
  isElectron: true,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  chooseDataRoot: () => ipcRenderer.invoke('settings:chooseDataRoot'),
  setDataRoot: (path, options) => ipcRenderer.invoke('settings:setDataRoot', path, options ?? {}),
  resetDataRoot: () => ipcRenderer.invoke('settings:resetDataRoot'),
  openDataRoot: () => ipcRenderer.invoke('settings:openDataRoot'),
})
