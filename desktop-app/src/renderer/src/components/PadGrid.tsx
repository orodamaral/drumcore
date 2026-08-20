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
      {pads.map((pad, i) => (
        <button
          key={i}
          className={`pad-button${i === selectedPad ? ' selected' : ''}${lastHit?.pad === i ? ' hit' : ''}`}
          onClick={() => onSelect(i)}
        >
          <span className="pad-name">{pad?.name ?? `Pad ${i + 1}`}</span>
          <span className="pad-note">nota {pad?.note ?? '—'}</span>
        </button>
      ))}
    </div>
  )
}
