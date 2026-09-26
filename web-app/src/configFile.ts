// Arquivo de backup/compartilhamento da configuração (ConfigTool). Só app:
// exportar lê o estado que o app já tem (pad_config de cada pad); importar
// vira uma fila de set_pad/set_global - nada novo no protocolo. Formato
// documentado em docs/04-protocolo-serial.md ("Arquivo de configuração").
import {
  GlobalConfig,
  MIDI_OUTPUTS,
  PadConfig,
  PadConfigPrimary,
  PadField,
  PadType,
  PAD_FIELDS,
  PAD_LABEL_MAX_LEN,
  PAD_TYPE_META,
  PAD_TYPES
} from './protocol'
import { MidiMapId, MIDI_MAPS } from './midiMaps'

export const CONFIG_FORMAT = 'drumcore-config'
export const CONFIG_VERSION = 1

export interface ConfigFilePad {
  pad: number
  pad_type: PadType
  label: string
  enabled: boolean
  hihat_pedal_channel: number
  hihat_invert: boolean
  // + os 14 campos numéricos de PAD_FIELDS
  [field: string]: number | string | boolean
}

/** Globais do arquivo - -1 = ausente/inválido no arquivo (não é importado). */
export interface ConfigGlobal {
  midi_channel: number
  midi_output: number
}

export interface ConfigFile {
  format: typeof CONFIG_FORMAT
  version: number
  exported_at: string
  firmware_version?: string
  pad_count: number
  global: ConfigGlobal
  app?: { midi_map?: MidiMapId }
  pads: ConfigFilePad[]
}

/** Uma escrita da fila em lote (App.runOps). */
export interface BatchOp {
  cmd?: 'set_pad' | 'set_global'
  pad: number
  field: string
  value: number | string
}

// Faixas aceitas pelo firmware (handleSetPad) - iguais às de
// docs/04-protocolo-serial.md.
const FIELD_RANGE: Record<PadField, [number, number]> = {
  sensitivity: [0, 100],
  threshold: [0, 100],
  scan_time: [0, 100],
  mask_time: [0, 100],
  curve_type: [0, 4],
  retrigger: [0, 100],
  gain: [10, 200],
  xtalk: [0, 100],
  xtalk_group: [0, 4],
  rim_sensitivity: [0, 100],
  rim_threshold: [0, 100],
  note: [0, 127],
  note_rim: [0, 127],
  note_cup: [0, 127]
}

// ------------------------------------------------------------ exportar

export function buildConfigFile(
  pads: Array<PadConfig | undefined>,
  global: GlobalConfig,
  firmwareVersion: string | undefined,
  midiMap: MidiMapId
): ConfigFile {
  const out: ConfigFilePad[] = []
  for (const p of pads) {
    if (!p?.primary) continue
    const entry: ConfigFilePad = {
      pad: p.pad,
      pad_type: p.pad_type,
      label: p.label,
      enabled: p.enabled,
      hihat_pedal_channel: p.hihat_pedal_channel,
      hihat_invert: p.hihat_invert
    }
    for (const f of PAD_FIELDS) entry[f] = p[f]
    out.push(entry)
  }
  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    exported_at: new Date().toISOString(),
    firmware_version: firmwareVersion,
    pad_count: pads.length,
    global: { ...global },
    app: { midi_map: midiMap },
    pads: out
  }
}

export function configFileName(date = new Date()): string {
  const d = date.toISOString().slice(0, 10)
  return `drumcore-config-${d}.json`
}

// ------------------------------------------------------------ importar: validar

export interface ParsedConfig {
  file: ConfigFile
  warnings: string[]
}

export type ParseResult = { ok: true; value: ParsedConfig } | { ok: false; error: string }

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

