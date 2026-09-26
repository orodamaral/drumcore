// Desfazer/refazer das alterações de valores feitas pelo app. Cada entrada
// guarda o "antes" e o "depois" de cada campo; desfazer/refazer é só mandar
// set_pad de volta com o valor antigo/novo - nada novo no protocolo.
//
// Fora do histórico de propósito: nome, tipo de sensor (reorganiza os canais
// consumidos - desfazer isso campo a campo não é seguro), ativo, pedal
// linkado e inverter.
import { PadConfig, PadField, PAD_TYPE_META } from './protocol'
import { PadOp } from './padActions'

export interface HistoryChange {
  pad: number
  field: PadField
  from: number
  to: number
}

export interface HistoryEntry {
  label: string
  changes: HistoryChange[]
  time: number
}

export const HISTORY_MAX = 100
/** Envios seguidos do mesmo campo dentro dessa janela viram uma entrada só (arrastar slider). */
const COALESCE_MS = 2000

export function changesFor(ops: PadOp[], pads: Record<number, PadConfig>): HistoryChange[] {
  const out: HistoryChange[] = []
  for (const op of ops) {
    const p = pads[op.pad]
    if (!p?.primary) continue
    const from = p[op.field]
    if (from !== op.value) out.push({ pad: op.pad, field: op.field, from, to: op.value })
  }
  return out
}

/** Adiciona ao topo da pilha, juntando com a anterior se for o mesmo campo logo em seguida. */
export function pushEntry(stack: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const last = stack[stack.length - 1]
  const single = entry.changes.length === 1 ? entry.changes[0] : null
  const lastSingle = last?.changes.length === 1 ? last.changes[0] : null
  if (single && lastSingle && single.pad === lastSingle.pad && single.field === lastSingle.field && entry.time - last.time < COALESCE_MS) {
    const merged = { ...lastSingle, to: single.to }
    // Voltou ao valor original arrastando: a entrada deixa de existir.
    if (merged.from === merged.to) return stack.slice(0, -1)
    return [...stack.slice(0, -1), { ...last, changes: [merged], time: entry.time }]
  }
  return [...stack.slice(-(HISTORY_MAX - 1)), entry]
}

export function fieldLabel(pads: Record<number, PadConfig>, pad: number, field: PadField): string {
  const p = pads[pad]
  const spec = p?.primary ? PAD_TYPE_META[p.pad_type].fields.find((f) => f.field === field) : undefined
  return spec?.label ?? field
}

export function undoOps(entry: HistoryEntry): PadOp[] {
  return entry.changes.map((c) => ({ pad: c.pad, field: c.field, value: c.from }))
}

export function redoOps(entry: HistoryEntry): PadOp[] {
  return entry.changes.map((c) => ({ pad: c.pad, field: c.field, value: c.to }))
}
