import { useEffect, useMemo, useRef, useState } from 'react'
import { PadConfig } from '../protocol'
import { DrumRole, ROLE_LABELS, ROLES, roleNotes, suggestRole } from '../drumRoles'
import { MidiMapId, MIDI_MAPS, MIDI_MAP_IDS, useMidiMap, useSetMidiMap } from '../midiMaps'
import { PadOp, primaryPads } from '../padActions'
import { padTypeLabel } from '../uiMeta'

interface Props {
  allPads: Array<PadConfig | undefined>
  onClose: () => void
  onRun: (ops: PadOp[], label: string) => void
}

export default function ApplyMapDialog({ allPads, onClose, onRun }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const currentMap = useMidiMap()
  const setDefaultMap = useSetMidiMap()
  const [mapId, setMapId] = useState<MidiMapId>(currentMap.id)
  const [includeOff, setIncludeOff] = useState(false)
  const pads = primaryPads(allPads)
  const [roles, setRoles] = useState<Record<number, DrumRole>>(() =>
    Object.fromEntries(pads.map((p) => [p.pad, suggestRole(p, currentMap.id)]))
  )

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  const map = MIDI_MAPS[mapId]
  const rows = pads.filter((p) => includeOff || p.enabled)

  const ops = useMemo(() => {
    const out: PadOp[] = []
    for (const p of rows) {
      for (const n of roleNotes(p, roles[p.pad] ?? 'none', mapId)) {
        if (p[n.field] !== n.value) out.push({ pad: p.pad, field: n.field, value: n.value })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, roles, mapId, allPads])

  const padsTouched = new Set(ops.map((o) => o.pad)).size

  function apply(): void {
    setDefaultMap(mapId)
    onRun(ops, `Mapa ${map.label} aplicado em ${padsTouched} pad${padsTouched === 1 ? '' : 's'}`)
    dialogRef.current?.close()
  }

  return (
    <dialog ref={dialogRef} className="dialog dialog-wide" onClose={onClose} aria-labelledby="apply-map-title">
      <h2 id="apply-map-title">Aplicar mapa aos pads</h2>
      <p className="dialog-sub">
        Escolha o instrumento de cada pad — o app sugere pelo nome, tipo de sensor ou nota atual — e as notas de cada
        zona (pele, aro, borda, cúpula…) são preenchidas pelo mapa escolhido. Só as notas mudam.
      </p>

      <div className="apply-map-bar">
        <label className="param-label" htmlFor="apply-map-select">
          Mapa
        </label>
        <select id="apply-map-select" value={mapId} onChange={(e) => setMapId(e.target.value as MidiMapId)}>
          {MIDI_MAP_IDS.map((id) => (
            <option key={id} value={id}>
              {MIDI_MAPS[id].label}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={includeOff} onChange={(e) => setIncludeOff(e.target.checked)} />
          Incluir canais desligados
        </label>
      </div>

      <div className="apply-map-table-wrap">
        <table className="apply-map-table">
          <thead>
            <tr>
              <th>Pad</th>
              <th>Instrumento</th>
              <th>Notas resultantes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const role = roles[p.pad] ?? 'none'
              const notes = roleNotes(p, role, mapId)
              return (
                <tr key={p.pad} className={p.enabled ? '' : 'off'}>
                  <td>
                    <span className="target-num">{p.pad + 1}</span> <span>{p.label || <span className="dim">sem nome</span>}</span>
                    <div className="apply-map-type">{padTypeLabel(p.pad_type)}</div>
                  </td>
                  <td>
                    <select
                      value={role}
                      aria-label={`Instrumento do pad ${p.pad + 1}`}
                      onChange={(e) => setRoles((r) => ({ ...r, [p.pad]: e.target.value as DrumRole }))}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {role === 'none' ? (
                      <span className="dim">sem mudança</span>
                    ) : notes.length === 0 ? (
                      <span className="dim">esse mapa não tem nota pra esse tipo de sensor</span>
                    ) : (
                      <ul className="apply-map-notes">
                        {notes.map((n) => {
                          const changed = p[n.field] !== n.value
                          return (
                            <li key={n.field} className={changed ? 'changed' : ''}>
                              {notes.length > 1 && <span className="dim">{n.label}: </span>}
                              <strong>{n.value}</strong> {map.names[n.value] ?? ''}
                              {changed && <span className="dim"> (era {p[n.field]})</span>}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="dialog-foot">
        <span className="dialog-summary" aria-live="polite">
          {ops.length === 0
            ? 'Nada a mudar.'
            : `${ops.length} nota${ops.length === 1 ? '' : 's'} em ${padsTouched} pad${padsTouched === 1 ? '' : 's'}`}
          {mapId !== currentMap.id && ` · ${map.label} vira o mapa padrão`}
        </span>
        <button type="button" onClick={() => dialogRef.current?.close()}>
          Cancelar
        </button>
        <button type="button" className="btn-primary" disabled={ops.length === 0} onClick={apply}>
          Aplicar
        </button>
      </div>
    </dialog>
  )
}