export function parseConfigFile(text: string, padCount: number): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'O arquivo não é um JSON válido.' }
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Arquivo vazio ou em formato inesperado.' }
  const obj = raw as Record<string, unknown>
  if (obj.format !== CONFIG_FORMAT) {
    return { ok: false, error: 'Não é um arquivo de configuração do DrumCore (campo "format" ausente ou diferente).' }
  }
  if (!isInt(obj.version) || obj.version < 1) return { ok: false, error: 'Versão do arquivo inválida.' }
  if (obj.version > CONFIG_VERSION) {
    return { ok: false, error: `Arquivo gerado por uma versão mais nova do ConfigTool (formato v${obj.version}). Atualize a página e tente de novo.` }
  }
  if (!Array.isArray(obj.pads)) return { ok: false, error: 'Arquivo sem a lista de pads.' }

  const warnings: string[] = []
  const pads: ConfigFilePad[] = []
  const seen = new Set<number>()
  for (const item of obj.pads) {
    const e = item as Record<string, unknown>
    if (!e || !isInt(e.pad) || e.pad < 0 || e.pad >= padCount || seen.has(e.pad)) {
      warnings.push('Uma entrada de pad sem número válido (ou repetida) foi ignorada.')
      continue
    }
    const n = e.pad + 1
    if (!isInt(e.pad_type) || !(PAD_TYPES as readonly number[]).includes(e.pad_type)) {
      warnings.push(`Pad ${n}: tipo de sensor inválido — ignorado.`)
      continue
    }
    seen.add(e.pad)
    const entry: ConfigFilePad = {
      pad: e.pad,
      pad_type: e.pad_type as PadType,
      label: typeof e.label === 'string' ? e.label.slice(0, PAD_LABEL_MAX_LEN) : '',
      enabled: typeof e.enabled === 'boolean' ? e.enabled : true,
      hihat_pedal_channel: isInt(e.hihat_pedal_channel) ? e.hihat_pedal_channel : -1,
      hihat_invert: typeof e.hihat_invert === 'boolean' ? e.hihat_invert : false
    }
    if (typeof e.label === 'string' && e.label.length > PAD_LABEL_MAX_LEN) {
      warnings.push(`Pad ${n}: nome cortado em ${PAD_LABEL_MAX_LEN} caracteres.`)
    }
    for (const f of PAD_FIELDS) {
      const v = e[f]
      if (v === undefined) continue
      const [min, max] = FIELD_RANGE[f]
      if (!isInt(v) || v < min || v > max) {
        warnings.push(`Pad ${n}: ${f} fora da faixa (${String(v)}) — mantido o valor atual.`)
        continue
      }
      entry[f] = v
    }
    pads.push(entry)
  }
  pads.sort((a, b) => a.pad - b.pad)

  const g = (obj.global ?? {}) as Record<string, unknown>
  const global: ConfigGlobal = {
    midi_channel: isInt(g.midi_channel) && g.midi_channel >= 1 && g.midi_channel <= 16 ? g.midi_channel : -1,
    midi_output: (MIDI_OUTPUTS as readonly unknown[]).includes(g.midi_output) ? (g.midi_output as number) : -1
  }
  const app = (obj.app ?? {}) as Record<string, unknown>
  const midiMap = typeof app.midi_map === 'string' && app.midi_map in MIDI_MAPS ? (app.midi_map as MidiMapId) : undefined

  return {
    ok: true,
    value: {
      file: {
        format: CONFIG_FORMAT,
        version: obj.version,
        exported_at: typeof obj.exported_at === 'string' ? obj.exported_at : '',
        firmware_version: typeof obj.firmware_version === 'string' ? obj.firmware_version : undefined,
        pad_count: isInt(obj.pad_count) ? obj.pad_count : padCount,
        global,
        app: midiMap ? { midi_map: midiMap } : undefined,
        pads
      },
      warnings
    }
  }
}

// ------------------------------------------------------------ importar: planejar a fila

export interface ImportOptions {
  names: boolean
  global: boolean
}

export interface ImportPlan {
  ops: BatchOp[]
  padsTouched: number
  warnings: string[]
}

const CONFIG_REPLY_FIELDS = ['pad_type', 'label', 'enabled', 'hihat_pedal_channel', 'hihat_invert']

/** Campos cujo set_pad responde com pad_config (e não ack) - ver docs/04-protocolo-serial.md. */
export function repliesWithPadConfig(field: string): boolean {
  return CONFIG_REPLY_FIELDS.includes(field)
}

const usesTwo = (t: PadType) => PAD_TYPE_META[t].channels === 2

/**
 * Ordem importa: 1) tipos, do pad 1 ao 32 (mudar o tipo muda quais canais
 * ficam consumidos - subindo em ordem, cada pad já é primário quando chega a
 * vez dele); 2) nome/ativo/inverter/valores; 3) links de pedal (o alvo
 * precisa já ser um pedal); 4) globais. Só entra o que muda.
 */
