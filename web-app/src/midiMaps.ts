// Mapas de nota MIDI (GM, Addictive Drums 2, Superior Drummer 3) - só apresentação: nomeiam
// as notas e alimentam o seletor de instrumento no app. O módulo continua
// recebendo apenas o número da nota; nada disso vai pro firmware.
import { createContext, useContext } from 'react'

export type MidiMapId = 'gm' | 'ad2' | 'sd3'

export interface MidiMapGroup {
  label: string
  notes: number[]
}

export interface MidiMap {
  id: MidiMapId
  label: string
  description: string
  /** Nome curto de cada nota mapeada. Notas ausentes = sem uso nesse mapa. */
  names: Record<number, string>
  /** Grupos do seletor "Instrumento" (optgroup). */
  groups: MidiMapGroup[]
  /**
   * Oitava da nota 0. -1 => 60 = C4, 36 = C2 (convenção do MIDI Monitor);
   * -2 => 60 = C3, 36 = C1 (convenção usada no keymap do Addictive Drums 2).
   */
  octaveOfZero: number
}

// ------------------------------------------------------------ General MIDI

// Mapa GM de percussão (canal 10). Nomes em PT-BR nos mais comuns.
const GM_NAMES: Record<number, string> = {
  35: 'Bumbo acústico',
  36: 'Bumbo',
  37: 'Aro (side stick)',
  38: 'Caixa',
  39: 'Palmas',
  40: 'Caixa eletrônica',
  41: 'Surdo grave',
  42: 'Chimbal fechado',
  43: 'Surdo',
  44: 'Chimbal pedal',
  45: 'Tom grave',
  46: 'Chimbal aberto',
  47: 'Tom médio-grave',
  48: 'Tom médio-agudo',
  49: 'Ataque 1',
  50: 'Tom agudo',
  51: 'Condução 1',
  52: 'China',
  53: 'Cúpula (ride bell)',
  54: 'Pandeirola',
  55: 'Splash',
  56: 'Cowbell',
  57: 'Ataque 2',
  58: 'Vibraslap',
  59: 'Condução 2',
  60: 'Hi Bongo',
  61: 'Low Bongo',
  62: 'Mute Hi Conga',
  63: 'Open Hi Conga',
  64: 'Low Conga',
  65: 'High Timbale',
  66: 'Low Timbale',
  67: 'High Agogo',
  68: 'Low Agogo',
  69: 'Cabasa',
  70: 'Maracas',
  71: 'Short Whistle',
  72: 'Long Whistle',
  73: 'Short Guiro',
  74: 'Long Guiro',
  75: 'Claves',
  76: 'Hi Wood Block',
  77: 'Low Wood Block',
  78: 'Mute Cuica',
  79: 'Open Cuica',
  80: 'Mute Triangle',
  81: 'Open Triangle'
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

const GM: MidiMap = {
  id: 'gm',
  label: 'General MIDI (GM)',
  description: 'Padrão GM de percussão (canal 10) — funciona com a maioria dos sintetizadores e DAWs.',
  names: GM_NAMES,
  groups: [
    { label: 'Bumbo', notes: [36, 35] },
    { label: 'Caixa', notes: [38, 40, 37, 39] },
    { label: 'Chimbal', notes: [42, 46, 44] },
    { label: 'Toms', notes: [50, 48, 47, 45, 43, 41] },
    { label: 'Pratos', notes: [49, 57, 51, 59, 53, 55, 52] },
    { label: 'Percussão', notes: [54, 56, 58, ...range(60, 81)] }
  ],
  octaveOfZero: -1
}

// ------------------------------------------------------------ Addictive Drums 2

// Fonte: keymap oficial do Addictive Drums 2 ("Addictive Drums 2 Keymap",
// XLN Audio, 2021-06-02). Nomes mantidos em inglês, iguais aos da
// interface do AD2.
const AD2_NAMES: Record<number, string> = {
  // posição por CC
  3: 'Ride 2 · CCpos (Tip<>Bell)',
  4: 'Ride 1 · CCpos (Tip<>Bell)',
  5: 'Snare · CCpos brush (Closed<>Shallow)',
  6: 'Snare · CCpos (Open<>Shallow)',
  7: 'HiHat · CC Shaft',
  8: 'HiHat · CC Tip',
  9: 'HiHat · CC Bell',
  // vassourinha
  26: 'Snare (brushes) · Sweep Short 1',
  28: 'Snare (brushes) · Sweep Short 2',
  29: 'Snare (brushes) · Sweep No Accent',
  30: 'Snare (brushes) · Sweep Fast Bright Accent',
  31: 'Snare (brushes) · Sweep Slow Bright Accent',
  32: 'Snare (brushes) · Sweep Fast Dark Accent',
  33: 'Snare (brushes) · Sweep Slow Dark Accent',
  34: 'Snare (brushes) · Sweep Mute',
  35: 'Snare (brushes) · Closed Soft Tap',
  // kit
  36: 'Kick',
  37: 'Snare · Rimshot',
  38: 'Snare · Open Hit',
  39: 'Snare · Rimshot (dbl)',
  40: 'Snare · Open Hit (dbl)',
  41: 'Snare · Shallow Rimshot',
  42: 'Snare · SideStick',
  43: 'Snare · Shallow Hit',
  44: 'Snare · RimClick',
  45: 'Ride 1 · Tip (dbl)',
  46: 'Cymbal 1 · Hit (dbl)',
  47: 'Flexi 1 · Hit A',
  48: 'HiHat · Pedal Closed',
  49: 'HiHat · Closed 1 Tip',
  50: 'HiHat · Closed 1 Shaft',
  51: 'HiHat · Closed 2 Tip',
  52: 'HiHat · Closed 2 Shaft',
  53: 'HiHat · Closed Bell',
  54: 'HiHat · Open A',
  55: 'HiHat · Open B',
  56: 'HiHat · Open C',
  57: 'HiHat · Open D',
  58: 'HiHat · Open Bell',
  59: 'HiHat · Pedal Open',
  60: 'Ride 1 · Tip',
  61: 'Ride 1 · Bell',
  62: 'Ride 1 · Shaft',
  63: 'Ride 1 · Choke',
  65: 'Tom 4 · Open Hit',
  66: 'Tom 4 · Rimshot',
  67: 'Tom 3 · Open Hit',
  68: 'Tom 3 · Rimshot',
  69: 'Tom 2 · Open Hit',
  70: 'Tom 2 · Rimshot',
  71: 'Tom 1 · Open Hit',
  72: 'Tom 1 · Rimshot',
  73: 'Flexi 1 · Hit B',
  74: 'Flexi 1 · Hit C',
  75: 'Snare · Sticks',
  76: 'Flexi 1 · Hit D',
  77: 'Cymbal 1 · Hit',
  78: 'Cymbal 1 · Choke',
  79: 'Cymbal 2 · Hit',
  80: 'Cymbal 2 · Choke',
  81: 'Cymbal 3 · Hit',
  82: 'Cymbal 3 · Choke',
  84: 'Ride 2 · Tip',
  85: 'Ride 2 · Bell',
  86: 'Ride 2 · Shaft',
  87: 'Ride 2 · Choke',
  89: 'Cymbal 4 · Hit',
  90: 'Cymbal 4 · Choke',
  91: 'Cymbal 5 · Hit',
  92: 'Cymbal 5 · Choke',
  93: 'Cymbal 6 · Hit',
  94: 'Cymbal 6 · Choke',
  96: 'Flexi 2 · Hit A',
  97: 'Flexi 2 · Hit B',
  98: 'Flexi 2 · Hit C',
  99: 'Flexi 2 · Hit D',
  100: 'Flexi 3 · Hit A',
  101: 'Flexi 3 · Hit B',
  102: 'Flexi 3 · Hit C',
  103: 'Flexi 3 · Hit D'
}

const AD2: MidiMap = {
  id: 'ad2',
  label: 'Addictive Drums 2',
  description: 'Keymap padrão do Addictive Drums 2 (XLN Audio). Notas no padrão do AD2: 36 = C1.',
  names: AD2_NAMES,
  groups: [
    { label: 'Kick', notes: [36] },
    { label: 'Snare', notes: [38, 37, 42, 44, 43, 41, 40, 39, 75] },
    { label: 'HiHat', notes: [8, 7, 9, 48, 59, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58] },
    { label: 'Toms', notes: [71, 72, 69, 70, 67, 68, 65, 66] },
    { label: 'Ride 1', notes: [60, 62, 61, 63, 45] },
    { label: 'Ride 2', notes: [84, 86, 85, 87] },
    { label: 'Cymbals', notes: [77, 78, 46, 79, 80, 81, 82, 89, 90, 91, 92, 93, 94] },
    { label: 'Flexi', notes: [47, 73, 74, 76, 96, 97, 98, 99, 100, 101, 102, 103] },
    { label: 'Snare (brushes)', notes: [35, 34, 26, 28, 29, 30, 31, 32, 33] },
    { label: 'Posição por CC', notes: [3, 4, 5, 6] }
  ],
  octaveOfZero: -2
}

// ------------------------------------------------------------ Superior Drummer 3

// Fonte: "Keyboard Layout - Superior Drummer 3" (Toontrack, SDX/Superior
// Line). Notas 1-5 são reservadas pro sampler; "alias" (repetições) ficam de
// fora. Nomes em inglês, iguais aos da interface do SD3.
const SD3_NAMES: Record<number, string> = {
  // controladas pelo CC do pedal
  6: 'Snare · Position Trig (CC)',
  7: 'Hi-Hat · Edge Trig (CC)',
  8: 'Hi-Hat · Tip Trig (CC)',
  9: 'Hi-Hat · Bell Trig (CC)',
  20: 'Hi-Hat · Shaft Trig (CC)',
  // chimbal
  12: 'Hi-Hat · Open Tip 0',
  13: 'Hi-Hat · Open Tip 1',
  14: 'Hi-Hat · Open Tip 2',
  15: 'Hi-Hat · Open Tip 3',
  16: 'Hi-Hat · Open Tip 4',
  17: 'Hi-Hat · Open Tip 5',
  21: 'Hi-Hat · Closed Pedal',
  22: 'Hi-Hat · Closed Edge',
  23: 'Hi-Hat · Open Pedal',
  24: 'Hi-Hat · Open 1',
  25: 'Hi-Hat · Open 2',
  26: 'Hi-Hat · Open 3',
  42: 'Hi-Hat · Closed (GM)',
  44: 'Hi-Hat · Pedal (GM)',
  46: 'Hi-Hat · Open (GM)',
  60: 'Hi-Hat · Open Edge 4',
  61: 'Hi-Hat · Closed Tip',
  62: 'Hi-Hat · Tight Edge',
  63: 'Hi-Hat · Tight Tip',
  64: 'Hi-Hat · Open Edge 0',
  65: 'Hi-Hat · Seq Hits',
  119: 'Hi-Hat · Closed Bell',
  120: 'Hi-Hat · Open Bell 0',
  121: 'Hi-Hat · Open Bell 1',
  122: 'Hi-Hat · Open Bell 2',
  123: 'Hi-Hat · Open Bell 3',
  124: 'Hi-Hat · Open Bell 4',
  // bumbo e caixa
  35: 'Kick · Hit',
  36: 'Kick · Open',
  33: 'Snare · Edge',
  37: 'Snare · Sidestick',
  38: 'Snare · Center',
  39: 'Snare · Closed Roll',
  40: 'Snare · Rimshot',
  68: 'Snare · Muted Hit',
  69: 'Snare · Flam',
  70: 'Snare · Muted Accent',
  71: 'Snare · Rim Only',
  125: 'Snare · Off Center',
  // toms
  48: 'Racktom 1 · Center',
  82: 'Racktom 1 · Rimshot',
  81: 'Racktom 1 · Rim Only',
  47: 'Racktom 2 · Center',
  80: 'Racktom 2 · Rimshot',
  79: 'Racktom 2 · Rim Only',
  45: 'Racktom 3 · Center',
  78: 'Racktom 3 · Rimshot',
  77: 'Racktom 3 · Rim Only',
  43: 'Floortom 1 · Center',
  75: 'Floortom 1 · Rimshot',
  74: 'Floortom 1 · Rim Only',
  41: 'Floortom 2 · Center',
  73: 'Floortom 2 · Rimshot',
  72: 'Floortom 2 · Rim Only',
  // condução
  51: 'Ride · Bow Tip',
  29: 'Ride · Bow Shank',
  30: 'Ride · Bell Tip',
  53: 'Ride · Bell Shank',
  59: 'Ride · Crashed',
  118: 'Ride · Muted',
  // pratos
  84: 'Cymbal 1 · Bow Tip',
  85: 'Cymbal 1 · Bell Shank',
  86: 'Cymbal 1 · Crashed',
  87: 'Cymbal 1 · Bow Shank',
  88: 'Cymbal 1 · Bell Tip',
  83: 'Cymbal 1 · Muted',
  49: 'Cymbal 2 · Crashed',
  50: 'Cymbal 2 · Muted',
  27: 'Cymbal 2 · Bow Tip',
  28: 'Cymbal 2 · Bell Shank',
  92: 'Cymbal 2 · Bow Shank',
  93: 'Cymbal 2 · Bell Tip',
  55: 'Cymbal 3 · Crashed',
  56: 'Cymbal 3 · Muted',
  96: 'Cymbal 3 · Bow Tip',
  97: 'Cymbal 3 · Bell Shank',
  99: 'Cymbal 3 · Bow Shank',
  100: 'Cymbal 3 · Bell Tip',
  57: 'Cymbal 4 · Crashed',
  58: 'Cymbal 4 · Muted',
  31: 'Cymbal 4 · Bow Tip',
  32: 'Cymbal 4 · Bell Shank',
  104: 'Cymbal 4 · Bow Shank',
  105: 'Cymbal 4 · Bell Tip',
  52: 'Cymbal 5 · Crashed',
  54: 'Cymbal 5 · Muted',
  108: 'Cymbal 5 · Bow Tip',
  109: 'Cymbal 5 · Bell Shank',
  111: 'Cymbal 5 · Bow Shank',
  112: 'Cymbal 5 · Bell Tip',
  // vassourinha
  66: 'Brushes · Bwd Swirl',
  67: 'Brushes · Fwd Swirl',
  126: 'Brushes · Bwd Trig',
  127: 'Brushes · Fwd Trig'
}

const SD3: MidiMap = {
  id: 'sd3',
  label: 'Superior Drummer 3',
  description: 'Layout padrão do Superior Drummer 3 (Toontrack). Notas no padrão do SD3: 36 = C1.',
  names: SD3_NAMES,
  groups: [
    { label: 'Kick', notes: [36, 35] },
    { label: 'Snare', notes: [38, 40, 33, 37, 71, 125, 39, 68, 69, 70] },
    { label: 'Hi-Hat', notes: [8, 7, 9, 20, 21, 23, 44, 42, 46, 61, 22, 63, 62, 119, 24, 25, 26, 12, 13, 14, 15, 16, 17, 64, 60, 120, 121, 122, 123, 124, 65] },
    { label: 'Toms', notes: [48, 82, 81, 47, 80, 79, 45, 78, 77, 43, 75, 74, 41, 73, 72] },
    { label: 'Ride', notes: [51, 29, 53, 30, 59, 118] },
    { label: 'Cymbals', notes: [86, 84, 87, 85, 88, 83, 49, 27, 92, 28, 93, 50, 55, 96, 99, 97, 100, 56, 57, 31, 104, 32, 105, 58, 52, 108, 111, 109, 112, 54] },
    { label: 'Brushes', notes: [67, 66, 127, 126] },
    { label: 'Posição por CC', notes: [6] }
  ],
  octaveOfZero: -2
}

export const MIDI_MAPS: Record<MidiMapId, MidiMap> = { gm: GM, ad2: AD2, sd3: SD3 }
export const MIDI_MAP_IDS = Object.keys(MIDI_MAPS) as MidiMapId[]
export const DEFAULT_MIDI_MAP: MidiMapId = 'ad2'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function noteName(note: number, map: MidiMap): string {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) + map.octaveOfZero}`
}

// ------------------------------------------------------------ preferência (por navegador)

const STORAGE_KEY = 'drumcore.midiMap'

export function loadMidiMapId(): MidiMapId {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && v in MIDI_MAPS) return v as MidiMapId
  } catch {
    // storage bloqueado (janela anônima etc) - usa o padrão
  }
  return DEFAULT_MIDI_MAP
}

export function saveMidiMapId(id: MidiMapId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // idem - a escolha só não persiste
  }
}

export interface MidiMapState {
  map: MidiMap
  setMapId: (id: MidiMapId) => void
}

export const MidiMapContext = createContext<MidiMapState>({ map: AD2, setMapId: () => undefined })

export function useMidiMap(): MidiMap {
  return useContext(MidiMapContext).map
}

export function useSetMidiMap(): (id: MidiMapId) => void {
  return useContext(MidiMapContext).setMapId
}
