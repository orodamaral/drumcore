import { useEffect, useState } from 'react'
import { PadConfig, PadField, PadType, PAD_LABEL_MAX_LEN, PAD_TYPE_META, PAD_TYPES } from '../protocol'

interface Props {
  pad?: PadConfig
  allPads: Array<PadConfig | undefined>
  onChange: (field: PadField, value: number) => void
  onRename: (label: string) => void
  onChangeType: (type: PadType) => void
  onChangeHihatLink: (channel: number) => void
}

export default function PadEditor({ pad, allPads, onChange, onRename, onChangeType, onChangeHihatLink }: Props) {
  const [draftLabel, setDraftLabel] = useState(pad?.primary ? pad.label : '')

  // Ressincroniza o campo com o que veio do módulo sempre que trocar de pad
  // ou quando a confirmação do rename chegar (pad.label mudou de fora).
  useEffect(() => {
    setDraftLabel(pad?.primary ? pad.label : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pad?.pad, pad?.primary && pad.label])

  if (!pad) {
    return <div className="pad-editor empty">Carregando configuração do pad...</div>
  }

  if (!pad.primary) {
    return (
      <div className="pad-editor empty">
        Este canal é o 2º canal do <strong>Pad {pad.consumed_by + 1}</strong> (tipo de sensor de 2 canais) — não tem
        configuração própria. Mude o tipo do Pad {pad.consumed_by + 1} pra "1 canal" se quiser liberar esse canal.
      </div>
    )
  }

  const activePad = pad // narrowing (pad.primary === true) fica retido nessa const pros closures abaixo

  function commitLabel(): void {
    if (draftLabel !== activePad.label) {
      onRename(draftLabel)
    }
  }

  const meta = PAD_TYPE_META[activePad.pad_type]

  const availablePedals = allPads.filter(
    (p): p is PadConfig & { primary: true } => Boolean(p?.primary) && PAD_TYPE_META[(p as { pad_type: PadType }).pad_type].isHihatPedal
  )

  return (
    <div className="pad-editor">
      <div className="pad-rename">
        <span className="pad-number-badge">{activePad.pad + 1}</span>
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

      <div className="field-row">
        <label htmlFor="pad-type-select">Tipo de sensor</label>
        <select
          id="pad-type-select"
          className="pad-type-select"
          value={activePad.pad_type}
          onChange={(event) => onChangeType(Number(event.target.value) as PadType)}
        >
          {PAD_TYPES.map((type) => (
            <option key={type} value={type}>
              {PAD_TYPE_META[type].label} ({PAD_TYPE_META[type].channels} canal{PAD_TYPE_META[type].channels > 1 ? 'is' : ''})
            </option>
          ))}
        </select>
      </div>

      {meta.channels === 2 && (
        <p className="pad-hint">
          Esse tipo usa 2 canais (esse + o Pad {activePad.pad + 2}) — o canal seguinte fica reservado, sem configuração própria.
        </p>
      )}

      {meta.isHihatCymbal && (
        <div className="field-row">
          <label htmlFor="hihat-link-select">Pedal linkado</label>
          <select
            id="hihat-link-select"
            className="pad-type-select"
            value={activePad.hihat_pedal_channel}
            onChange={(event) => onChangeHihatLink(Number(event.target.value))}
          >
            <option value={-1}>Nenhum (sempre "aberto")</option>
            {availablePedals.map((p) => (
              <option key={p.pad} value={p.pad}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {meta.fields.map((spec) => (
        <div className="field-row" key={spec.field}>
          <label htmlFor={`field-${spec.field}`}>{spec.label}</label>
          <input
            id={`field-${spec.field}`}
            type="range"
            min={spec.min}
            max={spec.max}
            value={activePad[spec.field]}
            onChange={(event) => onChange(spec.field, Number(event.target.value))}
          />
          <span className="field-value">{activePad[spec.field]}</span>
        </div>
      ))}
    </div>
  )
}
