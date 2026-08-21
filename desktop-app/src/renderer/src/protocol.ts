// Tipos e helpers do protocolo NDJSON com o módulo. Contrato completo em
// docs/04-protocolo-serial.md - manter os dois em sincronia.

export const PAD_FIELDS = [
  'sensitivity',
  'threshold',
  'scan_time',
  'mask_time',
  'curve_type',
  'rim_sensitivity',
  'rim_threshold',
  'note',
  'note_rim',
  'note_cup'
] as const
export type PadField = (typeof PAD_FIELDS)[number]

export const PAD_LABEL_MAX_LEN = 19

// Tipos de sensor - ver docs/05-tipos-de-sensor.md. Nenhum tipo usa mais de
// 2 canais (limitação da própria lib base).
export const PAD_TYPES = [0, 1, 2, 3, 4, 5, 6, 7] as const
export type PadType = (typeof PAD_TYPES)[number]

export interface FieldSpec {
  field: PadField
  label: string
  min: number
  max: number
}

const SENSING_FIELDS: FieldSpec[] = [
  { field: 'sensitivity', label: 'Sensibilidade', min: 0, max: 100 },
  { field: 'threshold', label: 'Threshold', min: 0, max: 100 },
  { field: 'scan_time', label: 'Scan time', min: 0, max: 100 },
  { field: 'mask_time', label: 'Mask time', min: 0, max: 100 },
  { field: 'curve_type', label: 'Curva', min: 0, max: 4 }
]

export interface PadTypeMeta {
  label: string
  channels: 1 | 2
  /** Pode ser linkado a um pad do tipo "pedal" (chimbal simples/2 zonas). */
  isHihatCymbal: boolean
  /** Pode ser o alvo de um link (pedal de chimbal). */
  isHihatPedal: boolean
  fields: FieldSpec[]
}

export const PAD_TYPE_META: Record<PadType, PadTypeMeta> = {
  0: {
    label: 'Simples (1 zona)',
    channels: 1,
    isHihatCymbal: false,
    isHihatPedal: false,
    fields: [...SENSING_FIELDS, { field: 'note', label: 'Nota MIDI', min: 0, max: 127 }]
  },
  1: {
    label: 'Aro / Dual (head + rim)',
    channels: 2,
    isHihatCymbal: false,
    isHihatPedal: false,
    fields: [
      ...SENSING_FIELDS,
      { field: 'rim_sensitivity', label: 'Sensibilidade do aro', min: 0, max: 100 },
      { field: 'rim_threshold', label: 'Threshold do aro', min: 0, max: 100 },
      { field: 'note', label: 'Nota (head)', min: 0, max: 127 },
      { field: 'note_rim', label: 'Nota (rim)', min: 0, max: 127 }
    ]
  },
  2: {
    label: 'Chimbal simples',
    channels: 1,
    isHihatCymbal: true,
    isHihatPedal: false,
    fields: [
      ...SENSING_FIELDS,
      { field: 'note', label: 'Nota (aberto)', min: 0, max: 127 },
      { field: 'note_rim', label: 'Nota (fechado)', min: 0, max: 127 }
    ]
  },
  3: {
    label: 'Prato 2 zonas',
    channels: 2,
    isHihatCymbal: false,
    isHihatPedal: false,
    fields: [
      ...SENSING_FIELDS,
      { field: 'rim_sensitivity', label: 'Threshold da borda', min: 0, max: 100 },
      { field: 'note', label: 'Nota (corpo)', min: 0, max: 127 },
      { field: 'note_rim', label: 'Nota (borda)', min: 0, max: 127 }
    ]
  },
  4: {
    label: 'Chimbal 2 zonas',
    channels: 2,
    isHihatCymbal: true,
    isHihatPedal: false,
    fields: [
      ...SENSING_FIELDS,
      { field: 'rim_sensitivity', label: 'Threshold da borda', min: 0, max: 100 },
      { field: 'note', label: 'Nota (corpo, aberto)', min: 0, max: 127 },
      { field: 'note_rim', label: 'Nota (fechado / borda)', min: 0, max: 127 }
    ]
  },
  5: {
    label: 'Prato 3 zonas',
    channels: 2,
    isHihatCymbal: false,
    isHihatPedal: false,
    fields: [
      ...SENSING_FIELDS,
      { field: 'rim_sensitivity', label: 'Threshold da borda (edge)', min: 0, max: 100 },
      { field: 'rim_threshold', label: 'Threshold do cup', min: 0, max: 100 },
      { field: 'note', label: 'Nota (corpo)', min: 0, max: 127 },
      { field: 'note_rim', label: 'Nota (borda)', min: 0, max: 127 },
      { field: 'note_cup', label: 'Nota (cup)', min: 0, max: 127 }
    ]
  },
  6: {
    label: 'Pedal de chimbal (FSR / VH-10 / VH-11)',
    channels: 1,
    isHihatCymbal: false,
    isHihatPedal: true,
    fields: [
      ...SENSING_FIELDS,
      { field: 'rim_sensitivity', label: 'Sensibilidade do pedal', min: 0, max: 100 },
      { field: 'note', label: 'Nota (pedal chick)', min: 0, max: 127 }
    ]
  },
  7: {
    label: 'Pedal de chimbal óptico (TCRT5000)',
    channels: 1,
    isHihatCymbal: false,
    isHihatPedal: true,
    fields: [
      ...SENSING_FIELDS,
      { field: 'rim_sensitivity', label: 'Sensibilidade do pedal', min: 0, max: 100 },
      { field: 'note', label: 'Nota (pedal chick)', min: 0, max: 127 }
    ]
  }
}

export interface PadConfigPrimary {
  pad: number
  primary: true
  pad_type: PadType
  uses_second_channel: boolean
  /** Nome pronto pra exibir: "N - label", ou "Pad N" enquanto sem label. */
  name: string
  /** Texto livre "crú" (sem o prefixo do número) - editável só pelo app desktop. */
  label: string
  sensitivity: number
  threshold: number
  scan_time: number
  mask_time: number
  curve_type: number
  rim_sensitivity: number
  rim_threshold: number
  note: number
  note_rim: number
  note_cup: number
  /** -1 = nenhum pedal linkado. Só relevante pra pad_type 2 (chimbal simples) e 4 (chimbal 2 zonas). */
  hihat_pedal_channel: number
}

export interface PadConfigConsumed {
  pad: number
  primary: false
  /** Índice do pad anterior que consumiu esse canal (tipo de 2 canais). */
  consumed_by: number
}

export type PadConfig = PadConfigPrimary | PadConfigConsumed

// GLOBAL (design/SPEC.md SCR 5) - saida agora e' USB/BLE/USB+BLE, nao ha'
// circuito de MIDI DIN nesse hardware (ver docs/01-decisoes-arquiteturais.md).
export const MIDI_OUTPUTS = [0, 1, 2] as const
export type MidiOutput = (typeof MIDI_OUTPUTS)[number]
export const MIDI_OUTPUT_LABELS: Record<MidiOutput, string> = {
  0: 'USB',
  1: 'BLE',
  2: 'USB + BLE'
}

export interface GlobalConfig {
  midi_channel: number
  midi_output: MidiOutput
  brightness: number
}

export type IncomingMessage =
  | { type: 'pong' }
  | ({ type: 'device_info' } & {
      pads: number
      muxes: number
      midi_channel: number
      midi_output: MidiOutput
      brightness: number
      ble_connected: boolean
      firmware_phase: string
    })
  | ({ type: 'pad_config' } & PadConfig)
  | ({ type: 'hit' } & { pad: number; zone: string; note: number; velocity: number })
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
