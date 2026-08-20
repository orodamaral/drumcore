import { PadConfig } from '../protocol'

interface Props {
  pads: Array<PadConfig | undefined>
  selectedPad: number
  lastHit: { pad: number; velocity: number } | null
  onSelect: (pad: number) => void
}

export default function PadGrid({ pads, selectedPad, lastHit, onSelect }: Props) {
  return (
    <div className="pad-list">
      {pads.map((pad, i) => {
        const consumed = pad && !pad.primary

        return (
          <button
            key={i}
            className={`pad-row${i === selectedPad ? ' selected' : ''}${lastHit?.pad === i ? ' hit' : ''}${consumed ? ' consumed' : ''}`}
            onClick={() => onSelect(i)}
            disabled={consumed}
          >
            <span className="pad-row-number">{i + 1}</span>

            {consumed ? (
              <span className="pad-row-consumed">2º canal do Pad {(pad as { consumed_by: number }).consumed_by + 1}</span>
            ) : (
              <>
                <span className={`pad-row-name${pad?.primary && pad.label ? '' : ' unnamed'}`}>
                  {pad?.primary && pad.label ? pad.label : 'Sem nome'}
                </span>
                <span className="pad-row-note">{pad?.primary ? `nota ${pad.note}` : '—'}</span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}
