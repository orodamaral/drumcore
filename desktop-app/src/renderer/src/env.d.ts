// Espelha a API exposta pelo preload (src/preload/index.ts) via
// contextBridge. Mantido em duplicado de propósito (em vez de importar o
// tipo direto do preload) pra não misturar o tsconfig do renderer (DOM) com
// o do processo main/preload (Node) - ver tsconfig.web.json/tsconfig.node.json.
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

export interface DrumCoreApi {
  listPorts: () => Promise<PortInfo[]>
  connect: (path: string) => Promise<void>
  disconnect: () => Promise<void>
  send: (line: string) => Promise<void>
  isConnected: () => Promise<boolean>
  onMessage: (callback: (line: string) => void) => () => void
  onError: (callback: (message: string) => void) => () => void
  getLatestFirmware: () => Promise<LatestFirmware>
  downloadFirmwareBinary: (url: string) => Promise<Uint8Array>
}

declare global {
  interface Window {
    drumCore: DrumCoreApi
  }
}
