// Tipos e helpers do protocolo NDJSON com o módulo. Contrato completo em
// docs/04-protocolo-serial.md - manter os dois em sincronia.

export interface PadConfig {
  pad: number
  name: string
  sensitivity: number
  threshold: number
  scan_time: number
  mask_time: number
  curve_type: number
  note: number
}

export const PAD_FIELDS = ['sensitivity', 'threshold', 'scan_time', 'mask_time', 'curve_type', 'note'] as const
export type PadField = (typeof PAD_FIELDS)[number]

export type IncomingMessage =
  | { type: 'pong' }
  | ({ type: 'device_info' } & { pads: number; muxes: number; midi_channel: number; firmware_phase: string })
  | ({ type: 'pad_config' } & PadConfig)
  | ({ type: 'hit' } & { pad: number; note: number; velocity: number })
  | { type: 'ack'; cmd: string; pad: number; field: string; value: number }
  | { type: 'error'; cmd: string; message: string }
  | { type: 'log'; message: string }

export function parseIncoming(line: string): IncomingMessage | null {
  try {
    const obj = JSON.parse(line)
    if (obj && typeof obj === 'object' && typeof obj.type === 'string') {
      return obj as IncomingMessage
    }
    return null
  } catch {
    return null
  }
}
