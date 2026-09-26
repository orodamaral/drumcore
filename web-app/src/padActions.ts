// Ações em lote sobre pads (copiar/colar/restaurar/copiar para outros).
// Tudo vira uma lista de set_pad campo a campo - o mesmo comando que o
// editor já usa, sem nada novo no protocolo.
import { PadConfig, PadConfigPrimary, PadField, PadType, PAD_TYPE_META } from './protocol'
import { FIELD_UI, SectionKey, SECTION_TITLES } from './uiMeta'

export interface PadOp {
  pad: number
  field: PadField
  value: number
}

export type CopySection = SectionKey

export const COPY_SECTIONS: CopySection[] = ['detection', 'response', 'xtalk', 'midi']
/** Notas ficam desmarcadas por padrão: copiar a nota de um pad pra outro raramente é o que se quer. */
export const DEFAULT_COPY_SECTIONS: CopySection[] = ['detection', 'response', 'xtalk']
export const RESET_SECTIONS: CopySection[] = ['detection', 'response', 'xtalk']

export function sectionLabel(s: CopySection): string {
  return s === 'midi' ? 'Notas MIDI' : SECTION_TITLES[s]
}

// rim_sensitivity/rim_threshold mudam de significado conforme o tipo (aro,
// borda, cup, pedal - ver PAD_TYPE_META), então só são copiados entre pads
// do MESMO tipo de sensor.
const TYPE_SPECIFIC: PadField[] = ['rim_sensitivity', 'rim_threshold']

export interface PadSnapshot {
  sourcePad: number
  sourceType: PadType
  values: Partial<Record<PadField, number>>
}

export function snapshotPad(pad: PadConfigPrimary): PadSnapshot {
  const values: Partial<Record<PadField, number>> = {}
  for (const spec of PAD_TYPE_META[pad.pad_type].fields) values[spec.field] = pad[spec.field]
  return { sourcePad: pad.pad, sourceType: pad.pad_type, values }
}

/** set_pad necessários pra levar `target` aos valores do snapshot (só o que muda). */
export function opsFromSnapshot(target: PadConfigPrimary, snap: PadSnapshot, sections: CopySection[]): PadOp[] {
  const ops: PadOp[] = []
  for (const spec of PAD_TYPE_META[target.pad_type].fields) {
    if (!sections.includes(FIELD_UI[spec.field].section)) continue
    if (TYPE_SPECIFIC.includes(spec.field) && target.pad_type !== snap.sourceType) continue
    const v = snap.values[spec.field]
    if (v === undefined || v < spec.min || v > spec.max || v === target[spec.field]) continue
    ops.push({ pad: target.pad, field: spec.field, value: v })
  }
  return ops
}

/** set_pad pra voltar os campos das seções escolhidas ao padrão de fábrica. */
export function resetOps(target: PadConfigPrimary, sections: CopySection[]): PadOp[] {
  const ops: PadOp[] = []
  for (const spec of PAD_TYPE_META[target.pad_type].fields) {
    const ui = FIELD_UI[spec.field]
    if (!sections.includes(ui.section) || ui.defaultValue === undefined) continue
    const v = Math.min(spec.max, Math.max(spec.min, ui.defaultValue))
    if (v !== target[spec.field]) ops.push({ pad: target.pad, field: spec.field, value: v })
  }
  return ops
}

export function primaryPads(all: Array<PadConfig | undefined>): PadConfigPrimary[] {
  return all.filter((p): p is PadConfigPrimary => Boolean(p?.primary))
}

export function padDisplayName(pad: PadConfigPrimary): string {
  return pad.label ? `Pad ${pad.pad + 1} · ${pad.label}` : `Pad ${pad.pad + 1}`
}
