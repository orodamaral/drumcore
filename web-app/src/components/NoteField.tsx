import { useEffect, useState } from 'react'
import { noteName, useMidiMap } from '../midiMaps'
import { InfoTip } from './ParamSlider'

interface Props {
  id: string
  label: string
  help: string
  value: number
  disabled?: boolean
  /** Outros pads/zonas que já usam esta nota (ex: ["Pad 7", "Pad 3 (rim)"]). */
  sharedWith: string[]
  onCommit: (value: number) => void
}

export default function NoteField({ id, label, help, value, disabled, sharedWith, onCommit }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const map = useMidiMap()

  useEffect(() => setDraft(null), [value])

  function commit(v: number): void {
    const clamped = Math.min(127, Math.max(0, Math.round(v)))
    setDraft(null)
    if (clamped !== value) onCommit(clamped)
  }

  function commitDraft(): void {
    if (draft === null) return
    const parsed = Number(draft)
    if (draft.trim() === '' || Number.isNaN(parsed)) {
      setDraft(null)
      return
    }
    commit(parsed)
  }

  const instrument = map.names[value]
  const helpId = `${id}-help`

  return (
    <div className={`param note-field${disabled ? ' disabled' : ''}`}>
      <div className="param-head">
        <label htmlFor={id} className="param-label">
          {label}
        </label>
        <InfoTip id={helpId} text={help} />
      </div>

      <div className="note-body">
        <div className="stepper">
          <button type="button" onClick={() => commit(value - 1)} disabled={disabled || value <= 0} aria-label="Nota anterior">
            −
          </button>
          <input
            id={id}
            type="number"
            className="param-number"
            min={0}
            max={127}
            value={draft ?? String(value)}
            disabled={disabled}
            aria-describedby={helpId}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitDraft()
              if (event.key === 'Escape') setDraft(null)
            }}
          />
          <button type="button" onClick={() => commit(value + 1)} disabled={disabled || value >= 127} aria-label="Próxima nota">
            +
          </button>
        </div>

        <span className="note-name">
          <span className="note-octave">{noteName(value, map)}</span>
          {instrument ? (
            <span className="note-gm">{instrument}</span>
          ) : (
            <span className="note-gm dim">sem uso no {map.label}</span>
          )}
        </span>

        <select
          className="note-gm-select"
          value={instrument ? value : ''}
          disabled={disabled}
          aria-label={`${label}: escolher instrumento (${map.label})`}
          onChange={(event) => event.target.value !== '' && commit(Number(event.target.value))}
        >
          <option value="">Instrumento ({map.id === 'gm' ? 'GM' : map.label})…</option>
          {map.groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.notes.map((n) => (
                <option key={n} value={n}>
                  {n} · {map.names[n]}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {sharedWith.length > 0 && (
        <p className="param-note">Também usada por: {sharedWith.join(', ')}</p>
      )}
    </div>
  )
}
