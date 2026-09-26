import { applyCurve, CURVE_NAMES } from '../uiMeta'
import { InfoTip } from './ParamSlider'

interface Props {
  value: number
  proposed?: number
  disabled?: boolean
  help: string
  onCommit: (value: number) => void
}

const W = 132
const H = 88
const PAD = 6

function curvePath(type: number): string {
  const pts: string[] = []
  for (let x = 1; x <= 127; x += 3) {
    const y = applyCurve(type, x)
    const px = PAD + ((x - 1) / 126) * (W - 2 * PAD)
    const py = H - PAD - ((y - 1) / 126) * (H - 2 * PAD)
    pts.push(`${pts.length ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`)
  }
  return pts.join(' ')
}

// Gráfico usa exatamente as fórmulas de HelloDrum::curve() (ver applyCurve()).
export default function CurveField({ value, proposed, disabled, help, onCommit }: Props) {
  return (
    <div className={`param curve-field${disabled ? ' disabled' : ''}`}>
      <div className="param-head">
        <span className="param-label" id="curve-label">
          Curva
        </span>
        <InfoTip id="curve-help" text={help} />
        {proposed !== undefined && proposed !== value && (
          <span className="param-proposed-badge">proposto: {CURVE_NAMES[proposed] ?? proposed}</span>
        )}
      </div>

      <div className="curve-body">
        <div className="segmented" role="radiogroup" aria-labelledby="curve-label" aria-describedby="curve-help">
          {CURVE_NAMES.map((name, i) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={value === i}
              className={`${value === i ? 'active' : ''}${proposed === i && proposed !== value ? ' ghost' : ''}`}
              disabled={disabled}
              onClick={() => value !== i && onCommit(i)}
            >
              {name}
            </button>
          ))}
        </div>

        <svg className="curve-chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Curva ${CURVE_NAMES[value]}: força × velocity`}>
          <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} className="curve-frame" />
          <path d={curvePath(0)} className="curve-ref" />
          {proposed !== undefined && proposed !== value && <path d={curvePath(proposed)} className="curve-ghost" />}
          <path d={curvePath(value)} className="curve-line" />
          <text x={W - PAD - 2} y={H - PAD - 3} className="curve-axis" textAnchor="end">
            força
          </text>
          <text x={PAD + 3} y={PAD + 10} className="curve-axis">
            vel
          </text>
        </svg>
      </div>
    </div>
  )
}
