import { MidiMapId, MIDI_MAPS, MIDI_MAP_IDS, useMidiMap, useSetMidiMap } from '../midiMaps'

// Escolha do mapa de notas (GM, Addictive Drums 2...). Preferência só do
// app, salva no navegador - não é enviada ao módulo.
export default function MidiMapSelect({ compact = false }: { compact?: boolean }) {
  const map = useMidiMap()
  const setMapId = useSetMidiMap()

  const select = (
    <select
      id={compact ? undefined : 'midi-map-select'}
      className={compact ? 'midi-map-compact' : 'full-select'}
      value={map.id}
      aria-label={compact ? 'Mapa MIDI' : undefined}
      title={compact ? `Mapa MIDI: ${map.description}` : undefined}
      onChange={(event) => setMapId(event.target.value as MidiMapId)}
    >
      {MIDI_MAP_IDS.map((id) => (
        <option key={id} value={id}>
          {MIDI_MAPS[id].label}
        </option>
      ))}
    </select>
  )

  if (compact) return select

  return (
    <div className="param">
      <div className="param-head">
        <label htmlFor="midi-map-select" className="param-label">
          Mapa MIDI padrão
        </label>
      </div>
      {select}
      <p className="param-note">
        {map.description} Define os nomes das notas e a lista de instrumentos no editor de pads. Fica salvo neste
        navegador — o módulo só recebe o número da nota.
      </p>
    </div>
  )
}
