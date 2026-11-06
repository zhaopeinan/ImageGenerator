/** Electron 预加载脚本注入的桌面 API */
export interface ShenbiDesktopApi {
  isElectron: true
  getSettings: () => Promise<{
    dataRoot: string
    defaultDataRoot: string
    isCustom: boolean
    channelsPath: string
  }>
  chooseDataRoot: () => Promise<string | null>
  setDataRoot: (
    path: string,
    options?: { migrate?: boolean },
  ) => Promise<{ ok: boolean; needsRestart?: boolean; error?: string }>
  resetDataRoot: () => Promise<{ ok: boolean; needsRestart?: boolean; error?: string }>
  openDataRoot: () => Promise<{ ok: boolean; error?: string }>
}

declare global {
  interface Window {
    shenbi?: ShenbiDesktopApi
  }
}

export {}
