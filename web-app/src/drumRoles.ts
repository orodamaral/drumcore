// "Aplicar mapa aos pads": cada pad recebe um PAPEL (bumbo, caixa, tom...)
// e o papel vira notas por zona conforme o mapa MIDI e o tipo de sensor.
// Só gera set_pad de note/note_rim/note_cup - nada novo no protocolo.
import { MidiMapId } from './midiMaps'
import { PadConfigPrimary, PadField, PadType, PAD_TYPE_META } from './protocol'

export type DrumRole =
  | 'none'
  | 'kick'
  | 'snare'
  | 'tom1'
  | 'tom2'
  | 'tom3'
  | 'tom4'
  | 'hihat'
  | 'hihat_pedal'
  | 'ride'
  | 'crash1'
  | 'crash2'
  | 'splash'
  | 'china'

export const ROLE_LABELS: Record<DrumRole, string> = {
  none: '— não mudar —',
  kick: 'Bumbo',
  snare: 'Caixa',
  tom1: 'Tom 1',
  tom2: 'Tom 2',
  tom3: 'Tom 3',
  tom4: 'Surdo (Tom 4)',
  hihat: 'Chimbal',
  hihat_pedal: 'Pedal do chimbal',
  ride: 'Condução',
  crash1: 'Ataque 1',
  crash2: 'Ataque 2',
  splash: 'Splash',
  china: 'China'
}

export const ROLES = Object.keys(ROLE_LABELS) as DrumRole[]

/** Notas por "golpe" do instrumento. `main` sempre existe; o resto cai pra `main` se faltar. */
interface Slots {
  main: number
  rim?: number // aro / rimshot
  edge?: number // borda (prato) / borda da pele (caixa 3 zonas)
  bell?: number // cúpula
  open?: number // chimbal aberto
  closed?: number // chimbal fechado
  choke?: number // abafar prato (sensor de choke)
}

// GM não tem notas de aro/rimshot pros toms nem choke - essas zonas repetem
// a nota principal (ou ficam sem mudança, no caso do choke).
const GM_SLOTS: Record<Exclude<DrumRole, 'none'>, Slots> = {
  kick: { main: 36 },
  snare: { main: 38, rim: 40, edge: 38 },
  tom1: { main: 50 },
  tom2: { main: 48 },
  tom3: { main: 45 },
  tom4: { main: 43 },
  hihat: { main: 42, closed: 42, open: 46 },
  hihat_pedal: { main: 44 },
  ride: { main: 51, edge: 59, bell: 53 },
  crash1: { main: 49 },
  crash2: { main: 57 },
  splash: { main: 55 },
  china: { main: 52 }
}

// Addictive Drums 2 - notas do keymap (ver midiMaps.ts). Splash/China usam
// os slots Cymbal 3/4 do AD2 (o kit define qual prato está em cada slot).
// Chimbal: notas "CC" (8 tip / 7 shaft / 9 bell) - nota fixa, o AD2 decide
// aberto/fechado pelo CC do pedal (os tipos "chimbal" que trocavam a nota
// pelo pedal estão ocultos, ver HIDDEN_PAD_TYPES em protocol.ts).
const AD2_SLOTS: Record<Exclude<DrumRole, 'none'>, Slots> = {
  kick: { main: 36 },
  snare: { main: 38, rim: 37, edge: 43 },
  tom1: { main: 71, rim: 72 },
  tom2: { main: 69, rim: 70 },
  tom3: { main: 67, rim: 68 },
  tom4: { main: 65, rim: 66 },
  hihat: { main: 8, edge: 7, bell: 9 },
  hihat_pedal: { main: 48 },
  ride: { main: 60, edge: 62, bell: 61 },
  crash1: { main: 77, choke: 78 },
  crash2: { main: 79, choke: 80 },
  splash: { main: 81, choke: 82 },
  china: { main: 89, choke: 90 }
}

const SLOTS: Record<MidiMapId, Record<Exclude<DrumRole, 'none'>, Slots>> = { gm: GM_SLOTS, ad2: AD2_SLOTS }

type NoteField = Extract<PadField, 'note' | 'note_rim' | 'note_cup'>

