import { useEffect, useState } from 'react'
import { PadConfig, PadField, PAD_LABEL_MAX_LEN } from '../protocol'

interface Props {
  pad?: PadConfig
  onChange: (field: PadField, value: number) => void
  onRename: (label: string) => void
}

const FIELD_META: Record<PadField, { label: string; min: number; max: number }> = {
  sensitivity: { label: 'Sensibilidade', min: 0, max: 100 },
  threshold: { label: 'Threshold', min: 0, max: 100 },
  scan_time: { label: 'Scan time', min: 0, max: 100 },
  mask_time: { label: 'Mask time', min: 0, max: 100 },
  curve_type: { label: 'Curva', min: 0, max: 4 },
  note: { label: 'Nota MIDI', min: 0, max: 127 }
}

export default function PadEditor({ pad, onChange, onRename }: Props) {
  const [draftLabel, setDraftLabel] = useState(pad?.label ?? '')

  // Ressincroniza o campo com o que veio do módulo sempre que trocar de pad
  // ou quando a confirmação do rename chegar (pad.label mudou de fora).
  useEffect(() => {
    setDraftLabel(pad?.label ?? '')
  }, [pad?.pad, pad?.label])

  if (!pad) {
    return <div className="pad-editor empty">Carregando configuração do pad...</div>
  }

  function commitLabel(): void {
    if (draftLabel !== pad!.label) {
      onRename(draftLabel)
    }
  }

  return (
    <div className="pad-editor">
      <div className="pad-rename">
        <span className="pad-number-badge">{pad.pad + 1}</span>
        <input
          type="text"
          className="pad-rename-input"
          value={draftLabel}
          maxLength={PAD_LABEL_MAX_LEN}
          placeholder="Nome do pad (ex: Caixa)"
          onChange={(event) => setDraftLabel(event.target.value)}
          onBlur={commitLabel}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitLabel()
              event.currentTarget.blur()
            }
          }}
        />
      </div>

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
