import { PadConfig } from '../protocol'

interface Props {
  pads: Array<PadConfig | undefined>
  selectedPad: number
  lastHit: { pad: number; velocity: number } | null
  onSelect: (pad: number) => void
}

export default function PadGrid({ pads, selectedPad, lastHit, onSelect }: Props) {
  return (
    <div className="pad-grid">
      {pads.map((pad, i) => {
        const consumed = pad && !pad.primary

        return (
          <button
            key={i}
            className={`pad-button${i === selectedPad ? ' selected' : ''}${lastHit?.pad === i ? ' hit' : ''}${consumed ? ' consumed' : ''}`}
            onClick={() => onSelect(i)}
            disabled={consumed}
          >
            {consumed ? (
              <span className="pad-consumed">2º canal do pad {(pad as { consumed_by: number }).consumed_by + 1}</span>
            ) : (
              <>
                <span className="pad-name">{pad?.primary ? pad.name : `Pad ${i + 1}`}</span>
                <span className="pad-note">nota {pad?.primary ? pad.note : '—'}</span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}
