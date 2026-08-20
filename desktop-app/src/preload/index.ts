import { contextBridge, ipcRenderer } from 'electron'

export interface PortInfo {
  path: string
  manufacturer?: string
}

const api = {
  listPorts: (): Promise<PortInfo[]> => ipcRenderer.invoke('serial:list-ports'),
  connect: (path: string): Promise<void> => ipcRenderer.invoke('serial:connect', path),
  disconnect: (): Promise<void> => ipcRenderer.invoke('serial:disconnect'),
  send: (line: string): Promise<void> => ipcRenderer.invoke('serial:send', line),
  isConnected: (): Promise<boolean> => ipcRenderer.invoke('serial:is-connected'),
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

contextBridge.exposeInMainWorld('helloDrum', api)

export type HelloDrumApi = typeof api