/** Qual golpe vai em cada campo de nota, por tipo de sensor (ver rótulos em PAD_TYPE_META). */
function slotsToFields(type: PadType, s: Slots): Partial<Record<NoteField, number | undefined>> {
  switch (type) {
    case 0: // simples
      return { note: s.main }
    case 1: // pele + aro
      return { note: s.main, note_rim: s.rim ?? s.main }
    case 2: // chimbal simples: aberto / fechado
    case 4: // chimbal 2 zonas: corpo aberto / fechado-borda
      return { note: s.open ?? s.main, note_rim: s.closed ?? s.main }
    case 3: // prato 2 zonas: corpo / borda
      return { note: s.main, note_rim: s.edge ?? s.main }
    case 5: // prato 3 zonas: corpo / borda / cup
      return { note: s.main, note_rim: s.edge ?? s.main, note_cup: s.bell ?? s.main }
    case 6: // pedal (chick)
    case 7:
      return { note: s.main }
    case 8: // caixa 3 zonas: centro / borda / aro
      return { note: s.main, note_rim: s.edge ?? s.main, note_cup: s.rim ?? s.main }
    case 9: // choke: só faz sentido pra prato com nota de choke
      return { note: s.choke }
  }
}

/** Notas que o papel dá pra esse pad (campo -> nota), respeitando os campos do tipo. */
export function roleNotes(pad: PadConfigPrimary, role: DrumRole, map: MidiMapId): Array<{ field: NoteField; label: string; value: number }> {
  if (role === 'none') return []
  const fields = slotsToFields(pad.pad_type, SLOTS[map][role])
  const out: Array<{ field: NoteField; label: string; value: number }> = []
  for (const spec of PAD_TYPE_META[pad.pad_type].fields) {
    const f = spec.field as NoteField
    const v = fields[f]
    if (v !== undefined) out.push({ field: f, label: spec.label, value: v })
  }
  return out
}

// ------------------------------------------------------------ sugestão de papel

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const NAME_RULES: Array<[RegExp, DrumRole]> = [
  [/\b(bumbo|kick|bd|bass)\b/, 'kick'],
  [/\b(caixa|snare|sd)\b/, 'snare'],
  [/\bpedal\b/, 'hihat_pedal'],
  [/\b(chimbal|hi-?hat|hh)\b/, 'hihat'],
  [/\b(conducao|ride)\b/, 'ride'],
  [/\bsplash\b/, 'splash'],
  [/\bchina\b/, 'china'],
  [/\b(ataque|crash)\s*2\b/, 'crash2'],
  [/\b(ataque|crash)\b/, 'crash1'],
  [/\b(surdo|floor)\b/, 'tom4'],
  [/\btom\s*1\b/, 'tom1'],
  [/\btom\s*2\b/, 'tom2'],
  [/\btom\s*3\b/, 'tom3'],
  [/\btom\s*4\b/, 'tom4'],
  [/\btom\b/, 'tom1']
]

/** Nota atual -> papel, por mapa (reconhece um kit já configurado em GM ou AD2). */
const NOTE_ROLE: Record<MidiMapId, Record<number, DrumRole>> = { gm: {}, ad2: {} }
for (const id of Object.keys(SLOTS) as MidiMapId[]) {
  for (const [role, s] of Object.entries(SLOTS[id]) as Array<[DrumRole, Slots]>) {
    for (const n of [s.main, s.open, s.closed]) if (n !== undefined && !(n in NOTE_ROLE[id])) NOTE_ROLE[id][n] = role
  }
}
Object.assign(NOTE_ROLE.gm, { 35: 'kick', 40: 'snare', 47: 'tom2', 41: 'tom4' })

export function suggestRole(pad: PadConfigPrimary, map: MidiMapId): DrumRole {
  const name = normalize(pad.label)
  for (const [re, role] of NAME_RULES) if (re.test(name)) return role
  if (pad.pad_type === 6 || pad.pad_type === 7) return 'hihat_pedal'
  if (pad.pad_type === 2 || pad.pad_type === 4) return 'hihat'
  if (pad.pad_type === 5) return 'ride'
  if (pad.pad_type === 8) return 'snare'
  if (pad.pad_type === 9) return 'none'
  // Mapa escolhido primeiro (49 = Ataque no GM, mas Chimbal fechado no AD2).
  const other: MidiMapId = map === 'gm' ? 'ad2' : 'gm'
  return NOTE_ROLE[map][pad.note] ?? NOTE_ROLE[other][pad.note] ?? 'none'
}
