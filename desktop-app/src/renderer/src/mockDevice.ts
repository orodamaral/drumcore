import { PadConfig, PadField, PAD_FIELDS, IncomingMessage } from './protocol'

// Simula o firmware (protocolo NDJSON) inteiramente no renderer, sem tocar
// em nenhuma porta serial - permite testar/demonstrar a UI antes de ter o
// hardware montado. Ver docs/04-protocolo-serial.md pro contrato real.
export class MockDevice {
  private listeners: Array<(line: string) => void> = []
  private pads: PadConfig[]
  private hitTimer: ReturnType<typeof setInterval> | null = null

  constructor(padCount = 32) {
    this.pads = Array.from({ length: padCount }, (_, i) => ({
      pad: i,
      name: `Pad ${i + 1}`,
      sensitivity: 100,
      threshold: 10,
      scan_time: 10,
      mask_time: 30,
      curve_type: 0,
      note: 36 + i
    }))
  }

  onMessage(listener: (line: string) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  start(): void {
    this.emit({ type: 'log', message: 'Modo demo ativo - simulando o modulo, sem hardware real conectado.' })
    this.hitTimer = setInterval(() => {
      const pad = Math.floor(Math.random() * this.pads.length)
      const velocity = 40 + Math.floor(Math.random() * 87)
      this.emit({ type: 'hit', pad, note: this.pads[pad].note, velocity })
    }, 1800)
  }

  stop(): void {
    if (this.hitTimer) clearInterval(this.hitTimer)
    this.hitTimer = null
  }

  send(line: string): void {
    let cmd: { cmd?: string; pad?: number; field?: string; value?: number }
    try {
      cmd = JSON.parse(line)
    } catch {
      this.emit({ type: 'error', cmd: '?', message: 'invalid_json' })
      return
    }

    switch (cmd.cmd) {
      case 'ping':
        this.emit({ type: 'pong' })
        break

      case 'get_device_info':
        this.emit({
          type: 'device_info',
          pads: this.pads.length,
          muxes: 4,
          midi_channel: 10,
          firmware_phase: 'E (demo)'
        })
        break

      case 'get_all_pads':
        this.pads.forEach((pad) => this.emit({ type: 'pad_config', ...pad }))
        break

      case 'get_pad': {
        const pad = typeof cmd.pad === 'number' ? this.pads[cmd.pad] : undefined
        if (pad) this.emit({ type: 'pad_config', ...pad })
        else this.emit({ type: 'error', cmd: 'get_pad', message: 'invalid_pad' })
        break
      }

      case 'set_pad':
        this.handleSetPad(cmd)
        break

      default:
        this.emit({ type: 'error', cmd: cmd.cmd ?? '?', message: 'unknown_cmd' })
    }
  }

  private handleSetPad(cmd: { pad?: number; field?: string; value?: number }): void {
    const pad = typeof cmd.pad === 'number' ? this.pads[cmd.pad] : undefined
    if (!pad) {
      this.emit({ type: 'error', cmd: 'set_pad', message: 'invalid_pad' })
      return
    }
    if (!cmd.field || !PAD_FIELDS.includes(cmd.field as PadField) || typeof cmd.value !== 'number') {
      this.emit({ type: 'error', cmd: 'set_pad', message: 'unknown_field' })
      return
    }

    pad[cmd.field as PadField] = cmd.value
    this.emit({ type: 'ack', cmd: 'set_pad', pad: pad.pad, field: cmd.field, value: cmd.value })
  }

  private emit(message: IncomingMessage): void {
    const line = JSON.stringify(message)
    this.listeners.forEach((listener) => listener(line))
  }
}
