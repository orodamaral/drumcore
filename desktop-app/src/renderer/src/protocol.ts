// Tipos e helpers do protocolo NDJSON com o módulo. Contrato completo em
// docs/04-protocolo-serial.md - manter os dois em sincronia.

export const PAD_FIELDS = [
  'sensitivity',
  'threshold',
  'scan_time',
  'mask_time',
  'curve_type',
  'retrigger',
  'gain',
  'xtalk',
  'xtalk_group',
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
export const PAD_TYPES = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const
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
  { field: 'curve_type', label: 'Curva', min: 0, max: 4 },
  // Fase P (inspirado no microDRUM/nanoDRUM - github.com/massimobernava/md-firmware):
  { field: 'retrigger', label: 'Retrigger', min: 0, max: 100 },
  { field: 'gain', label: 'Gain (calibração)', min: 10, max: 200 },
  { field: 'xtalk', label: 'Crosstalk', min: 0, max: 100 },
  { field: 'xtalk_group', label: 'Grupo de crosstalk', min: 0, max: 4 }
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
  },
  8: {
    label: 'Caixa 3 zonas (centro/borda/aro)',
    channels: 2,
    isHihatCymbal: false,
    isHihatPedal: false,
    fields: [
      ...SENSING_FIELDS,
      { field: 'rim_sensitivity', label: 'Threshold da borda (edge)', min: 0, max: 100 },
      { field: 'rim_threshold', label: 'Threshold do aro (rim)', min: 0, max: 100 },
      { field: 'note', label: 'Nota (centro)', min: 0, max: 127 },
      { field: 'note_rim', label: 'Nota (borda)', min: 0, max: 127 },
      { field: 'note_cup', label: 'Nota (aro)', min: 0, max: 127 }
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
  /** 0 = desligado (mask_time é corte rígido). >0: pancada bem mais forte que a anterior pode furar o mask_time (Fase P). */
  retrigger: number
  /** 10-200 = 0.10x-2.00x, 100 = neutro. Multiplicador de calibração aplicado ao sensor antes do threshold (Fase P). */
  gain: number
  /** 0 = desligado. Suprime o hit se outro pad do mesmo xtalk_group bateu bem mais forte no mesmo instante (Fase P). */
  xtalk: number
  /** 0 = nenhum grupo. Pads no mesmo grupo se suprimem mutuamente via xtalk (Fase P). */
  xtalk_group: number
  rim_sensitivity: number
  rim_threshold: number
  note: number
  note_rim: number
  note_cup: number
  /** -1 = nenhum pedal linkado. Só relevante pra pad_type 2 (chimbal simples) e 4 (chimbal 2 zonas). */
  hihat_pedal_channel: number
  /** false = canal desligado (slot sem sensor físico conectado) - firmware ignora esse canal por completo (Fase N). */
  enabled: boolean
  /** Só relevante pra pad_type 6/7 (controlador de pedal FSR/óptico) - inverte o CC final (127-CC). Fase X. */
  hihat_invert: boolean
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
}

// Assistente de auto-calibração (Fase O, inspirado no "Auto Tune" do
// microDRUM/nanoDRUM - github.com/massimobernava/md-firmware). "collecting"
// cobre as sub-fases internas do firmware (waiting/rising/decaying/cooldown)
// - o app só precisa saber "esperando o usuário bater" vs "processando".
//
// Fase T: a coleta agora é dividida em 3 níveis de força (fraco/médio/forte),
// 8 golpes cada (24 no total) - ver docs/01-decisoes-arquiteturais.md. Em
// "collecting", hit_count/hit_target contam o nível atual (não um total
// acumulado), e tier/tier_index/tier_count dizem qual nível está em coleta.
//
// Fase U: pads de 2 canais fazem 1 rodada extra inteira (mais 3 níveis, 24
// golpes) por zona além da principal, pra também calibrar rim_sensitivity/
// rim_threshold (que antes só davam pra ajustar na mão) - ver docs/01-
// decisoes-arquiteturais.md. "zone" só aparece quando o pad calibrado tem
// mais de 1 zona, e reaproveita o MESMO vocabulário do evento "hit" (zone
// em "hit" - ver PAD_TYPE_META/docs/05-tipos-de-sensor.md): "head"/"rim"
// pra PAD_DUAL (pad_type 1); "bow"/"edge"/"cup" pra PAD_CYMBAL_3ZONE
// (pad_type 5, Fase V); "head"/"edge"/"rim" pra PAD_SNARE_3ZONE (pad_type
// 8, Fase V) - 2 rodadas extras nesses últimos dois (edge e cup/rim são 2
// faixas de threshold no MESMO canal secundário, não um 3º piezo).
export const AUTOTUNE_HIT_TARGET = 8
export const AUTOTUNE_TIER_COUNT = 3
export const AUTOTUNE_HH_HOLD_MS = 3000
export type AutoTuneUiState = 'idle' | 'noise' | 'collecting' | 'done' | 'aborted'
export type AutoTuneTier = 'weak' | 'medium' | 'strong'
export type AutoTuneZone = 'head' | 'rim' | 'bow' | 'edge' | 'cup'

// "single" = 1 rodada (canal único ou pad_type sem calibração de 2ª zona
// ainda), "dual" = 2 rodadas (PAD_DUAL), "tri" = 3 rodadas (prato/caixa 3
// zonas) - fonte única pros lugares que exibem isso (PadEditor,
// mockDevice), pra não duplicar esse mapeamento.
export type AutoTuneShape = 'single' | 'dual' | 'tri'

export function autoTuneShapeFor(padType: PadType): AutoTuneShape {
  if (padType === 1) return 'dual'
  if (padType === 5 || padType === 8) return 'tri'
  return 'single'
}

// Sequência de zonas por pad_type, na ordem em que o assistente pede
// (1ª = zona principal). Mesmo vocabulário do evento "hit".
export function autoTuneZonesFor(padType: PadType): AutoTuneZone[] {
  if (padType === 1) return ['head', 'rim']
  if (padType === 5) return ['bow', 'edge', 'cup']
  if (padType === 8) return ['head', 'edge', 'rim']
  return []
}
// Fase X: controlador de pedal (HHC, pad_type 6/7) usa um assistente
// diferente do resto (sensor de posição contínua, não de impacto) - sem
// tier/hit_count, só 2 fases (`phase`) segurando o pedal aberto/fechado
// por um tempo (`hold_elapsed_ms`/`hold_target_ms`). O resultado final
// ganha `mode: "hihat_range"` pra a UI saber que sensitivity/threshold
// são o teto/piso de posição, não pico de pancada - ver
// docs/01-decisoes-arquiteturais.md.
export type AutoTuneHihatPhase = 'hh_open' | 'hh_closed'

export interface AutoTuneStatus {
  pad: number
  state: AutoTuneUiState
  hit_count: number
  hit_target: number
  tier?: AutoTuneTier
  tier_index?: number
  tier_count?: number
  zone?: AutoTuneZone
  phase?: AutoTuneHihatPhase
  hold_elapsed_ms?: number
  hold_target_ms?: number
  sensitivity?: number
  threshold?: number
  scan_time?: number
  mask_time?: number
  rim_sensitivity?: number
  rim_threshold?: number
  mode?: 'hihat_range'
  reason?: 'timeout' | 'channel_disabled'
}

export type IncomingMessage =
  | { type: 'pong' }
  | ({ type: 'device_info' } & {
      pads: number
      muxes: number
      midi_channel: number
      midi_output: MidiOutput
      ble_connected: boolean
      firmware_phase: string
    })
  | ({ type: 'pad_config' } & PadConfig)
  | ({ type: 'hit' } & { pad: number; zone: string; note: number; velocity: number })
  | ({ type: 'autotune_status' } & AutoTuneStatus)
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
