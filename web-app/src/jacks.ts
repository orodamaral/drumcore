// Agrupamento físico dos canais: cada jack TRS da jackboard leva 2 canais
// (8 jacks = 16 canais por placa, 2 placas = 32 canais). Canal 0-based par
// (0, 2, 4...) = TIP, ímpar (1, 3, 5...) = RING - confirmado pelo Rodrigo
// em 2026-09-27. Na numeração da interface (1-based): Pad 1 = tip, Pad 2 =
// ring, Pad 3 = tip... Índices aqui são 0-based (pad 0 = "Pad 1").
//
// Sensores de 2 canais (PAD_TYPE_META.channels === 2) leem a zona principal
// no próprio canal (pin_1) e a 2ª zona no seguinte (pin_2 = i+1) - ver
// recomputeChannelPrimary() em main.cpp. Então só fazem sentido começando
// no 1º canal do jack (tip) - e aí tip = pele/corpo, ring = aro/borda, o
// padrão dos pads de mercado. Começando no ring eles "atravessam" pro jack
// seguinte, o que não funciona com um cabo estéreo só.
import { JACK_LABEL_MAX_LEN, PadConfig, PadType, PAD_TYPE_META } from './protocol'

export const JACKS_PER_BOARD = 8

export type JackPos = 'ring' | 'tip'

export function jackOf(pad: number): number {
  return Math.floor(pad / 2)
}

export function jackPos(pad: number): JackPos {
  return pad % 2 === 0 ? 'tip' : 'ring'
}

export function boardOf(jack: number): 'A' | 'B' {
  return jack < JACKS_PER_BOARD ? 'A' : 'B'
}

/** "Jack 2" (1-based, contínuo entre as 2 placas). */
export function jackLabel(jack: number): string {
  return `Jack ${jack + 1}`
}

/** Um sensor de 2 canais pode começar neste pad sem atravessar pro jack seguinte? */
export function canStartTwoChannel(pad: number): boolean {
  return jackPos(pad) === 'tip'
}

/** Pad primário de 2 canais começando no ring - consome o tip do jack seguinte. */
export function crossesJacks(p: PadConfig | undefined): boolean {
  return Boolean(p?.primary && PAD_TYPE_META[p.pad_type].channels === 2 && !canStartTwoChannel(p.pad))
}

// Zona lida em cada canal pelos tipos de 2 canais: [canal principal, 2º canal].
const TWO_CHANNEL_ZONES: Partial<Record<PadType, [string, string]>> = {
  1: ['pele', 'aro'],
  3: ['corpo', 'borda'],
  4: ['corpo', 'borda'],
  5: ['corpo', 'borda / cup'],
  8: ['pele', 'borda / aro']
}

export function twoChannelZones(type: PadType): [string, string] {
  return TWO_CHANNEL_ZONES[type] ?? ['zona 1', 'zona 2']
}

/** Só ASCII imprimível (a fonte da tela não tem acentos): "Condução" -> "Conduc". */
export function sanitizeJackLabel(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .slice(0, JACK_LABEL_MAX_LEN)
}

/** O que a LIVE mostra sem apelido: nome do pad do tip (ou do ring), cortado em 6. */
export function jackFallbackName(pads: Array<PadConfig | undefined>, jack: number): string {
  const tip = pads[2 * jack]
  const ring = pads[2 * jack + 1]
  const name = (tip?.primary && tip.label) || (ring?.primary && ring.label) || ''
  return sanitizeJackLabel(name)
}
