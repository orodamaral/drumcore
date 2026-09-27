// Metadados só de apresentação (textos de ajuda, unidades, padrões, seções,
// nomes de nota/GM, curvas) - nada aqui muda o que é enviado ao módulo. As
// faixas (min/max) continuam vindo de PAD_TYPE_META em protocol.ts.
import { PadField, PadType, PAD_TYPE_META } from './protocol'

export type SectionKey = 'detection' | 'response' | 'xtalk' | 'midi'

export const SECTION_TITLES: Record<SectionKey, string> = {
  detection: 'Detecção',
  response: 'Resposta',
  xtalk: 'Crosstalk',
  midi: 'MIDI'
}

export interface FieldUi {
  section: SectionKey
  /** Ordem visual dentro da seção (a ordem de envio no protocolo não muda). */
  order: number
  help: string
  unit?: string
  /** Padrão de fábrica (HelloDrum::begin() + primeira inicialização da EEPROM em main.cpp). */
  defaultValue?: number
  /** Texto exibido no lugar da unidade quando o valor é 0 (campos em que 0 = desligado). */
  zeroLabel?: string
}

export const FIELD_UI: Record<PadField, FieldUi> = {
  threshold: {
    section: 'detection',
    order: 0,
    help: 'Nível mínimo de sinal para contar como batida. Aumente se houver disparos falsos (ruído, vibração).',
    defaultValue: 10
  },
  sensitivity: {
    section: 'detection',
    order: 1,
    // curve() na lib: map(pico, threshold, sensitivity*10, 1, 127) - quanto
    // MAIOR o valor, mais força é preciso pra chegar em 127.
    help: 'Nível de sinal que corresponde à velocity máxima (127). Valores menores = chega a 127 com menos força.',
    defaultValue: 100
  },
  scan_time: {
    section: 'detection',
    order: 2,
    help: 'Janela em que o módulo procura o pico depois de detectar a batida. Maior = velocity mais precisa, porém mais latência.',
    unit: 'ms',
    defaultValue: 10
  },
  mask_time: {
    section: 'detection',
    order: 3,
    help: 'Tempo após uma batida em que novas batidas no mesmo pad são ignoradas. Evita disparos duplos.',
    unit: 'ms',
    defaultValue: 30
  },
  retrigger: {
    section: 'detection',
    order: 4,
    help: 'Dentro do mask time, deixa passar uma batida bem mais forte que a anterior (rufos rápidos). 0 = desligado.',
    defaultValue: 0,
    zeroLabel: 'desl.'
  },
  rim_sensitivity: {
    section: 'detection',
    order: 5,
    help: 'Ajuste da 2ª zona do sensor (aro/borda/pedal, conforme o tipo).',
    defaultValue: 20
  },
  rim_threshold: {
    section: 'detection',
    order: 6,
    help: 'Limiar da zona extra do sensor (aro/cup, conforme o tipo).',
    defaultValue: 3
  },
  curve_type: {
    section: 'response',
    order: 0,
    help: 'Como a força da batida é convertida em velocity.',
    defaultValue: 0
  },
  gain: {
    section: 'response',
    order: 1,
    help: 'Multiplicador aplicado ao sinal antes do threshold, para equalizar piezos mais fortes/fracos. 100% = neutro.',
    unit: '%',
    defaultValue: 100
  },
  xtalk_group: {
    section: 'xtalk',
    order: 0,
    help: 'Pads no mesmo grupo se suprimem mutuamente quando um bate muito mais forte no mesmo instante.',
    defaultValue: 0
  },
  xtalk: {
    section: 'xtalk',
    order: 1,
    help: 'Quanto este pad ignora batidas causadas por vibração de outros pads do mesmo grupo. 0 = desligado.',
    defaultValue: 0,
    zeroLabel: 'desl.'
  },
  note: { section: 'midi', order: 0, help: 'Nota enviada quando o pad é tocado.' },
  note_rim: { section: 'midi', order: 1, help: 'Nota enviada pela 2ª zona.' },
  note_cup: { section: 'midi', order: 2, help: 'Nota enviada pela 3ª zona.' },
  pedal_cc: {
    section: 'midi',
    order: 3,
    help: 'Número do CC que leva a posição do pedal (0 = aberto, 127 = fechado). 4 (Foot Controller) é o padrão do Addictive Drums, EZdrummer e da maioria dos softwares.',
    defaultValue: 4
  }
}

export const NOTE_FIELDS: PadField[] = ['note', 'note_rim', 'note_cup']

// ------------------------------------------------------------ tipo de sensor

/** "Simples (1 zona)" -> "Simples · 1 zona · 1 canal" (só exibição). */
export function padTypeLabel(type: PadType): string {
  const meta = PAD_TYPE_META[type]
  const base = meta.label.replace(/\s*\((.*)\)$/, ' · $1')
  return `${base} · ${meta.channels} ${meta.channels > 1 ? 'canais' : 'canal'}`
}

// Nomes de nota / mapas GM e Addictive Drums 2: ver midiMaps.ts.

// ------------------------------------------------------------ curvas

// Mesmos nomes/índices (0-4) do campo CURVA na tela física.
export const CURVE_NAMES = ['Linear', 'Exp 1', 'Exp 2', 'Log 1', 'Log 2']

// Bases usadas em HelloDrum::curve() (hellodrum.cpp) - 1 = linear.
const CURVE_BASES = [1, 1.02, 1.05, 0.98, 0.95]

/** Velocity (1-127) pra uma entrada já normalizada em 1-127, igual ao firmware. */
export function applyCurve(curveType: number, input: number): number {
  const b = CURVE_BASES[curveType] ?? 1
  const x = Math.min(127, Math.max(1, input))
  if (b === 1) return x
  return (126 / (Math.pow(b, 126) - 1)) * (Math.pow(b, x - 1) - 1) + 1
}
