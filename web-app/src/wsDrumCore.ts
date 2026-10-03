// Implementação de DrumCoreApi (ver env.d.ts) por WebSocket, usada quando o
// app é aberto a partir da placa pelo Wi-Fi (Fase AE, ver hosted.ts). Mesmo
// protocolo NDJSON da serial: 1 comando por mensagem; cada mensagem que
// chega pode trazer 1 ou mais linhas.
import type { DrumCoreApi, PortInfo } from './env'

const CONNECT_TIMEOUT_MS = 5000

class WebSocketDrumCore implements DrumCoreApi {
  private ws: WebSocket | null = null
  private readonly messageListeners = new Set<(line: string) => void>()
  private readonly errorListeners = new Set<(message: string) => void>()

  async listPorts(): Promise<PortInfo[]> {
    return []
  }

  async connect(): Promise<void> {
    await this.disconnect()
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    const ws = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error('o módulo não respondeu pelo Wi-Fi'))
      }, CONNECT_TIMEOUT_MS)
      ws.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error('não foi possível abrir a conexão Wi-Fi com o módulo'))
      }
    })
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      for (const raw of event.data.split('\n')) {
        const line = raw.replace(/\r$/, '')
        if (line) this.messageListeners.forEach((callback) => callback(line))
      }
    }
    ws.onerror = null
    ws.onclose = () => {
      // Queda inesperada (Wi-Fi desligado no módulo, fora de alcance...). Um
      // disconnect() de propósito zera this.ws antes, e não cai aqui.
      if (this.ws !== ws) return
      this.ws = null
      this.errorListeners.forEach((callback) => callback('Conexão Wi-Fi com o módulo perdida'))
    }
    this.ws = ws
  }

  async disconnect(): Promise<void> {
    const ws = this.ws
    this.ws = null
    ws?.close()
  }

  async send(line: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('Módulo não está conectado pelo Wi-Fi')
    this.ws.send(line)
  }

  async isConnected(): Promise<boolean> {
    return this.ws?.readyState === WebSocket.OPEN
  }

  onMessage(callback: (line: string) => void): () => void {
    this.messageListeners.add(callback)
    return () => this.messageListeners.delete(callback)
  }

  onError(callback: (message: string) => void): () => void {
    this.errorListeners.add(callback)
    return () => this.errorListeners.delete(callback)
  }
}

export function installWsDrumCore(): void {
  window.drumCore = new WebSocketDrumCore()
}
