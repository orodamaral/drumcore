import {
  PadConfigPrimary,
  PadField,
  PAD_FIELDS,
  PAD_LABEL_MAX_LEN,
  PadType,
  PAD_TYPE_META,
  IncomingMessage
} from './protocol'

function nameFor(pad: number, label: string): string {
  return label ? `${pad + 1} - ${label}` : `Pad ${pad + 1}`
}

function usesSecondChannel(type: PadType): boolean {
  return PAD_TYPE_META[type].channels === 2
}

interface MockPad extends PadConfigPrimary {
  openHH: boolean // estado simulado do pedal (so relevante pros tipos "pedal")
}

// Simula o firmware (protocolo NDJSON) inteiramente no renderer, sem tocar
// em nenhuma porta serial - permite testar/demonstrar a UI antes de ter o
// hardware montado. Ver docs/04-protocolo-serial.md e
// docs/05-tipos-de-sensor.md pro contrato real.
export class MockDevice {
  private listeners: Array<(line: string) => void> = []
  private pads: MockPad[]
  private primary: boolean[]
  private hitTimer: ReturnType<typeof setInterval> | null = null

  constructor(padCount = 32) {
    this.pads = Array.from({ length: padCount }, (_, i) => this.freshPad(i))
    this.primary = Array.from({ length: padCount }, () => true)
  }

  private freshPad(i: number): MockPad {
    return {
      pad: i,
      primary: true,
      pad_type: 0,
      uses_second_channel: false,
      name: nameFor(i, ''),
      label: '',
      sensitivity: 100,
      threshold: 10,
      scan_time: 10,
      mask_time: 30,
      curve_type: 0,
      rim_sensitivity: 20,
      rim_threshold: 3,
      note: 36 + i,
      note_rim: 39,
      note_cup: 40,
      hihat_pedal_channel: -1,
      openHH: true
    }
  }

  private recomputePrimary(): void {
    for (let i = 0; i < this.pads.length; i++) {
      this.primary[i] = i === 0 ? true : !(this.primary[i - 1] && usesSecondChannel(this.pads[i - 1].pad_type))
    }
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
      const candidates = this.pads.filter((_, i) => this.primary[i])
      if (candidates.length === 0) return
      const pad = candidates[Math.floor(Math.random() * candidates.length)]
      const velocity = 40 + Math.floor(Math.random() * 87)
      const zone = this.randomZoneFor(pad)
      const note = this.noteForZone(pad, zone)
      this.emit({ type: 'hit', pad: pad.pad, zone, note, velocity })
    }, 1800)
  }

  stop(): void {
    if (this.hitTimer) clearInterval(this.hitTimer)
    this.hitTimer = null
  }

  private randomZoneFor(pad: MockPad): string {
    switch (pad.pad_type) {
      case 1:
        return Math.random() < 0.7 ? 'head' : 'rim'
      case 2:
        return pad.openHH ? 'open' : 'closed'
      case 3:
        return Math.random() < 0.7 ? 'bow' : 'edge'
      case 4:
        return Math.random() < 0.7 ? 'bow' : 'edge'
      case 5: {
        const r = Math.random()
        return r < 0.6 ? 'bow' : r < 0.85 ? 'edge' : 'cup'
      }
      case 6:
      case 7:
        return 'pedal'
      default:
        return 'bow'
    }
  }

  private noteForZone(pad: MockPad, zone: string): number {
    if (zone === 'rim' || zone === 'edge' || zone === 'closed') return pad.note_rim
    if (zone === 'cup') return pad.note_cup
    return pad.note
  }

  send(line: string): void {
    let cmd: { cmd?: string; pad?: number; field?: string; value?: number | string }
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
          firmware_phase: 'G (demo)'
        })
        break

      case 'get_all_pads':
        this.pads.forEach((_, i) => this.emitPadConfig(i))
        break

      case 'get_pad': {
        if (typeof cmd.pad === 'number' && this.pads[cmd.pad]) this.emitPadConfig(cmd.pad)
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

  private emitPadConfig(i: number): void {
    if (!this.primary[i]) {
      this.emit({ type: 'pad_config', pad: i, primary: false, consumed_by: i - 1 })
      return
    }
    const { openHH, ...config } = this.pads[i]
    void openHH
    this.emit({ type: 'pad_config', ...config })
  }

  private handleSetPad(cmd: { pad?: number; field?: string; value?: number | string }): void {
    const pad = typeof cmd.pad === 'number' ? this.pads[cmd.pad] : undefined
    if (!pad) {
      this.emit({ type: 'error', cmd: 'set_pad', message: 'invalid_pad' })
      return
    }
    if (!this.primary[pad.pad]) {
      this.emit({ type: 'error', cmd: 'set_pad', message: 'channel_consumed' })
      return
    }

    if (cmd.field === 'label') {
      const label = typeof cmd.value === 'string' ? cmd.value : ''
      if (label.length > PAD_LABEL_MAX_LEN) {
        this.emit({ type: 'error', cmd: 'set_pad', message: 'value_too_long' })
        return
      }
      pad.label = label
      pad.name = nameFor(pad.pad, label)
      this.emitPadConfig(pad.pad)
      return
    }

    if (cmd.field === 'pad_type') {
      const value = typeof cmd.value === 'number' ? cmd.value : -1
      if (!(value in PAD_TYPE_META)) {
        this.emit({ type: 'error', cmd: 'set_pad', message: 'value_out_of_range' })
        return
      }
      const newType = value as PadType
      if (usesSecondChannel(newType) && pad.pad >= this.pads.length - 1) {
        this.emit({ type: 'error', cmd: 'set_pad', message: 'no_second_channel' })
        return
      }

      pad.pad_type = newType
      pad.uses_second_channel = usesSecondChannel(newType)
      this.recomputePrimary()

      this.emitPadConfig(pad.pad)
      if (pad.pad + 1 < this.pads.length) this.emitPadConfig(pad.pad + 1)
      return
    }

    if (cmd.field === 'hihat_pedal_channel') {
      const value = typeof cmd.value === 'number' ? cmd.value : -1
      if (value < 0) {
        pad.hihat_pedal_channel = -1
      } else {
        const target = this.pads[value]
        if (!target || !PAD_TYPE_META[target.pad_type].isHihatPedal) {
          this.emit({ type: 'error', cmd: 'set_pad', message: 'invalid_pedal_channel' })
          return
        }
        pad.hihat_pedal_channel = value
      }
      this.emitPadConfig(pad.pad)
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