export function planImport(
  file: ConfigFile,
  current: Array<PadConfig | undefined>,
  currentGlobal: GlobalConfig,
  opts: ImportOptions
): ImportPlan {
  const warnings: string[] = []
  const count = current.length
  const byPad = new Map(file.pads.map((p) => [p.pad, p]))
  const cur = (i: number): PadConfigPrimary | undefined => (current[i]?.primary ? (current[i] as PadConfigPrimary) : undefined)

  // Tipo efetivo de cada pad depois do import (simulação do firmware).
  const effType: PadType[] = []
  const primary: boolean[] = []
  const typeOps: BatchOp[] = []
  for (let i = 0; i < count; i++) {
    primary[i] = i === 0 || !(primary[i - 1] && usesTwo(effType[i - 1]))
    const want = byPad.get(i)
    let t: PadType = cur(i)?.pad_type ?? 0
    if (want) {
      if (!primary[i]) {
        warnings.push(`Pad ${i + 1}: no arquivo ele tem configuração própria, mas fica como 2ª zona do Pad ${i} — ignorado.`)
      } else if (usesTwo(want.pad_type) && (i % 2 === 1 || i >= count - 1)) {
        // Regra do tip (firmware: two_channel_needs_tip / no_second_channel).
        warnings.push(
          `Pad ${i + 1}: "${PAD_TYPE_META[want.pad_type].label}" precisa começar no tip do jack (pad ímpar) — tipo mantido.`
        )
      } else {
        t = want.pad_type
        if (!cur(i) || cur(i)!.pad_type !== t) typeOps.push({ pad: i, field: 'pad_type', value: t })
      }
    }
    effType[i] = t
  }

  const fieldOps: BatchOp[] = []
  const linkOps: BatchOp[] = []
  for (let i = 0; i < count; i++) {
    const want = byPad.get(i)
    if (!want || !primary[i]) continue
    const before = cur(i)
    // Pad que era 2ª zona (ou mudou de tipo): o app não conhece os valores
    // atuais dele de forma confiável - manda tudo.
    const fresh = !before || before.pad_type !== effType[i]
    const differs = (field: string, v: number | string | boolean) =>
      fresh || (before as unknown as Record<string, unknown>)[field] !== v

    if (opts.names && differs('label', want.label)) fieldOps.push({ pad: i, field: 'label', value: want.label })
    if (differs('enabled', want.enabled)) fieldOps.push({ pad: i, field: 'enabled', value: want.enabled ? 1 : 0 })
    if (PAD_TYPE_META[effType[i]].isHihatPedal && differs('hihat_invert', want.hihat_invert)) {
      fieldOps.push({ pad: i, field: 'hihat_invert', value: want.hihat_invert ? 1 : 0 })
    }
    for (const spec of PAD_TYPE_META[effType[i]].fields) {
      const v = want[spec.field]
      if (typeof v !== 'number') continue
      if (differs(spec.field, v)) fieldOps.push({ pad: i, field: spec.field, value: v })
    }

    if (PAD_TYPE_META[effType[i]].isHihatCymbal) {
      const link = want.hihat_pedal_channel
      const validLink = link === -1 || (link >= 0 && link < count && primary[link] && PAD_TYPE_META[effType[link]].isHihatPedal)
      if (!validLink) {
        warnings.push(`Pad ${i + 1}: pedal linkado (Pad ${link + 1}) não é um pedal de chimbal depois do import — link ignorado.`)
      } else if (differs('hihat_pedal_channel', link)) {
        linkOps.push({ pad: i, field: 'hihat_pedal_channel', value: link })
      }
    }
  }

  const globalOps: BatchOp[] = []
  if (opts.global) {
    if (file.global.midi_channel > 0 && file.global.midi_channel !== currentGlobal.midi_channel) {
      globalOps.push({ cmd: 'set_global', pad: -1, field: 'midi_channel', value: file.global.midi_channel })
    }
    if (file.global.midi_output >= 0 && file.global.midi_output !== currentGlobal.midi_output) {
      globalOps.push({ cmd: 'set_global', pad: -1, field: 'midi_output', value: file.global.midi_output })
    }
  }

  const missing = [...Array(count).keys()].filter((i) => primary[i] && !byPad.has(i))
  if (missing.length > 0 && file.pads.length > 0) {
    warnings.push(`${missing.length} pad(s) sem dados no arquivo continuam como estão: ${missing.map((i) => i + 1).join(', ')}.`)
  }

  const ops = [...typeOps, ...fieldOps, ...linkOps, ...globalOps]
  return { ops, padsTouched: new Set(ops.filter((o) => o.pad >= 0).map((o) => o.pad)).size, warnings }
}
