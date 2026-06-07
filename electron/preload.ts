// Minimal preload bridge. contextIsolation is on, so the renderer (the existing React app, which
// talks to /api/* over http) gets no Node access — only a small, explicit `window.conduit` surface:
//   - platform hints
//   - secret: OS-keychain "remember on this device" for the wallet password (safeStorage in main)
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('conduit', {
  desktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  secret: {
    available: (): Promise<boolean> => ipcRenderer.invoke('secret:available'),
    set: (value: string): Promise<boolean> => ipcRenderer.invoke('secret:set', value),
    get: (): Promise<string | null> => ipcRenderer.invoke('secret:get'),
    clear: (): Promise<boolean> => ipcRenderer.invoke('secret:clear'),
  },
});
