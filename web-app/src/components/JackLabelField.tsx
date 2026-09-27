import { useEffect, useState } from 'react'
import { JACK_LABEL_MAX_LEN } from '../protocol'
import { jackLabel, sanitizeJackLabel } from '../jacks'

interface Props {
  jack: number
  label: string
  /** Texto que a tela LIVE mostra quando não há apelido (nome do pad). */
  fallback: string
  onCommit: (label: string) => void
}

// Apelido do jack na tela LIVE do módulo (1 célula por jack). Compartilhado
// pelos 2 pads do jack (tip + ring) - editar em qualquer um muda o mesmo.
export default function JackLabelField({ jack, label, fallback, onCommit }: Props) {
  const [draft, setDraft] = useState(label)

  useEffect(() => setDraft(label), [label, jack])

  function commit(): void {
    const clean = sanitizeJackLabel(draft)
    setDraft(clean)
    if (clean !== label) onCommit(clean)
  }

  const id = `jack-label-${jack}`
  return (
    <div className="param">
      <div className="param-head">
        <label htmlFor={id} className="param-label">
          Apelido do {jackLabel(jack)} (tela LIVE)
        </label>
      </div>
      <input
        id={id}
        type="text"
        className="jack-label-input"
        value={draft}
        maxLength={JACK_LABEL_MAX_LEN}
        placeholder={fallback || '--'}
        onChange={(e) => setDraft(sanitizeJackLabel(e.target.value))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            setDraft(label)
            e.currentTarget.blur()
          }
        }}
      />
      <p className="param-note">
        Até {JACK_LABEL_MAX_LEN} caracteres, sem acento (a fonte da tela não tem). Vale pros 2 pads do jack. Vazio = a
        tela mostra o nome do pad{fallback ? ` ("${fallback}")` : ''}.
      </p>
    </div>
  )
}
