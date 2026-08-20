import { PadConfig, PadField } from '../protocol'

interface Props {
  pad?: PadConfig
  onChange: (field: PadField, value: number) => void
}

const FIELD_META: Record<PadField, { label: string; min: number; max: number }> = {
  sensitivity: { label: 'Sensibilidade', min: 0, max: 100 },
  threshold: { label: 'Threshold', min: 0, max: 100 },
  scan_time: { label: 'Scan time', min: 0, max: 100 },
  mask_time: { label: 'Mask time', min: 0, max: 100 },
  curve_type: { label: 'Curva', min: 0, max: 4 },
  note: { label: 'Nota MIDI', min: 0, max: 127 }
}

export default function PadEditor({ pad, onChange }: Props) {
  if (!pad) {
    return <div className="pad-editor empty">Carregando configuração do pad...</div>
  }

  return (
    <div className="pad-editor">
      <h2>{pad.name}</h2>
      {(Object.keys(FIELD_META) as PadField[]).map((field) => {
        const meta = FIELD_META[field]
        return (
          <div className="field-row" key={field}>
            <label htmlFor={`field-${field}`}>{meta.label}</label>
            <input
              id={`field-${field}`}
              type="range"
              min={meta.min}
              max={meta.max}
              value={pad[field]}
              onChange={(event) => onChange(field, Number(event.target.value))}
            />
            <span className="field-value">{pad[field]}</span>
          </div>
        )
      })}
    </div>
  )
}
