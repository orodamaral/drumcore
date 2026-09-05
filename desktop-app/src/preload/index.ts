import { contextBridge, ipcRenderer } from 'electron'

export interface PortInfo {
  path: string
  manufacturer?: string
}

export interface FirmwareManifest {
  version: string
  chip: string
  flash_size: string
  flash_mode: string
  offset: string
  file: string
}

export interface LatestFirmware {
  manifest: FirmwareManifest
  downloadUrl: string
}

const api = {
  listPorts: (): Promise<PortInfo[]> => ipcRenderer.invoke('serial:list-ports'),
  connect: (path: string): Promise<void> => ipcRenderer.invoke('serial:connect', path),
  disconnect: (): Promise<void> => ipcRenderer.invoke('serial:disconnect'),
  send: (line: string): Promise<void> => ipcRenderer.invoke('serial:send', line),
  isConnected: (): Promise<boolean> => ipcRenderer.invoke('serial:is-connected'),
  // Fetch/download de release do GitHub roda no processo main (Node, sem
  // enforcement de CORS) - ver src/main/firmwareRelease.ts pro racional.
  getLatestFirmware: (): Promise<LatestFirmware> => ipcRenderer.invoke('firmware:get-latest'),
  downloadFirmwareBinary: (url: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('firmware:download-binary', url),
  onMessage: (callback: (line: string) => void) => {
    const listener = (_event: unknown, line: string) => callback(line)
    ipcRenderer.on('serial:message', listener)
    return () => ipcRenderer.removeListener('serial:message', listener)
  },
  onError: (callback: (message: string) => void) => {
    const listener = (_event: unknown, message: string) => callback(message)
    ipcRenderer.on('serial:error', listener)
    return () => ipcRenderer.removeListener('serial:error', listener)
  }
}

contextBridge.exposeInMainWorld('drumCore', api)

export type DrumCoreApi = typeof api
