// Implementacao de DrumCoreApi (ver env.d.ts) baseada em Web Serial, pra
// rodar a mesma UI (App.tsx e' identico nos dois builds) numa pagina web
// pura, sem Electron - ver web-app/. Equivalente ao par
// src/main/serial.ts (processo Node/Electron) + src/preload/index.ts
// (contextBridge), so' que tudo roda no proprio navegador, sem IPC
// nenhum (os listeners de mensagem/erro sao so' um Set de callbacks
// locais).
//
// Diferencas em relacao ao build Electron:
// - listPorts() sempre retorna [] - Web Serial nao expoe nome/caminho de
//   porta (COM3, /dev/ttyUSB0 etc) por privacidade. A selecao de
//   dispositivo acontece dentro de connect(), via
//   navigator.serial.requestPort() - o proprio navegador mostra o
//   seletor nativo (mais simples que o Electron, que precisa de um
//   handler manual pro evento 'select-serial-port' - ver
//   src/main/index.ts).
// - connect() ignora o argumento `path` (nao existe no mundo Web Serial).
import type { DrumCoreApi, PortInfo } from './env'

const BAUD_RATE = 115200

class WebSerialDrumCore implements DrumCoreApi {
  private port: SerialPort | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private reader: ReadableStreamDefaultReader<string> | null = null
  private readonly encoder = new TextEncoder()
  private readonly messageListeners = new Set<(line: string) => void>()
  private readonly errorListeners = new Set<(message: string) => void>()

  async listPorts(): Promise<PortInfo[]> {
    return []
  }

  async connect(): Promise<void> {
    await this.disconnect()
    const port = await navigator.serial.requestPort()
    await port.open({ baudRate: BAUD_RATE })
    this.port = port
    this.writer = port.writable!.getWriter()
    // Nao usa await de proposito - o loop roda em paralelo, entregando
    // linhas via onMessage() ate' disconnect() cancelar o reader.
    void this.readLoop(port)
  }

  private async readLoop(port: SerialPort): Promise<void> {
    const textDecoder = new TextDecoderStream()
    // O tipo generico de TextDecoderStream.writable (WritableStream<BufferSource>)
    // nao bate 1:1 com o de SerialPort.readable (ReadableStream<Uint8Array>) nas
    // lib.dom.d.ts atuais, apesar de serem compativeis em runtime - cast direto.
    const pipePromise = port.readable!
      .pipeTo(textDecoder.writable as unknown as WritableStream<Uint8Array>)
      .catch(() => {
        // Erro esperado quando disconnect() cancela o reader - ver abaixo.
      })
    const reader = textDecoder.readable.getReader()
    this.reader = reader

    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (!value) continue
        buffer += value
        let newlineIndex: number
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
          buffer = buffer.slice(newlineIndex + 1)
          if (line) {
            this.messageListeners.forEach((callback) => callback(line))
          }
        }
      }
    } catch (err) {
      this.errorListeners.forEach((callback) =>
        callback(err instanceof Error ? err.message : String(err))
      )
    }
    await pipePromise
  }

  async disconnect(): Promise<void> {
    try {
      await this.reader?.cancel()
    } catch {
      // Ignora - a porta pode ja ter sido desconectada fisicamente.
    }
    this.reader = null

    if (this.writer) {
      try {
        this.writer.releaseLock()
      } catch {
        // Ignora.
      }
      this.writer = null
    }

    if (this.port) {
      try {
        await this.port.close()
      } catch {
        // Ignora.
      }
      this.port = null
    }
  }

  async send(line: string): Promise<void> {
    if (!this.writer) throw new Error('Porta serial não está conectada')
    await this.writer.write(this.encoder.encode(line + '\n'))
  }

  async isConnected(): Promise<boolean> {
    return this.port !== null
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

export function installWebDrumCore(): void {
  window.drumCore = new WebSerialDrumCore()
}
