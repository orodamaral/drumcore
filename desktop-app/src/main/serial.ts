import { SerialPort } from 'serialport'
import { ReadlineParser } from '@serialport/parser-readline'
import type { BrowserWindow } from 'electron'

// Baud rate fixo (definido em firmware/platformio.ini). Ver
// docs/04-protocolo-serial.md pro contrato completo (comandos/eventos NDJSON).
const BAUD_RATE = 115200

export class SerialConnection {
  private port: SerialPort | null = null
  private parser: ReadlineParser | null = null

  async listPorts() {
    return SerialPort.list()
  }

  connect(path: string, window: BrowserWindow): Promise<void> {
    this.disconnect()

    return new Promise((resolvePromise, rejectPromise) => {
      const port = new SerialPort({ path, baudRate: BAUD_RATE }, (err) => {
        if (err) {
          rejectPromise(err)
          return
        }
        this.port = port
        this.parser = port.pipe(new ReadlineParser({ delimiter: '\n' }))
        this.parser.on('data', (line: string) => {
          window.webContents.send('serial:message', line)
        })
        resolvePromise()
      })

      port.on('error', (err) => {
        window.webContents.send('serial:error', err.message)
      })
    })
  }

  send(line: string) {
    if (!this.port || !this.port.isOpen) {
      throw new Error('Porta serial nao esta conectada')
    }
    this.port.write(line + '\n')
  }

  disconnect() {
    if (this.port?.isOpen) {
      this.port.close()
    }
    this.port = null
    this.parser = null
  }

  isConnected() {
    return Boolean(this.port?.isOpen)
  }
}
